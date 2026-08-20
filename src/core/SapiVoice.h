#pragma once

#include "Common.h"
#include "ToastNotifier.h"

#include <chrono>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace vrcsm::core
{

struct OscTtsPrefs;

// SAPI Speak flags we always use: async + purge-before-speak (latest event
// wins, matching Web Speech `synth.cancel()`) + treat input as plain text.
constexpr unsigned kSapiSpeakAsync = 1u;
constexpr unsigned kSapiSpeakPurgeBeforeSpeak = 2u;
constexpr unsigned kSapiSpeakIsNotXml = 16u;

inline unsigned SapiSpeakFlags() noexcept
{
    return kSapiSpeakAsync | kSapiSpeakPurgeBeforeSpeak | kSapiSpeakIsNotXml;
}

inline int ClampSapiRate(int rate) noexcept
{
    if (rate < -5) return -5;
    if (rate > 5) return 5;
    return rate;
}

inline int ClampSapiVolume(int volume) noexcept
{
    if (volume < 0) return 0;
    if (volume > 100) return 100;
    return volume;
}

bool SapiShouldSpeak(std::string_view text) noexcept;

enum class TtsScope
{
    Friends,
    All,
};

TtsScope ParseTtsScope(std::string_view scope) noexcept;

// friends → FriendOnline only; all → + Invite + FriendRequest.
bool ShouldSpeakKind(ToastKind kind, TtsScope scope) noexcept;

inline constexpr auto kTtsChatboxMinGap = std::chrono::seconds(10);

bool ChatboxEchoDue(bool chatboxEnabled,
                    std::chrono::steady_clock::time_point last,
                    std::chrono::steady_clock::time_point now,
                    std::chrono::seconds minGap = kTtsChatboxMinGap) noexcept;

// UTF-8 codepoint-safe trim. Never splits a codepoint (no mid-glyph byte cut).
std::string Utf8TruncateCodepoints(std::string_view text, std::size_t maxCodepoints);

struct SapiVoiceInfo
{
    std::string id;
    std::string name;
    std::string lang;
};

// preferredId wins when non-empty and present. Otherwise first voice whose
// locale prefix matches `lang` (e.g. "zh" → "zh-CN"). Empty → OS default.
std::string PickVoiceIdForLang(const std::vector<SapiVoiceInfo>& voices,
                               std::string_view lang,
                               std::string_view preferredId);

// Windows SAPI (`ISpVoice`) engine. All COM work runs on a dedicated STA
// worker. Speak is no-throw at the public API (failures are Result errors).
class SapiVoice
{
public:
    static SapiVoice& Instance();

    SapiVoice(const SapiVoice&) = delete;
    SapiVoice& operator=(const SapiVoice&) = delete;

    Result<std::monostate> Speak(std::string text, std::string lang = {});
    Result<std::monostate> Stop();
    Result<std::vector<SapiVoiceInfo>> ListVoices();
    Result<std::monostate> SetVoice(std::string voiceId);
    Result<std::monostate> SetRate(int rate);
    Result<std::monostate> SetVolume(int volume);

    void ApplyPrefs(const OscTtsPrefs& prefs);

    bool Available();
    bool IsSpeaking() const noexcept;
    const char* Engine(); // "sapi" | "none"
    std::string PreferredVoiceId() const;
    int Rate() const noexcept;
    int Volume() const noexcept;

    void Shutdown();

private:
    SapiVoice();
    ~SapiVoice();

    struct Impl;
    std::unique_ptr<Impl> m;
};

} // namespace vrcsm::core
