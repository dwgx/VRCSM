#include "../../pch.h"
#include "BridgeCommon.h"
#include "GreyBridge.h"

#include "../../core/AuthStore.h"
#include "../../core/Common.h"
#include "../../core/Database.h"
#include "../../core/EventWatch.h"
#include "../../core/GreyAudit.h"
#include "../../core/GreyPrefs.h"
#include "../../core/ImapClient.h"
#include "../../core/InviteAssist.h"
#include "../../core/LocationParse.h"
#include "../../core/OtpMailParser.h"
#include "../../core/OtpMailStore.h"
#include "../../core/PresenceCache.h"
#include "../../core/ProcessGuard.h"
#include "../../core/RateLimiter.h"
#include "../../core/ToastNotifier.h"
#include "../../core/VrcApi.h"
#include "../../core/VrOverlayNotifier.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <shellapi.h>
#include <thread>
#include <unordered_map>
#include <unordered_set>

using namespace vrcsm::core;

namespace
{

constexpr const char* kAssistList = "InviteAssist";
constexpr int kAllowlistCap = 64;

struct GreyState
{
    std::mutex mu;
    IpcBridge* bridge{nullptr};
    InviteAssistEngine assist;
    EventWatchEngine watch;
    std::unordered_map<std::string, std::string> friendLocations;

