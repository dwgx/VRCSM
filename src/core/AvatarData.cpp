#include "AvatarData.h"

#include "Common.h"

#include <algorithm>
#include <fstream>
#include <system_error>
#include <unordered_set>

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const LocalAvatarItem& a)
{
    j = nlohmann::json{
        {"user_id", a.user_id},
        {"avatar_id", a.avatar_id},
        {"path", a.path},
        {"eye_height", a.eye_height ? nlohmann::json(*a.eye_height) : nlohmann::json(nullptr)},
        {"parameter_count", a.parameter_count},
        {"modified_at", a.modified_at ? nlohmann::json(*a.modified_at) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const LocalAvatarReport& r)
{
    j = nlohmann::json{
        {"item_count", r.item_count},
        {"recent_items", r.recent_items},
        {"parameter_count_histogram", r.parameter_count_histogram},
    };
}

namespace
{
std::string histBucket(std::size_t n)
{
    if (n < 16) return "0-15";
    if (n < 32) return "16-31";
    if (n < 64) return "32-63";
    if (n < 128) return "64-127";
    return "128+";
}

LocalAvatarItem parseAvatarFile(const std::filesystem::path& usrDir, const std::filesystem::path& avtrFile)
{
    LocalAvatarItem item;
    item.user_id = usrDir.filename().string();
    item.avatar_id = avtrFile.filename().string();
    item.path = toUtf8(avtrFile.wstring());

    if (auto t = safeLastWriteTime(avtrFile))
    {
        item.modified_at = isoTimestamp(*t);
    }

    std::ifstream stream(avtrFile);
    if (!stream) return item;

    try
    {
        nlohmann::json data;
        stream >> data;
        if (data.contains("eyeHeight") && data["eyeHeight"].is_number())
        {
            item.eye_height = data["eyeHeight"].get<double>();
        }
        if (data.contains("animationParameters") && data["animationParameters"].is_array())
        {
            item.parameter_count = data["animationParameters"].size();
        }
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("AvatarData: failed to parse {}: {}",
                      toUtf8(avtrFile.wstring()), ex.what());
    }

    return item;
}
} // namespace

LocalAvatarReport AvatarData::scan(const std::filesystem::path& baseDir)
{
    LocalAvatarReport report;
    const auto root = baseDir / L"LocalAvatarData";

    std::error_code ec;
    if (!std::filesystem::exists(root, ec) || ec) return report;

    std::vector<LocalAvatarItem> items;
    for (const auto& userEntry : std::filesystem::directory_iterator(root, ec))
    {
        if (ec) break;
        if (!userEntry.is_directory()) continue;
        const auto usrName = userEntry.path().filename().string();
        if (usrName.rfind("usr_", 0) != 0) continue;

        for (const auto& avtrEntry : std::filesystem::directory_iterator(userEntry.path(), ec))
        {
            if (ec) break;
            if (!avtrEntry.is_regular_file()) continue;
            const auto fname = avtrEntry.path().filename().string();
            if (fname.rfind("avtr_", 0) != 0) continue;

            items.push_back(parseAvatarFile(userEntry.path(), avtrEntry.path()));
        }
    }

    report.item_count = items.size();
    for (const auto& it : items)
    {
        report.parameter_count_histogram[histBucket(it.parameter_count)] += 1;
    }

    std::sort(items.begin(), items.end(), [](const LocalAvatarItem& a, const LocalAvatarItem& b) {
        return a.modified_at.value_or("") > b.modified_at.value_or("");
    });

    std::unordered_set<std::string> seen;
    std::erase_if(items, [&seen](const LocalAvatarItem& it) {
        return !seen.insert(it.avatar_id).second;
    });

    if (items.size() > 10000) items.resize(10000);
    report.recent_items = std::move(items);

    return report;
}

} // namespace vrcsm::core
