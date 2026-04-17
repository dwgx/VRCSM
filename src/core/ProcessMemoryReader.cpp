#include "ProcessMemoryReader.h"
#include <tlhelp32.h>
#include <psapi.h>
#include <iostream>

namespace vrcsm::core {

ProcessMemoryReader::ProcessMemoryReader(const std::wstring& processName)
    : processName_(processName), processId_(0), hProcess_(nullptr) {
}

ProcessMemoryReader::~ProcessMemoryReader() {
    Detach();
}

bool ProcessMemoryReader::Attach() {
    if (IsAttached()) {
        return true;
    }

    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE) {
        return false;
    }

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(PROCESSENTRY32W);

    if (Process32FirstW(hSnapshot, &pe)) {
        do {
            if (processName_ == pe.szExeFile) {
                processId_ = pe.th32ProcessID;
                break;
            }
        } while (Process32NextW(hSnapshot, &pe));
    }

    CloseHandle(hSnapshot);

    if (processId_ == 0) {
        return false;
    }

    // Open process with minimal rights for reading memory to minimize AV/Anti-cheat flags
    hProcess_ = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE, processId_);
    return hProcess_ != nullptr;
}

void ProcessMemoryReader::Detach() {
    if (hProcess_) {
        CloseHandle(hProcess_);
        hProcess_ = nullptr;
    }
    processId_ = 0;
}

uintptr_t ProcessMemoryReader::GetModuleBase(const std::wstring& moduleName) const {
    if (!IsAttached()) return 0;

    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, processId_);
    if (hSnapshot == INVALID_HANDLE_VALUE) return 0;

    MODULEENTRY32W me;
    me.dwSize = sizeof(MODULEENTRY32W);
    uintptr_t baseAddress = 0;

    if (Module32FirstW(hSnapshot, &me)) {
        do {
            if (moduleName == me.szModule) {
                baseAddress = reinterpret_cast<uintptr_t>(me.modBaseAddr);
                break;
            }
        } while (Module32NextW(hSnapshot, &me));
    }

    CloseHandle(hSnapshot);
    return baseAddress;
}

bool ProcessMemoryReader::ReadMemory(uintptr_t address, void* buffer, size_t size) const {
    if (!IsAttached() || address == 0 || buffer == nullptr || size == 0) return false;

    SIZE_T bytesRead = 0;
    return ReadProcessMemory(hProcess_, reinterpret_cast<LPCVOID>(address), buffer, size, &bytesRead) && bytesRead == size;
}

std::optional<uintptr_t> ProcessMemoryReader::ReadPointer(uintptr_t address) const {
    return Read<uintptr_t>(address);
}

std::optional<uintptr_t> ProcessMemoryReader::ReadPointerChain(uintptr_t baseAddress, const std::vector<uintptr_t>& offsets) const {
    if (offsets.empty()) return baseAddress;

    uintptr_t currentAddress = baseAddress;
    for (size_t i = 0; i < offsets.size(); ++i) {
        auto val = Read<uintptr_t>(currentAddress + offsets[i]);
        if (!val) return std::nullopt;
        currentAddress = *val;
    }
    return currentAddress;
}

std::string ProcessMemoryReader::ReadString(uintptr_t address, size_t maxLength) const {
    if (!IsAttached() || address == 0) return "";

    std::string result;
    result.reserve(32);
    char buffer[256];
    size_t offset = 0;

    while (offset < maxLength) {
        size_t readSize = std::min<size_t>(sizeof(buffer), maxLength - offset);
        SIZE_T bytesRead = 0;
        
        if (!ReadProcessMemory(hProcess_, reinterpret_cast<LPCVOID>(address + offset), buffer, readSize, &bytesRead)) {
            break;
        }

        for (size_t i = 0; i < bytesRead; ++i) {
            if (buffer[i] == '\0') {
                return result;
            }
            result += buffer[i];
        }
        offset += bytesRead;
    }

    return result;
}

} // namespace vrcsm::core
