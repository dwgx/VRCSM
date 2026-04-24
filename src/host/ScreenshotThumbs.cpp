#include "../pch.h"

#include "ScreenshotThumbs.h"

#include "StringUtil.h"

#include <wincodec.h>
#include <shlobj.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <queue>
#include <thread>
#include <unordered_set>

namespace vrcsm::host::ScreenshotThumbs
{

namespace
{

// ─── FNV-1a 64 — stable filename hash ──────────────────────────────
// Same algorithm as the frontend's placeholderGradient so callers can
// reconcile if ever needed. 64-bit keeps collision probability at
// ~10^-10 for the realistic file counts we handle (~10k screenshots).
constexpr std::uint64_t kFnvOffset = 0xcbf29ce484222325ULL;
constexpr std::uint64_t kFnvPrime = 0x100000001b3ULL;

std::uint64_t fnv1a64(std::string_view s) noexcept
{
    std::uint64_t h = kFnvOffset;
    for (unsigned char c : s)
    {
        h ^= c;
        h *= kFnvPrime;
    }
    return h;
}

std::string toHex64(std::uint64_t v)
{
    char buf[17];
    for (int i = 15; i >= 0; --i)
    {
        const int nibble = static_cast<int>(v & 0xF);
        buf[i] = static_cast<char>(nibble < 10 ? '0' + nibble : 'a' + nibble - 10);
        v >>= 4;
    }
    buf[16] = '\0';
    return std::string(buf, 16);
}

// Resolve %LocalAppData%\VRCSM\ — mirrors what AuthStore/ThumbCache do.
std::filesystem::path LocalAppDataRoot()
{
    wil::unique_cotaskmem_string path;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &path)))
    {
        return std::filesystem::path(path.get()) / L"VRCSM";
    }
    return std::filesystem::path{};
}

// ─── COM init per worker thread ────────────────────────────────────
// WIC requires COM initialised on the calling thread. We use MTA (free-
// threaded) on worker threads so the factory can be shared. Using a
// thread_local sentinel ensures each thread only inits once per life.

struct ComApartment
{
    bool initialised{false};
    ComApartment() noexcept
    {
        const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        initialised = SUCCEEDED(hr);
    }
    ~ComApartment() noexcept
    {
        if (initialised) CoUninitialize();
    }
};

thread_local ComApartment tlsCom;

// ─── WIC encode ────────────────────────────────────────────────────

std::vector<std::uint8_t> StreamToBytes(IStream* stream)
{
    LARGE_INTEGER zero{};
    stream->Seek(zero, STREAM_SEEK_SET, nullptr);
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME))) return {};
    const std::size_t size = static_cast<std::size_t>(stat.cbSize.QuadPart);
    std::vector<std::uint8_t> bytes(size);
    ULONG read = 0;
    if (FAILED(stream->Read(bytes.data(), static_cast<ULONG>(size), &read))) return {};
    bytes.resize(read);
    return bytes;
}

bool WriteJpeg(const std::filesystem::path& destPath,
               const std::vector<std::uint8_t>& bytes)
{
    // Write atomically: dest.tmp → rename → dest. Prevents a half-
    // written file ever being served while generation is in flight.
    std::filesystem::path tmp = destPath;
    tmp += L".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) return false;
        f.write(reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size()));
        if (!f.good()) { std::filesystem::remove(tmp); return false; }
    }
    std::error_code ec;
    std::filesystem::rename(tmp, destPath, ec);
    if (ec) { std::filesystem::remove(tmp, ec); return false; }
    return true;
}

