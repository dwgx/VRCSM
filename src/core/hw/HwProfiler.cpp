#include "HwProfiler.h"

#include <fmt/format.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cctype>
#include <limits>
#include <sstream>
#include <vector>

namespace vrcsm::core::hw
{

void to_json(nlohmann::json& j, const PresetRecommendation& recommendation)
{
    j = nlohmann::json{
        {"tier", recommendation.tier},
        {"score", recommendation.score},
        {"cpuScore", recommendation.cpuScore},
        {"gpuScore", recommendation.gpuScore},
        {"gpuVramMultiplier", recommendation.gpuVramMultiplier},
        {"ramBonus", recommendation.ramBonus},
        {"hmdProfileName", recommendation.hmdProfileName},
        {"targetBandwidth", recommendation.targetBandwidth},
        {"supersampleScale", recommendation.supersampleScale},
        {"preferredRefreshRate", recommendation.preferredRefreshRate},
        {"motionSmoothing", recommendation.motionSmoothing},
        {"allowFiltering", recommendation.allowFiltering},
        {"ffrLevel", recommendation.ffrLevel},
        {"rationale", recommendation.rationale},
    };
}

namespace
{

constexpr auto kGiB = 1024ULL * 1024ULL * 1024ULL;

const nlohmann::json& ProfileTable()
{
    static const nlohmann::json table = nlohmann::json::parse(R"json(
{
  "cpuScores": {"13900K": 95, "7800X3D": 92, "5800X3D": 85, "7950X": 93, "12700K": 80, "10700K": 70, "3700X": 55, "default": 50},
  "gpuScores": {"4090": 100, "4080": 85, "4070 Ti": 75, "4070": 65, "3090": 78, "3080": 70, "3070": 60, "3060": 45, "2080 Ti": 55, "2080": 45, "2070": 35, "default": 30},
  "gpuVramMultiplier": {"<=8": 0.85, "<=12": 1.0, "<=16": 1.08, "<=24": 1.15},
  "ramBonus": {"<=16": 0, "<=32": 5, ">32": 10},
  "hmdProfile": {
    "Quest 3": {"nativeWidth": 2064, "refreshRates": [72, 80, 90, 120], "maxBitrate": 200, "preferFFR": true},
    "Quest 2": {"nativeWidth": 1832, "refreshRates": [72, 80, 90, 120], "maxBitrate": 150, "preferFFR": true},
    "Quest Pro": {"nativeWidth": 1800, "refreshRates": [72, 90], "maxBitrate": 200, "preferFFR": true},
    "Valve Index": {"nativeWidth": 1440, "refreshRates": [80, 90, 120, 144], "maxBitrate": 0, "preferFFR": false},
    "Vive Pro 2": {"nativeWidth": 2448, "refreshRates": [90, 120], "maxBitrate": 0, "preferFFR": false},
    "default": {"nativeWidth": 1832, "refreshRates": [72, 90], "maxBitrate": 150, "preferFFR": false}
  },
  "presets": {
    "ultra":   {"minScore": 170, "targetBandwidth": 200, "supersampleScale": 1.5, "preferredRefreshRate": 120, "motionSmoothing": false, "allowFiltering": true, "ffrLevel": 1},
    "high":    {"minScore": 130, "targetBandwidth": 150, "supersampleScale": 1.2, "preferredRefreshRate": 90,  "motionSmoothing": false, "allowFiltering": true, "ffrLevel": 2},
    "balanced":{"minScore": 90,  "targetBandwidth": 100, "supersampleScale": 1.0, "preferredRefreshRate": 90,  "motionSmoothing": true,  "allowFiltering": true, "ffrLevel": 2},
    "low":     {"minScore": 0,   "targetBandwidth": 50,  "supersampleScale": 0.8, "preferredRefreshRate": 72,  "motionSmoothing": true,  "allowFiltering": true, "ffrLevel": 3}
  }
}
    )json");
    return table;
}

std::string ToLower(std::string_view text)
{
    std::string lowered;
    lowered.reserve(text.size());
    for (const unsigned char ch : text)
    {
        lowered.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lowered;
}

struct ScoreMatch
{
    std::string matchedKey{"default"};
    int score{0};
};

ScoreMatch MatchScore(std::string_view deviceName, const nlohmann::json& table)
{
    ScoreMatch best;
    best.score = table.value("default", 0);

    const auto loweredName = ToLower(deviceName);
    for (auto it = table.begin(); it != table.end(); ++it)
    {
        if (it.key() == "default" || !it.value().is_number_integer())
        {
            continue;
        }

        const auto loweredKey = ToLower(it.key());
        if (loweredName.find(loweredKey) == std::string::npos)
        {
            continue;
        }

        const int score = it.value().get<int>();
        if (score > best.score)
        {
            best.matchedKey = it.key();
            best.score = score;
        }
    }

    return best;
}

double ResolveVramMultiplier(std::uint64_t vramBytes)
{
    const auto& table = ProfileTable().at("gpuVramMultiplier");
    if (vramBytes == 0)
    {
        return 1.0;
    }

    struct Threshold
    {
        std::uint64_t bytes{0};
        double multiplier{1.0};
    };

    std::vector<Threshold> thresholds;
    for (auto it = table.begin(); it != table.end(); ++it)
    {
        const std::string key = it.key();
        if (key.size() < 3)
        {
            continue;
        }

        thresholds.push_back(Threshold{
            std::stoull(key.substr(2)) * kGiB,
            it.value().get<double>(),
        });
    }

    std::sort(thresholds.begin(), thresholds.end(), [](const Threshold& lhs, const Threshold& rhs)
    {
        return lhs.bytes < rhs.bytes;
    });

    for (const auto& threshold : thresholds)
    {
        if (vramBytes <= threshold.bytes)
        {
            return threshold.multiplier;
        }
    }

    return thresholds.empty() ? 1.0 : thresholds.back().multiplier;
}

int ResolveRamBonus(std::uint64_t ramBytes)
{
    const auto& table = ProfileTable().at("ramBonus");
    if (ramBytes <= 16ULL * kGiB)
    {
        return table.at("<=16").get<int>();
    }
    if (ramBytes <= 32ULL * kGiB)
    {
        return table.at("<=32").get<int>();
    }
    return table.at(">32").get<int>();
}

std::string MatchHmdProfileName(std::string_view hmdModel)
{
    const auto& table = ProfileTable().at("hmdProfile");
    const auto loweredModel = ToLower(hmdModel);

    std::string best = "default";
    std::size_t bestLength = 0;
    for (auto it = table.begin(); it != table.end(); ++it)
    {
        if (it.key() == "default")
        {
            continue;
        }

        const auto loweredKey = ToLower(it.key());
        if (loweredModel.find(loweredKey) != std::string::npos && loweredKey.size() > bestLength)
        {
            best = it.key();
            bestLength = loweredKey.size();
        }
    }

    return best;
}

int ClampRefreshRate(int requestedRate, const nlohmann::json& hmdProfile)
{
    if (!hmdProfile.contains("refreshRates") || !hmdProfile["refreshRates"].is_array())
    {
        return requestedRate;
    }

    int bestBelowOrEqual = 0;
    int lowest = std::numeric_limits<int>::max();
    for (const auto& entry : hmdProfile["refreshRates"])
    {
        if (!entry.is_number_integer())
        {
            continue;
        }
        const int rate = entry.get<int>();
        lowest = std::min(lowest, rate);
        if (rate == requestedRate)
        {
            return rate;
        }
        if (rate <= requestedRate && rate > bestBelowOrEqual)
        {
            bestBelowOrEqual = rate;
        }
    }

    if (bestBelowOrEqual != 0)
    {
        return bestBelowOrEqual;
    }
    return lowest == std::numeric_limits<int>::max() ? requestedRate : lowest;
}

std::string BuildRationale(const HwReport& report,
                           const std::string& cpuMatch,
                           const std::string& gpuMatch,
                           const PresetRecommendation& recommendation)
{
    std::ostringstream rationale;
    rationale << "CPU '" << (report.cpuName.empty() ? "unknown" : report.cpuName) << "' matched "
              << cpuMatch << " (" << recommendation.cpuScore << "), GPU '"
              << (report.gpuName.empty() ? "unknown" : report.gpuName) << "' matched "
              << gpuMatch << " (" << recommendation.gpuScore << ") with VRAM multiplier "
              << fmt::format("{:.2f}", recommendation.gpuVramMultiplier)
              << " and RAM bonus " << recommendation.ramBonus << ". "
              << "Selected '" << recommendation.tier << "' for HMD profile '"
              << recommendation.hmdProfileName << "'.";
    return rationale.str();
}

Result<PresetRecommendation> BuildRecommendation(std::string_view forcedTier,
                                                 const HwReport& report)
{
    try
    {
        const auto& table = ProfileTable();
        const auto cpuMatch = MatchScore(report.cpuName, table.at("cpuScores"));
        const auto gpuMatch = MatchScore(report.gpuName, table.at("gpuScores"));
        const double gpuVramMultiplier = ResolveVramMultiplier(report.gpuVramBytes);
        const int ramBonus = ResolveRamBonus(report.ramBytes);
        const int score = cpuMatch.score
            + static_cast<int>(std::lround(static_cast<double>(gpuMatch.score) * gpuVramMultiplier))
            + ramBonus;

        std::string tier;
        if (!forcedTier.empty())
        {
            tier = ToLower(forcedTier);
            if (!table.at("presets").contains(tier))
            {
                return Error{"hw_profile_invalid_tier", fmt::format("Unknown preset tier '{}'", tier), 0};
            }
        }
        else
        {
            const std::array<std::string_view, 4> tiers{"ultra", "high", "balanced", "low"};
            for (const auto candidate : tiers)
            {
                const auto& preset = table.at("presets").at(std::string(candidate));
                if (score >= preset.at("minScore").get<int>())
                {
                    tier = std::string(candidate);
                    break;
                }
            }
        }

        const std::string hmdProfileName = MatchHmdProfileName(report.hmdModel);
        const auto& hmdProfile = table.at("hmdProfile").at(hmdProfileName);
        const auto& preset = table.at("presets").at(tier);

        PresetRecommendation recommendation;
        recommendation.tier = tier;
        recommendation.score = score;
        recommendation.cpuScore = cpuMatch.score;
        recommendation.gpuScore = gpuMatch.score;
        recommendation.gpuVramMultiplier = gpuVramMultiplier;
        recommendation.ramBonus = ramBonus;
        recommendation.hmdProfileName = hmdProfileName;
        recommendation.targetBandwidth = preset.at("targetBandwidth").get<int>();
        const int maxBitrate = hmdProfile.value("maxBitrate", 0);
        if (maxBitrate > 0)
        {
            recommendation.targetBandwidth = std::min(recommendation.targetBandwidth, maxBitrate);
        }
        recommendation.supersampleScale = preset.at("supersampleScale").get<double>();
        recommendation.preferredRefreshRate = ClampRefreshRate(
            preset.at("preferredRefreshRate").get<int>(),
            hmdProfile);
        recommendation.motionSmoothing = preset.at("motionSmoothing").get<bool>();
        recommendation.allowFiltering = preset.at("allowFiltering").get<bool>();
        recommendation.ffrLevel = hmdProfile.value("preferFFR", false)
            ? preset.at("ffrLevel").get<int>()
            : 0;
        recommendation.rationale = BuildRationale(report, cpuMatch.matchedKey, gpuMatch.matchedKey, recommendation);

        return recommendation;
    }
    catch (const std::exception& ex)
    {
        return Error{"hw_profile_failed", ex.what(), 0};
    }
}

} // namespace

Result<PresetRecommendation> Recommend(const HwReport& report)
{
    return BuildRecommendation({}, report);
}

Result<PresetRecommendation> PresetForTier(std::string_view tier, const HwReport& report)
{
    return BuildRecommendation(tier, report);
}

} // namespace vrcsm::core::hw
