@echo off
setlocal EnableDelayedExpansion

set "REPO=%~dp0.."
set "TARGET=%~1"
set "PRESET=%TARGET%"

if "%PRESET%"=="" set "PRESET=x64-debug"
if /I "%TARGET%"=="debug" set "PRESET=x64-debug"
if /I "%TARGET%"=="release" set "PRESET=x64-release"

where cl >nul 2>nul
if errorlevel 1 (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  if exist "%VSWHERE%" (
    for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%I"
  )
  if not defined VSINSTALL if exist "D:\Software\MS\Microsoft Visual Studio\18\Community" set "VSINSTALL=D:\Software\MS\Microsoft Visual Studio\18\Community"
  if not defined VSINSTALL (
    echo [build-host] Visual Studio build tools not found.
    exit /b 1
  )
  if exist "!VSINSTALL!\Common7\Tools\VsDevCmd.bat" (
    call "!VSINSTALL!\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
  ) else (
    call "!VSINSTALL!\VC\Auxiliary\Build\vcvars64.bat" >nul
  )
  if errorlevel 1 (
    echo [build-host] vcvars64 failed
    exit /b 1
  )
)

cd /d "%REPO%"
cmake --preset %PRESET%
if errorlevel 1 exit /b 1

cmake --build --preset %PRESET%
exit /b %errorlevel%
