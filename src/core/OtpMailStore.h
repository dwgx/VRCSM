#pragma once

#include "Common.h"

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace vrcsm::core
{

struct ImapOtpConfig
{
    std::string host;
    int port{993};
    std::string tls{"imaps"};
    std::string username;
    std::string password;
    std::vector<std::string> fromAllow{"noreply@vrchat.com", "@vrchat.com"};
    bool markSeen{false};
};

class OtpMailStore
{
public:
    static OtpMailStore& Instance();

    std::filesystem::path Path() const;
    void SetPathForTests(std::filesystem::path path);

    Result<ImapOtpConfig> Load();
    Result<std::monostate> Save(const ImapOtpConfig& cfg);
    Result<std::monostate> Clear();
    bool Exists() const;

    static Result<std::monostate> ValidatePublic(const ImapOtpConfig& cfg);

private:
    OtpMailStore() = default;

    mutable std::mutex m_mutex;
    std::optional<std::filesystem::path> m_overridePath;
};

} // namespace vrcsm::core
