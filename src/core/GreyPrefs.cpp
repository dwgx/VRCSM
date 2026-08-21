#include "GreyPrefs.h"

#include "Common.h"
#include "EventWatch.h"
#include "InviteSlots.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <mutex>
#include <unordered_set>

#include <spdlog/spdlog.h>

namespace vrcsm::core
{
namespace
{

std::mutex& PrefsMutex()
{
    static std::mutex m;
    return m;
}

const std::unordered_set<std::string>& KnownTopKeys()
{
    static const std::unordered_set<std::string> k = {
        "schema",
        "greyEnabled",
        "inviteSlots",
        "playspace",
        "oscTts",
        "authOtpMail",
        "inviteAssist",
        "eventWatch",
        "masterTosAcceptedAt",
    };
    return k;
}

void ClampGreyTiming(GreyPrefs& prefs)
{
    prefs.inviteAssist.cooldownSec = std::clamp(
        prefs.inviteAssist.cooldownSec,
        kInviteAssistCooldownMinSec,
        kInviteAssistCooldownMaxSec);
    prefs.inviteAssist.cancelWindowSec = kInviteAssistCancelWindowSec;
    prefs.eventWatch.intervalSec = std::clamp(
        prefs.eventWatch.intervalSec,
        kEventWatchIntervalMinSec,
        kEventWatchIntervalMaxSec);
    prefs.eventWatch.joinDelaySec = std::clamp(
        prefs.eventWatch.joinDelaySec,
        kEventWatchJoinDelayMinSec,
        kEventWatchJoinDelayMaxSec);
    prefs.eventWatch.joinCooldownSec = std::clamp(
        prefs.eventWatch.joinCooldownSec,
        kEventWatchJoinCooldownMinSec,
        kEventWatchJoinCooldownMaxSec);
}

bool IsForbiddenSecretKey(std::string_view key)
{
    return key == "password"
        || key == "imapPassword"
        || key == "vrcPassword"
        || key == "authPassword"
        || key == "imap.password";
}

bool ContainsForbiddenSecret(const nlohmann::json& value)
{
    if (value.is_object())
    {
        for (auto it = value.begin(); it != value.end(); ++it)
        {
            if (IsForbiddenSecretKey(it.key())) return true;
            if (ContainsForbiddenSecret(it.value())) return true;
        }
        return false;
    }
    if (value.is_array())
    {
        for (const auto& item : value)
        {
            if (ContainsForbiddenSecret(item)) return true;
        }
    }
    return false;
}

nlohmann::json MergeObject(const nlohmann::json& base, const nlohmann::json& patch)
{
    nlohmann::json out = base.is_object() ? base : nlohmann::json::object();
    if (!patch.is_object()) return out;
    for (auto it = patch.begin(); it != patch.end(); ++it)
    {
        if (it.value().is_object() && out.contains(it.key()) && out[it.key()].is_object())
        {
            out[it.key()] = MergeObject(out[it.key()], it.value());
        }
        else
        {
            out[it.key()] = it.value();
        }
    }
    return out;
}

GreyPrefs FromJson(const nlohmann::json& doc)
{
    GreyPrefs prefs = DefaultGreyPrefs();
    if (!doc.is_object()) return prefs;

    if (doc.contains("schema") && doc["schema"].is_number_integer())
    {
        prefs.schema = doc["schema"].get<int>();
    }
    if (doc.contains("greyEnabled") && doc["greyEnabled"].is_boolean())
    {
        prefs.greyEnabled = doc["greyEnabled"].get<bool>();
    }

    auto takeObject = [&](const char* key, nlohmann::json& dest)
    {
        if (doc.contains(key) && doc[key].is_object())
        {
            dest = MergeObject(dest, doc[key]);
        }
    };
    takeObject("inviteSlots", prefs.inviteSlots);
    takeObject("playspace", prefs.playspace);

    if (doc.contains("oscTts") && doc["oscTts"].is_object())
    {
        const auto& o = doc["oscTts"];
        if (o.contains("engine") && o["engine"].is_string()) prefs.oscTts.engine = o["engine"].get<std::string>();
        if (o.contains("voiceId") && o["voiceId"].is_string()) prefs.oscTts.voiceId = o["voiceId"].get<std::string>();
        if (o.contains("rate") && o["rate"].is_number_integer()) prefs.oscTts.rate = std::clamp(o["rate"].get<int>(), -5, 5);
        if (o.contains("volume") && o["volume"].is_number_integer()) prefs.oscTts.volume = std::clamp(o["volume"].get<int>(), 0, 100);
        if (o.contains("chatbox") && o["chatbox"].is_boolean()) prefs.oscTts.chatbox = o["chatbox"].get<bool>();
    }

    if (doc.contains("authOtpMail") && doc["authOtpMail"].is_object())
    {
        const auto& o = doc["authOtpMail"];
        if (o.contains("enabled") && o["enabled"].is_boolean()) prefs.authOtpMail.enabled = o["enabled"].get<bool>();
        if (o.contains("host") && o["host"].is_string()) prefs.authOtpMail.host = o["host"].get<std::string>();
        if (o.contains("port") && o["port"].is_number_integer()) prefs.authOtpMail.port = o["port"].get<int>();
        if (o.contains("tls") && o["tls"].is_string()) prefs.authOtpMail.tls = o["tls"].get<std::string>();
        if (o.contains("username") && o["username"].is_string()) prefs.authOtpMail.username = o["username"].get<std::string>();
        if (o.contains("markSeen") && o["markSeen"].is_boolean()) prefs.authOtpMail.markSeen = o["markSeen"].get<bool>();
        if (o.contains("tosAcceptedAt") && o["tosAcceptedAt"].is_string())
        {
            const auto s = o["tosAcceptedAt"].get<std::string>();
            prefs.authOtpMail.tosAcceptedAt = s.empty() ? std::nullopt : std::optional<std::string>(s);
        }
    }
    prefs.authOtpMail.submitOnce = false;

    if (doc.contains("inviteAssist") && doc["inviteAssist"].is_object())
    {
        const auto& o = doc["inviteAssist"];
        if (o.contains("enabled") && o["enabled"].is_boolean()) prefs.inviteAssist.enabled = o["enabled"].get<bool>();
        if (o.contains("cooldownSec") && o["cooldownSec"].is_number_integer()) prefs.inviteAssist.cooldownSec = o["cooldownSec"].get<int>();
        if (o.contains("cancelWindowSec") && o["cancelWindowSec"].is_number_integer()) prefs.inviteAssist.cancelWindowSec = o["cancelWindowSec"].get<int>();
        if (o.contains("confirmedAt") && o["confirmedAt"].is_string())
        {
            const auto s = o["confirmedAt"].get<std::string>();
            prefs.inviteAssist.confirmedAt = s.empty() ? std::nullopt : std::optional<std::string>(s);
        }
    }

    if (doc.contains("eventWatch") && doc["eventWatch"].is_object())
    {
        const auto& o = doc["eventWatch"];
        if (o.contains("intervalSec") && o["intervalSec"].is_number_integer())
        {
            prefs.eventWatch.intervalSec = o["intervalSec"].get<int>();
        }
        if (o.contains("joinDelaySec") && o["joinDelaySec"].is_number_integer()) prefs.eventWatch.joinDelaySec = o["joinDelaySec"].get<int>();
        if (o.contains("joinCooldownSec") && o["joinCooldownSec"].is_number_integer()) prefs.eventWatch.joinCooldownSec = o["joinCooldownSec"].get<int>();
        if (o.contains("autoJoinConfirmed") && o["autoJoinConfirmed"].is_boolean()) prefs.eventWatch.autoJoinConfirmed = o["autoJoinConfirmed"].get<bool>();
        if (o.contains("watches") && o["watches"].is_array())
        {
            prefs.eventWatch.watches.clear();
            for (const auto& w : o["watches"])
            {
                if (!w.is_object()) continue;
                GreyWatch watch;
                if (w.contains("id") && w["id"].is_string()) watch.id = w["id"].get<std::string>();
                if (w.contains("enabled") && w["enabled"].is_boolean()) watch.enabled = w["enabled"].get<bool>();
                if (w.contains("label") && w["label"].is_string()) watch.label = w["label"].get<std::string>();
                if (w.contains("worldId") && w["worldId"].is_string()) watch.worldId = w["worldId"].get<std::string>();
                if (w.contains("groupId") && w["groupId"].is_string()) watch.groupId = w["groupId"].get<std::string>();
                if (w.contains("region") && w["region"].is_string()) watch.region = w["region"].get<std::string>();
                if (w.contains("access") && w["access"].is_string()) watch.access = w["access"].get<std::string>();
                if (w.contains("minUsers") && w["minUsers"].is_number_integer()) watch.minUsers = w["minUsers"].get<int>();
                if (w.contains("maxUsers") && w["maxUsers"].is_number_integer()) watch.maxUsers = w["maxUsers"].get<int>();
                if (w.contains("nameContains") && w["nameContains"].is_string()) watch.nameContains = w["nameContains"].get<std::string>();
                if (w.contains("notify") && w["notify"].is_boolean()) watch.notify = w["notify"].get<bool>();
                if (w.contains("autoJoin") && w["autoJoin"].is_boolean()) watch.autoJoin = w["autoJoin"].get<bool>();
                if (!watch.notify)
                {
                    watch.autoJoin = false;
                }
                auto validated = ValidateWatch(std::move(watch));
                if (!isOk(validated))
                {
                    continue;
                }
                if (prefs.eventWatch.watches.size() >= 8)
                {
                    break;
                }
                prefs.eventWatch.watches.push_back(std::move(value(validated)));
            }
        }
    }

    if (doc.contains("masterTosAcceptedAt") && doc["masterTosAcceptedAt"].is_string())
    {
        const auto s = doc["masterTosAcceptedAt"].get<std::string>();
        prefs.masterTosAcceptedAt = s.empty() ? std::nullopt : std::optional<std::string>(s);
    }
    ClampGreyTiming(prefs);
    return prefs;
}

Result<std::monostate> AtomicWrite(const std::filesystem::path& path, const std::string& payload)
{
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);

