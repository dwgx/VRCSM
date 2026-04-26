@echo off
setlocal EnableDelayedExpansion

set "REPO=%~dp0.."
set "TARGET=%~1"
set "PRESET=%TARGET%"

if "%PRESET%"=="" set "PRESET=x64-debug"
if /I "%TARGET%"=="debug" set "PRESET=x64-debug"
if /I "%TARGET%"=="release" set "PRESET=x64-release"

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%I"
)
if not defined VSINSTALL (
  for %%D in ("%ProgramFiles%\Microsoft Visual Studio" "%ProgramFiles(x86)%\Microsoft Visual Studio") do (
    for %%E in (Enterprise Professional Community BuildTools) do (
      for /d %%V in ("%%~fD\2022\%%E" "%%~fD\2019\%%E" "%%~fD\18\%%E" "%%~fD\17\%%E") do (
        if not defined VSINSTALL if exist "%%~fV\Common7\Tools\VsDevCmd.bat" set "VSINSTALL=%%~fV"
      )
    )
  )
)
if not defined VSINSTALL (
  for %%L in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
    for %%D in ("%%L:\Microsoft Visual Studio" "%%L:\Program Files\Microsoft Visual Studio" "%%L:\Program Files (x86)\Microsoft Visual Studio" "%%L:\Software\MS\Microsoft Visual Studio") do (
      for %%E in (Enterprise Professional Community BuildTools) do (
        for /d %%V in ("%%~fD\2022\%%E" "%%~fD\2019\%%E" "%%~fD\18\%%E" "%%~fD\17\%%E") do (
          if not defined VSINSTALL if exist "%%~fV\Common7\Tools\VsDevCmd.bat" set "VSINSTALL=%%~fV"
        )
      )
    )
  )
)
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
  echo [build-host] Visual Studio environment initialization failed.
  exit /b 1
)
echo ;%INCLUDE%; | findstr /I /C:"\ucrt;" >nul
if errorlevel 1 (
  echo [build-host] Visual Studio environment missing UCRT include path.
  exit /b 1
)

cd /d "%REPO%"
call pnpm --dir web build
if errorlevel 1 exit /b 1

:: Force reconfigure when VERSION changes so VRCSM_VERSION_STRING is updated
cmake --preset %PRESET%
if errorlevel 1 exit /b 1

set "HOST_DIR=%REPO%\build\%PRESET%\src\host"
set "RENAMED_EXE="
if exist "%HOST_DIR%\VRCSM.exe" (
  set "STAMP=%DATE:/=-%-%TIME::=-%"
  set "STAMP=!STAMP: =0!"
  set "STAMP=!STAMP:.=-!"
  set "RENAMED_EXE=VRCSM.exe.!STAMP!.old"
  ren "%HOST_DIR%\VRCSM.exe" "!RENAMED_EXE!" >nul 2>nul
  if errorlevel 1 (
    echo [build-host] WARNING: could not rename locked VRCSM.exe before build
    set "RENAMED_EXE="
  )
)

cmake --build --preset %PRESET%
if errorlevel 1 (
  set "BUILD_ERROR=%errorlevel%"
  if defined RENAMED_EXE if not exist "%HOST_DIR%\VRCSM.exe" ren "%HOST_DIR%\!RENAMED_EXE!" "VRCSM.exe" >nul 2>nul
  exit /b !BUILD_ERROR!
)

cmake -DSOURCE=%REPO%\web\dist -DDEST=%HOST_DIR%\web -P %REPO%\cmake\sync-web-dist.cmake
if errorlevel 1 exit /b %errorlevel%

cmake -E copy_if_different %REPO%\resources\icons\vrcsm.ico %HOST_DIR%\VRCSM.ico
if errorlevel 1 exit /b %errorlevel%

exit /b 0
