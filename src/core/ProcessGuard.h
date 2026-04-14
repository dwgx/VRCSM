#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct ProcessStatus
{
    bool running = false;
    std::optional<std::uint32_t> pid;
};

void to_json(nlohmann::json& j, const ProcessStatus& s);

class ProcessGuard
{
public:
    static ProcessStatus IsVRChatRunning();

    static ProcessStatus checkProcess(const std::wstring& exeName);
};

} // namespace vrcsm::core
