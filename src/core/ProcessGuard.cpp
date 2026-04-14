#include "ProcessGuard.h"

#include <algorithm>
#include <cwctype>

#include <Windows.h>
#include <TlHelp32.h>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const ProcessStatus& s)
{
    j = nlohmann::json{
        {"running", s.running},
        {"pid", s.pid ? nlohmann::json(*s.pid) : nlohmann::json(nullptr)},
    };
}

namespace
{
bool iequalsW(const std::wstring& a, const std::wstring& b)
{
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i)
    {
        if (std::towlower(a[i]) != std::towlower(b[i])) return false;
    }
    return true;
}
} // namespace

ProcessStatus ProcessGuard::checkProcess(const std::wstring& exeName)
{
    ProcessStatus status;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return status;

    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snap, &entry))
    {
        do
        {
            if (iequalsW(entry.szExeFile, exeName))
            {
                status.running = true;
                status.pid = static_cast<std::uint32_t>(entry.th32ProcessID);
                break;
            }
        } while (Process32NextW(snap, &entry));
    }
    CloseHandle(snap);
    return status;
}

ProcessStatus ProcessGuard::IsVRChatRunning()
{
    auto status = checkProcess(L"VRChat.exe");
    if (status.running) return status;
    return checkProcess(L"VRChat-Win64-Shipping.exe");
}

} // namespace vrcsm::core
