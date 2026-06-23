#include "AvatarData.h"

#include "Common.h"

#include <algorithm>
#include <fstream>
#include <regex>
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

void to_json(nlohmann::json& j, const LocalAvatarParameter& p)
{
    j = nlohmann::json{
        {"name", p.name},
        {"value_type", p.valueType},
        {"default_value", p.defaultValue},
    };
}

void to_json(nlohmann::json& j, const LocalAvatarParametersReport& r)
{
    j = nlohmann::json{
        {"avatar_id", r.avatar_id},
        {"user_id", r.user_id},
        {"path", r.path},
        {"parameters", r.parameters},
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

bool LooksLikeId(std::string_view id, std::string_view prefix)
{
    if (id.rfind(prefix, 0) != 0)
    {
        return false;
    }
    static const std::regex kAllowed(R"(^[A-Za-z0-9_-]+$)");
    return std::regex_match(std::string(id), kAllowed);
}

std::string ParamTypeFromJson(const nlohmann::json& value)
{
    if (value.is_boolean()) return "bool";
    if (value.is_number_float()) return "float";
    if (value.is_number_integer() || value.is_number_unsigned()) return "int";
    if (value.is_string()) return "string";
    return "float";
}

std::optional<LocalAvatarParameter> ParseParameter(const nlohmann::json& entry)
{
    if (!entry.is_object())
    {
        return std::nullopt;
    }

    const auto pickString = [&](std::initializer_list<const char*> keys) -> std::string
    {
        for (const auto* key : keys)
        {
            if (entry.contains(key) && entry[key].is_string())
            {
                return entry[key].get<std::string>();
            }
        }
        return {};
    };

    LocalAvatarParameter parameter;
    parameter.name = pickString({"name", "parameter", "parameterName", "id"});
    if (parameter.name.empty())
    {
        return std::nullopt;
    }

    parameter.valueType = pickString({"type", "valueType", "parameterType"});
    if (parameter.valueType.empty())
    {
        if (entry.contains("defaultValue"))
        {
            parameter.valueType = ParamTypeFromJson(entry["defaultValue"]);
        }
        else if (entry.contains("value"))
        {
            parameter.valueType = ParamTypeFromJson(entry["value"]);
        }
        else
        {
            parameter.valueType = "float";
        }
    }
    std::transform(parameter.valueType.begin(), parameter.valueType.end(), parameter.valueType.begin(),
                   [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    if (parameter.valueType != "bool" && parameter.valueType != "int" && parameter.valueType != "float" && parameter.valueType != "string")
    {
        parameter.valueType = "float";
    }

    if (entry.contains("defaultValue"))
    {
        parameter.defaultValue = entry["defaultValue"];
    }
    else if (entry.contains("value"))
    {
        parameter.defaultValue = entry["value"];
    }
    else if (parameter.valueType == "bool")
    {
        parameter.defaultValue = false;
    }
    else if (parameter.valueType == "string")
    {
        parameter.defaultValue = "";
    }
    else
    {
        parameter.defaultValue = 0;
    }

    return parameter;
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

Result<LocalAvatarParametersReport> AvatarData::readParameters(
    const std::filesystem::path& baseDir,
    std::string_view avatarId,
    std::string_view userId,
    std::size_t limit)
{
    try
    {
        if (!LooksLikeId(avatarId, "avtr_"))
        {
            return Error{"invalid_avatar_id", "avatar.parameters.local requires an avtr_* avatarId", 0};
        }
        if (!userId.empty() && !LooksLikeId(userId, "usr_"))
        {
            return Error{"invalid_user_id", "avatar.parameters.local userId must be empty or usr_*", 0};
        }

        const auto root = baseDir / L"LocalAvatarData";
        std::error_code ec;
        if (!std::filesystem::exists(root, ec) || ec)
        {
            return Error{"not_found", "LocalAvatarData directory not found", 0};
        }

        std::filesystem::path target;
        std::string targetUserId;
        const auto avatarFileName = std::string(avatarId);
        if (!userId.empty())
        {
            const auto candidate = root / std::filesystem::path(toWide(userId)) / std::filesystem::path(toWide(avatarId));
            if (std::filesystem::is_regular_file(candidate, ec) && !ec)
            {
                target = candidate;
                targetUserId = std::string(userId);
            }
        }
        else
        {
            for (const auto& userEntry : std::filesystem::directory_iterator(root, ec))
            {
                if (ec) break;
                if (!userEntry.is_directory()) continue;
                const auto usrName = userEntry.path().filename().string();
                if (usrName.rfind("usr_", 0) != 0) continue;

                const auto candidate = userEntry.path() / std::filesystem::path(toWide(avatarFileName));
                if (std::filesystem::is_regular_file(candidate, ec) && !ec)
                {
                    target = candidate;
                    targetUserId = usrName;
                    break;
                }
            }
        }

        if (target.empty())
        {
            return Error{"not_found", "Avatar parameter file not found in LocalAvatarData", 0};
        }
        if (!ensureWithinBase(root, target))
        {
            return Error{"path_escape", "Resolved avatar parameter path is outside LocalAvatarData", 0};
        }

        std::ifstream stream(target);
        if (!stream)
        {
            return Error{"read_failed", "Failed to open avatar parameter file", 0};
        }

        nlohmann::json data;
        stream >> data;

        LocalAvatarParametersReport report;
        report.avatar_id = std::string(avatarId);
        report.user_id = targetUserId;
        report.path = toUtf8(target.wstring());

        if (data.contains("animationParameters") && data["animationParameters"].is_array())
        {
            std::unordered_set<std::string> seen;
            for (const auto& entry : data["animationParameters"])
            {
                if (report.parameters.size() >= limit)
                {
                    break;
                }
                auto parameter = ParseParameter(entry);
                if (!parameter || !seen.insert(parameter->name).second)
                {
                    continue;
                }
                report.parameters.push_back(std::move(*parameter));
            }
        }

        return report;
    }
    catch (const std::exception& ex)
    {
        return Error{"avatar_parameters_failed", ex.what(), 0};
    }
    catch (...)
    {
        return Error{"avatar_parameters_failed", "Unknown avatar parameter read failure", 0};
    }
}

} // namespace vrcsm::core
