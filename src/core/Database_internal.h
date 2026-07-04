#pragma once

// Internal, non-public implementation detail shared across the split
// Database_*.cpp translation units. NOT included by any public header;
// see Database.h for the frozen public interface. Hosts the RAII
// StatementGuard, the small bind/column helpers, and the RunOnce
// member template so every domain TU can instantiate it in place.

#include "Database.h"

#include <sqlite3.h>

#include <algorithm>
#include <cctype>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <variant>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{
namespace detail
{

class StatementGuard
{
public:
    explicit StatementGuard(sqlite3_stmt* stmt) noexcept
        : m_stmt(stmt)
    {
    }

    ~StatementGuard()
    {
        reset();
    }

    StatementGuard(const StatementGuard&) = delete;
    StatementGuard& operator=(const StatementGuard&) = delete;

    void reset() noexcept
    {
        if (m_stmt != nullptr)
        {
            sqlite3_finalize(m_stmt);
            m_stmt = nullptr;
        }
    }

private:
    sqlite3_stmt* m_stmt;
};

inline int BindText(sqlite3_stmt* stmt, int index, const std::string& value)
{
    return sqlite3_bind_text(stmt, index, value.c_str(), -1, SQLITE_TRANSIENT);
}

inline int BindOptionalText(sqlite3_stmt* stmt, int index, const std::optional<std::string>& value)
{
    if (!value.has_value())
    {
        return sqlite3_bind_null(stmt, index);
    }
    return sqlite3_bind_text(stmt, index, value->c_str(), -1, SQLITE_TRANSIENT);
}

inline int BindInt(sqlite3_stmt* stmt, int index, int value)
{
    return sqlite3_bind_int(stmt, index, value);
}

inline std::optional<std::string> ColumnOptionalText(sqlite3_stmt* stmt, int index)
{
    if (sqlite3_column_type(stmt, index) == SQLITE_NULL)
    {
        return std::nullopt;
    }
    const auto* text = sqlite3_column_text(stmt, index);
    if (text == nullptr)
    {
        return std::string{};
    }
    return std::string(reinterpret_cast<const char*>(text));
}

inline nlohmann::json ColumnTextOrNull(sqlite3_stmt* stmt, int index)
{
    const auto value = ColumnOptionalText(stmt, index);
    if (!value.has_value())
    {
        return nullptr;
    }
    return *value;
}

inline bool JsonObjectInt(const nlohmann::json& obj, const char* key, int& out)
{
    if (!obj.is_object())
    {
        return false;
    }
    const auto it = obj.find(key);
    if (it == obj.end())
    {
        return false;
    }
    if (const auto* signedPtr = it->get_ptr<const nlohmann::json::number_integer_t*>())
    {
        if (*signedPtr < std::numeric_limits<int>::min() || *signedPtr > std::numeric_limits<int>::max())
        {
            return false;
        }
        out = static_cast<int>(*signedPtr);
        return true;
    }
    if (const auto* unsignedPtr = it->get_ptr<const nlohmann::json::number_unsigned_t*>())
    {
        if (*unsignedPtr > static_cast<nlohmann::json::number_unsigned_t>(std::numeric_limits<int>::max()))
        {
            return false;
        }
        out = static_cast<int>(*unsignedPtr);
        return true;
    }
    return false;
}

inline std::string TrimAscii(std::string value)
{
    value.erase(
        value.begin(),
        std::find_if(value.begin(), value.end(), [](unsigned char ch)
        {
            return !std::isspace(ch);
        }));
    value.erase(
        std::find_if(value.rbegin(), value.rend(), [](unsigned char ch)
        {
            return !std::isspace(ch);
        }).base(),
        value.end());
    return value;
}

inline std::string LowerAscii(std::string_view value)
{
    std::string lowered;
    lowered.reserve(value.size());
    for (const unsigned char ch : value)
    {
        lowered.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lowered;
}

inline void RollbackIfNeeded(sqlite3* db) noexcept
{
    if (db != nullptr)
    {
        sqlite3_exec(db, "ROLLBACK;", nullptr, nullptr, nullptr);
    }
}

} // namespace detail

using namespace detail;

template <typename BindFn>
Result<std::monostate> Database::RunOnce(const char* sql, BindFn bind)
{
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    const auto bindResult = bind(rawStmt);
    if (std::holds_alternative<Error>(bindResult))
    {
        return std::get<Error>(bindResult);
    }

    const int rc = sqlite3_step(rawStmt);
    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return std::monostate{};
}

} // namespace vrcsm::core
