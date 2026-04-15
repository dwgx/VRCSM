#include "../pch.h"

#include "VrcSettings.h"

#include "ProcessGuard.h"

#include <cstring>
#include <limits>
#include <system_error>
#include <unordered_set>

namespace vrcsm::core
{

namespace
{

constexpr wchar_t kRegistrySubKey[] = L"Software\\VRChat\\VRChat";
constexpr std::string_view kDefaultGroup = "other";
// Group whitelist the frontend relies on for tab ordering. Keep this in
// sync with web/src/pages/Settings.tsx and the i18n groups.* keys. Any
// group outside this list collapses to "other" via NormalizeGroup, so
// adding a new category here is mandatory before you can use it in
// KnownKeys().
constexpr std::array<std::string_view, 12> kGroups{
    "audio",
    "graphics",
    "network",
    "avatar",
    "input",
    "osc",
    "comfort",
    "ui",
    "privacy",
    "safety",
    "system",
    "other"
};

struct KnownKey
{
    const char* originalName;
    const char* group;
    const char* description;
};

struct RegistryValueData
{
    DWORD type = 0;
    std::vector<uint8_t> data;
};

struct EncodedValueData
{
    DWORD type = 0;
    std::vector<uint8_t> data;
};

std::string MakeWin32Message(std::string_view action, LONG status)
{
    return fmt::format(
        "{} ({}): {}",
        action,
        status,
        std::system_category().message(static_cast<int>(status)));
}

std::string MakeJsonTypeName(VrcSettingType type)
{
    switch (type)
    {
    case VrcSettingType::Int:
        return "int";
    case VrcSettingType::Float:
        return "float";
    case VrcSettingType::String:
        return "string";
    case VrcSettingType::Bool:
        return "bool";
    case VrcSettingType::Raw:
    default:
        return "raw";
    }
}

bool IsKnownGroup(std::string_view group)
{
    return std::find(kGroups.begin(), kGroups.end(), group) != kGroups.end();
}

std::string NormalizeGroup(std::string_view group)
{
    if (IsKnownGroup(group))
    {
        return std::string(group);
    }

    return std::string(kDefaultGroup);
}

// KnownKeys is the full catalogue of PlayerPrefs keys we can recognise
// by name. The table literal is generated from docs/vrc-settings-keys.md
// via a codex delegation, then checked into
// src/core/VrcSettingsKnownKeys.inc. To regenerate after a VRChat update:
//   1. Refresh docs/vrc-settings-keys.md from a fresh IL2CPP dump +
//      live registry snapshot.
//   2. Re-run the codex header-conversion prompt (see git log for the
//      verbatim prompt) → writes VrcSettingsKnownKeys.inc.
//   3. Rebuild.
// The boolean promotion set is in VrcSettingsBoolKeys.inc — same drill.
const std::unordered_map<std::string, KnownKey>& KnownKeys()
{
    static const std::unordered_map<std::string, KnownKey> table{
#include "VrcSettingsKnownKeys.inc"
    };

    return table;
}

const std::unordered_set<std::string>& BooleanKeys()
{
    static const std::unordered_set<std::string> table{
#include "VrcSettingsBoolKeys.inc"
    };

    return table;
}

Error MakeError(std::string_view code, std::string_view message)
{
    return Error{std::string(code), std::string(message)};
}

nlohmann::json MakeErrorJson(const Error& err)
{
    return nlohmann::json{{"error", {{"code", err.code}, {"message", err.message}}}};
}

void ThrowIfRegistryError(LONG status, std::string_view action)
{
    if (status != ERROR_SUCCESS)
    {
        throw std::runtime_error(MakeWin32Message(action, status));
    }
}

wil::unique_hkey OpenSettingsKey(REGSAM access)
{
    HKEY rawKey = nullptr;
    const LONG status = RegOpenKeyExW(HKEY_CURRENT_USER, kRegistrySubKey, 0, access, &rawKey);
    if (status == ERROR_FILE_NOT_FOUND)
    {
        throw std::runtime_error("VRChat settings registry key not found");
    }

    ThrowIfRegistryError(status, "Failed to open VRChat settings registry key");
    return wil::unique_hkey(rawKey);
}

std::optional<std::wstring> EnumerateValueName(HKEY key, DWORD index)
{
    DWORD capacity = 256;
    while (true)
    {
        std::vector<wchar_t> buffer(capacity, L'\0');
        DWORD nameLength = capacity;
        const LONG status = RegEnumValueW(
            key,
            index,
            buffer.data(),
            &nameLength,
            nullptr,
            nullptr,
            nullptr,
            nullptr);

        if (status == ERROR_NO_MORE_ITEMS)
        {
            return std::nullopt;
        }

        if (status == ERROR_MORE_DATA)
        {
            capacity *= 2;
            continue;
        }

        ThrowIfRegistryError(status, "Failed to enumerate registry value");
        return std::wstring(buffer.data(), nameLength);
    }
}

RegistryValueData QueryValueData(HKEY key, const std::wstring& valueName)
{
    RegistryValueData valueData;
    DWORD size = 0;
    LONG status = RegQueryValueExW(
        key,
        valueName.c_str(),
        nullptr,
        &valueData.type,
        nullptr,
        &size);
    ThrowIfRegistryError(status, "Failed to query registry value size");

    valueData.data.resize(size);
    if (size == 0)
    {
        return valueData;
    }

    status = RegQueryValueExW(
        key,
        valueName.c_str(),
        nullptr,
        &valueData.type,
        valueData.data.data(),
        &size);
    ThrowIfRegistryError(status, "Failed to read registry value data");
    valueData.data.resize(size);
    return valueData;
}

std::optional<std::wstring> StripEncodedSuffix(std::wstring_view encodedKey)
{
    const std::size_t marker = encodedKey.rfind(L"_h");
    if (marker == std::wstring_view::npos || marker + 2 >= encodedKey.size())
    {
        return std::nullopt;
    }

    for (std::size_t i = marker + 2; i < encodedKey.size(); ++i)
    {
        if (encodedKey[i] < L'0' || encodedKey[i] > L'9')
        {
            return std::nullopt;
        }
    }

    return std::wstring(encodedKey.substr(0, marker));
}

uint32_t ReadUint32LE(const uint8_t* data)
{
    return static_cast<uint32_t>(data[0])
        | (static_cast<uint32_t>(data[1]) << 8)
        | (static_cast<uint32_t>(data[2]) << 16)
        | (static_cast<uint32_t>(data[3]) << 24);
}

// Minimal UTF-8 validator that also rejects embedded NULs.
// Used to classify Unity 2019+ PlayerPrefs REG_BINARY payloads as strings.
bool IsValidUtf8NoEmbeddedNul(const uint8_t* data, std::size_t length)
{
    std::size_t i = 0;
    while (i < length)
    {
        const uint8_t b = data[i];

        if (b == 0x00)
        {
            return false;
        }

        if (b < 0x80)
        {
            ++i;
            continue;
        }

        std::size_t extra = 0;
        if ((b & 0xE0) == 0xC0 && b >= 0xC2)
        {
            extra = 1;
        }
        else if ((b & 0xF0) == 0xE0)
        {
            extra = 2;
        }
        else if ((b & 0xF8) == 0xF0 && b <= 0xF4)
        {
            extra = 3;
        }
        else
        {
            return false;
        }

        if (i + extra >= length)
        {
            return false;
        }

        for (std::size_t j = 1; j <= extra; ++j)
        {
            if ((data[i + j] & 0xC0) != 0x80)
            {
                return false;
            }
        }

        i += extra + 1;
    }

    return true;
}

bool IsBooleanKey(std::string_view key)
{
    return BooleanKeys().contains(std::string(key));
}

VrcSettingValue DecodeNumericValue(std::string_view key, DWORD type, const std::vector<uint8_t>& data)
{
    VrcSettingValue value;

    if (type == REG_DWORD && data.size() >= sizeof(uint32_t))
    {
        int32_t rawValue = 0;
        std::memcpy(&rawValue, data.data(), sizeof(rawValue));
        if (IsBooleanKey(key))
        {
            value.type = VrcSettingType::Bool;
            value.asBool = (rawValue != 0);
        }
        else
        {
            value.type = VrcSettingType::Int;
            value.asInt = static_cast<int64_t>(rawValue);
        }

        return value;
    }

    if (type == REG_QWORD && data.size() >= sizeof(uint64_t))
    {
        int64_t rawValue = 0;
        std::memcpy(&rawValue, data.data(), sizeof(rawValue));
        if (IsBooleanKey(key))
        {
            value.type = VrcSettingType::Bool;
            value.asBool = (rawValue != 0);
        }
        else
        {
            value.type = VrcSettingType::Int;
            value.asInt = rawValue;
        }

        return value;
    }

    value.type = VrcSettingType::Raw;
    value.raw = data;
    return value;
}

VrcSettingValue DecodeBinaryValue(const std::vector<uint8_t>& data)
{
    VrcSettingValue value;
    value.type = VrcSettingType::Raw;
    value.raw = data;

    if (data.empty())
    {
        return value;
    }

    // Unity 2019+ (and therefore every current VRChat build) stores PlayerPrefs
    // REG_BINARY values without a type tag:
    //   - strings: raw UTF-8 bytes + a trailing NUL
    //   - floats:  4 bytes, IEEE 754 single precision
    // The legacy pre-2019 format tagged the first byte (0x00/0x01/0x02 for
    // length-prefixed strings, 0x03 for 8-byte doubles). We try the new
    // heuristics first and fall through to the legacy tags only if neither
    // matches, so we can decode cleanly on both layouts.
    if (data.back() == 0x00
        && IsValidUtf8NoEmbeddedNul(data.data(), data.size() - 1))
    {
        value.type = VrcSettingType::String;
        value.asString = std::string(
            reinterpret_cast<const char*>(data.data()),
            data.size() - 1);
        value.raw.clear();
        return value;
    }

    if (data.size() == sizeof(float))
    {
        float rawFloat = 0.0f;
        std::memcpy(&rawFloat, data.data(), sizeof(rawFloat));
        value.type = VrcSettingType::Float;
        value.asFloat = static_cast<double>(rawFloat);
        value.raw.clear();
        return value;
    }

    const uint8_t tag = data[0];

    if (tag == 0x00 || tag == 0x01 || tag == 0x02)
    {
        if (data.size() < 5)
        {
            spdlog::debug("Legacy Unity PlayerPrefs string value too small: {} bytes", data.size());
            return value;
        }

        const uint32_t length = ReadUint32LE(data.data() + 1);
        const std::size_t payloadSize = data.size() - 5;
        if (length > payloadSize)
        {
            spdlog::debug(
                "Legacy Unity PlayerPrefs string length exceeds payload: length={}, payload={}",
                length,
                payloadSize);
            return value;
        }

        value.type = VrcSettingType::String;
        value.asString = std::string(
            reinterpret_cast<const char*>(data.data() + 5),
            reinterpret_cast<const char*>(data.data() + 5 + length));
        value.raw.clear();
        return value;
    }

    if (tag == 0x03)
    {
        if (data.size() < 9)
        {
            spdlog::debug("Legacy Unity PlayerPrefs double value too small: {} bytes", data.size());
            return value;
        }

        double rawValue = 0.0;
        std::memcpy(&rawValue, data.data() + 1, sizeof(rawValue));
        value.type = VrcSettingType::Float;
        value.asFloat = rawValue;
        value.raw.clear();
        return value;
    }

    spdlog::debug("Unrecognized Unity PlayerPrefs binary payload ({} bytes)", data.size());
    return value;
}

VrcSettingValue DecodeValue(std::string_view key, DWORD type, const std::vector<uint8_t>& data)
{
    if (type == REG_DWORD || type == REG_QWORD)
    {
        return DecodeNumericValue(key, type, data);
    }

    if (type == REG_BINARY)
    {
        return DecodeBinaryValue(data);
    }

    VrcSettingValue value;
    value.type = VrcSettingType::Raw;
    value.raw = data;
    return value;
}

VrcSettingEntry BuildEntry(std::string encodedKey, std::string strippedKey, DWORD type, const std::vector<uint8_t>& data)
{
    VrcSettingEntry entry;
    entry.encodedKey = std::move(encodedKey);

    const auto it = KnownKeys().find(strippedKey);
    if (it != KnownKeys().end())
    {
        entry.key = it->second.originalName;
        entry.group = NormalizeGroup(it->second.group);
        entry.description = it->second.description;
    }
    else
    {
        entry.key = strippedKey;
        entry.group = std::string(kDefaultGroup);
    }

    entry.value = DecodeValue(entry.key, type, data);
    return entry;
}

Result<EncodedValueData> EncodeValue(const VrcSettingValue& value)
{
    EncodedValueData encoded;

    switch (value.type)
    {
    case VrcSettingType::Int:
        if (!value.asInt.has_value())
        {
            return MakeError("missing_param", "intValue is required for type=int");
        }

        if (*value.asInt >= std::numeric_limits<int32_t>::min()
            && *value.asInt <= std::numeric_limits<int32_t>::max())
        {
            encoded.type = REG_DWORD;
            encoded.data.resize(sizeof(int32_t));
            const int32_t rawValue = static_cast<int32_t>(*value.asInt);
            std::memcpy(encoded.data.data(), &rawValue, sizeof(rawValue));
        }
        else
        {
            encoded.type = REG_QWORD;
            encoded.data.resize(sizeof(int64_t));
            const int64_t rawValue = *value.asInt;
            std::memcpy(encoded.data.data(), &rawValue, sizeof(rawValue));
        }
        return encoded;

    case VrcSettingType::Float:
        if (!value.asFloat.has_value())
        {
            return MakeError("missing_param", "floatValue is required for type=float");
        }

        // Unity 2019+ writes floats as 4-byte IEEE 754 single precision
        // with no type tag. This matches what the game reads back.
        encoded.type = REG_BINARY;
        encoded.data.resize(sizeof(float));
        {
            const float rawFloat = static_cast<float>(*value.asFloat);
            std::memcpy(encoded.data.data(), &rawFloat, sizeof(rawFloat));
        }
        return encoded;

    case VrcSettingType::String:
        if (!value.asString.has_value())
        {
            return MakeError("missing_param", "stringValue is required for type=string");
        }

        if (value.asString->size() > std::numeric_limits<uint32_t>::max() - 1)
        {
            return MakeError("value_too_large", "stringValue exceeds Unity PlayerPrefs length capacity");
        }

        // Unity 2019+ writes strings as raw UTF-8 bytes terminated by a
        // single trailing NUL, with no type tag or length prefix.
        encoded.type = REG_BINARY;
        encoded.data.resize(value.asString->size() + 1);
        if (!value.asString->empty())
        {
            std::memcpy(
                encoded.data.data(),
                value.asString->data(),
                value.asString->size());
        }
        encoded.data.back() = 0x00;
        return encoded;

    case VrcSettingType::Bool:
        if (!value.asBool.has_value())
        {
            return MakeError("missing_param", "boolValue is required for type=bool");
        }

        encoded.type = REG_DWORD;
        encoded.data.resize(sizeof(uint32_t));
        {
            const uint32_t rawValue = *value.asBool ? 1U : 0U;
            std::memcpy(encoded.data.data(), &rawValue, sizeof(rawValue));
        }
        return encoded;

    case VrcSettingType::Raw:
        encoded.type = REG_BINARY;
        encoded.data = value.raw;
        return encoded;
    }

    return MakeError("invalid_param", "Unsupported setting type");
}

nlohmann::json SerializeValue(const VrcSettingValue& value)
{
    nlohmann::json json{
        {"type", MakeJsonTypeName(value.type)}
    };

    if (value.asInt.has_value())
    {
        json["intValue"] = *value.asInt;
    }
    if (value.asFloat.has_value())
    {
        json["floatValue"] = *value.asFloat;
    }
    if (value.asString.has_value())
    {
        json["stringValue"] = *value.asString;
    }
    if (value.asBool.has_value())
    {
        json["boolValue"] = *value.asBool;
    }
    if (value.type == VrcSettingType::Raw)
    {
        json["raw"] = value.raw;
    }

    return json;
}

nlohmann::json SerializeEntry(const VrcSettingEntry& entry)
{
    nlohmann::json json{
        {"encodedKey", entry.encodedKey},
        {"key", entry.key},
        {"group", NormalizeGroup(entry.group)},
        {"description", entry.description},
    };

    const auto valueJson = SerializeValue(entry.value);
    for (auto it = valueJson.begin(); it != valueJson.end(); ++it)
    {
        json[it.key()] = it.value();
    }

    return json;
}

Result<VrcSettingValue> ParseWriteValue(const nlohmann::json& json)
{
    if (!json.is_object())
    {
        return MakeError("missing_param", "value object required");
    }

    if (!json.contains("type") || !json["type"].is_string())
    {
        return MakeError("missing_param", "value.type is required");
    }

    const std::string type = json["type"].get<std::string>();
    VrcSettingValue value;

    if (type == "int")
    {
        if (!json.contains("intValue") || !json["intValue"].is_number_integer())
        {
            return MakeError("missing_param", "value.intValue must be an integer");
        }

        value.type = VrcSettingType::Int;
        value.asInt = json["intValue"].get<int64_t>();
        return value;
    }

    if (type == "float")
    {
        if (!json.contains("floatValue") || !json["floatValue"].is_number())
        {
            return MakeError("missing_param", "value.floatValue must be numeric");
        }

        value.type = VrcSettingType::Float;
        value.asFloat = json["floatValue"].get<double>();
        return value;
    }

    if (type == "string")
    {
        if (!json.contains("stringValue") || !json["stringValue"].is_string())
        {
            return MakeError("missing_param", "value.stringValue must be a string");
        }

        value.type = VrcSettingType::String;
        value.asString = json["stringValue"].get<std::string>();
        return value;
    }

    if (type == "bool")
    {
        if (!json.contains("boolValue") || !json["boolValue"].is_boolean())
        {
            return MakeError("missing_param", "value.boolValue must be a boolean");
        }

        value.type = VrcSettingType::Bool;
        value.asBool = json["boolValue"].get<bool>();
        return value;
    }

    return MakeError("invalid_param", "value.type must be int, float, string, or bool");
}

std::filesystem::path MakeDefaultExportPath()
{
    std::error_code ec;
    std::filesystem::path base = std::filesystem::temp_directory_path(ec);
    if (ec)
    {
        base = std::filesystem::current_path(ec);
        if (ec)
        {
            base = L".";
        }
    }

    SYSTEMTIME st{};
    GetLocalTime(&st);

    const std::wstring fileName = toWide(fmt::format(
        "vrcsm-vrc-settings-{:04}{:02}{:02}-{:02}{:02}{:02}.reg",
        st.wYear,
        st.wMonth,
        st.wDay,
        st.wHour,
        st.wMinute,
        st.wSecond));

    return base / fileName;
}

} // namespace

Result<std::vector<VrcSettingEntry>> VrcSettings::ReadAll()
{
    try
    {
        auto key = OpenSettingsKey(KEY_READ);
        std::vector<VrcSettingEntry> entries;

        for (DWORD index = 0;; ++index)
        {
            const auto valueName = EnumerateValueName(key.get(), index);
            if (!valueName.has_value())
            {
                break;
            }

            const auto strippedName = StripEncodedSuffix(*valueName);
            if (!strippedName.has_value())
            {
                continue;
            }

            const auto valueData = QueryValueData(key.get(), *valueName);
            entries.push_back(BuildEntry(
                toUtf8(*valueName),
                toUtf8(*strippedName),
                valueData.type,
                valueData.data));
        }

        return entries;
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::ReadAll failed: {}", ex.what());
        return MakeError("registry_read_failed", ex.what());
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::ReadAll failed with unknown exception");
        return MakeError("registry_read_failed", "Unknown registry read failure");
    }
}

Result<VrcSettingEntry> VrcSettings::ReadOne(std::string_view encodedKey)
{
    try
    {
        if (encodedKey.empty())
        {
            return MakeError("missing_param", "encodedKey is required");
        }

        const std::wstring valueName = toWide(encodedKey);
        const auto strippedName = StripEncodedSuffix(valueName);
        if (!strippedName.has_value())
        {
            return MakeError("invalid_param", "encodedKey must use the Unity PlayerPrefs encoded form");
        }

        auto key = OpenSettingsKey(KEY_READ);
        DWORD type = 0;
        DWORD size = 0;
        LONG status = RegQueryValueExW(key.get(), valueName.c_str(), nullptr, &type, nullptr, &size);
        if (status == ERROR_FILE_NOT_FOUND)
        {
            return MakeError("not_found", "Registry value not found");
        }

        ThrowIfRegistryError(status, "Failed to query registry value");

        const auto valueData = QueryValueData(key.get(), valueName);
        return BuildEntry(
            std::string(encodedKey),
            toUtf8(*strippedName),
            valueData.type,
            valueData.data);
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::ReadOne failed for {}: {}", encodedKey, ex.what());
        return MakeError("registry_read_failed", ex.what());
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::ReadOne failed with unknown exception");
        return MakeError("registry_read_failed", "Unknown registry read failure");
    }
}

Result<std::monostate> VrcSettings::WriteOne(std::string_view encodedKey, const VrcSettingValue& value)
{
    try
    {
        if (encodedKey.empty())
        {
            return MakeError("missing_param", "encodedKey is required");
        }

        if (!StripEncodedSuffix(toWide(encodedKey)).has_value())
        {
            return MakeError("invalid_param", "encodedKey must use the Unity PlayerPrefs encoded form");
        }

        const auto status = ProcessGuard::IsVRChatRunning();
        if (status.running)
        {
            return MakeError(
                "vrc_running",
                "VRChat is running — close it before writing settings so changes do not get overwritten on exit");
        }

        const auto encodedValue = EncodeValue(value);
        if (!isOk(encodedValue))
        {
            return error(encodedValue);
        }

        auto key = OpenSettingsKey(KEY_WRITE);
        const std::wstring valueName = toWide(encodedKey);
        const auto& payload = vrcsm::core::value(encodedValue);

        const LONG writeStatus = RegSetValueExW(
            key.get(),
            valueName.c_str(),
            0,
            payload.type,
            payload.data.empty() ? nullptr : payload.data.data(),
            static_cast<DWORD>(payload.data.size()));
        ThrowIfRegistryError(writeStatus, "Failed to write registry value");

        return std::monostate{};
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::WriteOne failed for {}: {}", encodedKey, ex.what());
        return MakeError("registry_write_failed", ex.what());
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::WriteOne failed with unknown exception");
        return MakeError("registry_write_failed", "Unknown registry write failure");
    }
}

Result<std::filesystem::path> VrcSettings::ExportReg(const std::filesystem::path& outPath)
{
    try
    {
        std::error_code ec;
        auto finalPath = outPath;
        if (finalPath.empty())
        {
            finalPath = MakeDefaultExportPath();
        }

        finalPath = std::filesystem::absolute(finalPath, ec);
        if (ec)
        {
            return MakeError("path_failed", ec.message());
        }

        const auto parent = finalPath.parent_path();
        if (!parent.empty())
        {
            std::filesystem::create_directories(parent, ec);
            if (ec)
            {
                return MakeError("mkdir_failed", ec.message());
            }
        }

        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);
        PROCESS_INFORMATION processInfo{};

        std::wstring commandLine =
            L"reg export \"HKCU\\Software\\VRChat\\VRChat\" \""
            + finalPath.wstring()
            + L"\" /y";
        std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
        mutableCommand.push_back(L'\0');

        if (!CreateProcessW(
                nullptr,
                mutableCommand.data(),
                nullptr,
                nullptr,
                FALSE,
                CREATE_NO_WINDOW,
                nullptr,
                nullptr,
                &startupInfo,
                &processInfo))
        {
            return MakeError("export_failed", MakeWin32Message("Failed to launch reg export", GetLastError()));
        }

        wil::unique_handle processHandle(processInfo.hProcess);
        wil::unique_handle threadHandle(processInfo.hThread);

        const DWORD waitStatus = WaitForSingleObject(processHandle.get(), INFINITE);
        if (waitStatus != WAIT_OBJECT_0)
        {
            return MakeError("export_failed", MakeWin32Message("Failed while waiting for reg export", GetLastError()));
        }

        DWORD exitCode = 0;
        if (!GetExitCodeProcess(processHandle.get(), &exitCode))
        {
            return MakeError("export_failed", MakeWin32Message("Failed to read reg export exit code", GetLastError()));
        }

        if (exitCode != 0)
        {
            return MakeError("export_failed", fmt::format("reg export exited with code {}", exitCode));
        }

        return finalPath;
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::ExportReg failed: {}", ex.what());
        return MakeError("export_failed", ex.what());
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::ExportReg failed with unknown exception");
        return MakeError("export_failed", "Unknown export failure");
    }
}

