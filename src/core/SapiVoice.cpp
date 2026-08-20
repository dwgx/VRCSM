#include "SapiVoice.h"

#include "GreyPrefs.h"
#include "ToastNotifier.h"

#include <cctype>
#include <condition_variable>
#include <cwchar>
#include <mutex>
#include <queue>
#include <thread>

#include <Windows.h>
#include <winnls.h>
#include <sapi.h>
#include <wrl/client.h>

#include <spdlog/spdlog.h>

using Microsoft::WRL::ComPtr;

namespace vrcsm::core
{

namespace
{

bool IsWhitespaceUtf8(std::string_view text) noexcept
{
    for (unsigned char c : text)
    {
        if (!std::isspace(c)) return false;
    }
    return true;
}

std::string ToLowerAscii(std::string_view s)
{
    std::string out(s);
    for (char& c : out)
    {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

std::string LangPrefix(std::string_view lang)
{
    const auto lower = ToLowerAscii(lang);
    const auto dash = lower.find('-');
    if (dash == std::string::npos) return lower;
    return lower.substr(0, dash);
}

std::string LocaleFromLangAttr(const std::wstring& attr)
{
    if (attr.empty()) return {};
    wchar_t* end = nullptr;
    const unsigned long lcid = std::wcstoul(attr.c_str(), &end, 16);
    if (lcid == 0) return {};
    wchar_t name[LOCALE_NAME_MAX_LENGTH]{};
    if (LCIDToLocaleName(static_cast<LCID>(lcid), name, LOCALE_NAME_MAX_LENGTH, 0) == 0)
    {
        return {};
    }
    return toUtf8(name);
}

nlohmann::json VoicesToJson(const std::vector<SapiVoiceInfo>& voices)
{
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& v : voices)
    {
        arr.push_back({{"id", v.id}, {"name", v.name}, {"lang", v.lang}});
    }
    return arr;
}

std::vector<SapiVoiceInfo> VoicesFromJson(const nlohmann::json& arr)
{
    std::vector<SapiVoiceInfo> out;
    if (!arr.is_array()) return out;
    for (const auto& v : arr)
    {
        if (!v.is_object()) continue;
        SapiVoiceInfo info;
        info.id = v.value("id", "");
        info.name = v.value("name", "");
        info.lang = v.value("lang", "");
        out.push_back(std::move(info));
    }
    return out;
}

} // namespace

bool SapiShouldSpeak(std::string_view text) noexcept
{
    return !text.empty() && !IsWhitespaceUtf8(text);
}

TtsScope ParseTtsScope(std::string_view scope) noexcept
{
    return scope == "all" ? TtsScope::All : TtsScope::Friends;
}

bool ShouldSpeakKind(ToastKind kind, TtsScope scope) noexcept
{
    switch (kind)
    {
    case ToastKind::FriendOnline:
        return true;
    case ToastKind::Invite:
    case ToastKind::FriendRequest:
        return scope == TtsScope::All;
    }
    return false;
}

bool ChatboxEchoDue(bool chatboxEnabled,
                    std::chrono::steady_clock::time_point last,
                    std::chrono::steady_clock::time_point now,
                    std::chrono::seconds minGap) noexcept
{
    if (!chatboxEnabled) return false;
    if (last == std::chrono::steady_clock::time_point{}) return true;
    return now - last >= minGap;
}

std::string Utf8TruncateCodepoints(std::string_view text, std::size_t maxCodepoints)
{
    if (text.empty() || maxCodepoints == 0) return {};
    std::size_t i = 0;
    std::size_t n = 0;
    while (i < text.size() && n < maxCodepoints)
    {
        const auto c = static_cast<unsigned char>(text[i]);
        std::size_t w = 1;
        if ((c & 0x80) == 0) w = 1;
        else if ((c & 0xE0) == 0xC0) w = 2;
        else if ((c & 0xF0) == 0xE0) w = 3;
        else if ((c & 0xF8) == 0xF0) w = 4;
        else
        {
            ++i;
            continue;
        }
        if (i + w > text.size()) break;
        i += w;
        ++n;
    }
    return std::string(text.substr(0, i));
}

std::string PickVoiceIdForLang(const std::vector<SapiVoiceInfo>& voices,
                               std::string_view lang,
                               std::string_view preferredId)
{
    if (!preferredId.empty())
    {
        for (const auto& v : voices)
        {
            if (v.id == preferredId) return v.id;
        }
    }
    const auto want = LangPrefix(lang);
    if (want.empty()) return {};
    for (const auto& v : voices)
    {
        if (LangPrefix(v.lang) == want) return v.id;
    }
    return {};
}

enum class SapiCmd
{
    Speak,
    Stop,
    List,
    SetVoice,
    SetRate,
    SetVolume,
    Shutdown,
};

struct SapiReply
{
    std::mutex mu;
    std::condition_variable cv;
    bool done{false};
    Result<nlohmann::json> result{nlohmann::json::object()};
};

struct SapiRequest
{
    SapiCmd cmd{SapiCmd::Stop};
    std::string text;
    std::string lang;
    std::string voiceId;
    int number{0};
    std::shared_ptr<SapiReply> reply;
};

struct SapiVoice::Impl
{
    mutable std::mutex mutex;
    std::queue<SapiRequest> queue;
    std::thread thread;
    HANDLE wake{nullptr};
    std::atomic<bool> stop{false};
    std::atomic<bool> workerUp{false};
    std::atomic<bool> available{false};
    std::atomic<bool> speaking{false};
    std::atomic<int> rate{0};
    std::atomic<int> volume{80};
    std::string voiceId;
    ComPtr<ISpVoice> voice;