    auto tmp = path;
    tmp += L".tmp";

    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out)
        {
            return Error{"io_error", "failed to open grey-prefs temp file", 0};
        }
        out << payload;
        out.flush();
        if (!out)
        {
            return Error{"io_error", "failed to write grey-prefs temp file", 0};
        }
    }

    std::filesystem::rename(tmp, path, ec);
    if (ec)
    {
        std::error_code rm;
        std::filesystem::remove(path, rm);
        ec.clear();
        std::filesystem::rename(tmp, path, ec);
        if (ec)
        {
            return Error{"io_error", "failed to replace grey-prefs.json", 0};
        }
    }
    return std::monostate{};
}

} // namespace

GreyPrefs GreyPrefsFromJson(const nlohmann::json& doc)
{
    return FromJson(doc);
}

GreyPrefs DefaultGreyPrefs()
{
    GreyPrefs prefs;
    prefs.schema = 1;
    prefs.greyEnabled = true;
    prefs.inviteSlots = {
        {"lastType", "invite"},
        {"confirmBeforeSend", true},
    };
    prefs.playspace = {
        {"lockX", false},
        {"lockY", true},
        {"lockZ", false},
        {"speedMps", 1.5},
    };
    prefs.oscTts = OscTtsPrefs{};
    prefs.authOtpMail = GreyAuthOtpMailPrefs{};
    prefs.inviteAssist = GreyInviteAssistPrefs{};
    prefs.eventWatch = GreyEventWatchPrefs{};
    return prefs;
}

