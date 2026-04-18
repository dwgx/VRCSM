add_executable(dump_avatar_details
    dump_avatar_details.cpp
)

target_link_libraries(dump_avatar_details PRIVATE
    vrcsm_core
)

set_target_properties(dump_avatar_details PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
