# Build-time helper that syncs the in-repo plugins/ directory into
# ${DEST}. Bundled plugins (hello, and later AutoUploader) live here so
# they ship with the MSI and are discovered on first run by the plugin
# loader without a manual "install" step.
#
# Same pattern as sync-web-dist.cmake: NO-OP gracefully when the source
# is missing so a fresh checkout still configures.

if(NOT DEFINED SOURCE OR NOT DEFINED DEST)
    message(FATAL_ERROR "sync-plugins.cmake requires -DSOURCE= -DDEST=")
endif()

if(NOT EXISTS "${SOURCE}")
    message(STATUS "sync-plugins: ${SOURCE} missing — skipping")
    return()
endif()

if(EXISTS "${DEST}")
    file(REMOVE_RECURSE "${DEST}")
endif()

file(MAKE_DIRECTORY "${DEST}")
file(COPY "${SOURCE}/" DESTINATION "${DEST}")
message(STATUS "sync-plugins: ${SOURCE} → ${DEST}")