nlohmann::json GreyPrefsToJson(const GreyPrefs& prefs)
{
    nlohmann::json watches = nlohmann::json::array();
    for (const auto& w : prefs.eventWatch.watches)
    {
        watches.push_back({
            {"id", w.id},
            {"enabled", w.enabled},
            {"label", w.label},
            {"worldId", w.worldId},
            {"groupId", w.groupId},
            {"region", w.region},
            {"access", w.access},
            {"minUsers", w.minUsers},
            {"maxUsers", w.maxUsers},
            {"nameContains", w.nameContains},
            {"notify", w.notify},
            {"autoJoin", w.autoJoin},
        });
    }
    return nlohmann::json{
        {"schema", prefs.schema},
        {"greyEnabled", prefs.greyEnabled},
        {"inviteSlots", prefs.inviteSlots},
        {"playspace", prefs.playspace},
        {"oscTts", {
            {"engine", prefs.oscTts.engine},
            {"voiceId", prefs.oscTts.voiceId},
            {"rate", prefs.oscTts.rate},
            {"volume", prefs.oscTts.volume},
            {"chatbox", prefs.oscTts.chatbox},
        }},
        {"authOtpMail", {
            {"enabled", prefs.authOtpMail.enabled},
            {"host", prefs.authOtpMail.host},
            {"port", prefs.authOtpMail.port},
            {"tls", prefs.authOtpMail.tls},
            {"username", prefs.authOtpMail.username},
            {"markSeen", prefs.authOtpMail.markSeen},
            {"submitOnce", false},
            {"tosAcceptedAt", prefs.authOtpMail.tosAcceptedAt.has_value()
                ? nlohmann::json(*prefs.authOtpMail.tosAcceptedAt) : nlohmann::json(nullptr)},
        }},
        {"inviteAssist", {
            {"enabled", prefs.inviteAssist.enabled},
            {"confirmedAt", prefs.inviteAssist.confirmedAt.has_value()
                ? nlohmann::json(*prefs.inviteAssist.confirmedAt) : nlohmann::json(nullptr)},
            {"cooldownSec", prefs.inviteAssist.cooldownSec},
            {"cancelWindowSec", prefs.inviteAssist.cancelWindowSec},
        }},
        {"eventWatch", {
            {"intervalSec", prefs.eventWatch.intervalSec},
            {"joinDelaySec", prefs.eventWatch.joinDelaySec},
            {"joinCooldownSec", prefs.eventWatch.joinCooldownSec},
            {"autoJoinConfirmed", prefs.eventWatch.autoJoinConfirmed},
            {"watches", std::move(watches)},
        }},
        {"masterTosAcceptedAt", prefs.masterTosAcceptedAt.has_value()
            ? nlohmann::json(*prefs.masterTosAcceptedAt) : nlohmann::json(nullptr)},
    };
}

