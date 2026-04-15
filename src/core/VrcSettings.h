#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

#include "Common.h"

namespace vrcsm::core
{

enum class VrcSettingType
{
    Int,
    Float,
    String,
    Bool,
    Raw
};

struct VrcSettingValue
{
    VrcSettingType type = VrcSettingType::Raw;
    std::optional<int64_t> asInt;
    std::optional<double> asFloat;
    std::optional<std::string> asString;
    std::optional<bool> asBool;
    std::vector<uint8_t> raw;
};

struct VrcSettingEntry
{
    std::string key;
    std::string encodedKey;
    VrcSettingValue value;
    std::string group;
    std::string description;
};

class VrcSettings
{
public:
    static Result<std::vector<VrcSettingEntry>> ReadAll();
    static Result<VrcSettingEntry> ReadOne(std::string_view encodedKey);
    static Result<std::monostate> WriteOne(std::string_view encodedKey, const VrcSettingValue& value);
    static Result<std::filesystem::path> ExportReg(const std::filesystem::path& outPath);

    static nlohmann::json ReadAllJson(const nlohmann::json& params);
    static nlohmann::json WriteOneJson(const nlohmann::json& params);
    static nlohmann::json ExportRegJson(const nlohmann::json& params);
};

} // namespace vrcsm::core
