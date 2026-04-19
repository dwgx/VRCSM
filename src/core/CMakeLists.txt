add_library(vrcsm_core STATIC
    Common.cpp
    AuthStore.cpp
    PathProbe.cpp
    CacheIndex.cpp
    CacheScanner.cpp
    BundleSniff.cpp
    Database.cpp
    LogParser.cpp
    LogTailer.cpp
    LogEventClassifier.cpp
    AvatarData.cpp
    AvatarPreview.cpp
    JunctionUtil.cpp
    ProcessGuard.cpp
    SafeDelete.cpp
    Migrator.cpp
    VrcConfig.cpp
    SteamVrConfig.cpp
    ProcessMemoryReader.cpp
    VrcRadarEngine.cpp
    VrcSettings.cpp
    TaskQueue.cpp
    RateLimiter.cpp
    VrcApi.cpp
    Report.cpp
    UnityBundle.cpp
    UnitySerialized.cpp
    UnityMesh.cpp
    UnityPreview.cpp

    # v0.8.0 plugin system — manifest, store, installer, registry, feed.
    # PluginProcess (service/app shape) lives in its own file and
    # lands with the AutoUploader port in v0.9.0 (Phase B).
    plugins/PluginManifest.cpp
    plugins/PluginStore.cpp
    plugins/PluginInstaller.cpp
    plugins/PluginRegistry.cpp
    plugins/PluginFeed.cpp
)

add_subdirectory(updater)
add_subdirectory(hw)

target_include_directories(vrcsm_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

find_package(unofficial-sqlite3 CONFIG REQUIRED)
find_package(lz4 CONFIG REQUIRED)
find_package(LibLZMA REQUIRED)

target_link_libraries(vrcsm_core PUBLIC
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
    unofficial::sqlite3::sqlite3
    lz4::lz4
    LibLZMA::LibLZMA
    vrcsm_core_updater
    vrcsm_core_hw
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
        Crypt32
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
