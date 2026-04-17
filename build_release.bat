@echo off
call "%~dp0scripts\build-host.bat" release
exit /b %errorlevel%
