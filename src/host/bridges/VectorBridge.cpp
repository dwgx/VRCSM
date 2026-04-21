#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"

namespace
{

// Parse an IPC-supplied vector: JSON array of numbers → std::vector<float>.
// Rejects anything that isn't an array of finite numbers. Size isn't
// constrained here; Database layer validates against the expected
// model dimensionality.
std::vector<float> ParseEmbedding(const nlohmann::json& params, const char* key)
{
    if (!params.is_object() || !params.contains(key) || !params[key].is_array())
    {
        throw IpcException(vrcsm::core::Error{
            "bad_request",
            fmt::format("'{}' must be an array of numbers", key),
            0});
    }
    const auto& arr = params[key];
    std::vector<float> out;
    out.reserve(arr.size());
    for (const auto& v : arr)
    {
        if (!v.is_number())
        {
            throw IpcException(vrcsm::core::Error{
                "bad_request",
                fmt::format("'{}' contains a non-numeric element", key),
                0});
        }
        out.push_back(v.get<float>());
    }
    return out;
}

} // namespace

nlohmann::json IpcBridge::HandleVectorUpsertEmbedding(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto avatarId = JsonStringField(params, "avatar_id").value_or("");
    const auto modelVersion = JsonStringField(params, "model_version").value_or("");
    if (avatarId.empty())
    {
        throw IpcException(vrcsm::core::Error{"bad_request", "'avatar_id' is required", 0});
    }
    if (modelVersion.empty())
    {
        throw IpcException(vrcsm::core::Error{"bad_request", "'model_version' is required", 0});
    }

    vrcsm::core::Database::AvatarEmbeddingInsert ins;
    ins.avatar_id = avatarId;
    ins.model_version = modelVersion;
    ins.embedding = ParseEmbedding(params, "embedding");

    auto result = vrcsm::core::Database::Instance().UpsertAvatarEmbedding(ins);
    if (vrcsm::core::isOk(result))
    {
        return nlohmann::json{{"ok", true}};
    }
    throw IpcException(vrcsm::core::error(result));
}

nlohmann::json IpcBridge::HandleVectorSearch(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto query = ParseEmbedding(params, "embedding");
    int k = ParamInt(params, "k", 25);
    if (k < 1) k = 1;
    if (k > 200) k = 200;

    auto result = vrcsm::core::Database::Instance().SearchAvatarEmbeddings(query, k);
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(vrcsm::core::error(result));
    }

    const auto& matches = vrcsm::core::value(result);
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& m : matches)
    {
        arr.push_back({
            {"avatar_id", m.avatar_id},
            {"distance", m.distance},
        });
    }
    return nlohmann::json{{"matches", std::move(arr)}};
}

nlohmann::json IpcBridge::HandleVectorGetUnindexed(const nlohmann::json& params, const std::optional<std::string>&)
{
    (void)params;
    auto result = vrcsm::core::Database::Instance().GetUnindexedAvatarIds();
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(vrcsm::core::error(result));
    }
    return nlohmann::json{{"avatar_ids", vrcsm::core::value(result)}};
}

nlohmann::json IpcBridge::HandleVectorRemoveEmbedding(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto avatarId = JsonStringField(params, "avatar_id").value_or("");
    if (avatarId.empty())
    {
        throw IpcException(vrcsm::core::Error{"bad_request", "'avatar_id' is required", 0});
    }
    auto result = vrcsm::core::Database::Instance().DeleteAvatarEmbedding(avatarId);
    if (vrcsm::core::isOk(result))
    {
        return nlohmann::json{{"ok", true}};
    }
    throw IpcException(vrcsm::core::error(result));
}
