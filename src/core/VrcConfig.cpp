#include "VrcConfig.h"

#include "Common.h"
#include "PathProbe.h"
#include "ProcessGuard.h"

#include <fstream>
#include <spdlog/spdlog.h>
#include <sstream>
#include <system_error>

namespace vrcsm::core
{

Result<nlohmann::json> VrcConfig::Read(const std::filesystem::path& configPath)
{
    std::error_code ec;
    auto read_from = [](const std::filesystem::path& p) -> std::optional<std::string> {
        std::ifstream in(p, std::ios::binary);
        if (!in) return std::nullopt;
        std::stringstream buffer;
        buffer << in.rdbuf();
        return buffer.str();
    };

    if (!std::filesystem::exists(configPath, ec) || ec)
    {
        auto backupPath = configPath;
        backupPath += L".bak";
        if (std::filesystem::exists(backupPath, ec) && !ec) {
            auto bContent = read_from(backupPath);
            if (bContent && !bContent->empty()) {
                try { return nlohmann::json::parse(*bContent); }
                catch (const std::exception& ex)
                {
                    spdlog::debug("VrcConfig: failed to parse backup config '{}': {}", backupPath.string(), ex.what());
                }
            }
        }
        return Error{"not_found", "Config file not found"};
    }

    auto content = read_from(configPath);
    if (!content)
    {
        return Error{"open_failed", "Cannot open config file for reading"};
    }

    if (content->empty())
    {
        return nlohmann::json::object();
    }

    try
    {
        return nlohmann::json::parse(*content);
    }
    catch (const std::exception& ex)
    {
        auto backupPath = configPath;
        backupPath += L".bak";
        auto bContent = read_from(backupPath);
        if (bContent && !bContent->empty()) {
            try { return nlohmann::json::parse(*bContent); }
            catch (const std::exception& backupEx)
            {
                spdlog::debug("VrcConfig: failed to parse backup config '{}': {}", backupPath.string(), backupEx.what());
            }
        }
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

    auto tmpFile = configPath;
    tmpFile += L".tmp";

    std::ofstream out(tmpFile, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        return Error{"open_failed", "Cannot open temporary config file for writing"};
    }

    const std::string serialized = config.dump(2);
    out.write(serialized.data(), static_cast<std::streamsize>(serialized.size()));
    out.flush();
    if (!out)
    {
        out.close();
        std::filesystem::remove(tmpFile, ec);
        return Error{"write_failed", "Stream write failed"};
    }
    out.close();

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

    std::filesystem::rename(tmpFile, configPath, ec);
    if (ec)
    {
        std::filesystem::remove(tmpFile, ec);
        return Error{"rename_failed", ec.message()};
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

    const auto status = ProcessGuard::IsVRChatRunning();
    if (status.running)
    {
        return nlohmann::json{
            {"error", {
                {"code", "vrc_running"},
                {"message", "VRChat is running — close it before writing configuration."}
            }}
        };
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
