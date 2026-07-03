#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace vrcsm::core
{

/// A10 — read-only avatar-ID sourcing from VRChat's own local analytics cache.
///
/// VRChat now encrypts the on-disk avatar cache, so the offline-enrichment path
/// for `avtr_` ids is the Amplitude analytics cache the client already writes to
/// `%Temp%\VRChat\VRChat\amplitude.cache` (the VRC-LOG technique). This helper
/// is strictly read-only: no network, no mutation, no upload. The raw analytics
/// content is treated as DATA — only the `avtr_` ids are extracted; nothing else
/// from the file is surfaced. Gate the caller behind an explicit settings toggle
/// (default OFF); this module performs no gating itself.
class AvatarIdHarvest
{
public:
    /// Default location of the Amplitude cache: `%Temp%\VRChat\VRChat\amplitude.cache`.
    static std::filesystem::path DefaultCachePath();

    /// Scan a JSON-lines analytics cache file for unique `avtr_` ids, preserving
    /// first-seen order. Returns an empty vector if the file is missing or
    /// unreadable (never throws). Only id-shaped tokens are extracted.
    static std::vector<std::string> HarvestFromFile(const std::filesystem::path& cachePath);

    /// Convenience: harvest from `DefaultCachePath()`.
    static std::vector<std::string> Harvest();
};

} // namespace vrcsm::core
