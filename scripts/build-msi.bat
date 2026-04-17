@echo off
setlocal enabledelayedexpansion

set REPO=%~dp0..
set BUILD_DIR=%REPO%\build\x64-release\src\host
set ICON_FILE=%REPO%\resources\icons\vrcsm.ico
set OUT_DIR=%REPO%\build\msi
set WIX=%USERPROFILE%\.dotnet\tools\wix.exe

set /p APP_VERSION=<"%REPO%\VERSION"
for /f "tokens=* delims= " %%A in ("%APP_VERSION%") do set "APP_VERSION=%%A"
set APP_VERSION_MSI=%APP_VERSION%.0
set OUT_MSI=%OUT_DIR%\VRCSM-%APP_VERSION%-x64.msi

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

set "WIX_VERSION="
for /f %%V in ('"%WIX%" --version') do if not defined WIX_VERSION set "WIX_VERSION=%%V"
set "WIX_MAJOR=%WIX_VERSION:~0,1%"
set "WIX_EULA_ARG="
if "%WIX_MAJOR%"=="7" set "WIX_EULA_ARG=-acceptEula wix7"
if "%WIX_MAJOR%"=="8" set "WIX_EULA_ARG=-acceptEula wix7"

"%WIX%" build %WIX_EULA_ARG% "%REPO%\installer\vrcsm.wxs" -arch x64 -d "BuildDir=%BUILD_DIR%" -d "IconFile=%ICON_FILE%" -d "ProductVersion=%APP_VERSION_MSI%" -o "%OUT_MSI%"
if errorlevel 1 (
    echo [build-msi] FAILED
    exit /b 1
)

echo [build-msi] OK -^> %OUT_MSI%
