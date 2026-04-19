#pragma once

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace vrcsm::core::updater
{

class UpdateState
{
public:
    static UpdateState& Instance();

    void Load();
    void Save() const;

    bool IsSkipped(const std::string& version) const;
    void Skip(const std::string& version);
    void Unskip(const std::string& version);
    std::vector<std::string> SkippedVersions() const;

    bool AutoCheck() const;
    void SetAutoCheck(bool value);

    int CheckIntervalHours() const;
    void SetCheckIntervalHours(int value);

    std::optional<std::string> LastChecked() const;
    void MarkChecked();

private:
    UpdateState() = default;

    static std::filesystem::path StateFilePath();

    mutable std::mutex m_mutex;
    bool m_loaded{false};
    std::vector<std::string> m_skippedVersions;
    std::optional<std::string> m_lastChecked;
    bool m_autoCheck{true};
    int m_checkIntervalHours{24};
};

} // namespace vrcsm::core::updater
