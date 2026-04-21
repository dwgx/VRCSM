#include "../pch.h"

#include "OscBridge.h"

#include "Common.h"

#include <algorithm>
#include <cstring>

#include <Windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "Ws2_32.lib")

// ─────────────────────────────────────────────────────────────────────────
// OscBridge — minimal OSC 1.0 UDP client + server.
//
// VRChat uses these type tags in practice:
//   `i` 32-bit big-endian int, `f` 32-bit big-endian float, `s` NUL-
//   terminated ASCII string padded to 4 bytes, `T`/`F` boolean (no data).
// We also support `b` blobs because they cost nothing extra, and we
// preserve unknown tags on the receive side so the frontend can see
// them.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

struct WinsockBootstrap
{
    WinsockBootstrap()
    {
        WSADATA data;
        WSAStartup(MAKEWORD(2, 2), &data);
    }
    ~WinsockBootstrap()
    {
        WSACleanup();
    }
};

WinsockBootstrap& EnsureWinsock()
{
    static WinsockBootstrap bootstrap;
    return bootstrap;
}

// Round up to the next multiple of 4 — OSC strings, blobs, and the
// type-tag string all have to be 4-byte-aligned on the wire.
std::size_t PadTo4(std::size_t n)
{
    return (n + 3u) & ~std::size_t{3u};
}

void WriteBe32(std::vector<std::uint8_t>& out, std::uint32_t v)
{
    out.push_back(static_cast<std::uint8_t>((v >> 24) & 0xff));
    out.push_back(static_cast<std::uint8_t>((v >> 16) & 0xff));
    out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xff));
    out.push_back(static_cast<std::uint8_t>(v & 0xff));
}

std::uint32_t ReadBe32(const std::uint8_t* p)
{
    return (static_cast<std::uint32_t>(p[0]) << 24) |
           (static_cast<std::uint32_t>(p[1]) << 16) |
           (static_cast<std::uint32_t>(p[2]) << 8) |
           static_cast<std::uint32_t>(p[3]);
}

// Parse a NUL-terminated OSC string at `offset`. Returns the string and
// advances `offset` past the 4-byte-aligned terminator.
bool ReadOscString(const std::uint8_t* data, std::size_t size,
                   std::size_t& offset, std::string& out)
{
    const std::size_t start = offset;
    while (offset < size && data[offset] != 0)
    {
        ++offset;
    }
    if (offset >= size) return false;
    out.assign(reinterpret_cast<const char*>(data + start), offset - start);
    // Advance past the terminating NUL, then round up to the next
    // 4-byte boundary so the caller lands on the start of the next
    // OSC field.
    ++offset;
    offset = PadTo4(offset);
    return true;
}

} // namespace

std::vector<std::uint8_t> EncodeOscMessage(
    const std::string& address,
    const std::vector<OscArgument>& args)
{
    std::vector<std::uint8_t> out;
    out.reserve(64 + address.size() + args.size() * 8);

    // Address
    out.insert(out.end(), address.begin(), address.end());
    out.push_back(0);
    while (out.size() % 4 != 0) out.push_back(0);

    // Type tag string: leading ',' plus one tag per arg
    std::string tags = ",";
    for (const auto& arg : args)
    {
        std::visit([&tags](const auto& v)
        {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::int32_t>)
                tags.push_back('i');
            else if constexpr (std::is_same_v<T, float>)
                tags.push_back('f');
            else if constexpr (std::is_same_v<T, std::string>)
                tags.push_back('s');
            else if constexpr (std::is_same_v<T, std::vector<std::uint8_t>>)
                tags.push_back('b');
            else if constexpr (std::is_same_v<T, bool>)
                tags.push_back(v ? 'T' : 'F');
        }, arg.value);
    }
    out.insert(out.end(), tags.begin(), tags.end());
    out.push_back(0);
    while (out.size() % 4 != 0) out.push_back(0);

    // Arguments
    for (const auto& arg : args)
    {
        std::visit([&out](const auto& v)
        {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::int32_t>)
            {
                WriteBe32(out, static_cast<std::uint32_t>(v));
            }
            else if constexpr (std::is_same_v<T, float>)
            {
                std::uint32_t bits;
                std::memcpy(&bits, &v, sizeof(bits));
                WriteBe32(out, bits);
            }
            else if constexpr (std::is_same_v<T, std::string>)
            {
                out.insert(out.end(), v.begin(), v.end());
                out.push_back(0);
                while (out.size() % 4 != 0) out.push_back(0);
            }
            else if constexpr (std::is_same_v<T, std::vector<std::uint8_t>>)
            {
                WriteBe32(out, static_cast<std::uint32_t>(v.size()));
                out.insert(out.end(), v.begin(), v.end());
                while (out.size() % 4 != 0) out.push_back(0);
            }
            // Bool carries no payload — T/F encoded in the tag.
        }, arg.value);
    }

    return out;
}

