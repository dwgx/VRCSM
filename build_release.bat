@echo off
call "D:\Software\MS\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
cmake --preset x64-release
cmake --build --preset x64-release
