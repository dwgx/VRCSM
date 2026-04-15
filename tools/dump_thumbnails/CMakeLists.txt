add_executable(dump_thumbnails
    dump_thumbnails.cpp
)

target_link_libraries(dump_thumbnails PRIVATE
    vrcsm_core
)

set_target_properties(dump_thumbnails PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
