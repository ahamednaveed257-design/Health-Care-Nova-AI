@echo off
setlocal
if not defined HOST set "HOST=127.0.0.1"
if not defined PORT set "PORT=4173"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-care-nova-server.ps1" -ListenHost "%HOST%" -Port %PORT%
exit /b %ERRORLEVEL%