    ~Impl()
    {
        stop.store(true);
        if (wake) SetEvent(wake);
        if (thread.joinable()) thread.join();
        if (wake)
        {
            CloseHandle(wake);
            wake = nullptr;
        }
    }

    void EnsureWorker()
    {
        std::lock_guard<std::mutex> lk(mutex);
        if (thread.joinable()) return;
        stop.store(false);
        if (!wake) wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        thread = std::thread([this] { Worker(); });
    }

    Result<nlohmann::json> Post(SapiRequest req)
    {
        EnsureWorker();
        auto reply = std::make_shared<SapiReply>();
        req.reply = reply;
        {
            std::lock_guard<std::mutex> lk(mutex);
            queue.push(std::move(req));
        }
        if (wake) SetEvent(wake);
        std::unique_lock<std::mutex> lk(reply->mu);
        reply->cv.wait(lk, [&] { return reply->done; });
        return std::move(reply->result);
    }

    void Complete(const std::shared_ptr<SapiReply>& reply, Result<nlohmann::json> value)
    {
        if (!reply) return;
        {
            std::lock_guard<std::mutex> lk(reply->mu);
            reply->result = std::move(value);
            reply->done = true;
        }
        reply->cv.notify_one();
    }

    std::vector<SapiVoiceInfo> EnumVoicesOnSta()
    {
        std::vector<SapiVoiceInfo> out;
        ComPtr<ISpObjectTokenCategory> cat;
        HRESULT hr = CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_ALL,
                                      IID_PPV_ARGS(&cat));
        if (FAILED(hr) || !cat) return out;
        hr = cat->SetId(SPCAT_VOICES, FALSE);
        if (FAILED(hr)) return out;
        ComPtr<IEnumSpObjectTokens> en;
        hr = cat->EnumTokens(nullptr, nullptr, &en);
        if (FAILED(hr) || !en) return out;

        for (;;)
        {
            ComPtr<ISpObjectToken> tok;
            ULONG fetched = 0;
            hr = en->Next(1, &tok, &fetched);
            if (FAILED(hr) || fetched == 0 || !tok) break;

            SapiVoiceInfo info;
            LPWSTR id = nullptr;
            if (SUCCEEDED(tok->GetId(&id)) && id)
            {
                info.id = toUtf8(id);
                CoTaskMemFree(id);
            }
            LPWSTR name = nullptr;
            if (SUCCEEDED(tok->GetStringValue(nullptr, &name)) && name)
            {
                info.name = toUtf8(name);
                CoTaskMemFree(name);
            }
            ComPtr<ISpDataKey> attrs;
            if (SUCCEEDED(tok->OpenKey(L"Attributes", &attrs)) && attrs)
            {
                LPWSTR lang = nullptr;
                if (SUCCEEDED(attrs->GetStringValue(L"Language", &lang)) && lang)
                {
                    info.lang = LocaleFromLangAttr(lang);
                    CoTaskMemFree(lang);
                }
            }
            if (!info.id.empty()) out.push_back(std::move(info));
        }
        return out;
    }

    HRESULT ApplyVoiceToken(const std::string& id)
    {
        if (!voice) return E_FAIL;
        if (id.empty())
        {
            return voice->SetVoice(nullptr);
        }
        ComPtr<ISpObjectTokenCategory> cat;
        HRESULT hr = CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_ALL,
                                      IID_PPV_ARGS(&cat));
        if (FAILED(hr) || !cat) return hr;
        hr = cat->SetId(SPCAT_VOICES, FALSE);
        if (FAILED(hr)) return hr;
        ComPtr<IEnumSpObjectTokens> en;
        hr = cat->EnumTokens(nullptr, nullptr, &en);
        if (FAILED(hr) || !en) return hr;
        const std::wstring want = toWide(id);
        for (;;)
        {
            ComPtr<ISpObjectToken> tok;
            ULONG fetched = 0;
            hr = en->Next(1, &tok, &fetched);
            if (FAILED(hr) || fetched == 0 || !tok) break;
            LPWSTR tokId = nullptr;
            if (SUCCEEDED(tok->GetId(&tokId)) && tokId)
            {
                const bool match = want == tokId;
                CoTaskMemFree(tokId);
                if (match)
                {
                    return voice->SetVoice(tok.Get());
                }
            }
        }
        return HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
    }

