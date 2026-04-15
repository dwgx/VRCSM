add_executable(dump_settings
    dump_settings.cpp
)

target_link_libraries(dump_settings PRIVATE
    vrcsm_core
)

set_target_properties(dump_settings PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
