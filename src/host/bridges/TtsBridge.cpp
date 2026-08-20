#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/GreyPrefs.h"
#include "../../core/OscBridge.h"
#include "../../core/SapiVoice.h"
#include "../../core/ToastNotifier.h"

// ─────────────────────────────────────────────────────────────────────────
// TTS bridge — Windows SAPI via tts.status / tts.speak / tts.stop /
// tts.voices / tts.setVoice. Pipeline events speak on the host so
// announcements still work with the SPA minimized to tray.
// ─────────────────────────────────────────────────────────────────────────

namespace
{

nlohmann::json VoiceListJson(const std::vector<vrcsm::core::SapiVoiceInfo>& voices)
{
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& v : voices)
    {
        arr.push_back({{"id", v.id}, {"name", v.name}, {"lang", v.lang}});
    }
    return arr;
}

void PersistOscTtsFromEngine(bool chatbox)
{
    auto loaded = vrcsm::core::LoadGreyPrefs();
    vrcsm::core::GreyPrefs prefs = vrcsm::core::isOk(loaded)
                                       ? vrcsm::core::value(loaded)
                                       : vrcsm::core::DefaultGreyPrefs();
    auto& engine = vrcsm::core::SapiVoice::Instance();
    prefs.oscTts.engine = "sapi";
    prefs.oscTts.voiceId = engine.PreferredVoiceId();
    prefs.oscTts.rate = engine.Rate();
    prefs.oscTts.volume = engine.Volume();
    prefs.oscTts.chatbox = chatbox;
    auto saved = vrcsm::core::SaveGreyPrefs(prefs);
    if (!vrcsm::core::isOk(saved))
    {
        spdlog::warn("tts: failed to persist grey-prefs oscTts ({})",
                     vrcsm::core::error(saved).message);
    }
}

} // namespace

void IpcBridge::InitTtsFromGreyPrefs()
{
    auto loaded = vrcsm::core::LoadGreyPrefs();
    const auto prefs = vrcsm::core::isOk(loaded)
                           ? vrcsm::core::value(loaded)
                           : vrcsm::core::DefaultGreyPrefs();
    auto& engine = vrcsm::core::SapiVoice::Instance();
    engine.ApplyPrefs(prefs.oscTts);
    m_ttsChatbox.store(prefs.oscTts.chatbox);
}

void IpcBridge::MaybeSpeakToast(const vrcsm::core::ToastContent& toast)
{
    if (!m_ttsEnabled.load()) return;

    const auto scope = m_ttsScopeAll.load() ? vrcsm::core::TtsScope::All
                                            : vrcsm::core::TtsScope::Friends;
    if (!vrcsm::core::ShouldSpeakKind(toast.kind, scope)) return;

    const std::string phrase = vrcsm::core::FormatTtsPhrase(toast);
    if (!vrcsm::core::SapiShouldSpeak(phrase)) return;

    auto& engine = vrcsm::core::SapiVoice::Instance();
    if (engine.Available())
    {
        auto spoken = engine.Speak(phrase);
        if (!vrcsm::core::isOk(spoken))
        {
            spdlog::warn("tts: Speak failed ({})", vrcsm::core::error(spoken).message);
        }
    }

    if (!m_ttsChatbox.load()) return;

    const auto now = std::chrono::steady_clock::now();
    bool due = false;
    {
        std::lock_guard<std::mutex> lk(m_ttsChatboxMutex);
        due = vrcsm::core::ChatboxEchoDue(true, m_lastTtsChatbox, now);
        if (due) m_lastTtsChatbox = now;
    }
    if (!due) return;

    const std::string clipped = vrcsm::core::Utf8TruncateCodepoints(phrase, 144);
    if (clipped.empty()) return;
    if (!m_osc) m_osc = std::make_unique<vrcsm::core::OscBridge>();
    const auto sent = m_osc->Send(
        "/chatbox/input",
        {vrcsm::core::OscArgument::fromString(clipped),
         vrcsm::core::OscArgument::fromBool(true)});
    if (!sent.ok)
    {
        spdlog::warn("tts: chatbox echo failed ({})",
                     sent.error ? sent.error->message : "unknown");
    }
}

