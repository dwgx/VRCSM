@echo off
setlocal

call "D:\Software\MS\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
    echo vcvars64 failed
    exit /b 1
)

set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ninja-build.Ninja_Microsoft.Winget.Source_8wekyb3d8bbwe;%PATH%"

where ninja
where cl

cd /d "D:\Project\VRCSM"
cmake --preset x64-debug
if errorlevel 1 exit /b 1

cmake --build --preset x64-debug
exit /b %errorlevel%