// Core WIC pipeline: decode file → scale to fit maxEdge → encode JPEG.
std::vector<std::uint8_t> EncodeThumbnail(const std::filesystem::path& source, int maxEdge)
{
    using Microsoft::WRL::ComPtr;

    ComPtr<IWICImagingFactory> factory;
    HRESULT hr = CoCreateInstance(
        CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(factory.ReleaseAndGetAddressOf()));
    if (FAILED(hr)) return {};

    ComPtr<IWICBitmapDecoder> decoder;
    hr = factory->CreateDecoderFromFilename(
        source.wstring().c_str(), nullptr, GENERIC_READ,
        WICDecodeMetadataCacheOnLoad, decoder.ReleaseAndGetAddressOf());
    if (FAILED(hr)) return {};

    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, frame.ReleaseAndGetAddressOf()))) return {};

    UINT origW = 0, origH = 0;
    if (FAILED(frame->GetSize(&origW, &origH)) || origW == 0 || origH == 0) return {};

    // Fit within a maxEdge×maxEdge bounding box, preserving aspect.
    // If the source is already smaller, keep it (no upscaling).
    const double scale = (origW >= origH)
        ? std::min(1.0, static_cast<double>(maxEdge) / origW)
        : std::min(1.0, static_cast<double>(maxEdge) / origH);
    UINT newW = std::max<UINT>(1, static_cast<UINT>(origW * scale + 0.5));
    UINT newH = std::max<UINT>(1, static_cast<UINT>(origH * scale + 0.5));

    ComPtr<IWICBitmapScaler> scaler;
    if (FAILED(factory->CreateBitmapScaler(scaler.ReleaseAndGetAddressOf()))) return {};
    // Fant is the highest-quality filter WIC ships; cost is negligible
    // compared to PNG decode so we pay for quality.
    if (FAILED(scaler->Initialize(frame.Get(), newW, newH,
                                  WICBitmapInterpolationModeFant))) return {};

    // Convert to 24bpp BGR for JPEG (WIC JPEG encoder does not accept BGRA).
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(converter.ReleaseAndGetAddressOf()))) return {};
    if (FAILED(converter->Initialize(
            scaler.Get(), GUID_WICPixelFormat24bppBGR,
            WICBitmapDitherTypeNone, nullptr, 0.0,
            WICBitmapPaletteTypeCustom))) return {};

    // In-memory stream → JPEG encode → copy bytes out.
    ComPtr<IStream> memStream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, memStream.ReleaseAndGetAddressOf()))) return {};

    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr,
                                      encoder.ReleaseAndGetAddressOf()))) return {};
    if (FAILED(encoder->Initialize(memStream.Get(), WICBitmapEncoderNoCache))) return {};

    ComPtr<IWICBitmapFrameEncode> frameEncode;
    ComPtr<IPropertyBag2> propBag;
    if (FAILED(encoder->CreateNewFrame(frameEncode.ReleaseAndGetAddressOf(),
                                       propBag.ReleaseAndGetAddressOf()))) return {};

    // 85% quality gives ~30 KB per 320×180 thumb — well under the 3-8 MB
    // originals. Visual difference is imperceptible at tile sizes.
    PROPBAG2 prop{};
    wchar_t nameBuf[] = L"ImageQuality";
    prop.pstrName = nameBuf;
    VARIANT val;
    VariantInit(&val);
    val.vt = VT_R4;
    val.fltVal = 0.85f;
    propBag->Write(1, &prop, &val);
    VariantClear(&val);

    if (FAILED(frameEncode->Initialize(propBag.Get()))) return {};
    if (FAILED(frameEncode->SetSize(newW, newH))) return {};
    WICPixelFormatGUID pf = GUID_WICPixelFormat24bppBGR;
    if (FAILED(frameEncode->SetPixelFormat(&pf))) return {};
    if (FAILED(frameEncode->WriteSource(converter.Get(), nullptr))) return {};
    if (FAILED(frameEncode->Commit())) return {};
    if (FAILED(encoder->Commit())) return {};

    return StreamToBytes(memStream.Get());
}

// ─── Background worker pool ────────────────────────────────────────

class ThumbPool
{
public:
    static ThumbPool& Instance()
    {
        static ThumbPool pool;
        return pool;
    }

    void Enqueue(const std::filesystem::path& src, int maxEdge)
    {
        const auto key = KeyOf(src, maxEdge);
        {
            std::lock_guard<std::mutex> lk(m_mutex);
            if (m_inFlight.contains(key)) return;
            m_inFlight.insert(key);
            m_queue.push_back(Job{src, maxEdge});
        }
        m_cv.notify_one();
    }

    ~ThumbPool()
    {
        {
            std::lock_guard<std::mutex> lk(m_mutex);
            m_stop = true;
        }
        m_cv.notify_all();
        for (auto& t : m_workers)
        {
            if (t.joinable()) t.join();
        }
    }

private:
    struct Job { std::filesystem::path src; int maxEdge; };

    ThumbPool()
    {
        // Two workers: enough to saturate disk read for PNG decode
        // without stealing cores from the main app. Too many threads
        // contends on the same file device and actually slows us down.
        unsigned n = 2;
        for (unsigned i = 0; i < n; ++i)
        {
            m_workers.emplace_back([this]{ Worker(); });
        }
    }

