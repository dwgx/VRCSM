#pragma once

#include <windows.h>
#include <string>
#include <vector>
#include <memory>
#include <optional>

namespace vrcsm::core {

class ProcessMemoryReader {
public:
    ProcessMemoryReader(const std::wstring& processName);
    ~ProcessMemoryReader();

    // Disable copy and assignment
    ProcessMemoryReader(const ProcessMemoryReader&) = delete;
    ProcessMemoryReader& operator=(const ProcessMemoryReader&) = delete;

    bool Attach();
    void Detach();
    bool IsAttached() const { return hProcess_ != nullptr; }

    uintptr_t GetModuleBase(const std::wstring& moduleName) const;

    // Read generic memory into a buffer
    bool ReadMemory(uintptr_t address, void* buffer, size_t size) const;

    // Template helper to read specific types safely
    template <typename T>
    std::optional<T> Read(uintptr_t address) const {
        T value;
        if (ReadMemory(address, &value, sizeof(T))) {
            return value;
        }
        return std::nullopt;
    }

    // Read a pointer at the address
    std::optional<uintptr_t> ReadPointer(uintptr_t address) const;

    // Follow a chain of pointers (e.g., base + offset1 -> ptr + offset2 -> ptr2)
    std::optional<uintptr_t> ReadPointerChain(uintptr_t baseAddress, const std::vector<uintptr_t>& offsets) const;

    // Read a null-terminated UTF-8 string at the address
    std::string ReadString(uintptr_t address, size_t maxLength = 256) const;

private:
    std::wstring processName_;
    DWORD processId_;
    HANDLE hProcess_;
};

} // namespace vrcsm::core