nlohmann::json VrcSettings::ReadAllJson(const nlohmann::json&)
{
    try
    {
        const auto result = ReadAll();
        if (!isOk(result))
        {
            return MakeErrorJson(error(result));
        }

        const auto& entries = value(result);
        nlohmann::json entriesJson = nlohmann::json::array();
        nlohmann::json groupsJson = nlohmann::json::object();
        for (const auto& group : kGroups)
        {
            groupsJson[std::string(group)] = nlohmann::json::array();
        }

        for (std::size_t i = 0; i < entries.size(); ++i)
        {
            entriesJson.push_back(SerializeEntry(entries[i]));
            const std::string group = NormalizeGroup(entries[i].group);
            groupsJson[group].push_back(i);
        }

        return nlohmann::json{
            {"entries", entriesJson},
            {"count", entries.size()},
            {"groups", groupsJson}
        };
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::ReadAllJson failed: {}", ex.what());
        return MakeErrorJson(MakeError("registry_read_failed", ex.what()));
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::ReadAllJson failed with unknown exception");
        return MakeErrorJson(MakeError("registry_read_failed", "Unknown registry read failure"));
    }
}

nlohmann::json VrcSettings::WriteOneJson(const nlohmann::json& params)
{
    try
    {
        if (!params.contains("encodedKey") || !params["encodedKey"].is_string())
        {
            return MakeErrorJson(MakeError("missing_param", "encodedKey field required"));
        }

        if (!params.contains("value"))
        {
            return MakeErrorJson(MakeError("missing_param", "value field required"));
        }

        const auto valueResult = ParseWriteValue(params["value"]);
        if (!isOk(valueResult))
        {
            return MakeErrorJson(error(valueResult));
        }

        const auto result = WriteOne(
            params["encodedKey"].get<std::string>(),
            value(valueResult));
        if (!isOk(result))
        {
            return MakeErrorJson(error(result));
        }

        return nlohmann::json{{"ok", true}};
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::WriteOneJson failed: {}", ex.what());
        return MakeErrorJson(MakeError("registry_write_failed", ex.what()));
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::WriteOneJson failed with unknown exception");
        return MakeErrorJson(MakeError("registry_write_failed", "Unknown registry write failure"));
    }
}

nlohmann::json VrcSettings::ExportRegJson(const nlohmann::json& params)
{
    try
    {
        std::filesystem::path outPath;
        if (params.contains("outPath") && params["outPath"].is_string())
        {
            outPath = utf8Path(params["outPath"].get<std::string>());
        }
        else
        {
            outPath = MakeDefaultExportPath();
        }

        const auto result = ExportReg(outPath);
        if (!isOk(result))
        {
            return MakeErrorJson(error(result));
        }

        return nlohmann::json{
            {"ok", true},
            {"path", toUtf8(value(result).wstring())}
        };
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("VrcSettings::ExportRegJson failed: {}", ex.what());
        return MakeErrorJson(MakeError("export_failed", ex.what()));
    }
    catch (...)
    {
        spdlog::debug("VrcSettings::ExportRegJson failed with unknown exception");
        return MakeErrorJson(MakeError("export_failed", "Unknown export failure"));
    }
}

} // namespace vrcsm::core
