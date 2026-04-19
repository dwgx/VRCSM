find_package(WIL CONFIG REQUIRED)

add_library(vrcsm_core_hw STATIC
    HwDetector.cpp
    HwProfiler.cpp
    HwProfileFeed.cpp
)

target_include_directories(vrcsm_core_hw PUBLIC
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/core
)

target_link_libraries(vrcsm_core_hw PUBLIC
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
    WIL::WIL
)

if(MSVC)
    target_compile_definitions(vrcsm_core_hw PUBLIC
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
    )
    target_link_libraries(vrcsm_core_hw PUBLIC
        wbemuuid.lib
        oleaut32.lib
        ole32.lib
        winhttp.lib
        advapi32.lib
    )
endif()

set_target_properties(vrcsm_core_hw PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
