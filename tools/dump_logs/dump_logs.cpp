// Standalone harness for LogParser::parse(). Prints the resulting
// LogReport as JSON so we can see what the frontend actually receives
// on the "logs" page without running the full WebView2 GUI.
//
// Usage:
//   dump_logs                 -- uses the default VRChat LocalLow dir
//   dump_logs <path>          -- override the baseDir (for testing)

#include <cstdio>
#include <filesystem>
#include <iostream>
#include <string>

#include <nlohmann/json.hpp>

#include "core/LogParser.h"
#include "core/PathProbe.h"

int main(int argc, char** argv)
{
    std::filesystem::path baseDir;
    if (argc > 1)
    {
        baseDir = argv[1];
    }
    else
    {
        baseDir = vrcsm::core::PathProbe::Probe().baseDir;
    }

    std::cout << "baseDir: " << baseDir.string() << "\n";

    const auto report = vrcsm::core::LogParser::parse(baseDir);
    nlohmann::json j = report;
    std::cout << j.dump(2) << "\n";
    return 0;
}
