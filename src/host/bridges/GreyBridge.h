#pragma once

#include "../../core/GreyPrefs.h"

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

class IpcBridge;

void GreyBindBridge(IpcBridge* bridge);
void GreyShutdownWorkers();
void GreyOnPrefsChanged(const vrcsm::core::GreyPrefs& prefs);
void GreyHandlePipeline(IpcBridge* bridge, const std::string& type, const nlohmann::json& content);
void GreyHandleFriendsSnapshot(const std::vector<std::string>& userIds);
void GreyHandleSelfUser(const std::string& userId);
void GreyDeleteImapSecret();