    void Handle(SapiRequest& req)
    {
        if (!available.load() && req.cmd != SapiCmd::Shutdown && req.cmd != SapiCmd::List)
        {
            Complete(req.reply, Error{"tts_unavailable", "SAPI voice is not available", 0});
            return;
        }

        switch (req.cmd)
        {
        case SapiCmd::Speak:
        {
            if (!SapiShouldSpeak(req.text))
            {
                Complete(req.reply, nlohmann::json{{"ok", true}, {"skipped", true}});
                return;
            }
            const auto voices = EnumVoicesOnSta();
            std::string chosen;
            {
                std::lock_guard<std::mutex> lk(mutex);
                chosen = PickVoiceIdForLang(voices, req.lang, voiceId);
            }
            if (!chosen.empty())
            {
                (void)ApplyVoiceToken(chosen);
            }
            else
            {
                (void)ApplyVoiceToken({});
            }
            const std::wstring wide = toWide(req.text);
            speaking.store(true);
            const HRESULT hr = voice->Speak(
                wide.c_str(),
                static_cast<DWORD>(SapiSpeakFlags()),
                nullptr);
            if (FAILED(hr))
            {
                speaking.store(false);
                Complete(req.reply, Error{"tts_speak_failed", "ISpVoice::Speak failed", 0});
                return;
            }
            SPVOICESTATUS status{};
            if (SUCCEEDED(voice->GetStatus(&status, nullptr)))
            {
                speaking.store(status.dwRunningState == SPRS_IS_SPEAKING);
            }
            Complete(req.reply, nlohmann::json{{"ok", true}});
            break;
        }
        case SapiCmd::Stop:
            if (voice)
            {
                (void)voice->Speak(L"", SPF_PURGEBEFORESPEAK | SPF_ASYNC | SPF_IS_NOT_XML, nullptr);
            }
            speaking.store(false);
            Complete(req.reply, nlohmann::json{{"ok", true}});
            break;
        case SapiCmd::List:
            Complete(req.reply, VoicesToJson(EnumVoicesOnSta()));
            break;
        case SapiCmd::SetVoice:
        {
            const HRESULT hr = ApplyVoiceToken(req.voiceId);
            if (FAILED(hr) && !req.voiceId.empty())
            {
                Complete(req.reply, Error{"tts_voice_missing", "voice token not found", 0});
                return;
            }
            {
                std::lock_guard<std::mutex> lk(mutex);
                voiceId = req.voiceId;
            }
            Complete(req.reply, nlohmann::json{{"ok", true}});
            break;
        }
        case SapiCmd::SetRate:
            if (voice)
            {
                (void)voice->SetRate(ClampSapiRate(req.number));
            }
            rate.store(ClampSapiRate(req.number));
            Complete(req.reply, nlohmann::json{{"ok", true}});
            break;
        case SapiCmd::SetVolume:
            if (voice)
            {
                (void)voice->SetVolume(static_cast<USHORT>(ClampSapiVolume(req.number)));
            }
            volume.store(ClampSapiVolume(req.number));
            Complete(req.reply, nlohmann::json{{"ok", true}});
            break;
        case SapiCmd::Shutdown:
            if (voice)
            {
                (void)voice->Speak(L"", SPF_PURGEBEFORESPEAK | SPF_ASYNC | SPF_IS_NOT_XML, nullptr);
                voice.Reset();
            }
            speaking.store(false);
            available.store(false);
            Complete(req.reply, nlohmann::json{{"ok", true}});
            stop.store(true);
            break;
        }
    }

    void Worker()
    {
        const HRESULT comHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        const bool comOk = SUCCEEDED(comHr) || comHr == RPC_E_CHANGED_MODE;
        if (!comOk)
        {
            spdlog::warn("SapiVoice: CoInitializeEx failed ({:08x})", static_cast<unsigned>(comHr));
            available.store(false);
            workerUp.store(true);
            for (;;)
            {
                SapiRequest req;
                {
                    std::lock_guard<std::mutex> lk(mutex);
                    if (queue.empty()) break;
                    req = std::move(queue.front());
                    queue.pop();
                }
                Complete(req.reply, Error{"tts_unavailable", "COM init failed", 0});
            }
            return;
        }

        HRESULT hr = CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL, IID_PPV_ARGS(&voice));
        if (FAILED(hr) || !voice)
        {
            spdlog::warn("SapiVoice: CoCreateInstance(ISpVoice) failed ({:08x})",
                         static_cast<unsigned>(hr));
            available.store(false);
        }
        else
        {
            available.store(true);
            (void)voice->SetRate(rate.load());
            (void)voice->SetVolume(static_cast<USHORT>(volume.load()));
            std::string id;
            {
                std::lock_guard<std::mutex> lk(mutex);
                id = voiceId;
            }
            if (!id.empty()) (void)ApplyVoiceToken(id);
        }
        workerUp.store(true);

