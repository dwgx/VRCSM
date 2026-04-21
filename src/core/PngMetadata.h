#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Inject a set of `tEXt` chunks into an existing PNG file, matching the
// VRCX-style convention of embedding VRChat world/player metadata in
// capture files so any viewer can read them back later (`exiftool`,
// VRCX itself, or a custom script).
//
// Scope is intentionally narrow:
//   - reads the input file, verifies the PNG magic + IHDR, emits a new
//     copy with tEXt chunks appended right after the IHDR block, then
//     atomically replaces the original via rename-over
//   - tEXt keys are restricted to 1-79 ASCII bytes; values are UTF-8
//     and size-capped per chunk at 64 KiB
//   - existing chunks (including prior tEXt values with the same
//     keyword) are preserved — we append rather than overwrite
//
// Returns `true` on success; `false` if the file is missing, too short,
// or lacks a valid PNG signature. All I/O errors log via spdlog so the
// caller can treat the injector as fire-and-forget.
bool InjectPngTextChunks(
    const std::filesystem::path& pngPath,
    const std::vector<std::pair<std::string, std::string>>& entries);

// Convenience wrapper — serialises the JSON object into flat key/value
// pairs and delegates to InjectPngTextChunks. Nested objects or arrays
// are stringified before being written.
bool InjectPngTextFromJson(
    const std::filesystem::path& pngPath,
    const nlohmann::json& metadata);

// Read existing tEXt chunks from a PNG. Returns every key/value pair
// encountered, including duplicates — callers that want unique keys can
// post-filter. Returns an empty vector on malformed input.
std::vector<std::pair<std::string, std::string>> ReadPngTextChunks(
    const std::filesystem::path& pngPath);

} // namespace vrcsm::core
