# Build-time helper that syncs web/dist → ${DEST}/web so the WebView2
# host picks up the latest React bundle without any manual cp step.
#
# Invoked by a POST_BUILD custom command on the `vrcsm` target. See
# src/host/CMakeLists.txt for the wiring. The indirection through this
# script exists for exactly one reason: we need to NO-OP gracefully when
# `web/dist` does not exist (fresh checkout before `pnpm run build`) and
# a plain `copy_directory` command would fail the build.

if(NOT DEFINED SOURCE OR NOT DEFINED DEST)
    message(FATAL_ERROR "sync-web-dist.cmake requires -DSOURCE= -DDEST=")
endif()

if(NOT EXISTS "${SOURCE}")
    message(STATUS "sync-web-dist: ${SOURCE} missing — skipping (run `pnpm --dir web run build` to populate)")
    return()
endif()

# Purge the destination so stale files from a previous bundle (renamed
# chunks, removed assets) don't leak into the new build.
if(EXISTS "${DEST}")
    file(REMOVE_RECURSE "${DEST}")
endif()

file(MAKE_DIRECTORY "${DEST}")
file(COPY "${SOURCE}/" DESTINATION "${DEST}")
message(STATUS "sync-web-dist: ${SOURCE} → ${DEST}")