bool ParseOscMessage(const std::uint8_t* data, std::size_t size,
                     std::string& address,
                     std::vector<OscArgument>& args)
{
    std::size_t offset = 0;
    if (!ReadOscString(data, size, offset, address)) return false;
    if (address.empty() || address[0] != '/') return false;

    std::string tags;
    if (!ReadOscString(data, size, offset, tags)) return false;
    if (tags.empty() || tags[0] != ',') return false;

    for (std::size_t i = 1; i < tags.size(); ++i)
    {
        const char tag = tags[i];
        switch (tag)
        {
        case 'i':
            if (offset + 4 > size) return false;
            args.push_back(OscArgument::fromInt(
                static_cast<std::int32_t>(ReadBe32(data + offset))));
            offset += 4;
            break;
        case 'f':
        {
            if (offset + 4 > size) return false;
            std::uint32_t bits = ReadBe32(data + offset);
            float f;
            std::memcpy(&f, &bits, sizeof(f));
            args.push_back(OscArgument::fromFloat(f));
            offset += 4;
            break;
        }
        case 's':
        {
            std::string s;
            if (!ReadOscString(data, size, offset, s)) return false;
            args.push_back(OscArgument::fromString(std::move(s)));
            break;
        }
        case 'b':
        {
            if (offset + 4 > size) return false;
            const std::uint32_t blobSize = ReadBe32(data + offset);
            offset += 4;
            if (offset + blobSize > size) return false;
            std::vector<std::uint8_t> blob(data + offset, data + offset + blobSize);
            args.push_back({std::move(blob)});
            offset += blobSize;
            offset = PadTo4(offset);
            break;
        }
        case 'T':
            args.push_back(OscArgument::fromBool(true));
            break;
        case 'F':
            args.push_back(OscArgument::fromBool(false));
            break;
        case 'N':
        case 'I':
            // nil / impulse — skip without consuming bytes
            break;
        default:
            // Unknown tag — skip the arg if it's fixed-size, otherwise
            // give up. Conservative for now.
            return false;
        }
    }
    return true;
}

std::vector<OscArgument> OscArgumentsFromJson(const nlohmann::json& arr)
{
    std::vector<OscArgument> out;
    if (!arr.is_array()) return out;
    for (const auto& v : arr)
    {
        if (v.is_boolean()) out.push_back(OscArgument::fromBool(v.get<bool>()));
        else if (v.is_number_integer()) out.push_back(OscArgument::fromInt(v.get<std::int32_t>()));
        else if (v.is_number_float()) out.push_back(OscArgument::fromFloat(v.get<float>()));
        else if (v.is_string()) out.push_back(OscArgument::fromString(v.get<std::string>()));
        else out.push_back(OscArgument::fromString(v.dump()));
    }
    return out;
}