    std::atomic<bool> stop{false};
    std::atomic<bool> otpRunning{false};
    std::atomic<bool> watchRunning{false};
    std::atomic<bool> otpSubmitOnce{false};
    std::thread otpThread;
    std::thread watchThread;
    std::thread assistThread;
    std::condition_variable cv;
};

GreyState& GS()
{
    static GreyState s;
    return s;
}

void Post(IpcBridge* bridge, std::string_view event, const nlohmann::json& data)
{
    if (bridge != nullptr)
    {
        bridge->PostGreyEvent(event, data);
    }
}

void ShowSocialToast(const std::string& title, const std::string& body, const std::optional<std::string>& launch)
{
    ToastContent toast;
    toast.kind = ToastKind::Invite;
    toast.title = title;
    toast.body = body;
    toast.launchArg = launch;
    ToastNotifier::ShowToast(toast);
    OverlayNotification overlay;
    overlay.title = title;
    overlay.body = body;
    VrOverlayNotifier::Notify(overlay);
}

Result<GreyPrefs> RequireGrey()
{
    auto loaded = GreyPrefsStore::Instance().Load();
    if (!isOk(loaded))
    {
        return error(loaded);
    }
    if (!value(loaded).greyEnabled)
    {
        return GreyDisabledError();
    }
    return loaded;
}

void ThrowIfErr(const Error& err)
{
    throw IpcException(err);
}

template <typename T>
T Unwrap(Result<T>&& r)
{
    if (!isOk(r))
    {
        throw IpcException(error(r));
    }
    return value(r);
}

nlohmann::json AllowlistJson()
{
    nlohmann::json arr = nlohmann::json::array();
    auto items = Database::Instance().FavoriteItems(kAssistList);
    if (!isOk(items))
    {
        return arr;
    }
    const auto& doc = value(items);
    const auto* list = doc.is_array() ? &doc : (doc.contains("items") ? &doc["items"] : nullptr);
    if (list == nullptr || !list->is_array())
    {
        return arr;
    }
    for (const auto& row : *list)
    {
        if (row.value("type", "") != "user")
        {
            continue;
        }
        arr.push_back({
            {"userId", row.value("target_id", "")},
            {"displayName", row.value("display_name", "")},
        });
    }
    return arr;
}

bool InAllowlist(const std::string& userId)
{
    for (const auto& row : AllowlistJson())
    {
        if (row.value("userId", "") == userId)
        {
            return true;
        }
    }
    return false;
}

void SyncWatchFromPrefs(const GreyPrefs& prefs)
{
    auto& st = GS();
    st.watch.replaceAll(prefs.eventWatch.watches);
    st.watch.setJoinCooldown(std::chrono::seconds{prefs.eventWatch.joinCooldownSec});
}

void StopThread(std::thread& t)
{
    if (t.joinable())
    {
        t.join();
    }
}

void OtpLoop()
{
    auto& st = GS();
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes{3};
    while (!st.stop.load() && st.otpRunning.load())
    {
        if (std::chrono::steady_clock::now() >= deadline)
        {
            break;
        }
        {
            std::unique_lock lock(st.mu);
            st.cv.wait_for(lock, std::chrono::seconds{5}, [&] { return st.stop.load() || !st.otpRunning.load(); });
        }
        if (st.stop.load() || !st.otpRunning.load())
        {
            break;
        }

        auto cfgRes = OtpMailStore::Instance().Load();
        if (!isOk(cfgRes))
        {
            continue;
        }
        ImapOtpConfig cfg = value(cfgRes);
        auto fetched = ImapClient::FetchUnseenToday(cfg);
        secureClearString(cfg.password);
        if (!isOk(fetched))
        {
            continue;
        }
        const auto now = std::chrono::system_clock::now();
        for (const auto& mail : value(fetched))
        {
            auto parsed = ParseOtpMail(mail, now, cfg.fromAllow);
            if (!parsed)
            {
                continue;
            }
            (void)AppendGreyAudit("otpMail", "otp.parsed", nlohmann::json{{"fromHost", parsed->fromHost}, {"remainingTtlSec", parsed->remainingTtlSec}});
            Post(st.bridge, "otpMail.codeFound", nlohmann::json{
                {"code", parsed->code},
                {"remainingTtlSec", parsed->remainingTtlSec},
            });
            if (st.otpSubmitOnce.exchange(false))
            {
                auto verify = VrcApi::verifyTwoFactor("emailOtp", parsed->code);
                (void)AppendGreyAudit("otpMail", "otp.submitOnce", nlohmann::json{{"ok", verify.ok}});
                if (verify.ok)
                {
                    auto user = VrcApi::fetchCurrentUser();
                    nlohmann::json summary = nlohmann::json::object();
                    if (isOk(user))
                    {
                        const auto& doc = value(user);
                        summary["authed"] = true;
                        summary["displayName"] = doc.value("displayName", "");
                        summary["userId"] = doc.value("id", "");
                    }
                    Post(st.bridge, "auth.loginCompleted", nlohmann::json{{"ok", true}, {"user", summary}});
                }
                secureClearString(parsed->code);
            }
            break;
        }
    }
    st.otpRunning.store(false);
}

void AssistWaitLoop()
{
    auto& st = GS();
    while (!st.stop.load())
    {
        {
            std::unique_lock lock(st.mu);
            st.cv.wait_for(lock, std::chrono::milliseconds{200}, [&] { return st.stop.load(); });
        }
        if (st.stop.load())
        {
            break;
        }
        auto due = st.assist.takeDue(std::chrono::steady_clock::now());
        if (!due)
        {
            continue;
        }
        auto prefs = GreyPrefsStore::Instance().Load();
        if (!isOk(prefs) || !value(prefs).greyEnabled || !value(prefs).inviteAssist.enabled)
        {
            continue;
        }
        const auto loc = PresenceCache::Instance().location().value_or("");
        auto invited = VrcApi::inviteUser(due->senderUserId, loc, 0);
        st.assist.markAccepted(due->senderUserId, std::chrono::steady_clock::now());
        (void)AppendGreyAudit("inviteAssist", "assist.accept", nlohmann::json{
            {"senderUserId", due->senderUserId},
            {"ok", isOk(invited)},
        });
        if (!due->notificationId.empty())
        {
            (void)VrcApi::seeNotification(due->notificationId);
        }
        Post(st.bridge, "inviteAssist.accepted", nlohmann::json{
            {"senderUserId", due->senderUserId},
            {"displayName", due->displayName},
        });
    }
}

std::vector<nlohmann::json> CollectWatchInstances(const GreyPrefs& prefs)
{
    std::vector<nlohmann::json> instances;
    auto& st = GS();
    std::unordered_set<std::string> seen;

    auto addLocation = [&](const std::string& location) {
        if (location.empty() || !isInWorld(location) || seen.count(location) > 0)
        {
            return;
        }
        if (!RateLimiter::Instance().TryAcquire())
        {
            return;
        }
        auto inst = VrcApi::fetchInstance(location);
        if (isOk(inst))
        {
            auto doc = value(inst);
            if (!doc.contains("location"))
            {
                doc["location"] = location;
            }
            seen.insert(location);
            instances.push_back(std::move(doc));
        }
    };

    {
        std::lock_guard<std::mutex> lock(st.mu);
        for (const auto& kv : st.friendLocations)
        {
            addLocation(kv.second);
        }
    }

    for (const auto& w : prefs.eventWatch.watches)
    {
        if (!w.enabled || w.groupId.empty())
        {
            continue;
        }
        if (!RateLimiter::Instance().TryAcquire())
        {
            continue;
        }
        auto gi = VrcApi::fetchGroupInstances(w.groupId);
        if (!isOk(gi))
        {
            continue;
        }
        const auto& body = value(gi);
        const nlohmann::json* arr = body.is_array() ? &body : nullptr;
        if (arr == nullptr && body.contains("instances") && body["instances"].is_array())
        {
            arr = &body["instances"];
        }
        if (arr == nullptr)
        {
            continue;
        }
        for (const auto& row : *arr)
        {
            instances.push_back(row);
        }
    }
    return instances;
}

void MaybeJoin(const EventWatchMatch& match, const GreyPrefs& prefs)
{
    auto& st = GS();
    if (!match.autoJoin)
    {
        return;
    }
    if (!isLaunchableVrchatLocation(match.location))
    {
        return;
    }
    if (!st.watch.joinCooldownReady(match.watchId, std::chrono::steady_clock::now()))
    {
        return;
    }
    EventJoinPending pending;
    pending.watchId = match.watchId;
    pending.location = match.location;
    pending.worldName = match.worldName;
    pending.due = std::chrono::steady_clock::now() + std::chrono::seconds{prefs.eventWatch.joinDelaySec};
    if (!st.watch.armJoin(std::move(pending)))
    {
        return;
    }
    Post(st.bridge, "eventWatch.joinPending", nlohmann::json{
        {"watchId", match.watchId},
        {"location", match.location},
        {"worldName", match.worldName},
    });
}

void ApplyWatchMatches(const GreyPrefs& prefs)
{
    auto& st = GS();
    auto instances = CollectWatchInstances(prefs);
    auto matches = st.watch.matchAll(instances);
    std::unordered_set<std::string> present;
    for (const auto& m : matches)
    {
        present.insert(m.dedupKey);
        if (!m.notify)
        {
            continue;
        }
        if (!st.watch.shouldNotify(m.dedupKey))
        {
            continue;
        }
        st.watch.markNotified(m.dedupKey);
        (void)AppendGreyAudit("eventWatch", "watch.match", nlohmann::json{
            {"watchId", m.watchId},
            {"location", m.location},
            {"nUsers", m.nUsers},
        });
        const auto launch = "vrcsm://watch/" + m.watchId + "/" + m.location;
        ShowSocialToast("Instance found", m.worldName.empty() ? m.location : m.worldName, launch);
        (void)AppendGreyAudit("eventWatch", "watch.notify", nlohmann::json{{"watchId", m.watchId}});
        Post(st.bridge, "eventWatch.match", nlohmann::json{
            {"watchId", m.watchId},
            {"location", m.location},
            {"worldName", m.worldName},
            {"nUsers", m.nUsers},
            {"autoJoin", m.autoJoin},
        });
        MaybeJoin(m, prefs);
    }
    st.watch.retainPresent(present);
}

void WatchLoop()
{
    auto& st = GS();
    auto lastPoll = std::chrono::steady_clock::time_point{};
    while (!st.stop.load() && st.watchRunning.load())
    {
        auto prefsRes = GreyPrefsStore::Instance().Load();
        int interval = 30;
        if (isOk(prefsRes))
        {
            interval = std::clamp(value(prefsRes).eventWatch.intervalSec, 30, 300);
        }
        const auto now = std::chrono::steady_clock::now();
        if (lastPoll.time_since_epoch().count() == 0
            || now - lastPoll >= std::chrono::seconds{interval})
        {
            if (isOk(prefsRes) && value(prefsRes).greyEnabled && st.watch.anyEnabled())
            {
                ApplyWatchMatches(value(prefsRes));
            }
            lastPoll = now;
        }
        if (auto due = st.watch.takeJoinDue(now))
        {
            if (isLaunchableVrchatLocation(due->location))
            {
                if (ProcessGuard::IsVRChatRunning().running)
                {
                    (void)VrcApi::inviteSelf(due->location);
                }
                else
                {
                    const std::wstring url = toWide("vrchat://launch?id=" + due->location);
                    ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                }
                (void)AppendGreyAudit("eventWatch", "watch.join", nlohmann::json{
                    {"watchId", due->watchId},
                    {"location", due->location},
                });
                Post(st.bridge, "eventWatch.joined", nlohmann::json{
                    {"watchId", due->watchId},
                    {"location", due->location},
                });
            }
            st.watch.markJoined(due->watchId, now);
        }
        auto waitFor = std::chrono::milliseconds{200};
        if (auto pending = st.watch.joinPending())
        {
            const auto remain = std::chrono::duration_cast<std::chrono::milliseconds>(pending->due - now);
            if (remain.count() > 0 && remain < waitFor)
            {
                waitFor = remain;
            }
        }
        {
            std::unique_lock lock(st.mu);
            st.cv.wait_for(lock, waitFor, [&] {
                return st.stop.load() || !st.watchRunning.load();
            });
        }
    }
    st.watchRunning.store(false);
}

void EnsureAssistThread()
{
    auto& st = GS();
    if (!st.assistThread.joinable())
    {
        st.assistThread = std::thread(AssistWaitLoop);
    }
}

void StartWatchIfNeeded()
{
    auto& st = GS();
    auto prefs = GreyPrefsStore::Instance().Load();
    if (!isOk(prefs) || !value(prefs).greyEnabled || !st.watch.anyEnabled())
    {
        return;
    }
    bool expected = false;
    if (st.watchRunning.compare_exchange_strong(expected, true))
    {
        if (st.watchThread.joinable())
        {
            st.watchThread.join();
        }
        st.watchThread = std::thread(WatchLoop);
    }
}

void StopWatch()
{
    auto& st = GS();
    st.watchRunning.store(false);
    st.cv.notify_all();
}

nlohmann::json PrefsPayload()
{
    auto prefs = Unwrap(GreyPrefsStore::Instance().Load());
    return nlohmann::json{{"prefs", GreyPrefsStore::Redact(prefs)}};
}

void JoinLocation(const std::string& location)
{
    if (!isLaunchableVrchatLocation(location))
    {
        throw IpcException(Error{"invalid_params", "invalid location", 0});
    }
    if (ProcessGuard::IsVRChatRunning().running)
    {
        auto r = VrcApi::inviteSelf(location);
        if (!isOk(r))
        {
            throw IpcException(error(r));
        }
        return;
    }
    // Launch via existing shell helper by posting a synthetic request through
    // VrcApi-less ShellExecute of vrchat:// — GreyBridge cannot call the
    // private shell handler, so we reuse inviteSelf fallback: if VRChat is
    // not running the SPA/user-click path uses shell.launchVrchatLocation.
    const std::wstring url = vrcsm::core::toWide("vrchat://launch?id=" + location);
    ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

} // namespace

void GreyBindBridge(IpcBridge* bridge)
{
    auto& st = GS();
    st.bridge = bridge;
    st.stop.store(false);
    auto prefs = GreyPrefsStore::Instance().Load();
    if (isOk(prefs))
    {
        SyncWatchFromPrefs(value(prefs));
        st.assist.setCooldown(std::chrono::seconds{value(prefs).inviteAssist.cooldownSec});
    }
    EnsureAssistThread();
    StartWatchIfNeeded();
}

void GreyShutdownWorkers()
{
    auto& st = GS();
    st.stop.store(true);
    st.otpRunning.store(false);
    st.watchRunning.store(false);
    st.cv.notify_all();
    StopThread(st.otpThread);
    StopThread(st.watchThread);
    StopThread(st.assistThread);
    st.bridge = nullptr;
}

void GreyDeleteImapSecret()
{
    (void)OtpMailStore::Instance().Clear();
}

void GreyHandleFriendsSnapshot(const std::vector<std::string>& userIds)
{
    PresenceCache::Instance().setFriends(userIds);
}

void GreyHandleSelfUser(const std::string& userId)
{
    PresenceCache::Instance().setSelfUserId(userId);
}

void GreyHandlePipeline(IpcBridge* bridge, const std::string& type, const nlohmann::json& content)
{
    auto& st = GS();
    st.bridge = bridge;

    if (type == "user-location")
    {
        const auto userId = content.value("userId", content.value("user_id", ""));
        const auto loc = content.value("location", "");
        const auto self = PresenceCache::Instance().selfUserId();
        if (self && !userId.empty() && userId == *self)
        {
            PresenceCache::Instance().setLocation(loc);
        }
    }
    if (type == "friend-location")
    {
        const auto userId = content.value("userId", "");
        const auto loc = content.value("location", "");
        if (!userId.empty())
        {
            std::lock_guard<std::mutex> lock(st.mu);
            st.friendLocations[userId] = loc;
        }
    }

    auto prefsRes = GreyPrefsStore::Instance().Load();
    GreyPrefs prefs = isOk(prefsRes) ? value(prefsRes) : GreyPrefs{};
    InviteAssistContext ctx;
    ctx.greyEnabled = prefs.greyEnabled;
    ctx.enabled = prefs.inviteAssist.enabled;
    ctx.confirmed = prefs.inviteAssist.confirmedAt.has_value();
    ctx.inWorld = PresenceCache::Instance().isInWorld();
    ctx.vrcRunning = ProcessGuard::IsVRChatRunning().running;
    ctx.friendsStale = PresenceCache::Instance().friendsStale(std::chrono::system_clock::now());
    const auto sender = NotificationSenderId(content);
    ctx.isFriend = PresenceCache::Instance().isFriend(sender);
    ctx.inAllowlist = InAllowlist(sender);

    auto decision = st.assist.consider(type, content, ctx, std::chrono::steady_clock::now());
    if (!decision.accept)
    {
        if (decision.skip != AssistSkipReason::WrongType
            && decision.skip != AssistSkipReason::GreyDisabled
            && decision.skip != AssistSkipReason::Disabled)
        {
            (void)AppendGreyAudit("inviteAssist", "assist.skip", nlohmann::json{
                {"reason", decision.reason},
                {"senderUserId", sender},
            });
        }
        return;
    }

    AssistPending pending;
    pending.senderUserId = sender;
    pending.displayName = NotificationSenderName(content);
    pending.notificationId = NotificationIdOf(content);
    pending.location = PresenceCache::Instance().location().value_or("");
    pending.due = std::chrono::steady_clock::now() + std::chrono::seconds{prefs.inviteAssist.cancelWindowSec};
    if (!st.assist.armPending(pending, std::chrono::seconds{prefs.inviteAssist.cancelWindowSec}))
    {
        return;
    }
    const auto name = pending.displayName.empty() ? pending.senderUserId : pending.displayName;
    ShowSocialToast(
        "Invite request",
        "Invite request from " + name + " — auto-invite in 5s. Cancel in VRCSM.",
        std::nullopt);
    Post(bridge, "inviteAssist.pending", st.assist.pendingJson());
}

void GreyOnPrefsChanged(const GreyPrefs& prefs)
{
    SyncWatchFromPrefs(prefs);
    GS().assist.setCooldown(std::chrono::seconds{prefs.inviteAssist.cooldownSec});
    if (prefs.greyEnabled)
    {
        StartWatchIfNeeded();
    }
    else
    {
        StopWatch();
        GS().otpRunning.store(false);
        GS().assist.cancelPending();
        GS().watch.cancelJoin();
        GS().cv.notify_all();
    }
}

nlohmann::json IpcBridge::HandleOtpMailGetConfig(const nlohmann::json&, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    nlohmann::json out{
        {"enabled", prefs.authOtpMail.enabled},
        {"host", prefs.authOtpMail.host},
        {"port", prefs.authOtpMail.port},
        {"tls", prefs.authOtpMail.tls},
        {"username", prefs.authOtpMail.username},
        {"passwordSaved", OtpMailStore::Instance().Exists()},
        {"markSeen", prefs.authOtpMail.markSeen},
        {"fromAllow", nlohmann::json::array({"noreply@vrchat.com", "@vrchat.com"})},
        {"tosAcceptedAt", prefs.authOtpMail.tosAcceptedAt
            ? nlohmann::json(*prefs.authOtpMail.tosAcceptedAt)
            : nlohmann::json(nullptr)},
    };
    return out;
}

nlohmann::json IpcBridge::HandleOtpMailSetConfig(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!params.is_object())
    {
        throw IpcException(Error{"invalid_params", "object required", 0});
    }
    if (params.contains("vrcPassword") || params.contains("authPassword"))
    {
        throw IpcException(Error{"invalid_params", "VRChat passwords cannot be stored in IMAP config", 0});
    }

