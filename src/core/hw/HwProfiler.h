#pragma once

#include "HwDetector.h"

#include "../Common.h"

#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace vrcsm::core::hw
{

struct PresetRecommendation
{
    std::string tier;
    int score{0};
    int cpuScore{0};
    int gpuScore{0};
    double gpuVramMultiplier{1.0};
    int ramBonus{0};
    std::string hmdProfileName;
    int targetBandwidth{0};
    double supersampleScale{1.0};
    int preferredRefreshRate{72};
    bool motionSmoothing{true};
    bool allowFiltering{true};
    int ffrLevel{0};
    std::string rationale;
};

void to_json(nlohmann::json& j, const PresetRecommendation& recommendation);

Result<PresetRecommendation> Recommend(const HwReport& report);
Result<PresetRecommendation> PresetForTier(std::string_view tier, const HwReport& report);

} // namespace vrcsm::core::hw
