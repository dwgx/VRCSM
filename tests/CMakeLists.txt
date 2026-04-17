cmake_minimum_required(VERSION 3.20)

include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/03597a01ee50ed33e9dfd640b249b4be3799d395.zip
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

add_executable(VRCSM_Tests
  main.cpp
)

# If you have a core static library, link it here:
# target_link_libraries(VRCSM_Tests PRIVATE vrcsm_core gtest_main)
# But since this project might just compile directly, let's just link gtest for scaffolding.
target_link_libraries(VRCSM_Tests PRIVATE gtest_main)

include(GoogleTest)
gtest_discover_tests(VRCSM_Tests)
