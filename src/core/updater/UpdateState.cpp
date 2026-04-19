#include "../../pch.h"

#include "UpdateState.h"

#include "../Common.h"

#include <chrono>
#include <ctime>
#include <fstream>

namespace vrcsm::core::updater
{

namespace
{

std::string UtcNowIso()
{
    const auto now = std::chrono::system_clock::now();
    const auto time = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
    gmtime_s(&utc, &time);

    return fmt::format(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        utc.tm_year + 1900,
        utc.tm_mon + 1,
        utc.tm_mday,
        utc.tm_hour,
        utc.tm_min,
        utc.tm_sec);
}

bool WriteJsonAtomically(const std::filesystem::path& path, const nlohmann::json& json)
{
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);

    const std::filesystem::path tempPath = path.native() + L".tmp";
    {
        std::ofstream output(tempPath, std::ios::binary | std::ios::trunc);
        if (!output)
        {
            return false;
        }
        output << json.dump(2);
        output.flush();
        if (!output)
        {
            return false;
        }
    }

    std::filesystem::rename(tempPath, path, ec);
    if (ec)
    {
        std::filesystem::remove(path, ec);
        ec.clear();
        std::filesystem::rename(tempPath, path, ec);
    }
    return !ec;
}

void SortAndDedupe(std::vector<std::string>& values)
{
    std::sort(values.begin(), values.end());
    values.erase(std::unique(values.begin(), values.end()), values.end());
}

} // namespace

UpdateState& UpdateState::Instance()
{
    static UpdateState state;
    state.Load();
    return state;
}

std::filesystem::path UpdateState::StateFilePath()
{
    return getAppDataRoot() / L"updater-state.json";
}

void UpdateState::Load()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_loaded)
    {
        return;
    }
    m_loaded = true;

    std::ifstream input(StateFilePath(), std::ios::binary);
    if (!input)
    {
        return;
    }

    try
    {
        const nlohmann::json doc = nlohmann::json::parse(input, nullptr, false);
        if (!doc.is_object())
        {
            return;
        }

        if (const auto it = doc.find("skippedVersions"); it != doc.end() && it->is_array())
        {
            m_skippedVersions.clear();
            for (const auto& item : *it)
            {
                if (item.is_string())
                {
                    m_skippedVersions.push_back(item.get<std::string>());
                }
            }
            SortAndDedupe(m_skippedVersions);
        }

        if (const auto it = doc.find("lastChecked"); it != doc.end() && it->is_string())
        {
            m_lastChecked = it->get<std::string>();
        }

        if (const auto it = doc.find("autoCheck"); it != doc.end() && it->is_boolean())
        {
            m_autoCheck = it->get<bool>();
        }

        if (const auto it = doc.find("checkIntervalHours"); it != doc.end() && it->is_number_integer())
        {
            m_checkIntervalHours = std::max(1, it->get<int>());
        }
    }
    catch (...)
    {
    }
}

void UpdateState::Save() const
{
    std::lock_guard<std::mutex> lock(m_mutex);

    nlohmann::json doc;
    doc["skippedVersions"] = m_skippedVersions;
    doc["lastChecked"] = m_lastChecked.has_value() ? nlohmann::json(*m_lastChecked) : nlohmann::json(nullptr);
    doc["autoCheck"] = m_autoCheck;
    doc["checkIntervalHours"] = m_checkIntervalHours;

    (void)WriteJsonAtomically(StateFilePath(), doc);
}

bool UpdateState::IsSkipped(const std::string& version) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return std::find(m_skippedVersions.begin(), m_skippedVersions.end(), version) != m_skippedVersions.end();
}

void UpdateState::Skip(const std::string& version)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (version.empty())
    {
        return;
    }
    m_skippedVersions.push_back(version);
    SortAndDedupe(m_skippedVersions);
}

void UpdateState::Unskip(const std::string& version)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_skippedVersions.erase(
        std::remove(m_skippedVersions.begin(), m_skippedVersions.end(), version),
        m_skippedVersions.end());
}

std::vector<std::string> UpdateState::SkippedVersions() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_skippedVersions;
}

bool UpdateState::AutoCheck() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_autoCheck;
}

void UpdateState::SetAutoCheck(bool value)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_autoCheck = value;
}

int UpdateState::CheckIntervalHours() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_checkIntervalHours;
}

void UpdateState::SetCheckIntervalHours(int value)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_checkIntervalHours = std::max(1, value);
}

std::optional<std::string> UpdateState::LastChecked() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_lastChecked;
}

void UpdateState::MarkChecked()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_lastChecked = UtcNowIso();
}

} // namespace vrcsm::core::updater