nlohmann::json IpcBridge::HandleTtsStatus(const nlohmann::json&, const std::optional<std::string>&)
{
    auto& engine = vrcsm::core::SapiVoice::Instance();
    const char* kind = engine.Engine();
    nlohmann::json voices = nlohmann::json::array();
    if (std::string_view(kind) == "sapi")
    {
        auto listed = engine.ListVoices();
        if (vrcsm::core::isOk(listed))
        {
            voices = VoiceListJson(vrcsm::core::value(listed));
        }
    }
    return nlohmann::json{
        {"engine", kind},
        {"voices", std::move(voices)},
        {"speaking", engine.IsSpeaking()},
        {"voiceId", engine.PreferredVoiceId()},
        {"rate", engine.Rate()},
        {"volume", engine.Volume()},
        {"chatbox", m_ttsChatbox.load()},
        {"enabled", m_ttsEnabled.load()},
    };
}

nlohmann::json IpcBridge::HandleTtsVoices(const nlohmann::json& params, const std::optional<std::string>& id)
{
    auto status = HandleTtsStatus(params, id);
    return nlohmann::json{{"voices", status.value("voices", nlohmann::json::array())}};
}

nlohmann::json IpcBridge::HandleTtsSpeak(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto text = JsonStringField(params, "text").value_or("");
    if (!m_ttsEnabled.load() || !vrcsm::core::SapiShouldSpeak(text))
    {
        return nlohmann::json{{"ok", true}};
    }

    const auto lang = JsonStringField(params, "lang").value_or("");
    auto& engine = vrcsm::core::SapiVoice::Instance();
    if (engine.Available())
    {
        auto spoken = engine.Speak(text, lang);
        if (!vrcsm::core::isOk(spoken))
        {
            spdlog::warn("tts.speak: {}", vrcsm::core::error(spoken).message);
        }
    }

    const bool echo = params.contains("echoChatbox") && params["echoChatbox"].is_boolean()
                          ? params["echoChatbox"].get<bool>()
                          : m_ttsChatbox.load();
    if (echo)
    {
        const auto now = std::chrono::steady_clock::now();
        bool due = false;
        {
            std::lock_guard<std::mutex> lk(m_ttsChatboxMutex);
            due = vrcsm::core::ChatboxEchoDue(true, m_lastTtsChatbox, now);
            if (due) m_lastTtsChatbox = now;
        }
        if (due)
        {
            const std::string clipped = vrcsm::core::Utf8TruncateCodepoints(text, 144);
            if (!clipped.empty())
            {
                if (!m_osc) m_osc = std::make_unique<vrcsm::core::OscBridge>();
                (void)m_osc->Send(
                    "/chatbox/input",
                    {vrcsm::core::OscArgument::fromString(clipped),
                     vrcsm::core::OscArgument::fromBool(true)});
            }
        }
    }

    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleTtsStop(const nlohmann::json&, const std::optional<std::string>&)
{
    auto stopped = vrcsm::core::SapiVoice::Instance().Stop();
    if (!vrcsm::core::isOk(stopped))
    {
        spdlog::warn("tts.stop: {}", vrcsm::core::error(stopped).message);
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleTtsSetVoice(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto& engine = vrcsm::core::SapiVoice::Instance();
    if (params.contains("voiceId") && params["voiceId"].is_string())
    {
        auto r = engine.SetVoice(params["voiceId"].get<std::string>());
        if (!vrcsm::core::isOk(r))
        {
            throw IpcException(vrcsm::core::error(r));
        }
    }
    if (params.contains("rate") && params["rate"].is_number_integer())
    {
        (void)engine.SetRate(params["rate"].get<int>());
    }
    if (params.contains("volume") && params["volume"].is_number_integer())
    {
        (void)engine.SetVolume(params["volume"].get<int>());
    }
    if (params.contains("chatbox") && params["chatbox"].is_boolean())
    {
        m_ttsChatbox.store(params["chatbox"].get<bool>());
    }
    PersistOscTtsFromEngine(m_ttsChatbox.load());
    return nlohmann::json{
        {"ok", true},
        {"voiceId", engine.PreferredVoiceId()},
        {"rate", engine.Rate()},
        {"volume", engine.Volume()},
        {"chatbox", m_ttsChatbox.load()},
    };
}