    auto prefs = Unwrap(RequireGrey());
    const bool enabled = params.value("enabled", prefs.authOtpMail.enabled);
    if (enabled)
    {
        if (!prefs.greyEnabled)
        {
            throw IpcException(GreyDisabledError());
        }
        if (!prefs.authOtpMail.tosAcceptedAt && !params.contains("tosAcceptedAt"))
        {
            throw IpcException(GreyConfirmRequiredError("Email OTP helper TOS must be accepted"));
        }
    }

    ImapOtpConfig cfg;
    auto existing = OtpMailStore::Instance().Load();
    if (isOk(existing))
    {
        cfg = value(existing);
    }
    cfg.host = params.value("host", prefs.authOtpMail.host);
    cfg.port = params.value("port", prefs.authOtpMail.port);
    cfg.tls = params.value("tls", prefs.authOtpMail.tls);
    cfg.username = params.value("username", prefs.authOtpMail.username);
    cfg.markSeen = params.value("markSeen", prefs.authOtpMail.markSeen);
    if (params.contains("password") && params["password"].is_string())
    {
        const auto pw = params["password"].get<std::string>();
        if (!pw.empty())
        {
            cfg.password = pw;
        }
    }
    if (cfg.host.empty() && enabled)
    {
        throw IpcException(Error{"invalid_params", "host is required when enabling", 0});
    }
    if (!cfg.host.empty() || !cfg.password.empty())
    {
        auto valid = ValidateImapEndpoint(cfg.host, cfg.port, cfg.tls);
        if (!isOk(valid))
        {
            throw IpcException(error(valid));
        }
        if (!cfg.password.empty())
        {
            Unwrap(OtpMailStore::Instance().Save(cfg));
        }
    }

