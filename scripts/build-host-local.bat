@echo off
setlocal EnableDelayedExpansion

set "REPO=%~dp0.."
set "TARGET=%~1"
set "PRESET=%TARGET%"
if "%PRESET%"=="" set "PRESET=x64-debug"
if /I "%TARGET%"=="debug" set "PRESET=x64-debug"
if /I "%TARGET%"=="release" set "PRESET=x64-release"

call "D:\Software\MS\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [build-host-local] vcvars64 failed
  exit /b 1
)

cd /d "%REPO%"

cmake --build --preset %PRESET%
if errorlevel 1 exit /b %errorlevel%

set "HOST_DIR=%REPO%\build\%PRESET%\src\host"
cmake -DSOURCE=%REPO%\web\dist -DDEST=%HOST_DIR%\web -P %REPO%\cmake\sync-web-dist.cmake
if errorlevel 1 exit /b %errorlevel%

cmake -E copy_if_different %REPO%\resources\icons\vrcsm.ico %HOST_DIR%\VRCSM.ico
if errorlevel 1 exit /b %errorlevel%

exit /b 0
