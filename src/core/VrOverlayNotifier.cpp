#include "../pch.h"

#include "VrOverlayNotifier.h"

#include "ToastNotifier.h"

#include <string>

#include <Windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

// One-shot Winsock init for the process. The OscBridge has its own copy; both
// are harmless — WSAStartup is refcounted and we never WSACleanup mid-run.
struct WinsockBootstrap
{
    WinsockBootstrap()
    {
        WSADATA data;
        WSAStartup(MAKEWORD(2, 2), &data);
    }
    ~WinsockBootstrap() { WSACleanup(); }
};

void EnsureWinsock()
{
    static WinsockBootstrap bootstrap;
    (void)bootstrap;
}

} // namespace

std::optional<OverlayNotification> FormatOverlayNotification(
    const std::string& type, const nlohmann::json& content)
{
    // Reuse the desktop-toast formatter so the two channels notify on exactly
    // the same events with the same untrusted-content validation. We map its
    // title/body across and drop the desktop-only launchArg/kind — the overlay
    // has no click-routing surface.
    auto toast = FormatPipelineToast(type, content);
    if (!toast.has_value())
    {
        return std::nullopt;
    }

    OverlayNotification out;
    out.title = toast->title;
    out.body = toast->body;
    return out;
}

nlohmann::json BuildXsOverlayJson(const OverlayNotification& n)
{
    // XSOverlay Notifications API schema (see header link). Fields not set here
    // fall back to XSOverlay's documented defaults.
    return nlohmann::json{
        {"messageType", 1},        // 1 = notification popup
        {"index", 0},
        {"timeout", 4.0},          // seconds on screen
        {"height", 110.0},         // popup expansion height
        {"volume", 0.5},
        {"audioPath", "default"},  // built-in chime
        {"title", n.title},
        {"content", n.body},
        {"useBase64Icon", false},
        {"icon", "default"},
        {"sourceApp", "VRCSM"},
    };
}

bool VrOverlayNotifier::SendXsOverlay(const nlohmann::json& payload,
                                      const std::string& host,
                                      std::uint16_t port)
{
    EnsureWinsock();

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET)
    {
        spdlog::warn("[vroverlay] socket failed: {}", WSAGetLastError());
        return false;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    if (inet_pton(AF_INET, host.c_str(), &addr.sin_addr) != 1)
    {
        spdlog::warn("[vroverlay] bad host: {}", host);
        closesocket(sock);
        return false;
    }

    const std::string bytes = payload.dump();
    const int rc = sendto(sock,
                          bytes.data(),
                          static_cast<int>(bytes.size()),
                          0,
                          reinterpret_cast<sockaddr*>(&addr),
                          sizeof(addr));
    closesocket(sock);

    if (rc != static_cast<int>(bytes.size()))
    {
        spdlog::warn("[vroverlay] sendto failed: {}", WSAGetLastError());
        return false;
    }
    return true;
}

bool VrOverlayNotifier::Notify(const OverlayNotification& n,
                               const std::string& host,
                               std::uint16_t port)
{
    return SendXsOverlay(BuildXsOverlayJson(n), host, port);
}

} // namespace vrcsm::core