    nlohmann::json patch{
        {"authOtpMail", {
            {"enabled", enabled},
            {"host", cfg.host},
            {"port", cfg.port},
            {"tls", cfg.tls},
            {"username", cfg.username},
            {"markSeen", cfg.markSeen},
            {"submitOnce", false},
        }},
    };
    if (params.contains("tosAcceptedAt") && params["tosAcceptedAt"].is_string())
    {
        patch["authOtpMail"]["tosAcceptedAt"] = params["tosAcceptedAt"];
    }
    prefs = Unwrap(GreyPrefsStore::Instance().MergePatch(patch));
    (void)AppendGreyAudit("otpMail", "otp.configured", nlohmann::json{
        {"enabled", enabled},
        {"host", cfg.host},
        {"port", cfg.port},
    });
    secureClearString(cfg.password);
    return nlohmann::json{{"passwordSaved", OtpMailStore::Instance().Exists()}};
}

nlohmann::json IpcBridge::HandleOtpMailClear(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    Unwrap(OtpMailStore::Instance().Clear());
    nlohmann::json patch{{"authOtpMail", {{"enabled", false}, {"username", ""}, {"host", ""}}}};
    (void)GreyPrefsStore::Instance().MergePatch(patch);
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleOtpMailTest(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    auto cfg = Unwrap(OtpMailStore::Instance().Load());
    auto tested = ImapClient::TestInbox(cfg);
    secureClearString(cfg.password);
    auto result = Unwrap(std::move(tested));
    return nlohmann::json{{"ok", result.ok}, {"inboxExists", result.inboxExists}};
}

nlohmann::json IpcBridge::HandleOtpMailStart(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    if (!prefs.authOtpMail.enabled)
    {
        throw IpcException(Error{"confirm_required", "Email OTP helper is off", 403});
    }
    auto& st = GS();
    st.otpSubmitOnce.store(params.value("submitOnce", false));
    bool expected = false;
    if (st.otpRunning.compare_exchange_strong(expected, true))
    {
        if (st.otpThread.joinable())
        {
            st.otpThread.join();
        }
        st.otpThread = std::thread(OtpLoop);
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleOtpMailStop(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    auto& st = GS();
    st.otpRunning.store(false);
    st.otpSubmitOnce.store(false);
    st.cv.notify_all();
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleOtpMailPoll(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    auto cfg = Unwrap(OtpMailStore::Instance().Load());
    auto fetched = ImapClient::FetchUnseenToday(cfg);
    secureClearString(cfg.password);
    if (!isOk(fetched))
    {
        throw IpcException(error(fetched));
    }
    const auto now = std::chrono::system_clock::now();
    for (const auto& mail : value(fetched))
    {
        auto parsed = ParseOtpMail(mail, now, cfg.fromAllow);
        if (parsed)
        {
            nlohmann::json out{{"found", true}, {"code", parsed->code}};
            secureClearString(parsed->code);
            return out;
        }
    }
    return nlohmann::json{{"found", false}};
}

nlohmann::json IpcBridge::HandleInviteAssistGet(const nlohmann::json&, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    return nlohmann::json{
        {"enabled", prefs.inviteAssist.enabled},
        {"confirmedAt", prefs.inviteAssist.confirmedAt
            ? nlohmann::json(*prefs.inviteAssist.confirmedAt)
            : nlohmann::json(nullptr)},
        {"cooldownSec", prefs.inviteAssist.cooldownSec},
        {"allowlist", AllowlistJson()},
        {"pending", GS().assist.pendingJson()},
    };
}

nlohmann::json IpcBridge::HandleInviteAssistSetEnabled(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    const bool enabled = params.value("enabled", false);
    if (enabled && !prefs.inviteAssist.confirmedAt)
    {
        throw IpcException(Error{"confirm_required", "Invite Assist requires first-run confirmation", 403});
    }
    prefs = Unwrap(GreyPrefsStore::Instance().MergePatch(nlohmann::json{
        {"inviteAssist", {{"enabled", enabled}}},
    }));
    if (!enabled)
    {
        GS().assist.cancelPending();
    }
    return nlohmann::json{
        {"enabled", prefs.inviteAssist.enabled},
        {"confirmedAt", prefs.inviteAssist.confirmedAt
            ? nlohmann::json(*prefs.inviteAssist.confirmedAt)
            : nlohmann::json(nullptr)},
    };
}

nlohmann::json IpcBridge::HandleInviteAssistConfirm(const nlohmann::json& params, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    if (!params.value("acknowledged", false))
    {
        throw IpcException(Error{"confirm_required", "acknowledged must be true", 403});
    }
    const auto now = nowIso();
    auto prefs = Unwrap(GreyPrefsStore::Instance().MergePatch(nlohmann::json{
        {"inviteAssist", {{"confirmedAt", now}, {"enabled", true}}},
    }));
    return nlohmann::json{{"confirmedAt", now}};
}

nlohmann::json IpcBridge::HandleInviteAssistAllowAdd(const nlohmann::json& params, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    const auto userId = JsonStringField(params, "userId").value_or("");
    if (userId.empty())
    {
        throw IpcException(Error{"invalid_params", "userId required", 0});
    }
    auto current = AllowlistJson();
    if (static_cast<int>(current.size()) >= kAllowlistCap)
    {
        throw IpcException(Error{"limit_exceeded", "InviteAssist allowlist cap is 64", 0});
    }
    Database::FavoriteInsert f;
    f.type = "user";
    f.target_id = userId;
    f.list_name = kAssistList;
    f.display_name = JsonStringField(params, "displayName");
    f.added_at = nowIso();
    Unwrap(Database::Instance().AddFavorite(f));
    return nlohmann::json{{"allowlist", AllowlistJson()}};
}

nlohmann::json IpcBridge::HandleInviteAssistAllowRemove(const nlohmann::json& params, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    const auto userId = JsonStringField(params, "userId").value_or("");
    if (userId.empty())
    {
        throw IpcException(Error{"invalid_params", "userId required", 0});
    }
    Unwrap(Database::Instance().RemoveFavorite("user", userId, kAssistList));
    return nlohmann::json{{"allowlist", AllowlistJson()}};
}

nlohmann::json IpcBridge::HandleInviteAssistCancelPending(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    GS().assist.cancelPending();
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleEventWatchList(const nlohmann::json&, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    auto rows = GS().watch.watches();
    if (rows.empty())
    {
        rows = prefs.eventWatch.watches;
    }
    nlohmann::json watches = nlohmann::json::array();
    for (const auto& w : rows)
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
        {"watches", watches},
        {"lastPollAt", nullptr},
        {"running", GS().watchRunning.load()},
    };
}

nlohmann::json IpcBridge::HandleEventWatchUpsert(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    nlohmann::json row = params.contains("watch") ? params["watch"] : params;
    GreyWatch w;
    w.id = row.value("id", "");
    w.enabled = row.value("enabled", false);
    w.label = row.value("label", "");
    w.worldId = row.value("worldId", "");
    w.groupId = row.value("groupId", "");
    w.region = row.value("region", "");
    w.access = row.value("access", "any");
    w.minUsers = row.value("minUsers", 0);
    w.maxUsers = row.value("maxUsers", 0);
    w.nameContains = row.value("nameContains", "");
    w.notify = row.value("notify", true);
    w.autoJoin = row.value("autoJoin", false);
    if (w.autoJoin && !prefs.eventWatch.autoJoinConfirmed)
    {
        throw IpcException(Error{"confirm_required", "auto-join requires a second confirmation", 403});
    }
    auto watches = Unwrap(GS().watch.upsert(std::move(w)));
    prefs.eventWatch.watches = watches;
    Unwrap(GreyPrefsStore::Instance().Save(prefs));
    StartWatchIfNeeded();
    return HandleEventWatchList(nlohmann::json::object(), std::nullopt);
}

nlohmann::json IpcBridge::HandleEventWatchRemove(const nlohmann::json& params, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    const auto id = JsonStringField(params, "id").value_or("");
    auto watches = Unwrap(GS().watch.remove(id));
    auto prefs = Unwrap(GreyPrefsStore::Instance().Load());
    prefs.eventWatch.watches = watches;
    Unwrap(GreyPrefsStore::Instance().Save(prefs));
    if (!GS().watch.anyEnabled())
    {
        StopWatch();
    }
    return HandleEventWatchList(nlohmann::json::object(), std::nullopt);
}

nlohmann::json IpcBridge::HandleEventWatchStart(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    StartWatchIfNeeded();
    auto& st = GS();
    if (!st.watchRunning.load())
    {
        bool expected = false;
        if (st.watchRunning.compare_exchange_strong(expected, true))
        {
            if (st.watchThread.joinable())
            {
                st.watchThread.join();
            }
            st.watchThread = std::thread(WatchLoop);
        }
    }
    return nlohmann::json{{"running", true}};
}

nlohmann::json IpcBridge::HandleEventWatchStop(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    StopWatch();
    return nlohmann::json{{"running", false}};
}

nlohmann::json IpcBridge::HandleEventWatchPollNow(const nlohmann::json&, const std::optional<std::string>&)
{
    auto prefs = Unwrap(RequireGrey());
    auto instances = CollectWatchInstances(prefs);
    auto matched = GS().watch.matchAll(instances);
    nlohmann::json matches = nlohmann::json::array();
    for (const auto& m : matched)
    {
        matches.push_back({
            {"watchId", m.watchId},
            {"location", m.location},
            {"worldName", m.worldName},
            {"nUsers", m.nUsers},
            {"autoJoin", m.autoJoin},
        });
    }
    ApplyWatchMatches(prefs);
    return nlohmann::json{{"matches", matches}};
}

nlohmann::json IpcBridge::HandleEventWatchCancelJoin(const nlohmann::json&, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    GS().watch.cancelJoin();
    (void)AppendGreyAudit("eventWatch", "watch.cancel", nlohmann::json::object());
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleEventWatchJoinNow(const nlohmann::json& params, const std::optional<std::string>&)
{
    Unwrap(RequireGrey());
    const auto location = JsonStringField(params, "location").value_or("");
    JoinLocation(location);
    (void)AppendGreyAudit("eventWatch", "watch.join", nlohmann::json{{"location", location}, {"manual", true}});
    return nlohmann::json{{"ok", true}};
}
