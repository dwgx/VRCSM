find_package(WIL CONFIG REQUIRED)
find_package(unofficial-webview2 CONFIG REQUIRED)

add_executable(vrcsm WIN32
    main.cpp
    App.cpp
    MainWindow.cpp
    WebViewHost.cpp
    IpcBridge.cpp
    AuthLoginWindow.cpp
    StringUtil.cpp
)

target_link_libraries(vrcsm PRIVATE
    vrcsm_core
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
    ${CMAKE_SOURCE_DIR}/resources/app.rc
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

install(TARGETS vrcsm RUNTIME DESTINATION .)
