find_package(WIL CONFIG REQUIRED)
find_package(unofficial-webview2 CONFIG REQUIRED)

add_executable(vrcsm WIN32
    main.cpp
    App.cpp
    MainWindow.cpp
    WebViewHost.cpp
    IpcBridge.cpp
    StringUtil.cpp
    VrchatPaths.cpp

    # Domain-specific IPC handler implementations (split from IpcBridge.cpp)
    bridges/AuthBridge.cpp
    bridges/ApiBridge.cpp
    bridges/CacheBridge.cpp
    bridges/HwBridge.cpp
    bridges/SettingsBridge.cpp
    bridges/MigrateBridge.cpp
    bridges/ScreenshotBridge.cpp
    bridges/ShellBridge.cpp
    bridges/LogsBridge.cpp
    bridges/RadarBridge.cpp
    bridges/DatabaseBridge.cpp
    bridges/PluginBridge.cpp
    bridges/UpdateBridge.cpp
)

set(VRCSM_GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
set(VRCSM_ICON_SOURCE_PATH "${CMAKE_SOURCE_DIR}/resources/icons/vrcsm.ico")
set(VRCSM_ICON_PATH "${VRCSM_GENERATED_DIR}/vrcsm.ico")
set(VRCSM_MANIFEST_PATH "${CMAKE_SOURCE_DIR}/resources/app.manifest")
# Legacy PyInstaller extractor resource retired in v0.5.1 — the in-process
# UnityFS → glTF pipeline (src/core/UnityPreview.cpp) replaces it.
file(MAKE_DIRECTORY "${VRCSM_GENERATED_DIR}")
configure_file(
    "${VRCSM_ICON_SOURCE_PATH}"
    "${VRCSM_ICON_PATH}"
    COPYONLY
)
configure_file(
    "${CMAKE_SOURCE_DIR}/resources/app.rc"
    "${VRCSM_GENERATED_DIR}/app.rc"
    @ONLY
)

target_link_libraries(vrcsm PRIVATE
    vrcsm_core
    vrcsm_core_hw
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
    WIL::WIL
    unofficial::webview2::webview2
    dwmapi
    shcore
    ole32
    shlwapi
    shell32
    user32
    advapi32
    version
)

target_sources(vrcsm PRIVATE
    ${VRCSM_GENERATED_DIR}/app.rc
)

target_compile_definitions(vrcsm PRIVATE
    VRCSM_VERSION_STRING="${PROJECT_VERSION}"
)

target_link_options(vrcsm PRIVATE /MANIFEST:NO)

set_target_properties(vrcsm PROPERTIES
    OUTPUT_NAME "VRCSM"
    WIN32_EXECUTABLE TRUE
)

# Post-build: sync web/dist → $<TARGET_FILE_DIR:vrcsm>/web so that running
# the dev build from the build directory picks up the latest React
# bundle without a manual `cp -r web/dist …` step. The indirection
# through sync-web-dist.cmake lets the copy gracefully no-op when
# web/dist does not yet exist on a fresh checkout.
add_custom_command(TARGET vrcsm POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DSOURCE=${CMAKE_SOURCE_DIR}/web/dist
        -DDEST=$<TARGET_FILE_DIR:vrcsm>/web
        -P ${CMAKE_SOURCE_DIR}/cmake/sync-web-dist.cmake
    COMMENT "Syncing web/dist to $<TARGET_FILE_DIR:vrcsm>/web"
    VERBATIM
)

add_custom_command(TARGET vrcsm POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${VRCSM_ICON_SOURCE_PATH}
        $<TARGET_FILE_DIR:vrcsm>/VRCSM.ico
    COMMENT "Syncing app icon to $<TARGET_FILE_DIR:vrcsm>/VRCSM.ico"
    VERBATIM
)

# Bundled plugins (shipped in the MSI and copied next to VRCSM.exe so the
# plugin loader discovers them on first run).
add_custom_command(TARGET vrcsm POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DSOURCE=${CMAKE_SOURCE_DIR}/plugins
        -DDEST=$<TARGET_FILE_DIR:vrcsm>/plugins
        -P ${CMAKE_SOURCE_DIR}/cmake/sync-plugins.cmake
    COMMENT "Syncing bundled plugins to $<TARGET_FILE_DIR:vrcsm>/plugins"
    VERBATIM
)

install(TARGETS vrcsm RUNTIME DESTINATION .)