        while (!stop.load())
        {
            const HANDLE w = wake;
            const DWORD wait = w
                ? MsgWaitForMultipleObjects(1, &w, FALSE, 50, QS_ALLINPUT)
                : WAIT_TIMEOUT;
            MSG msg{};
            while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE))
            {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if (wait == WAIT_OBJECT_0 || wait == WAIT_TIMEOUT ||
                wait == WAIT_OBJECT_0 + 1)
            {
                for (;;)
                {
                    SapiRequest req;
                    {
                        std::lock_guard<std::mutex> lk(mutex);
                        if (queue.empty()) break;
                        req = std::move(queue.front());
                        queue.pop();
                    }
                    Handle(req);
                }
            }

            if (voice)
            {
                SPVOICESTATUS status{};
                if (SUCCEEDED(voice->GetStatus(&status, nullptr)))
                {
                    speaking.store(status.dwRunningState == SPRS_IS_SPEAKING);
                }
            }
        }

        voice.Reset();
        available.store(false);
        speaking.store(false);
        if (SUCCEEDED(comHr)) CoUninitialize();
    }
};

SapiVoice& SapiVoice::Instance()
{
    static SapiVoice inst;
    return inst;
}

SapiVoice::SapiVoice() : m(std::make_unique<Impl>()) {}

SapiVoice::~SapiVoice() = default;

Result<std::monostate> SapiVoice::Speak(std::string text, std::string lang)
{
    if (!SapiShouldSpeak(text))
    {
        return std::monostate{};
    }
    SapiRequest req;
    req.cmd = SapiCmd::Speak;
    req.text = std::move(text);
    req.lang = std::move(lang);
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return std::monostate{};
}

Result<std::monostate> SapiVoice::Stop()
{
    SapiRequest req;
    req.cmd = SapiCmd::Stop;
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return std::monostate{};
}

Result<std::vector<SapiVoiceInfo>> SapiVoice::ListVoices()
{
    SapiRequest req;
    req.cmd = SapiCmd::List;
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return VoicesFromJson(value(r));
}

Result<std::monostate> SapiVoice::SetVoice(std::string voiceId)
{
    SapiRequest req;
    req.cmd = SapiCmd::SetVoice;
    req.voiceId = std::move(voiceId);
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return std::monostate{};
}

Result<std::monostate> SapiVoice::SetRate(int rate)
{
    SapiRequest req;
    req.cmd = SapiCmd::SetRate;
    req.number = ClampSapiRate(rate);
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return std::monostate{};
}

Result<std::monostate> SapiVoice::SetVolume(int volume)
{
    SapiRequest req;
    req.cmd = SapiCmd::SetVolume;
    req.number = ClampSapiVolume(volume);
    auto r = m->Post(std::move(req));
    if (!isOk(r)) return error(r);
    return std::monostate{};
}

void SapiVoice::ApplyPrefs(const OscTtsPrefs& prefs)
{
    m->rate.store(ClampSapiRate(prefs.rate));
    m->volume.store(ClampSapiVolume(prefs.volume));
    {
        std::lock_guard<std::mutex> lk(m->mutex);
        m->voiceId = prefs.voiceId;
    }
    if (m->workerUp.load() && m->available.load())
    {
        (void)SetRate(prefs.rate);
        (void)SetVolume(prefs.volume);
        (void)SetVoice(prefs.voiceId);
    }
}

bool SapiVoice::Available()
{
    m->EnsureWorker();
    for (int i = 0; i < 50 && !m->workerUp.load(); ++i)
    {
        Sleep(10);
    }
    return m->available.load();
}

bool SapiVoice::IsSpeaking() const noexcept
{
    return m->speaking.load();
}

const char* SapiVoice::Engine()
{
    return Available() ? "sapi" : "none";
}

std::string SapiVoice::PreferredVoiceId() const
{
    std::lock_guard<std::mutex> lk(m->mutex);
    return m->voiceId;
}

int SapiVoice::Rate() const noexcept
{
    return m->rate.load();
}

int SapiVoice::Volume() const noexcept
{
    return m->volume.load();
}

void SapiVoice::Shutdown()
{
    if (!m->thread.joinable()) return;
    SapiRequest req;
    req.cmd = SapiCmd::Shutdown;
    (void)m->Post(std::move(req));
    m->stop.store(true);
    if (m->wake) SetEvent(m->wake);
    if (m->thread.joinable()) m->thread.join();
}

} // namespace vrcsm::core