nlohmann::json OscArgumentsToJson(const std::vector<OscArgument>& args)
{
    auto arr = nlohmann::json::array();
    for (const auto& arg : args)
    {
        std::visit([&arr](const auto& v)
        {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::int32_t>) arr.push_back(v);
            else if constexpr (std::is_same_v<T, float>) arr.push_back(v);
            else if constexpr (std::is_same_v<T, std::string>) arr.push_back(v);
            else if constexpr (std::is_same_v<T, bool>) arr.push_back(v);
            else if constexpr (std::is_same_v<T, std::vector<std::uint8_t>>)
            {
                // Blobs surface as base-ish representation; most callers
                // only care about the other tags.
                arr.push_back(nlohmann::json::object({{"blob", v.size()}}));
            }
        }, arg.value);
    }
    return arr;
}

OscBridge::OscBridge()
{
    EnsureWinsock();
}

OscBridge::~OscBridge()
{
    StopListen();
}

bool OscBridge::Send(const std::string& address,
                     const std::vector<OscArgument>& args,
                     const std::string& host,
                     std::uint16_t port)
{
    EnsureWinsock();

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET)
    {
        spdlog::warn("OscBridge: socket() failed ({})", WSAGetLastError());
        return false;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

    const auto bytes = EncodeOscMessage(address, args);
    const int rc = sendto(sock,
                          reinterpret_cast<const char*>(bytes.data()),
                          static_cast<int>(bytes.size()),
                          0,
                          reinterpret_cast<sockaddr*>(&addr),
                          sizeof(addr));
    const bool ok = rc == static_cast<int>(bytes.size());
    if (!ok)
    {
        spdlog::warn("OscBridge: sendto failed ({})", WSAGetLastError());
    }
    closesocket(sock);
    return ok;
}

bool OscBridge::StartListen(MessageCallback onMessage, std::uint16_t port)
{
    StopListen();
    m_callback = std::move(onMessage);
    m_listening.store(true);
    m_listener = std::thread(&OscBridge::ListenLoop, this, port);
    return true;
}

void OscBridge::StopListen()
{
    if (!m_listening.exchange(false))
    {
        return;
    }
    CloseSocket();
    if (m_listener.joinable())
    {
        m_listener.join();
    }
}

void OscBridge::CloseSocket()
{
    std::lock_guard<std::mutex> lk(m_socketMutex);
    if (m_socket != 0)
    {
        closesocket(static_cast<SOCKET>(m_socket));
        m_socket = 0;
    }
}

void OscBridge::ListenLoop(std::uint16_t port)
{
    EnsureWinsock();

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET)
    {
        spdlog::warn("OscBridge: listen socket() failed ({})", WSAGetLastError());
        m_listening.store(false);
        return;
    }

    sockaddr_in bindAddr{};
    bindAddr.sin_family = AF_INET;
    bindAddr.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &bindAddr.sin_addr);

    if (bind(sock, reinterpret_cast<sockaddr*>(&bindAddr), sizeof(bindAddr)) != 0)
    {
        spdlog::warn("OscBridge: bind :{} failed ({})", port, WSAGetLastError());
        closesocket(sock);
        m_listening.store(false);
        return;
    }

    {
        std::lock_guard<std::mutex> lk(m_socketMutex);
        m_socket = static_cast<std::uintptr_t>(sock);
    }

    spdlog::info("OscBridge: listening on 127.0.0.1:{}", port);

    std::vector<std::uint8_t> buffer(65 * 1024);
    while (m_listening.load())
    {
        int fromLen = sizeof(sockaddr_in);
        sockaddr_in from{};
        const int n = recvfrom(sock,
                               reinterpret_cast<char*>(buffer.data()),
                               static_cast<int>(buffer.size()),
                               0,
                               reinterpret_cast<sockaddr*>(&from),
                               &fromLen);
        if (n <= 0)
        {
            // closesocket() from StopListen() returns -1 here. Either
            // way, exit cleanly.
            break;
        }

        std::string addr;
        std::vector<OscArgument> args;
        if (!ParseOscMessage(buffer.data(), static_cast<std::size_t>(n), addr, args))
        {
            continue;
        }

        if (m_callback)
        {
            try
            {
                m_callback(addr, args);
            }
            catch (const std::exception& ex)
            {
                spdlog::warn("OscBridge: callback threw: {}", ex.what());
            }
        }
    }

    CloseSocket();
}

} // namespace vrcsm::core
