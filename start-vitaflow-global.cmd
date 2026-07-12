@echo off
setlocal

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "APP_DIR=%~dp0"
set "NODE_ENV=production"
set "HOST=0.0.0.0"
set "PORT=4173"
set "FRAME_ANCESTORS='self'"

if not exist "%NODE_EXE%" (
  echo Node.js was not found at %NODE_EXE%.
  echo Install Node.js or update NODE_EXE inside this file.
  pause
  exit /b 1
)

echo Starting Care Nova AI for network access...
start "Care Nova AI Network Server" "%NODE_EXE%" "%APP_DIR%server.js"
timeout /t 2 > nul
start "" "http://127.0.0.1:%PORT%/?refresh=5.0.188"

echo.
echo Care Nova AI is listening on all network interfaces at port %PORT%.
echo Same-network users can open http://YOUR-COMPUTER-IP:%PORT%
echo For worldwide public access, host it behind HTTPS on a cloud server or domain.
pause

