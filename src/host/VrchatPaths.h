#pragma once

#include "../pch.h"

#include <filesystem>
#include <vector>

std::vector<std::filesystem::path> EnumerateVrchatScreenshotRoots();

std::filesystem::path DetectPrimaryVrchatScreenshotRoot();