    static std::string KeyOf(const std::filesystem::path& src, int maxEdge)
    {
        return WideToUtf8(src.wstring()) + "|" + std::to_string(maxEdge);
    }

    void Worker()
    {
        for (;;)
        {
            Job job;
            {
                std::unique_lock<std::mutex> lk(m_mutex);
                m_cv.wait(lk, [this]{ return m_stop || !m_queue.empty(); });
                if (m_stop && m_queue.empty()) return;
                job = std::move(m_queue.front());
                m_queue.pop_front();
            }

            try
            {
                (void)GenerateIfMissing(job.src, job.maxEdge);
            }
            catch (const std::exception& ex)
            {
                spdlog::warn("[thumbs] generation failed for {}: {}",
                             WideToUtf8(job.src.wstring()), ex.what());
            }
            catch (...)
            {
                spdlog::warn("[thumbs] generation failed for {}: unknown",
                             WideToUtf8(job.src.wstring()));
            }

            {
                std::lock_guard<std::mutex> lk(m_mutex);
                m_inFlight.erase(KeyOf(job.src, job.maxEdge));
            }
        }
    }

    std::mutex m_mutex;
    std::condition_variable m_cv;
    std::deque<Job> m_queue;
    std::unordered_set<std::string> m_inFlight;
    std::vector<std::thread> m_workers;
    bool m_stop{false};
};

} // namespace

std::filesystem::path CacheDir()
{
    static const std::filesystem::path kRoot = []
    {
        auto root = LocalAppDataRoot();
        if (root.empty()) return std::filesystem::path{};
        auto dir = root / L"screenshot-thumbs";
        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        return dir;
    }();
    return kRoot;
}

std::string CacheFileName(const std::filesystem::path& source, int maxEdge)
{
    // Hash path + mtime + size. If the user edits or replaces a PNG,
    // mtime/size changes, the hash changes, a fresh thumbnail is
    // generated, and the old one naturally ages out when we later
    // prune. Until a prune we still hit disk but serve the right file.
    std::error_code ec;
    std::uint64_t mtime = 0;
    std::uint64_t fsize = 0;
    const auto tp = std::filesystem::last_write_time(source, ec);
    if (!ec)
    {
        mtime = static_cast<std::uint64_t>(tp.time_since_epoch().count());
    }
    const auto size = std::filesystem::file_size(source, ec);
    if (!ec) fsize = static_cast<std::uint64_t>(size);

    std::string material =
        WideToUtf8(source.wstring()) +
        "|" + std::to_string(mtime) +
        "|" + std::to_string(fsize) +
        "|" + std::to_string(maxEdge);

    return toHex64(fnv1a64(material)) + "_" + std::to_string(maxEdge) + ".jpg";
}

std::filesystem::path GenerateIfMissing(
    const std::filesystem::path& source,
    int maxEdge)
{
    // Resolve cache slot first — cheap, no decode needed.
    const auto cacheDir = CacheDir();
    if (cacheDir.empty()) return {};

    const std::string fname = CacheFileName(source, maxEdge);
    const auto cachePath = cacheDir / Utf8ToWide(fname);

    std::error_code ec;
    if (std::filesystem::exists(cachePath, ec)) return cachePath;

    // Ensure source exists before we spin up WIC.
    if (!std::filesystem::exists(source, ec)) return {};

    const auto bytes = EncodeThumbnail(source, maxEdge);
    if (bytes.empty()) return {};

    if (!WriteJpeg(cachePath, bytes)) return {};
    return cachePath;
}

void EnqueueBatch(const std::vector<std::filesystem::path>& sources, int maxEdge)
{
    if (sources.empty()) return;
    const auto cacheDir = CacheDir();
    if (cacheDir.empty()) return;

    auto& pool = ThumbPool::Instance();
    for (const auto& src : sources)
    {
        // Skip sources that already have a cached thumbnail — no need
        // to wake a worker just to re-check on disk. Worker still
        // double-checks under lock to prevent races.
        const std::string fname = CacheFileName(src, maxEdge);
        const auto cachePath = cacheDir / Utf8ToWide(fname);
        std::error_code ec;
        if (std::filesystem::exists(cachePath, ec)) continue;
        pool.Enqueue(src, maxEdge);
    }
}

} // namespace vrcsm::host::ScreenshotThumbs
