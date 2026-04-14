#include "VrcConfig.h"

#include "Common.h"
#include "PathProbe.h"

#include <fstream>
#include <sstream>
#include <system_error>

namespace vrcsm::core
{

Result<nlohmann::json> VrcConfig::Read(const std::filesystem::path& configPath)
{
    std::error_code ec;
    if (!std::filesystem::exists(configPath, ec) || ec)
    {
        return Error{"not_found", "Config file not found"};
    }

    std::ifstream in(configPath, std::ios::binary);
    if (!in)
    {
        return Error{"open_failed", "Cannot open config file for reading"};
    }

    std::stringstream buffer;
    buffer << in.rdbuf();
    const std::string text = buffer.str();

    if (text.empty())
    {
        return nlohmann::json::object();
    }

    try
    {
        return nlohmann::json::parse(text);
    }
    catch (const std::exception& ex)
    {
        return Error{"parse_failed", ex.what()};
    }
}

Result<std::monostate> VrcConfig::Write(
    const std::filesystem::path& configPath,
    const nlohmann::json& config)
{
    std::error_code ec;

    auto parent = configPath.parent_path();
    if (!parent.empty())
    {
        std::filesystem::create_directories(parent, ec);
        if (ec) return Error{"mkdir_failed", ec.message()};
    }

    if (std::filesystem::exists(configPath, ec) && !ec)
    {
        auto backup = configPath;
        backup += L".bak";
        std::filesystem::copy_file(
            configPath,
            backup,
            std::filesystem::copy_options::overwrite_existing,
            ec);
        if (ec) return Error{"backup_failed", ec.message()};
    }

    std::ofstream out(configPath, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        return Error{"open_failed", "Cannot open config file for writing"};
    }

    const std::string serialized = config.dump(2);
    out.write(serialized.data(), static_cast<std::streamsize>(serialized.size()));
    if (!out)
    {
        return Error{"write_failed", "Stream write failed"};
    }

    return std::monostate{};
}

nlohmann::json VrcConfig::ReadJson(const nlohmann::json& params)
{
    std::filesystem::path path;
    if (params.contains("path") && params["path"].is_string())
    {
        path = utf8Path(params["path"].get<std::string>());
    }
    else
    {
        const auto probe = PathProbe::Probe();
        if (!probe.configJson.has_value())
        {
            return nlohmann::json{{"error", {{"code", "not_found"}, {"message", "VRChat config.json path not detected"}}}};
        }
        path = *probe.configJson;
    }

    auto result = Read(path);
    if (isOk(result))
    {
        return value(result);
    }
    const auto& err = error(result);
    return nlohmann::json{{"error", {{"code", err.code}, {"message", err.message}}}};
}

nlohmann::json VrcConfig::WriteJson(const nlohmann::json& params)
{
    std::filesystem::path path;
    if (params.contains("path") && params["path"].is_string())
    {
        path = utf8Path(params["path"].get<std::string>());
    }
    else
    {
        const auto probe = PathProbe::Probe();
        if (!probe.configJson.has_value())
        {
            return nlohmann::json{{"error", {{"code", "not_found"}, {"message", "VRChat config.json path not detected"}}}};
        }
        path = *probe.configJson;
    }

    if (!params.contains("config"))
    {
        return nlohmann::json{{"error", {{"code", "missing_param"}, {"message", "config field required"}}}};
    }

    auto result = Write(path, params["config"]);
    if (isOk(result))
    {
        return nlohmann::json{{"ok", true}};
    }
    const auto& err = error(result);
    return nlohmann::json{{"error", {{"code", err.code}, {"message", err.message}}}};
}

} // namespace vrcsm::core
