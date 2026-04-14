#include "../pch.h"

#include "IpcBridge.h"

#include "StringUtil.h"
#include "WebViewHost.h"

#include "../core/BundleSniff.h"
#include "../core/CacheScanner.h"
#include "../core/JunctionUtil.h"
#include "../core/Migrator.h"
#include "../core/PathProbe.h"
#include "../core/ProcessGuard.h"
#include "../core/SafeDelete.h"

namespace
{
template <typename T>
nlohmann::json ToJson(const T& value)
{
    return nlohmann::json(value);
}

std::optional<std::string> ExtractId(const nlohmann::json& envelope)
{
    if (!envelope.contains("id") || envelope["id"].is_null())
    {
        return std::nullopt;
    }

    return envelope.at("id").get<std::string>();
}
}

IpcBridge::IpcBridge(WebViewHost& host)
    : m_host(host)
{
    RegisterHandlers();
}

void IpcBridge::Dispatch(const std::string& jsonText)
{
    std::optional<std::string> id;

    try
    {
        const nlohmann::json envelope = nlohmann::json::parse(jsonText);
        id = ExtractId(envelope);

        const std::string method = envelope.at("method").get<std::string>();
        const nlohmann::json params = envelope.value("params", nlohmann::json::object());

        const auto it = m_handlers.find(method);
        if (it == m_handlers.end())
        {
            PostError(id, "method_not_found", fmt::format("Unknown IPC method: {}", method));
            return;
        }

        try
        {
            PostResult(id, it->second(params, id));
        }
        catch (const std::exception& ex)
        {
            PostError(id, "handler_error", ex.what());
        }
        catch (...)
        {
            PostError(id, "handler_error", "Unknown handler failure");
        }
    }
    catch (const std::exception& ex)
    {
        PostError(id, "invalid_request", ex.what());
    }
    catch (...)
    {
        PostError(id, "invalid_request", "Unknown dispatch failure");
    }
}

void IpcBridge::RegisterHandlers()
{
    m_handlers.emplace("app.version", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAppVersion(params, id);
    });
    m_handlers.emplace("path.probe", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandlePathProbe(params, id);
    });
    m_handlers.emplace("scan", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleScan(params, id);
    });
    m_handlers.emplace("bundle.preview", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleBundlePreview(params, id);
    });
    m_handlers.emplace("delete.dryRun", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleDeleteDryRun(params, id);
    });
    m_handlers.emplace("delete.execute", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleDeleteExecute(params, id);
    });
    m_handlers.emplace("process.vrcRunning", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleProcessVrcRunning(params, id);
    });
    m_handlers.emplace("migrate.preflight", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleMigratePreflight(params, id);
    });
    m_handlers.emplace("migrate.execute", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleMigrateExecute(params, id);
    });
    m_handlers.emplace("junction.repair", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleJunctionRepair(params, id);
    });
}

nlohmann::json IpcBridge::HandleAppVersion(const nlohmann::json&, const std::optional<std::string>&)
{
    return nlohmann::json{
        {"version", "0.1.0"},
        {"build", std::string(__DATE__) + " " + std::string(__TIME__)}
    };
}

nlohmann::json IpcBridge::HandlePathProbe(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::PathProbe::Probe());
}

nlohmann::json IpcBridge::HandleScan(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto probe = vrcsm::core::PathProbe::Probe();
    return ToJson(vrcsm::core::CacheScanner::buildReport(probe.baseDir));
}

nlohmann::json IpcBridge::HandleBundlePreview(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto entryPath = Utf8ToWide(params.at("entry").get<std::string>());
    const std::filesystem::path base(entryPath);
    const std::filesystem::path infoPath = base / L"__info";
    const std::filesystem::path dataPath = base / L"__data";

    std::ifstream infoStream(infoPath, std::ios::binary);
    if (!infoStream)
    {
        throw std::runtime_error("Failed to open __info");
    }

    std::string infoText((std::istreambuf_iterator<char>(infoStream)), std::istreambuf_iterator<char>());
    auto sniff = vrcsm::core::BundleSniff::sniff(dataPath);
    nlohmann::json result = ToJson(sniff);
    result["infoText"] = infoText;
    return result;
}

nlohmann::json IpcBridge::HandleDeleteDryRun(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::SafeDelete::ResolveTargets(params));
}

nlohmann::json IpcBridge::HandleDeleteExecute(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::SafeDelete::Execute(params));
}

nlohmann::json IpcBridge::HandleProcessVrcRunning(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::ProcessGuard::IsVRChatRunning());
}

nlohmann::json IpcBridge::HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::Migrator::Preflight(params));
}

nlohmann::json IpcBridge::HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>& id)
{
    const auto request = params;
    const auto requestId = id;

    std::thread([this, request, requestId]()
    {
        try
        {
            auto progress = [this](const auto& update)
            {
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "migrate.progress"},
                    {"data", ToJson(update)}
                }.dump());
            };

            const auto result = vrcsm::core::Migrator::Execute(request, progress);
            m_host.PostMessageToWeb(nlohmann::json{
                {"event", "migrate.done"},
                {"data", ToJson(result)}
            }.dump());
            PostResult(requestId, ToJson(result));
        }
        catch (const std::exception& ex)
        {
            PostError(requestId, "migrate_failed", ex.what());
        }
        catch (...)
        {
            PostError(requestId, "migrate_failed", "Unknown migration failure");
        }
    }).detach();

    return nlohmann::json{{"started", true}};
}

nlohmann::json IpcBridge::HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::JunctionUtil::Repair(params));
}

void IpcBridge::PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const
{
    nlohmann::json response{
        {"result", result}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump());
}

void IpcBridge::PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const
{
    nlohmann::json response{
        {"error", {
            {"code", code},
            {"message", message}
        }}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump());
}
