#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <variant>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct Error
{
    std::string code;
    std::string message;
};

inline void to_json(nlohmann::json& j, const Error& e)
{
    j = nlohmann::json{{"code", e.code}, {"message", e.message}};
}

template <typename T>
using Result = std::variant<T, Error>;

template <typename T>
bool isOk(const Result<T>& r)
{
    return std::holds_alternative<T>(r);
}

template <typename T>
const T& value(const Result<T>& r)
{
    return std::get<T>(r);
}

template <typename T>
const Error& error(const Result<T>& r)
{
    return std::get<Error>(r);
}

std::string formatBytesHuman(std::uint64_t bytes);

std::string nowIso();

std::string isoTimestamp(std::filesystem::file_time_type t);

std::optional<std::filesystem::file_time_type> safeLastWriteTime(const std::filesystem::path& p) noexcept;

std::string toUtf8(std::wstring_view wide);

std::wstring toWide(std::string_view utf8);

std::filesystem::path utf8Path(std::string_view utf8);

bool ensureWithinBase(const std::filesystem::path& base, const std::filesystem::path& candidate);

} // namespace vrcsm::core
