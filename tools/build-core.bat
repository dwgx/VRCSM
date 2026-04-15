@echo off
setlocal
call "D:\Software\MS\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b %errorlevel%
cmake --build "%~dp0..\build\x64-debug"
exit /b %errorlevel%
