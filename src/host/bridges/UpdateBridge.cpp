#include "../../pch.h"

#include "BridgeCommon.h"

#include "../../core/updater/UpdateApplier.h"
#include "../../core/updater/UpdateChecker.h"
#include "../../core/updater/UpdateDownloader.h"
#include "../../core/updater/UpdatePackage.h"
#include "../../core/updater/UpdateState.h"

namespace
{

[[noreturn]] void ThrowUpdateError(std::string_view code, std::string_view message)
{
    throw IpcException(vrcsm::core::Error{
        std::string(code),
        std::string(message),
        0
    });
}

[[noreturn]] void ThrowUpdateError(const vrcsm::core::Error& error)
{
    throw IpcException(error);
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

std::string FileNameFromUrl(const std::string& url)
{
    const std::size_t query = url.find_first_of("?#");
    const std::string withoutQuery = query == std::string::npos ? url : url.substr(0, query);
    const std::size_t slash = withoutQuery.find_last_of('/');
    if (slash == std::string::npos)
    {
        return withoutQuery;
    }
    return withoutQuery.substr(slash + 1);
}

std::string UpdateFileNameForRequest(
    const nlohmann::json& params,
    const std::string& version,
    const std::optional<std::string>& url = std::nullopt)
{
    if (const auto fileName = JsonStringField(params, "fileName");
        fileName.has_value() && !fileName->empty())
    {
        return *fileName;
    }
    if (url.has_value())
    {
        const std::string derived = FileNameFromUrl(*url);
        if (!derived.empty() && vrcsm::core::updater::IsMsiFileName(derived))
        {
            return derived;
        }
    }
    return fmt::format("VRCSM-{}.msi", version);
}

std::filesystem::path UpdateTargetPathForFileName(const std::string& fileName)
{
    return vrcsm::core::updater::BuildUpdateTargetPath(fileName);
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
            ThrowUpdateError(vrcsm::core::error(result));
        }

        const auto& info = vrcsm::core::value(result);
        nlohmann::json out{
            {"available", info.available},
            {"current", info.currentVersion},
            {"currentVersion", info.currentVersion},
            {"latest", info.latestVersion},
            {"latestVersion", info.latestVersion},
            {"fileName", info.fileName.has_value() ? nlohmann::json(*info.fileName) : nlohmann::json(nullptr)},
            {"downloadUrl", info.downloadUrl.has_value() ? nlohmann::json(*info.downloadUrl) : nlohmann::json(nullptr)},
            {"size", info.downloadSize.has_value() ? nlohmann::json(*info.downloadSize) : nlohmann::json(nullptr)},
            {"downloadSize", info.downloadSize.has_value() ? nlohmann::json(*info.downloadSize) : nlohmann::json(nullptr)},
            {"sha256", info.sha256.has_value() ? nlohmann::json(*info.sha256) : nlohmann::json(nullptr)},
            {"releaseNotes", info.releaseNotesMarkdown},
            {"releaseNotesMarkdown", info.releaseNotesMarkdown},
            {"releaseUrl", info.releaseUrl},
            {"skipped", state.IsSkipped(info.latestVersion)}
        };

        const auto targetFileName = info.fileName.value_or(fmt::format("VRCSM-{}.msi", info.latestVersion));
        const auto existingMsi = UpdateTargetPathForFileName(targetFileName);
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
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_check_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_check_failed", "Unknown update check failure");
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
            ThrowUpdateError("update_invalid", "update.download requires url and version");
        }
        if (!params.contains("size") || !params["size"].is_number_integer())
        {
            ThrowUpdateError("update_invalid", "update.download requires numeric size");
        }

        const auto sizeValue = params["size"].get<std::int64_t>();
        if (sizeValue <= 0)
        {
            ThrowUpdateError("update_invalid", "update.download size must be positive");
        }

        const std::uint64_t expectedSize = static_cast<std::uint64_t>(sizeValue);
        const auto expectedSha256 = JsonStringField(params, "sha256");
        const std::string targetFileName = UpdateFileNameForRequest(params, *version, url);
        if (!vrcsm::core::updater::IsSafeMsiFileName(targetFileName))
        {
            ThrowUpdateError("update_invalid", "update.download fileName must be a single .msi file name");
        }
        const std::filesystem::path targetPath = UpdateTargetPathForFileName(targetFileName);
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
        options.targetFileName = targetFileName;
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
            ThrowUpdateError(vrcsm::core::error(result));
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
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_download_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_download_failed", "Unknown update download failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateInstall(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto path = JsonStringField(params, "path");
        if (!path.has_value())
        {
            ThrowUpdateError("update_invalid", "update.install requires path");
        }
        const auto version = JsonStringField(params, "version");
        if (!version.has_value() || version->empty())
        {
            ThrowUpdateError("update_invalid", "update.install requires version");
        }
        if (!params.contains("size") || !params["size"].is_number_integer())
        {
            ThrowUpdateError("update_invalid", "update.install requires numeric size");
        }
        const auto sizeValue = params["size"].get<std::int64_t>();
        if (sizeValue <= 0)
        {
            ThrowUpdateError("update_invalid", "update.install size must be positive");
        }

        vrcsm::core::updater::PackageValidationOptions validation;
        validation.version = *version;
        validation.expectedFileName = UpdateFileNameForRequest(params, *version);
        validation.expectedSize = static_cast<std::uint64_t>(sizeValue);
        validation.expectedSha256 = JsonStringField(params, "sha256");

        auto validationResult = vrcsm::core::updater::ValidateDownloadedPackage(
            vrcsm::core::utf8Path(*path),
            validation);
        if (!vrcsm::core::isOk(validationResult))
        {
            ThrowUpdateError(vrcsm::core::error(validationResult));
        }

        const auto installerPath = UpdateTargetPathForFileName(validation.expectedFileName);
        auto result = vrcsm::core::updater::UpdateApplier::Apply(installerPath);
        if (!vrcsm::core::isOk(result))
        {
            ThrowUpdateError(vrcsm::core::error(result));
        }

        m_host.QuitForUpdate();
        return nlohmann::json{{"ok", true}};
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_install_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_install_failed", "Unknown update install failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateSkipVersion(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto version = JsonStringField(params, "version");
        if (!version.has_value() || version->empty())
        {
            ThrowUpdateError("update_invalid", "update.skipVersion requires version");
        }

        auto& state = vrcsm::core::updater::UpdateState::Instance();
        state.Skip(*version);
        state.Save();
        return StateSnapshot();
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_state_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_state_failed", "Unknown update state failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateUnskipVersion(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto version = JsonStringField(params, "version");
        if (!version.has_value() || version->empty())
        {
            ThrowUpdateError("update_invalid", "update.unskipVersion requires version");
        }

        auto& state = vrcsm::core::updater::UpdateState::Instance();
        state.Unskip(*version);
        state.Save();
        return StateSnapshot();
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_state_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_state_failed", "Unknown update state failure");
    }
}

nlohmann::json IpcBridge::HandleUpdateGetState(const nlohmann::json&, const std::optional<std::string>&)
{
    try
    {
        return StateSnapshot();
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        ThrowUpdateError("update_state_failed", ex.what());
    }
    catch (...)
    {
        ThrowUpdateError("update_state_failed", "Unknown update state failure");
    }
}
