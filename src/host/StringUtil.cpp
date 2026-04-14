#include "../pch.h"

#include "StringUtil.h"

std::wstring Utf8ToWide(std::string_view text)
{
    if (text.empty())
    {
        return {};
    }

    const int required = MultiByteToWideChar(
        CP_UTF8,
        MB_ERR_INVALID_CHARS,
        text.data(),
        static_cast<int>(text.size()),
        nullptr,
        0);
    if (required <= 0)
    {
        throw std::runtime_error("MultiByteToWideChar failed");
    }

    std::wstring result(static_cast<size_t>(required), L'\0');
    const int converted = MultiByteToWideChar(
        CP_UTF8,
        MB_ERR_INVALID_CHARS,
        text.data(),
        static_cast<int>(text.size()),
        result.data(),
        required);
    if (converted != required)
    {
        throw std::runtime_error("MultiByteToWideChar conversion failed");
    }

    return result;
}

std::string WideToUtf8(std::wstring_view text)
{
    if (text.empty())
    {
        return {};
    }

    const int required = WideCharToMultiByte(
        CP_UTF8,
        WC_ERR_INVALID_CHARS,
        text.data(),
        static_cast<int>(text.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (required <= 0)
    {
        throw std::runtime_error("WideCharToMultiByte failed");
    }

    std::string result(static_cast<size_t>(required), '\0');
    const int converted = WideCharToMultiByte(
        CP_UTF8,
        WC_ERR_INVALID_CHARS,
        text.data(),
        static_cast<int>(text.size()),
        result.data(),
        required,
        nullptr,
        nullptr);
    if (converted != required)
    {
        throw std::runtime_error("WideCharToMultiByte conversion failed");
    }

    return result;
}
