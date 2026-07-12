param(
  [ValidateSet("local", "global")]
  [string]$Mode = "local",
  [ValidateSet("default", "edge")]
  [string]$Browser = "default",
  [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $appDir "index.html"
$localRuntimeScript = Join-Path $PSScriptRoot "start-local-runtime.ps1"
$serverRunnerScriptPath = Join-Path $PSScriptRoot "run-care-nova-server.ps1"
$port = 4173
$browserUrl = "http://127.0.0.1:$port/"
$listenHost = if ($Mode -eq "global") { "0.0.0.0" } else { "127.0.0.1" }
$serverOutLogPath = Join-Path $appDir "server-4173.codex.out.log"
$serverErrLogPath = Join-Path $appDir "server-4173.codex.err.log"
$packageJsonPath = Join-Path $appDir "package.json"

function Normalize-ProcessPathEnvironment {
  $processPath = [System.Environment]::GetEnvironmentVariable("Path", "Process")

  if (-not $processPath) {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $processPath = (@($machinePath, $userPath) | Where-Object { $_ } | Select-Object -Unique) -join ";"
  }

  [System.Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [System.Environment]::SetEnvironmentVariable("Path", $processPath, "Process")
}

function Open-LocalTarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target,
    [ValidateSet("default", "edge")]
    [string]$Browser = "default"
  )

  if ($Browser -eq "edge") {
    $edgeExe = Resolve-EdgeExe

    if ($edgeExe) {
      Start-Process -FilePath $edgeExe -ArgumentList @("--new-window", $Target) | Out-Null
      return
    }
  }

  Start-Process -FilePath $Target | Out-Null
}

function Resolve-EdgeExe {
  $candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates.Count -gt 0) {
    return @($candidates)[0]
  }

  return $null
}

function Resolve-NodeExe {
  $candidates = @(
    $env:CARE_NOVA_NODE_EXE,
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "C:\Program Files\nodejs\node.exe",
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  ) | Where-Object {
    $_ -and
    (Test-Path $_) -and
    ([System.IO.Path]::GetExtension([string]$_).ToLowerInvariant() -eq ".exe")
  }

  if ($candidates.Count -gt 0) {
    return @($candidates)[0]
  }

  return $null
}

function Test-CareNovaHealth {
  param(
    [int]$TimeoutSec = 2,
    [string]$ExpectedVersion = ""
  )

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec $TimeoutSec

    if ($health.ok -ne $true) {
      return $false
    }

    if ($ExpectedVersion -and [string]$health.version -ne [string]$ExpectedVersion) {
      return $false
    }

    return $true
  } catch {
    return $false
  }
}

function Get-CareNovaHealthPayload {
  param(
    [int]$TimeoutSec = 2
  )

  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec $TimeoutSec
  } catch {
    return $null
  }
}

function Wait-ForCareNovaHealth {
  param(
    [int]$Attempts = 24,
    [int]$DelayMs = 500,
    [int]$RequiredSuccesses = 2,
    [string]$ExpectedVersion = ""
  )

  $successStreak = 0

  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Test-CareNovaHealth -ExpectedVersion $ExpectedVersion) {
      $successStreak += 1

      if ($successStreak -ge $RequiredSuccesses) {
        return $true
      }
    } else {
      $successStreak = 0
    }

    Start-Sleep -Milliseconds $DelayMs
  }

  return $false
}

function Get-ExpectedAppVersion {
  if (-not (Test-Path $packageJsonPath)) {
    return ""
  }

  try {
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    return [string]$packageJson.version
  } catch {
    return ""
  }
}

function Get-ListeningProcessIds {
  param(
    [int]$Port
  )

  $processIds = @()

  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    if ($connections) {
      $processIds += @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    }
  } catch {
    # Fall through to netstat parsing.
  }

  if (-not $processIds.Count) {
    try {
      $netstatLines = netstat -ano -p tcp | Select-String "LISTENING"
      foreach ($line in $netstatLines) {
        $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
        if ($parts.Count -lt 5) {
          continue
        }

        $localAddress = [string]$parts[1]
        $state = [string]$parts[3]
        $pidText = [string]$parts[4]

        if ($state -ne "LISTENING") {
          continue
        }

        if ($localAddress -match ":(\d+)$" -and [int]$Matches[1] -eq $Port) {
          $parsedPid = 0
          if ([int]::TryParse($pidText, [ref]$parsedPid) -and $parsedPid -gt 0) {
            $processIds += $parsedPid
          }
        }
      }
    } catch {
      # Ignore; caller will decide next step.
    }
  }

  return @($processIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)
}

