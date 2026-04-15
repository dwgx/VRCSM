add_executable(tail_probe
    tail_probe.cpp
)

target_link_libraries(tail_probe PRIVATE
    vrcsm_core
)

set_target_properties(tail_probe PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