std::filesystem::path GreyPrefsPath()
{
    return getAppDataRoot() / L"grey-prefs.json";
}

Result<GreyPrefs> LoadGreyPrefs()
{
    return LoadGreyPrefsFrom(GreyPrefsPath());
}

Result<GreyPrefs> LoadGreyPrefsFrom(const std::filesystem::path& path)
{
    std::lock_guard<std::mutex> lock(PrefsMutex());
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec)
    {
        return DefaultGreyPrefs();
    }

    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        spdlog::warn("grey-prefs: could not read {}, using defaults", toUtf8(path.wstring()));
        return DefaultGreyPrefs();
    }

    try
    {
        const auto doc = nlohmann::json::parse(in);
        return FromJson(doc);
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("grey-prefs: corrupt file ({}), using defaults", ex.what());
        return DefaultGreyPrefs();
    }
}

Result<std::monostate> SaveGreyPrefs(const GreyPrefs& prefs)
{
    return SaveGreyPrefsTo(GreyPrefsPath(), prefs);
}

Result<std::monostate> SaveGreyPrefsTo(const std::filesystem::path& path, const GreyPrefs& prefs)
{
    std::lock_guard<std::mutex> lock(PrefsMutex());
    return AtomicWrite(path, GreyPrefsToJson(prefs).dump(2));
}

