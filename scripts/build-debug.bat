@echo off
setlocal

call "%~dp0build-host.bat" debug
exit /b %errorlevel%
