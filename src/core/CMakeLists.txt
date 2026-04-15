add_library(vrcsm_core STATIC
    Common.cpp
    PathProbe.cpp
    CacheScanner.cpp
    BundleSniff.cpp
    LogParser.cpp
    LogTailer.cpp
    AvatarData.cpp
    JunctionUtil.cpp
    ProcessGuard.cpp
    SafeDelete.cpp
    Migrator.cpp
    VrcConfig.cpp
    VrcSettings.cpp
    VrcApi.cpp
    Report.cpp
)

target_include_directories(vrcsm_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

target_link_libraries(vrcsm_core PUBLIC
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
)

if(MSVC)
    target_compile_definitions(vrcsm_core PUBLIC
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
    )
    target_link_libraries(vrcsm_core PUBLIC
        Shlwapi
        Advapi32
        Ole32
        Shell32
        Version
        Winhttp
    )
endif()

set_target_properties(vrcsm_core PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
