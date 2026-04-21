cmake_minimum_required(VERSION 3.28)

cmake_policy(SET CMP0091 NEW)

file(READ "${CMAKE_SOURCE_DIR}/VERSION" VRCSM_VERSION_TEXT)
string(STRIP "${VRCSM_VERSION_TEXT}" VRCSM_VERSION_TEXT)

project(VRCSM VERSION ${VRCSM_VERSION_TEXT} LANGUAGES C CXX)

set(VRCSM_PRODUCT_VERSION
    "${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}.${PROJECT_VERSION_PATCH}.0")
set(VRCSM_FILE_VERSION
    "${PROJECT_VERSION_MAJOR},${PROJECT_VERSION_MINOR},${PROJECT_VERSION_PATCH},0")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    add_compile_options(/utf-8 /W4 /permissive- /Zc:__cplusplus /MP /EHsc)
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
    add_subdirectory(tools/dump_avatar_details)
    add_subdirectory(tools/dump_thumbnails)
    add_subdirectory(tools/dump_logs)
    add_subdirectory(tools/tail_probe)
    add_subdirectory(tools/test_extract)
endif()

# Configure GoogleTest options
option(INSTALL_GTEST "Enable installation of googletest. (Projects embedding googletest may want to turn this OFF.)" OFF)
enable_testing()
add_subdirectory(tests)
