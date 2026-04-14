find_package(WIL CONFIG REQUIRED)
find_package(unofficial-webview2 CONFIG REQUIRED)

add_executable(vrcsm WIN32
    main.cpp
    App.cpp
    MainWindow.cpp
    WebViewHost.cpp
    IpcBridge.cpp
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

install(TARGETS vrcsm RUNTIME DESTINATION .)
