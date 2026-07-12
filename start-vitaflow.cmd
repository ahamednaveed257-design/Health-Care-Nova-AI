@echo off
setlocal

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "APP_DIR=%~dp0"
set "HOST=127.0.0.1"
set "PORT=4173"

if not exist "%NODE_EXE%" (
  echo Node.js was not found at %NODE_EXE%.
  echo Install Node.js or update NODE_EXE inside this file.
  pause
  exit /b 1
)

echo Starting Care Nova AI locally...
start "Care Nova AI Local Server" "%NODE_EXE%" "%APP_DIR%server.js"
timeout /t 2 > nul
start "" "http://127.0.0.1:%PORT%/?refresh=5.0.188"

echo.
echo Care Nova AI is opening at http://127.0.0.1:%PORT%
echo Keep the server window open while using the app.
pause

