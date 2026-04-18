@echo off
setlocal EnableDelayedExpansion

set "REPO=%~dp0.."
where cl >nul 2>nul
if errorlevel 1 (
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
    echo [build-core] Visual Studio build tools not found.
    exit /b 1
  )
  if exist "!VSINSTALL!\Common7\Tools\VsDevCmd.bat" (
    call "!VSINSTALL!\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
  ) else (
    call "!VSINSTALL!\VC\Auxiliary\Build\vcvars64.bat" >nul
  )
  if errorlevel 1 exit /b %errorlevel%
)

cmake --build "%REPO%\build\x64-debug"
exit /b %errorlevel%
