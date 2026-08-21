#pragma once

#include "Common.h"

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct OscTtsPrefs
{
    std::string engine{"sapi"};
    std::string voiceId;
    int rate{0};
    int volume{80};
    bool chatbox{false};
};

struct GreyWatch
{
    std::string id;
    bool enabled{false};
    std::string label;
    std::string worldId;
    std::string groupId;
    std::string region;
    std::string access{"any"};
    int minUsers{0};
    int maxUsers{0};
    std::string nameContains;
    bool notify{true};
    bool autoJoin{false};
};

struct GreyAuthOtpMailPrefs
{
    bool enabled{false};
    std::string host;
    int port{993};
    std::string tls{"imaps"};
    std::string username;
    bool markSeen{false};
    bool submitOnce{false};
    std::optional<std::string> tosAcceptedAt;
};

inline constexpr int kInviteAssistCooldownMinSec = 600;
inline constexpr int kInviteAssistCooldownMaxSec = 3600;
inline constexpr int kInviteAssistCancelWindowSec = 5;
inline constexpr int kEventWatchIntervalMinSec = 30;
inline constexpr int kEventWatchIntervalMaxSec = 300;
inline constexpr int kEventWatchJoinDelayMinSec = 15;
inline constexpr int kEventWatchJoinDelayMaxSec = 60;
inline constexpr int kEventWatchJoinCooldownMinSec = 600;
inline constexpr int kEventWatchJoinCooldownMaxSec = 3600;

struct GreyInviteAssistPrefs
{
    bool enabled{false};
    std::optional<std::string> confirmedAt;
    int cooldownSec{kInviteAssistCooldownMinSec};
    int cancelWindowSec{kInviteAssistCancelWindowSec};
};

struct GreyEventWatchPrefs
{
    int intervalSec{kEventWatchIntervalMinSec};
    int joinDelaySec{kEventWatchJoinDelayMinSec};
    int joinCooldownSec{kEventWatchJoinCooldownMinSec};
    bool autoJoinConfirmed{false};
    std::vector<GreyWatch> watches;
};

// Host JSON at `%LocalAppData%\VRCSM\grey-prefs.json`. No secrets.
// `greyEnabled` defaults true (helpers visible). Invite Assist / Event Watch
// auto-join / IMAP still need their own confirm rails and stay off.
struct GreyPrefs
{
    int schema{1};
    bool greyEnabled{true};
    nlohmann::json inviteSlots = nlohmann::json::object();
    nlohmann::json playspace = nlohmann::json::object();
    OscTtsPrefs oscTts{};
    GreyAuthOtpMailPrefs authOtpMail{};
    GreyInviteAssistPrefs inviteAssist{};
    GreyEventWatchPrefs eventWatch{};
    std::optional<std::string> masterTosAcceptedAt;
};

GreyPrefs DefaultGreyPrefs();

nlohmann::json GreyPrefsToJson(const GreyPrefs& prefs);
GreyPrefs GreyPrefsFromJson(const nlohmann::json& doc);

std::filesystem::path GreyPrefsPath();

Result<GreyPrefs> LoadGreyPrefs();
Result<GreyPrefs> LoadGreyPrefsFrom(const std::filesystem::path& path);
Result<std::monostate> SaveGreyPrefs(const GreyPrefs& prefs);
Result<std::monostate> SaveGreyPrefsTo(const std::filesystem::path& path, const GreyPrefs& prefs);

// Merge a JSON patch. Unknown top-level keys and secret fields
// (`password`, `imapPassword`, `vrcPassword`, `authPassword`) → invalid_params.
Result<GreyPrefs> MergeGreyPrefsPatch(const GreyPrefs& current, const nlohmann::json& patch);

Error GreyDisabledError();
Error GreyConfirmRequiredError(std::string_view detail);

// Adapter used by G4–G6 engines/tests (formerly GreyPrefsStore in a worktree).
class GreyPrefsStore
{
public:
    static GreyPrefsStore& Instance();
    std::filesystem::path Path() const;
    void SetPathForTests(std::filesystem::path path);
    Result<GreyPrefs> Load();
    Result<std::monostate> Save(const GreyPrefs& prefs);
    Result<GreyPrefs> MergePatch(const nlohmann::json& patch);
    static nlohmann::json Redact(const GreyPrefs& prefs);

private:
    GreyPrefsStore() = default;
    mutable std::mutex m_mutex;
    std::optional<std::filesystem::path> m_overridePath;
};

} // namespace vrcsm::core
