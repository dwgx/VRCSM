#pragma once

#include <filesystem>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Aggregates results from every scanner module into the top-level report
// JSON consumed by the host's IpcBridge (matches the Python prototype's
// report.json schema).
//
// The actual entry point is CacheScanner::buildReport(), declared in
// CacheScanner.h and implemented in Report.cpp so that aggregation can
// pull in every module header without polluting the scanner translation
// unit.
nlohmann::json BuildFullReport(const std::filesystem::path& baseDir);

} // namespace vrcsm::core
