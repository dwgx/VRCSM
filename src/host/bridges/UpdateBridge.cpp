#include "../../pch.h"

#include "BridgeCommon.h"

#include "../../core/updater/UpdateApplier.h"
#include "../../core/updater/UpdateChecker.h"
#include "../../core/updater/UpdateDownloader.h"
#include "../../core/updater/UpdateState.h"

namespace
{

nlohmann::json MakeError(std::string_view code, std::string_view message)
{
    return nlohmann::json{
        {"error", {
            {"code", code},
            {"message", message}
        }}
    };
}

nlohmann::json MakeError(const vrcsm::core::Error& error)
{
    nlohmann::json errJson;
    to_json(errJson, error);
    return nlohmann::json{{"error", errJson}};
}

nlohmann::json StateSnapshot()
{
    auto& state = vrcsm::core::updater::UpdateState::Instance();
    const auto lastChecked = state.LastChecked();
    return nlohmann::json{
        {"autoCheck", state.AutoCheck()},
        {"checkIntervalHours", state.CheckIntervalHours()},
        {"skippedVersions", state.SkippedVersions()},
        {"lastChecked", lastChecked.has_value()
            ? nlohmann::json(*lastChecked)
            : nlohmann::json(nullptr)}
    };
}

std::filesystem::path UpdateTargetPathForVersion(const std::string& version)
{
    return vrcsm::core::getAppDataRoot() / L"updates" / vrcsm::core::toWide(fmt::format("VRCSM-{}.msi", version));
}

std::optional<std::uint64_t> ExistingFileSize(const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec))
    {
        return std::nullopt;
    }

    const auto size = std::filesystem::file_size(path, ec);
    if (ec)
    {
        return std::nullopt;
    }
    return size;
}

} // namespace

