// Standalone harness that exercises VrcSettings::ReadAllJson() against the
// real HKCU\Software\VRChat\VRChat registry hive, then prints a summary plus
// a handful of sample decoded entries. Used as an end-to-end smoke test for
// the Unity 2019+ REG_BINARY decoder when the GUI path is unavailable.

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <map>
#include <string>

#include <nlohmann/json.hpp>

#include "core/VrcSettings.h"

using nlohmann::json;

namespace
{

const char* classifyType(const json& entry)
{
    if (!entry.contains("type"))
    {
        return "<missing>";
    }
    return entry["type"].get_ref<const std::string&>().c_str();
}

std::string renderValue(const json& entry)
{
    const std::string type = entry.value("type", "raw");
    if (type == "int")
    {
        return std::to_string(entry.value("intValue", int64_t{0}));
    }
    if (type == "float")
    {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.6g", entry.value("floatValue", 0.0));
        return buf;
    }
    if (type == "string")
    {
        return "\"" + entry.value("stringValue", std::string{}) + "\"";
    }
    if (type == "bool")
    {
        return entry.value("boolValue", false) ? "true" : "false";
    }
    if (type == "raw")
    {
        const auto& raw = entry["raw"];
        std::string hex;
        hex.reserve(raw.size() * 3);
        for (const auto& b : raw)
        {
            char buf[4];
            std::snprintf(buf, sizeof(buf), "%02X ", b.get<int>());
            hex += buf;
        }
        return "raw[" + std::to_string(raw.size()) + "] " + hex;
    }
    return "<?>";
}

} // namespace

int main()
{
    const json result = vrcsm::core::VrcSettings::ReadAllJson(json::object());
    if (result.contains("error"))
    {
        std::cerr << "ReadAllJson returned error: " << result["error"].dump() << "\n";
        return 1;
    }

    if (!result.contains("entries"))
    {
        std::cerr << "ReadAllJson returned no entries field\n";
        return 1;
    }

    const auto& entries = result["entries"];
    const std::size_t count = entries.size();

    std::map<std::string, std::size_t> typeCounts;
    std::map<std::string, std::size_t> groupCounts;
    std::size_t rawCount = 0;
    for (const auto& entry : entries)
    {
        ++typeCounts[classifyType(entry)];
        ++groupCounts[entry.value("group", std::string("other"))];
        if (entry.value("type", std::string("")) == "raw")
        {
            ++rawCount;
        }
    }

    std::cout << "=== VrcSettings::ReadAllJson smoke test ===\n";
    std::cout << "total entries : " << count << "\n\n";

    std::cout << "type breakdown:\n";
    for (const auto& [type, n] : typeCounts)
    {
        std::cout << "  " << type << " : " << n << "\n";
    }
    std::cout << "\n";

    std::cout << "group breakdown:\n";
    for (const auto& [group, n] : groupCounts)
    {
        std::cout << "  " << group << " : " << n << "\n";
    }
    std::cout << "\n";

    // Show a few known-interesting entries we can eyeball.
    const std::vector<std::string> showcase{
        "VRC_CURRENT_LANGUAGE",
        "VRC_ADVANCED_GRAPHICS_QUALITY",
        "VRC_INPUT_MIC_ENABLED",
        "VRC_INPUT_MIC_THRESHOLD",
        "VRC_MASTER_VOLUME",
        "VRC_WORLD_VOLUME",
        "VRC_AVATAR_VOLUME",
        "FOLDOUT_STATES",
    };

    std::cout << "showcase entries:\n";
    for (const auto& wantedKey : showcase)
    {
        bool found = false;
        for (const auto& entry : entries)
        {
            if (entry.value("key", std::string{}) == wantedKey)
            {
                std::cout << "  " << wantedKey
                          << "  [" << entry.value("type", std::string("?")) << "]"
                          << "  group=" << entry.value("group", std::string("?"))
                          << "  " << renderValue(entry) << "\n";
                found = true;
                break;
            }
        }
        if (!found)
        {
            std::cout << "  " << wantedKey << "  <not present>\n";
        }
    }
    std::cout << "\n";

    // First 6 raw entries if any — these would indicate decoder fallthrough.
    if (rawCount > 0)
    {
        std::cout << "raw fallthrough samples (max 6):\n";
        std::size_t shown = 0;
        for (const auto& entry : entries)
        {
            if (entry.value("type", std::string{}) != "raw") continue;
            std::cout << "  " << entry.value("key", std::string("?")) << " => "
                      << renderValue(entry) << "\n";
            if (++shown >= 6) break;
        }
    }
    else
    {
        std::cout << "no raw entries — every REG_BINARY decoded cleanly.\n";
    }

    return 0;
}
