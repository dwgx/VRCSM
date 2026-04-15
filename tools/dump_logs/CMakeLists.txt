add_executable(dump_logs
    dump_logs.cpp
)

target_link_libraries(dump_logs PRIVATE
    vrcsm_core
    nlohmann_json::nlohmann_json
)

set_target_properties(dump_logs PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
