#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/SteamVrConfig.h"
#include "../../core/hw/HwDetector.h"
#include "../../core/hw/HwProfileFeed.h"
#include "../../core/hw/HwProfiler.h"

namespace
{

nlohmann::json HwReportToJson(const vrcsm::core::hw::HwReport& report)
{
    return nlohmann::json{
        {"cpu_name", report.cpuName},
        {"cpu_cores", report.cpuCores},
        {"cpu_threads", report.cpuThreads},
        {"cpu_clock_mhz", report.cpuClockMhz},
        {"gpu_name", report.gpuName},
        {"gpu_vram_bytes", report.gpuVramBytes},
        {"gpu_driver", report.gpuDriver},
        {"ram_bytes", report.ramBytes},
        {"hmd_model", report.hmdModel},
        {"hmd_manufacturer", report.hmdManufacturer},
        {"os_build", report.osBuild},
    };
}

nlohmann::json RecommendationToJson(const vrcsm::core::hw::PresetRecommendation& recommendation)
{
    return nlohmann::json{
        {"tier", recommendation.tier},
        {"score", recommendation.score},
        {"cpu_score", recommendation.cpuScore},
        {"gpu_score", recommendation.gpuScore},
        {"gpu_vram_multiplier", recommendation.gpuVramMultiplier},
        {"ram_bonus", recommendation.ramBonus},
        {"hmd_profile_name", recommendation.hmdProfileName},
        {"target_bandwidth", recommendation.targetBandwidth},
        {"supersample_scale", recommendation.supersampleScale},
        {"preferred_refresh_rate", recommendation.preferredRefreshRate},
        {"motion_smoothing", recommendation.motionSmoothing},
        {"allow_filtering", recommendation.allowFiltering},
        {"ffr_level", recommendation.ffrLevel},
        {"rationale", recommendation.rationale},
    };
}

vrcsm::core::hw::HwReport UnwrapReport(vrcsm::core::Result<vrcsm::core::hw::HwReport>&& result)
{
    if (vrcsm::core::isOk(result))
    {
        return std::get<vrcsm::core::hw::HwReport>(std::move(result));
    }
    throw IpcException(std::get<vrcsm::core::Error>(std::move(result)));
}

vrcsm::core::hw::PresetRecommendation UnwrapRecommendation(vrcsm::core::Result<vrcsm::core::hw::PresetRecommendation>&& result)
{
    if (vrcsm::core::isOk(result))
    {
        return std::get<vrcsm::core::hw::PresetRecommendation>(std::move(result));
    }
    throw IpcException(std::get<vrcsm::core::Error>(std::move(result)));
}

std::string TierParam(const nlohmann::json& params)
{
    if (!params.is_object() || !params.contains("tier") || !params["tier"].is_string())
    {
        throw IpcException(vrcsm::core::Error{"missing_param", "hw.applyPreset requires string field 'tier'", 0});
    }
    return params["tier"].get<std::string>();
}

} // namespace

nlohmann::json IpcBridge::HandleHwApplyPreset(const nlohmann::json& params, const std::optional<std::string>&)
{
    try
    {
        const auto path = vrcsm::core::SteamVrConfig::DetectVrSettingsPath();
        if (!path)
        {
            throw IpcException(vrcsm::core::Error{"not_found", "steamvr.vrsettings not found", 0});
        }

        const auto report = UnwrapReport(vrcsm::core::hw::Detect());
        const auto recommendation = UnwrapRecommendation(
            vrcsm::core::hw::PresetForTier(TierParam(params), report));

        nlohmann::json applied{
            {"driver_vrlink", {
                {"targetBandwidth", recommendation.targetBandwidth},
                {"automaticBandwidth", recommendation.targetBandwidth <= 100},
                {"ffrLevel", recommendation.ffrLevel},
            }},
            {"steamvr", {
                {"supersampleScale", recommendation.supersampleScale},
                {"preferredRefreshRate", recommendation.preferredRefreshRate},
                {"motionSmoothing", recommendation.motionSmoothing},
                {"allowSupersampleFiltering", recommendation.allowFiltering},
                {"supersampleManualOverride", true},
            }},
        };

        const auto writeResult = vrcsm::core::SteamVrConfig::Write(*path, applied);
        if (writeResult.contains("error"))
        {
            const auto& err = writeResult["error"];
            throw IpcException(vrcsm::core::Error{
                err.value("code", "steamvr_write_failed"),
                err.value("message", "Failed to write steamvr.vrsettings"),
                0});
        }

        return nlohmann::json{
            {"ok", true},
            {"applied", std::move(applied)},
        };
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        throw IpcException(vrcsm::core::Error{"hw_apply_failed", ex.what(), 0});
    }
    catch (...)
    {
        throw IpcException(vrcsm::core::Error{"hw_apply_failed", "Unknown hardware preset apply failure", 0});
    }
}

nlohmann::json IpcBridge::HandleHwDetect(const nlohmann::json&, const std::optional<std::string>&)
{
    try
    {
        return HwReportToJson(UnwrapReport(vrcsm::core::hw::Detect()));
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        throw IpcException(vrcsm::core::Error{"hw_detect_failed", ex.what(), 0});
    }
    catch (...)
    {
        throw IpcException(vrcsm::core::Error{"hw_detect_failed", "Unknown hardware detection failure", 0});
    }
}

nlohmann::json IpcBridge::HandleHwRecommend(const nlohmann::json&, const std::optional<std::string>&)
{
    try
    {
        const auto report = UnwrapReport(vrcsm::core::hw::Detect());
        const auto baseRecommendation = UnwrapRecommendation(vrcsm::core::hw::Recommend(report));

        nlohmann::json result{
            {"report", HwReportToJson(report)},
            {"recommendation", RecommendationToJson(baseRecommendation)},
        };

        auto communityResult = vrcsm::core::hw::HwProfileFeed::Instance().FetchCommunityProfile(report);
        if (vrcsm::core::isOk(communityResult))
        {
            const auto& community = std::get<std::optional<vrcsm::core::hw::PresetRecommendation>>(communityResult);
            if (community.has_value())
            {
                result["community"] = RecommendationToJson(*community);
                result["recommendation"] = RecommendationToJson(*community);
            }
        }

        return result;
    }
    catch (const IpcException&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        throw IpcException(vrcsm::core::Error{"hw_recommend_failed", ex.what(), 0});
    }
    catch (...)
    {
        throw IpcException(vrcsm::core::Error{"hw_recommend_failed", "Unknown hardware recommendation failure", 0});
    }
}
