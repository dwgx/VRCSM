#include "../pch.h"

#include "VrchatPaths.h"

#include <KnownFolders.h>
#include <ShlObj.h>

#include <cwchar>

#include <wil/resource.h>

namespace
{

std::optional<std::filesystem::path> KnownFolderPath(REFKNOWNFOLDERID id)
{
    wil::unique_cotaskmem_string raw;
    if (FAILED(SHGetKnownFolderPath(id, 0, nullptr, raw.put())) || raw == nullptr)
    {
        return std::nullopt;
    }
    return std::filesystem::path(raw.get());
}

std::optional<std::filesystem::path> EnvironmentPath(const wchar_t* key)
{
    const DWORD required = GetEnvironmentVariableW(key, nullptr, 0);
    if (required <= 1)
    {
        return std::nullopt;
    }

    std::wstring buffer(static_cast<std::size_t>(required), L'\0');
    const DWORD written = GetEnvironmentVariableW(key, buffer.data(), required);
    if (written == 0 || written >= required)
    {
        return std::nullopt;
    }

    buffer.resize(static_cast<std::size_t>(written));
    return std::filesystem::path(buffer);
}

bool ContainsPath(const std::vector<std::filesystem::path>& paths, const std::filesystem::path& candidate)
{
    const auto normalized = candidate.lexically_normal().wstring();
    for (const auto& existing : paths)
    {
        if (_wcsicmp(existing.lexically_normal().wstring().c_str(), normalized.c_str()) == 0)
        {
            return true;
        }
    }
    return false;
}

bool IsScreenshotFile(const std::filesystem::path& path)
{
    const auto ext = path.extension().wstring();
    return _wcsicmp(ext.c_str(), L".png") == 0
        || _wcsicmp(ext.c_str(), L".jpg") == 0
        || _wcsicmp(ext.c_str(), L".jpeg") == 0;
}

void AddCandidate(std::vector<std::filesystem::path>& out, const std::optional<std::filesystem::path>& base)
{
    if (!base.has_value() || base->empty())
    {
        return;
    }

    const auto candidate = base->lexically_normal() / L"VRChat";
    if (!ContainsPath(out, candidate))
    {
        out.push_back(candidate);
    }
}

struct ScreenshotRootScore
{
    std::uint64_t imageCount = 0;
    std::filesystem::file_time_type latestImageTime{};
    bool hasImageTime = false;
};

ScreenshotRootScore ScoreScreenshotRoot(const std::filesystem::path& root)
{
    ScreenshotRootScore score;

    std::error_code ec;
    if (!std::filesystem::exists(root, ec) || ec)
    {
        return score;
    }

    std::filesystem::recursive_directory_iterator it(
        root,
        std::filesystem::directory_options::skip_permission_denied,
        ec);
    if (ec)
    {
        return score;
    }

    for (const auto end = std::filesystem::recursive_directory_iterator{}; it != end; it.increment(ec))
    {
        if (ec)
        {
            break;
        }

        std::error_code fileEc;
        if (!it->is_regular_file(fileEc) || fileEc || !IsScreenshotFile(it->path()))
        {
            continue;
        }

        ++score.imageCount;

        const auto mtime = it->last_write_time(fileEc);
        if (fileEc)
        {
            continue;
        }
        if (!score.hasImageTime || mtime > score.latestImageTime)
        {
            score.latestImageTime = mtime;
            score.hasImageTime = true;
        }
    }

    return score;
}

} // namespace

std::vector<std::filesystem::path> EnumerateVrchatScreenshotRoots()
{
    std::vector<std::filesystem::path> candidates;
    candidates.reserve(8);

    AddCandidate(candidates, KnownFolderPath(FOLDERID_Pictures));

#ifdef FOLDERID_SkyDrivePictures
    AddCandidate(candidates, KnownFolderPath(FOLDERID_SkyDrivePictures));
#endif

    for (const auto* key : {L"OneDrive", L"OneDriveConsumer", L"OneDriveCommercial"})
    {
        if (auto oneDrive = EnvironmentPath(key))
        {
            AddCandidate(candidates, *oneDrive / L"Pictures");
        }
    }

    if (auto userProfile = EnvironmentPath(L"USERPROFILE"))
    {
        AddCandidate(candidates, *userProfile / L"OneDrive" / L"Pictures");
        AddCandidate(candidates, *userProfile / L"Pictures");
    }

    return candidates;
}

std::filesystem::path DetectPrimaryVrchatScreenshotRoot()
{
    const auto candidates = EnumerateVrchatScreenshotRoots();
    std::error_code ec;
    std::filesystem::path firstExisting;
    std::filesystem::path bestCandidate;
    ScreenshotRootScore bestScore;
    bool haveBest = false;

    for (const auto& candidate : candidates)
    {
        if (std::filesystem::exists(candidate, ec) && !ec)
        {
            if (firstExisting.empty())
            {
                firstExisting = candidate;
            }

            const auto score = ScoreScreenshotRoot(candidate);
            if (score.imageCount == 0)
            {
                continue;
            }

            if (!haveBest
                || score.latestImageTime > bestScore.latestImageTime
                || (score.latestImageTime == bestScore.latestImageTime
                    && score.imageCount > bestScore.imageCount))
            {
                bestCandidate = candidate;
                bestScore = score;
                haveBest = true;
            }
        }
        ec.clear();
    }

    if (haveBest)
    {
        return bestCandidate;
    }

    if (!firstExisting.empty())
    {
        return firstExisting;
    }

    if (!candidates.empty())
    {
        return candidates.front();
    }

    return {};
}
