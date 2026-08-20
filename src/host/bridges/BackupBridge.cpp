#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AppBackup.h"
#include "../../core/CacheIndex.h"
#include "../../core/Database.h"

// App-data backup of %LocalAppData%/VRCSM (db + settings). Registration
// lives in IpcBridge::RegisterHandlers / AsyncMethodSet; see HOOKS.

namespace
{

nlohmann::json EntryJson(const vrcsm::core::AppBackupEntry& e)
{
    return nlohmann::json{
        {"id", e.id},
        {"createdAt", e.createdAt},
        {"bytes", e.bytes},
        {"files", e.files},
    };
}

vrcsm::core::AppBackup MakeBackup()
{
    return vrcsm::core::AppBackup(vrcsm::core::getAppDataRoot());
}

} // namespace

nlohmann::json IpcBridge::HandleBackupCreate(const nlohmann::json& params,
                                             const std::optional<std::string>&)
{
    const int keep = ParamInt(params, "keep", vrcsm::core::AppBackup::kDefaultKeep);
    auto result = MakeBackup().Create(keep);
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(vrcsm::core::error(result));
    }
    const auto& value = vrcsm::core::value(result);
    auto json = EntryJson(value.entry);
    json["pruned"] = value.pruned;
    json["ok"] = true;
    return json;
}

nlohmann::json IpcBridge::HandleBackupList(const nlohmann::json&,
                                           const std::optional<std::string>&)
{
    auto listed = MakeBackup().List();
    if (!vrcsm::core::isOk(listed))
    {
        throw IpcException(vrcsm::core::error(listed));
    }
    nlohmann::json backups = nlohmann::json::array();
    for (const auto& e : vrcsm::core::value(listed))
    {
        backups.push_back(EntryJson(e));
    }
    return nlohmann::json{{"backups", std::move(backups)}};
}

nlohmann::json IpcBridge::HandleBackupRestore(const nlohmann::json& params,
                                              const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "id");
    if (!id.has_value() || id->empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "backup.restore requires 'id'", 0});
    }

    // Cheap ProcessGuard-style refuse: do not clobber app data while the
    // background cache index is still walking. Dest-lock is checked in core
    // after we drop our own SQLite handle.
    if (vrcsm::core::CacheIndex::Instance().IsScanning())
    {
        throw IpcException(vrcsm::core::Error{
            "mid_scan",
            "Restore refused while a cache index scan is running",
            0});
    }

    auto& db = vrcsm::core::Database::Instance();
    const bool wasOpen = db.IsOpen();
    const auto dbPath = vrcsm::core::Database::DefaultDbPath();
    if (wasOpen)
    {
        db.Close();
    }

    auto restored = MakeBackup().Restore(*id, {false});

    if (wasOpen)
    {
        const auto reopened = db.Open(dbPath);
        if (!vrcsm::core::isOk(reopened) && vrcsm::core::isOk(restored))
        {
            throw IpcException(vrcsm::core::error(reopened));
        }
    }

    if (!vrcsm::core::isOk(restored))
    {
        throw IpcException(vrcsm::core::error(restored));
    }

    auto json = EntryJson(vrcsm::core::value(restored));
    json["ok"] = true;
    return json;
}
