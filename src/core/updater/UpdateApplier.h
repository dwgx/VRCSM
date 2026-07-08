#pragma once

#include "../Common.h"

#include <filesystem>
#include <string>

namespace vrcsm::core::updater
{

// Builds the command line for the detached `cmd.exe` bootstrap that applies an
// MSI update. The bootstrap waits for the current VRCSM process to fully exit
// (so it releases the file locks on VRCSM.exe and its loaded DLLs), then runs
// msiexec for an in-place major upgrade, then relaunches the freshly installed
// VRCSM.exe. Extracted as a pure function so the exact structure/ordering can
// be locked by a unit test without spawning msiexec.
//
// `relaunchExePath` may be empty, in which case the bootstrap installs the MSI
// but does not relaunch. All three paths are wrapped in double quotes.
std::wstring BuildInstallCommandLine(
    const std::wstring& msiexecPath,
    const std::wstring& msiPath,
    const std::wstring& relaunchExePath);

class UpdateApplier
{
public:
    static Result<std::monostate> Apply(const std::filesystem::path& msiPath);
    static void QuitCurrentProcess();
};

} // namespace vrcsm::core::updater
