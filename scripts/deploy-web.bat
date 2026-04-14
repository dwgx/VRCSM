@echo off
setlocal

set "PRESET=%~1"
if "%PRESET%"=="" set "PRESET=x64-debug"

set "EXE_DIR=D:\Project\VRCSM\build\%PRESET%\src\host"
set "WEB_DIST=D:\Project\VRCSM\web\dist"
set "WEB_OUT=%EXE_DIR%\web"

if not exist "%WEB_DIST%\index.html" (
    echo [deploy-web] vite dist not found at %WEB_DIST%
    echo [deploy-web] run: cd web ^&^& pnpm exec vite build
    exit /b 1
)

if not exist "%EXE_DIR%" (
    echo [deploy-web] exe dir not found at %EXE_DIR%
    echo [deploy-web] build the project first via scripts\build-debug.bat
    exit /b 1
)

if exist "%WEB_OUT%" rmdir /s /q "%WEB_OUT%"
xcopy /e /i /q /y "%WEB_DIST%" "%WEB_OUT%" >nul
if errorlevel 1 (
    echo [deploy-web] xcopy failed
    exit /b 1
)
echo [deploy-web] copied %WEB_DIST% -^> %WEB_OUT%
exit /b 0
