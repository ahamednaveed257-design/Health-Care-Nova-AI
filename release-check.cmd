@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_CMD=%APP_DIR%node.cmd"

if not exist "%NODE_CMD%" (
  echo node.cmd was not found in %APP_DIR%.
  echo Restore the project root launcher files, then retry.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"

echo Checking Care Nova AI deployment readiness...
"%NODE_CMD%" --check server.js || exit /b 1
"%NODE_CMD%" --check src\enterprisePatientAccess.js || exit /b 1
"%NODE_CMD%" --check src\enterpriseConfigReadiness.js || exit /b 1
"%NODE_CMD%" --check src\enterpriseReleaseSnapshot.js || exit /b 1
"%NODE_CMD%" --check src\enterpriseSecretPosture.js || exit /b 1
"%NODE_CMD%" --check src\enterpriseStartupGuard.js || exit /b 1
"%NODE_CMD%" --check src\healthEngine.js || exit /b 1
"%NODE_CMD%" --check src\memoryStore.js || exit /b 1
"%NODE_CMD%" --check src\recordStore.js || exit /b 1
"%NODE_CMD%" --check src\offlineMedicalDatabase.js || exit /b 1
"%NODE_CMD%" --check public\app.js || exit /b 1
"%NODE_CMD%" --check public\sw.js || exit /b 1
"%NODE_CMD%" --check scripts\build-github-standalone.js || exit /b 1
"%NODE_CMD%" --check scripts\smoke-test.js || exit /b 1
"%NODE_CMD%" --check scripts\deployment-check.js || exit /b 1
"%NODE_CMD%" --check scripts\enterprise-public-deployment-check.js || exit /b 1
"%NODE_CMD%" --check scripts\enterprise-release-snapshot-check.js || exit /b 1
"%NODE_CMD%" --check scripts\enterprise-startup-guard-check.js || exit /b 1
"%NODE_CMD%" --check scripts\github-package-check.js || exit /b 1
"%NODE_CMD%" --check scripts\local-eval-benchmarks.js || exit /b 1
"%NODE_CMD%" --check scripts\model-file-check.js || exit /b 1
"%NODE_CMD%" scripts\build-github-standalone.js || exit /b 1
"%NODE_CMD%" scripts\github-package-check.js || exit /b 1
"%NODE_CMD%" scripts\model-file-check.js || exit /b 1
"%NODE_CMD%" scripts\smoke-test.js || exit /b 1
"%NODE_CMD%" scripts\deployment-check.js || exit /b 1
"%NODE_CMD%" scripts\enterprise-public-deployment-check.js || exit /b 1
"%NODE_CMD%" scripts\enterprise-release-snapshot-check.js || exit /b 1
"%NODE_CMD%" scripts\enterprise-startup-guard-check.js || exit /b 1
"%NODE_CMD%" scripts\local-eval-benchmarks.js || exit /b 1

echo.
echo Care Nova AI is deployment ready.
if /i not "%~1"=="--no-pause" pause