Result<GreyPrefs> MergeGreyPrefsPatch(const GreyPrefs& current, const nlohmann::json& patch)
{
    if (!patch.is_object())
    {
        return Error{"invalid_params", "grey.prefs.set: patch must be an object", 400};
    }
    if (ContainsForbiddenSecret(patch))
    {
        return Error{"invalid_params", "grey.prefs.set: secret fields are not stored here", 400};
    }

    for (auto it = patch.begin(); it != patch.end(); ++it)
    {
        if (!KnownTopKeys().contains(it.key()))
        {
            return Error{"invalid_params", "grey.prefs.set: unknown key '" + it.key() + "'", 400};
        }
    }

    GreyPrefs next = current;

    if (patch.contains("schema"))
    {
        if (!patch["schema"].is_number_integer())
        {
            return Error{"invalid_params", "grey.prefs.set: schema must be an integer", 400};
        }
        next.schema = patch["schema"].get<int>();
    }
    if (patch.contains("greyEnabled"))
    {
        if (!patch["greyEnabled"].is_boolean())
        {
            return Error{"invalid_params", "grey.prefs.set: greyEnabled must be a boolean", 400};
        }
        next.greyEnabled = patch["greyEnabled"].get<bool>();
    }

    auto mergeKnown = [&](const char* key, nlohmann::json& dest) -> Result<std::monostate>
    {
        if (!patch.contains(key)) return std::monostate{};
        if (!patch[key].is_object())
        {
            return Error{"invalid_params", std::string("grey.prefs.set: ") + key + " must be an object", 400};
        }
        dest = MergeObject(dest, patch[key]);
        return std::monostate{};
    };

    if (const auto r = mergeKnown("inviteSlots", next.inviteSlots); !isOk(r)) return error(r);
    if (const auto r = mergeKnown("playspace", next.playspace); !isOk(r)) return error(r);
    if (patch.contains("oscTts"))
    {
        if (!patch["oscTts"].is_object())
        {
            return Error{"invalid_params", "grey.prefs.set: oscTts must be an object", 400};
        }
        const auto& o = patch["oscTts"];
        if (o.contains("engine") && o["engine"].is_string()) next.oscTts.engine = o["engine"].get<std::string>();
        if (o.contains("voiceId") && o["voiceId"].is_string()) next.oscTts.voiceId = o["voiceId"].get<std::string>();
        if (o.contains("rate") && o["rate"].is_number_integer()) next.oscTts.rate = std::clamp(o["rate"].get<int>(), -5, 5);
        if (o.contains("volume") && o["volume"].is_number_integer()) next.oscTts.volume = std::clamp(o["volume"].get<int>(), 0, 100);
        if (o.contains("chatbox") && o["chatbox"].is_boolean()) next.oscTts.chatbox = o["chatbox"].get<bool>();
    }
    if (patch.contains("authOtpMail") || patch.contains("inviteAssist")
        || patch.contains("eventWatch") || patch.contains("masterTosAcceptedAt"))
    {
        auto asJson = GreyPrefsToJson(next);
        if (patch.contains("authOtpMail")) asJson["authOtpMail"] = MergeObject(asJson["authOtpMail"], patch["authOtpMail"]);
        if (patch.contains("inviteAssist")) asJson["inviteAssist"] = MergeObject(asJson["inviteAssist"], patch["inviteAssist"]);
        if (patch.contains("eventWatch")) asJson["eventWatch"] = MergeObject(asJson["eventWatch"], patch["eventWatch"]);
        if (patch.contains("masterTosAcceptedAt")) asJson["masterTosAcceptedAt"] = patch["masterTosAcceptedAt"];
        next = FromJson(asJson);
        next.greyEnabled = GreyPrefsToJson(current).value("greyEnabled", next.greyEnabled);
        if (patch.contains("greyEnabled") && patch["greyEnabled"].is_boolean())
        {
            next.greyEnabled = patch["greyEnabled"].get<bool>();
        }
        if (patch.contains("schema") && patch["schema"].is_number_integer())
        {
            next.schema = patch["schema"].get<int>();
        }
        next.inviteSlots = current.inviteSlots;
        next.playspace = current.playspace;
        next.oscTts = current.oscTts;
        if (const auto r = mergeKnown("inviteSlots", next.inviteSlots); !isOk(r)) return error(r);
        if (const auto r = mergeKnown("playspace", next.playspace); !isOk(r)) return error(r);
        if (patch.contains("oscTts") && patch["oscTts"].is_object())
        {
            const auto& o = patch["oscTts"];
            if (o.contains("engine") && o["engine"].is_string()) next.oscTts.engine = o["engine"].get<std::string>();
            if (o.contains("voiceId") && o["voiceId"].is_string()) next.oscTts.voiceId = o["voiceId"].get<std::string>();
            if (o.contains("rate") && o["rate"].is_number_integer()) next.oscTts.rate = std::clamp(o["rate"].get<int>(), -5, 5);
            if (o.contains("volume") && o["volume"].is_number_integer()) next.oscTts.volume = std::clamp(o["volume"].get<int>(), 0, 100);
            if (o.contains("chatbox") && o["chatbox"].is_boolean()) next.oscTts.chatbox = o["chatbox"].get<bool>();
        }
    }

    if (next.inviteSlots.contains("lastType"))
    {
        if (!next.inviteSlots["lastType"].is_string()
            || !IsLiveInviteSlotType(next.inviteSlots["lastType"].get<std::string>()))
        {
            return Error{"invalid_params", "inviteSlots.lastType must be a live slot type", 400};
        }
    }
    if (next.inviteSlots.contains("confirmBeforeSend")
        && !next.inviteSlots["confirmBeforeSend"].is_boolean())
    {
        return Error{"invalid_params", "inviteSlots.confirmBeforeSend must be a boolean", 400};
    }

    next.authOtpMail.submitOnce = false;
    if (next.greyEnabled && !current.greyEnabled && !next.masterTosAcceptedAt.has_value())
    {
        next.masterTosAcceptedAt = nowIso();
    }
    ClampGreyTiming(next);
    return next;
}

