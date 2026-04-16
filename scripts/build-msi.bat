@echo off
setlocal enabledelayedexpansion

set REPO=%~dp0..
set BUILD_DIR=%REPO%\build\x64-release\src\host
set ICON_FILE=%REPO%\resources\icons\vrcsm.ico
set OUT_DIR=%REPO%\build\msi
set OUT_MSI=%OUT_DIR%\VRCSM-0.5.0-x64.msi
set WIX=%USERPROFILE%\.dotnet\tools\wix.exe

if not exist "%BUILD_DIR%\VRCSM.exe" (
    echo [build-msi] ERROR: VRCSM.exe not found at %BUILD_DIR%
    echo [build-msi] Run scripts\build-debug.bat and scripts\deploy-web.bat first.
    exit /b 1
)
if not exist "%BUILD_DIR%\web\index.html" (
    echo [build-msi] ERROR: web\index.html not found in %BUILD_DIR%
    echo [build-msi] Run scripts\deploy-web.bat first.
    exit /b 1
)
if not exist "%WIX%" (
    echo [build-msi] ERROR: wix.exe not found at %WIX%
    echo [build-msi] Run: dotnet tool install -g wix
    exit /b 1
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

echo [build-msi] BuildDir=%BUILD_DIR%
echo [build-msi] Output=%OUT_MSI%

"%WIX%" build "%REPO%\installer\vrcsm.wxs" -arch x64 -d "BuildDir=%BUILD_DIR%" -d "IconFile=%ICON_FILE%" -o "%OUT_MSI%"
if errorlevel 1 (
    echo [build-msi] FAILED
    exit /b 1
)

echo [build-msi] OK -^> %OUT_MSI%
