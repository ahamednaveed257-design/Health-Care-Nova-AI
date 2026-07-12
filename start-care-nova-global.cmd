@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-care-nova.ps1" -Mode global
exit /b %ERRORLEVEL%

