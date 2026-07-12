param(
  [string]$ListenHost = "127.0.0.1",
  [int]$Port = 4173,
  [string]$NodeExe = "",
  [ValidateSet("local", "global")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $PSScriptRoot

function Resolve-NodeExe {
  param(
    [string]$Preferred
  )

  $candidates = @(
    $Preferred,
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

$resolvedNodeExe = Resolve-NodeExe -Preferred $NodeExe

if (-not $resolvedNodeExe) {
  throw "Node.js runtime not found. Care Nova AI server cannot start."
}

$env:HOST = [string]$ListenHost
$env:PORT = [string]$Port
$env:CARE_NOVA_PRETTY_JSON = "false"
$env:CARE_NOVA_NODE_EXE = $resolvedNodeExe

if ($Mode -eq "global") {
  $env:NODE_ENV = "production"
  $env:FRAME_ANCESTORS = "'self'"
} else {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  Remove-Item Env:FRAME_ANCESTORS -ErrorAction SilentlyContinue
}

Set-Location $appDir
& $resolvedNodeExe "server.js"
