@echo off
call "D:\Software\MS\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo vcvars64 failed
  exit /b 1
)
cd /d D:\Project\VRCSM
cmake --build build/x64-debug --config Debug
exit /b %errorlevel%