nlohmann::json IpcBridge::HandleUpdateCheck(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const bool forceRefresh = params.value("force", false);
        auto result = vrcsm::core::updater::UpdateChecker::CheckLatest(forceRefresh);

        auto& state = vrcsm::core::updater::UpdateState::Instance();
        state.MarkChecked();
        state.Save();

        if (!vrcsm::core::isOk(result))
        {
            return MakeError(vrcsm::core::error(result));
        }

        const auto& info = vrcsm::core::value(result);
        nlohmann::json out{
            {"available", info.available},
            {"currentVersion", info.currentVersion},
            {"latestVersion", info.latestVersion},
            {"downloadUrl", info.downloadUrl.has_value() ? nlohmann::json(*info.downloadUrl) : nlohmann::json(nullptr)},
            {"downloadSize", info.downloadSize.has_value() ? nlohmann::json(*info.downloadSize) : nlohmann::json(nullptr)},
            {"sha256", info.sha256.has_value() ? nlohmann::json(*info.sha256) : nlohmann::json(nullptr)},
            {"releaseNotesMarkdown", info.releaseNotesMarkdown},
            {"releaseUrl", info.releaseUrl},
            {"skipped", state.IsSkipped(info.latestVersion)}
        };

        const auto existingMsi = UpdateTargetPathForVersion(info.latestVersion);
        std::error_code ec;
        if (std::filesystem::is_regular_file(existingMsi, ec))
        {
            out["currentMsiPath"] = vrcsm::core::toUtf8(existingMsi.wstring());
        }
        else
        {
            out["currentMsiPath"] = nullptr;
        }

        return out;
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_check_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_check_failed", "Unknown update check failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateDownload(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto url = JsonStringField(params, "url");
        const auto version = JsonStringField(params, "version");
        if (!url.has_value() || !version.has_value())
        {
            return MakeError("update_invalid", "update.download requires url and version");
        }
        if (!params.contains("size") || !params["size"].is_number_integer())
        {
            return MakeError("update_invalid", "update.download requires numeric size");
        }

        const auto sizeValue = params["size"].get<std::int64_t>();
        if (sizeValue <= 0)
        {
            return MakeError("update_invalid", "update.download size must be positive");
        }

        const std::uint64_t expectedSize = static_cast<std::uint64_t>(sizeValue);
        const auto expectedSha256 = JsonStringField(params, "sha256");
        const std::filesystem::path targetPath = UpdateTargetPathForVersion(*version);
        const auto existingSize = ExistingFileSize(targetPath);
        const bool verifyOnly = expectedSha256.has_value()
            && existingSize.has_value()
            && *existingSize == expectedSize;

        bool sawDownloadComplete = verifyOnly;
        bool verifyPhase = verifyOnly;
        if (verifyOnly)
        {
            PostEventToUi("update.progress", nlohmann::json{
                {"phase", "verify"},
                {"done", 0},
                {"total", expectedSize},
                {"version", *version}
            });
        }

        vrcsm::core::updater::DownloadOptions options;
        options.url = *url;
        options.expectedSize = expectedSize;
        options.expectedSha256 = expectedSha256;
        options.targetFileName = fmt::format("VRCSM-{}.msi", *version);
        options.onProgress = [this, version = *version, &sawDownloadComplete, &verifyPhase](
            std::uint64_t done,
            std::uint64_t total)
        {
            if (!verifyPhase && sawDownloadComplete)
            {
                verifyPhase = true;
            }

            PostEventToUi("update.progress", nlohmann::json{
                {"phase", verifyPhase ? "verify" : "download"},
                {"done", done},
                {"total", total},
                {"version", version}
            });

            if (!verifyPhase && total > 0 && done >= total)
            {
                sawDownloadComplete = true;
            }
        };

        auto result = vrcsm::core::updater::UpdateDownloader::Download(options);
        if (!vrcsm::core::isOk(result))
        {
            return MakeError(vrcsm::core::error(result));
        }

        const auto& path = vrcsm::core::value(result);
        PostEventToUi("update.progress", nlohmann::json{
            {"phase", "done"},
            {"done", expectedSize},
            {"total", expectedSize},
            {"version", *version},
            {"path", vrcsm::core::toUtf8(path.wstring())}
        });

        return nlohmann::json{
            {"path", vrcsm::core::toUtf8(path.wstring())}
        };
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_download_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_download_failed", "Unknown update download failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateInstall(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto path = JsonStringField(params, "path");
        if (!path.has_value())
        {
            return MakeError("update_invalid", "update.install requires path");
        }

        auto result = vrcsm::core::updater::UpdateApplier::Apply(vrcsm::core::utf8Path(*path));
        if (!vrcsm::core::isOk(result))
        {
            return MakeError(vrcsm::core::error(result));
        }

        m_host.QuitForUpdate();
        return nlohmann::json{{"ok", true}};
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_install_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_install_failed", "Unknown update install failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateSkipVersion(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto version = JsonStringField(params, "version");
        if (!version.has_value() || version->empty())
        {
            return MakeError("update_invalid", "update.skipVersion requires version");
        }

        auto& state = vrcsm::core::updater::UpdateState::Instance();
        state.Skip(*version);
        state.Save();
        return StateSnapshot();
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_state_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_state_failed", "Unknown update state failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateUnskipVersion(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto version = JsonStringField(params, "version");
        if (!version.has_value() || version->empty())
        {
            return MakeError("update_invalid", "update.unskipVersion requires version");
        }

        auto& state = vrcsm::core::updater::UpdateState::Instance();
        state.Unskip(*version);
        state.Save();
        return StateSnapshot();
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_state_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_state_failed", "Unknown update state failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateGetState(const nlohmann::json&, const std::optional<std::string>&)
{
    try
    {
        return StateSnapshot();
    }
    catch (const std::exception& ex)
    {
        return MakeError("update_state_failed", ex.what());
    }
    catch (...)
    {
        return MakeError("update_state_failed", "Unknown update state failure");
    }
}
