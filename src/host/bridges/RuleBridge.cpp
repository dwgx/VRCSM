#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"

nlohmann::json IpcBridge::HandleRulesList(const nlohmann::json&, const std::optional<std::string>&)
{
    return unwrapResult(vrcsm::core::Database::Instance().ListRules());
}

nlohmann::json IpcBridge::HandleRulesGet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "id", 0);
    if (id <= 0) throw IpcException({"missing_field", "rules.get: missing 'id'", 400});
    return unwrapResult(vrcsm::core::Database::Instance().GetRule(id));
}

nlohmann::json IpcBridge::HandleRulesCreate(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto name = JsonStringField(params, "name");
    const auto dslYaml = JsonStringField(params, "dsl_yaml");
    if (!name.has_value() || name->empty())
        throw IpcException({"missing_field", "rules.create: missing 'name'", 400});
    if (!dslYaml.has_value() || dslYaml->empty())
        throw IpcException({"missing_field", "rules.create: missing 'dsl_yaml'", 400});

    vrcsm::core::Database::RuleInsert r;
    r.name = *name;
    r.dsl_yaml = *dslYaml;
    if (params.contains("description") && params["description"].is_string())
        r.description = params["description"].get<std::string>();
    r.cooldown_seconds = ParamInt(params, "cooldown_seconds", 5);

    return unwrapResult(vrcsm::core::Database::Instance().InsertRule(r));
}

nlohmann::json IpcBridge::HandleRulesUpdate(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "id", 0);
    if (id <= 0) throw IpcException({"missing_field", "rules.update: missing 'id'", 400});
    return unwrapResult(vrcsm::core::Database::Instance().UpdateRule(id, params));
}

nlohmann::json IpcBridge::HandleRulesDelete(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "id", 0);
    if (id <= 0) throw IpcException({"missing_field", "rules.delete: missing 'id'", 400});
    const auto r = vrcsm::core::Database::Instance().DeleteRule(id);
    if (std::holds_alternative<vrcsm::core::Error>(r))
        throw IpcException(std::get<vrcsm::core::Error>(r));
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleRulesSetEnabled(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "id", 0);
    if (id <= 0) throw IpcException({"missing_field", "rules.setEnabled: missing 'id'", 400});
    const bool enabled = params.contains("enabled") && params["enabled"].is_boolean()
        ? params["enabled"].get<bool>() : true;
    const auto r = vrcsm::core::Database::Instance().SetRuleEnabled(id, enabled);
    if (std::holds_alternative<vrcsm::core::Error>(r))
        throw IpcException(std::get<vrcsm::core::Error>(r));
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleRulesHistory(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t ruleId = ParamInt(params, "rule_id", 0);
    if (ruleId <= 0) throw IpcException({"missing_field", "rules.history: missing 'rule_id'", 400});
    return unwrapResult(vrcsm::core::Database::Instance().RuleFiringHistory(ruleId));
}
