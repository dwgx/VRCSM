cmake_minimum_required(VERSION 3.28)

cmake_policy(SET CMP0091 NEW)

project(VRCSM VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    add_compile_options(/utf-8 /W4 /permissive- /Zc:__cplusplus /MP)
    add_compile_definitions(
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
    )
endif()

find_package(nlohmann_json CONFIG REQUIRED)
find_package(fmt CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)

add_subdirectory(src)

option(VRCSM_BUILD_TOOLS "Build auxiliary diagnostic tools" ON)
if(VRCSM_BUILD_TOOLS)
    add_subdirectory(tools/dump_settings)
    add_subdirectory(tools/dump_thumbnails)
    add_subdirectory(tools/dump_logs)
    add_subdirectory(tools/tail_probe)
endif()

# tests/ will be added to the build later.