function Stop-StaleCareNovaRuntime {
  param(
    [int]$Port
  )

  $processIds = Get-ListeningProcessIds -Port $Port

  foreach ($processId in $processIds) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      # If the process is already gone or inaccessible, continue.
    }
  }

  if ($processIds.Count -gt 0) {
    Start-Sleep -Milliseconds 1200
  }
}

function Get-LogTail {
  param(
    [string]$Path,
    [int]$Lines = 16
  )

  if (-not (Test-Path $Path)) {
    return ""
  }

  try {
    return ((Get-Content $Path -Tail $Lines -ErrorAction SilentlyContinue) | Out-String).Trim()
  } catch {
    return ""
  }
}

function Open-FallbackSurface {
  if ($SkipBrowser) {
    return
  }

  if (Test-Path $launcherPath) {
    Open-LocalTarget -Target $launcherPath -Browser $Browser
    return
  }

  Open-LocalTarget -Target $browserUrl -Browser $Browser
}

function Start-CareNovaServer {
  param(
    [string]$NodeExe,
    [string]$AppDir,
    [string]$ListenHost,
    [int]$Port,
    [string]$Mode
  )

  $detachedLauncherPath = Join-Path $PSScriptRoot "launch-care-nova-detached.mjs"

  if (-not (Test-Path $detachedLauncherPath)) {
    throw "Detached server launcher was not found at '$detachedLauncherPath'."
  }

  Remove-Item $serverOutLogPath -ErrorAction SilentlyContinue
  Remove-Item $serverErrLogPath -ErrorAction SilentlyContinue

  try {
    $null = & $NodeExe $detachedLauncherPath `
      --host $ListenHost `
      --port $Port `
      --mode $Mode `
      --node $NodeExe
  } catch {
    throw "Care Nova detached server launcher failed to launch. $($_.Exception.Message)"
  }
}

function Start-LocalRuntimeBootstrap {
  param(
    [string]$ScriptPath,
    [bool]$EnableMockFallback
  )

  if (-not (Test-Path $ScriptPath)) {
    return
  }

  $runtimeArgs = @(
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-File `"$ScriptPath`""
  )

  if ($EnableMockFallback) {
    $runtimeArgs += "-EnableMockFallback"
  }

  $runtimeArgs = $runtimeArgs -join " "

  try {
    Start-Process -FilePath "powershell.exe" `
      -ArgumentList $runtimeArgs `
      -WorkingDirectory $appDir `
      -WindowStyle Hidden | Out-Null
  } catch {
    # Local AI bootstrap is optional for app startup.
  }
}

Normalize-ProcessPathEnvironment

$nodeExe = Resolve-NodeExe
$expectedVersion = Get-ExpectedAppVersion

if (-not $nodeExe) {
  Open-FallbackSurface
  throw "Node.js runtime not found. Care Nova could not start the localhost server."
}

$env:CARE_NOVA_NODE_EXE = $nodeExe
Start-LocalRuntimeBootstrap -ScriptPath $localRuntimeScript -EnableMockFallback:($Mode -eq "local")

$runningHealth = Get-CareNovaHealthPayload
$runningVersion = if ($runningHealth) { [string]$runningHealth.version } else { "" }
$runningApp = if ($runningHealth) { [string]$runningHealth.app } else { "" }
$staleRuntimeDetected = $runningHealth -and $runningHealth.ok -eq $true -and $runningApp -eq "Care Nova AI" -and $expectedVersion -and $runningVersion -and $runningVersion -ne $expectedVersion

if ($staleRuntimeDetected) {
  Stop-StaleCareNovaRuntime -Port $port
}

if (-not (Test-CareNovaHealth -ExpectedVersion $expectedVersion)) {
  Start-CareNovaServer -NodeExe $nodeExe -AppDir $appDir -ListenHost $listenHost -Port $port -Mode $Mode
}

$ready = Wait-ForCareNovaHealth -Attempts 24 -DelayMs 500 -RequiredSuccesses 2 -ExpectedVersion $expectedVersion

if ($ready) {
  if (-not $SkipBrowser) {
    Open-LocalTarget -Target $browserUrl -Browser $Browser
  }

  exit 0
}

Open-FallbackSurface
$stdoutTail = Get-LogTail -Path $serverOutLogPath
$stderrTail = Get-LogTail -Path $serverErrLogPath
$errorMessage = "Care Nova AI did not become ready on $browserUrl"

if ($staleRuntimeDetected -and $expectedVersion) {
  $errorMessage += "`nDetected an older running Care Nova version ($runningVersion). Expected version: $expectedVersion."
}

if ($stderrTail) {
  $errorMessage += "`nServer stderr:`n$stderrTail"
} elseif ($stdoutTail) {
  $errorMessage += "`nServer stdout:`n$stdoutTail"
}

throw $errorMessage