Error GreyDisabledError()
{
    return Error{"grey_disabled", "Optional social/VR helpers are disabled", 403};
}

Error GreyConfirmRequiredError(std::string_view detail)
{
    return Error{"confirm_required", std::string(detail), 403};
}

GreyPrefsStore& GreyPrefsStore::Instance()
{
    static GreyPrefsStore store;
    return store;
}

std::filesystem::path GreyPrefsStore::Path() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_overridePath.has_value())
    {
        return *m_overridePath;
    }
    return GreyPrefsPath();
}

void GreyPrefsStore::SetPathForTests(std::filesystem::path path)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (path.empty())
    {
        m_overridePath.reset();
    }
    else
    {
        m_overridePath = std::move(path);
    }
}

Result<GreyPrefs> GreyPrefsStore::Load()
{
    return LoadGreyPrefsFrom(Path());
}

Result<std::monostate> GreyPrefsStore::Save(const GreyPrefs& prefs)
{
    return SaveGreyPrefsTo(Path(), prefs);
}

Result<GreyPrefs> GreyPrefsStore::MergePatch(const nlohmann::json& patch)
{
    auto loaded = Load();
    if (!isOk(loaded))
    {
        return error(loaded);
    }
    auto merged = MergeGreyPrefsPatch(value(loaded), patch);
    if (!isOk(merged))
    {
        return error(merged);
    }
    auto saved = Save(value(merged));
    if (!isOk(saved))
    {
        return error(saved);
    }
    return value(merged);
}

nlohmann::json GreyPrefsStore::Redact(const GreyPrefs& prefs)
{
    return GreyPrefsToJson(prefs);
}

} // namespace vrcsm::core
