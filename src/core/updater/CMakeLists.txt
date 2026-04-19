add_library(vrcsm_core_updater STATIC
    UpdateChecker.cpp
    UpdateDownloader.cpp
    UpdateApplier.cpp
    UpdateState.cpp
)

target_include_directories(vrcsm_core_updater PUBLIC
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/core
)

target_link_libraries(vrcsm_core_updater PUBLIC
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
)

if(MSVC)
    target_compile_definitions(vrcsm_core_updater PUBLIC
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
        VRCSM_VERSION_STRING="${PROJECT_VERSION}"
    )
    target_link_libraries(vrcsm_core_updater PUBLIC
        winhttp.lib
        bcrypt.lib
    )
endif()

set_target_properties(vrcsm_core_updater PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
