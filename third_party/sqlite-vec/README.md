# sqlite-vec vendored amalgamation

Source: https://github.com/asg017/sqlite-vec (v0.1.9)
License: Apache-2.0 OR MIT

Drop-in single-file SQLite extension for vector similarity search.
Used by VRCSM's experimental visual avatar search feature.

Integration: compiled directly into `vrcsm_core` via CMake, registered
via `sqlite3_auto_extension(sqlite3_vec_init)` before any `sqlite3_open_v2`
call. See `src/core/Database.cpp`.

To upgrade: download amalgamation zip from the releases page, unzip,
overwrite both files. No other changes needed unless the public API
changes.
