#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Tagged OSC argument. VRChat's OSC surface only uses i / f / s / T / F
// in practice — we expose just those four plus blobs for completeness
// rather than chase the whole OSC 1.1 type menagerie.
struct OscArgument
{
    // Order matches OSC type tags: i f s b T F
    std::variant<std::int32_t, float, std::string, std::vector<std::uint8_t>,
                 bool>
        value;

    static OscArgument fromInt(std::int32_t v) { return {v}; }
    static OscArgument fromFloat(float v) { return {v}; }
    static OscArgument fromString(std::string v) { return {std::move(v)}; }
    static OscArgument fromBool(bool v) { return {v}; }
};

// OSC bridge — UDP client + server for VRChat's OSC surface.
//
// VRChat listens on 127.0.0.1:9000 (incoming) and mirrors parameter
// updates to 127.0.0.1:9001 (outgoing). The bridge exposes `Send()` for
// firing messages at the game and a `Listen()` worker that decodes
// incoming messages and hands them back to the caller via a callback.
//
// Scope is deliberately tight: we parse the four type tags VRChat
// actually uses (i, f, s, T/F) plus blob; anything else in an incoming
// packet is reported back as a zero-arg message with the raw type tag
// string preserved in the envelope.
class OscBridge
{
public:
    using MessageCallback = std::function<void(
        const std::string& address,
        const std::vector<OscArgument>& args)>;

    OscBridge();
    ~OscBridge();

    OscBridge(const OscBridge&) = delete;
    OscBridge& operator=(const OscBridge&) = delete;

    // Fires a single OSC message at `host:port` (defaults to
    // 127.0.0.1:9000 — VRChat's input socket). Synchronous; returns
    // false if the socket setup or send fails.
    bool Send(const std::string& address,
              const std::vector<OscArgument>& args,
              const std::string& host = "127.0.0.1",
              std::uint16_t port = 9000);

    // Starts a listening UDP socket on `port` (defaults to 9001).
    // Incoming packets are parsed into `(address, args)` pairs and
    // fanned out to the callback off the listen thread. Idempotent —
    // calling twice with different ports restarts the listener.
    bool StartListen(MessageCallback onMessage, std::uint16_t port = 9001);
    void StopListen();

    bool IsListening() const { return m_listening.load(); }

private:
    void ListenLoop(std::uint16_t port);
    void CloseSocket();

    MessageCallback m_callback;
    std::thread m_listener;
    std::atomic<bool> m_listening{false};

    std::mutex m_socketMutex;
    std::uintptr_t m_socket{0}; // SOCKET cast to uintptr_t to avoid <winsock2.h> in header
};

// Parse a raw OSC packet into an (address, args) pair. Returns false
// on malformed packets. Exposed for unit tests.
bool ParseOscMessage(const std::uint8_t* data, std::size_t size,
                     std::string& address, std::vector<OscArgument>& args);

// Serialize an OSC message to wire bytes. Used by Send() and exposed
// for tests.
std::vector<std::uint8_t> EncodeOscMessage(
    const std::string& address,
    const std::vector<OscArgument>& args);

// Convert JSON arguments (as passed from the IPC bridge) into OscArgument
// values. Accepts numbers, strings, booleans — anything else is coerced
// to string.
std::vector<OscArgument> OscArgumentsFromJson(const nlohmann::json& arr);

// Convert OSC arguments back to JSON for frontend consumption.
nlohmann::json OscArgumentsToJson(const std::vector<OscArgument>& args);

} // namespace vrcsm::core
