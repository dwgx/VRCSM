#pragma once

#include "../pch.h"

std::wstring Utf8ToWide(std::string_view text);
std::string WideToUtf8(std::wstring_view text);
