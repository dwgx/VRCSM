#pragma once

#include "../Common.h"

#include <filesystem>

namespace vrcsm::core::updater
{

class UpdateApplier
{
public:
    static Result<std::monostate> Apply(const std::filesystem::path& msiPath);
    static void QuitCurrentProcess();
};

} // namespace vrcsm::core::updater
