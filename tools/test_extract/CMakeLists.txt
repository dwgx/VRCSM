add_executable(test_extract
    test_extract.cpp
)

target_link_libraries(test_extract PRIVATE
    vrcsm_core
)

set_target_properties(test_extract PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)
