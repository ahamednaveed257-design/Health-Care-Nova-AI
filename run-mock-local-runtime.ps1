param(
  [string]$NodeExe = "",
  [int]$Port = 11434
)

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $PSScriptRoot
$mockRuntimeScript = Join-Path $PSScriptRoot "mock-ollama-runtime.js"

function Resolve-NodeExe {
  param(
    [string]$Preferred
  )

  $candidates = @(
    $Preferred,
    $env:CARE_NOVA_NODE_EXE,
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "C:\Program Files\nodejs\node.exe",
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates.Count -gt 0) {
    return @($candidates)[0]
  }

  return $null
}

$resolvedNodeExe = Resolve-NodeExe -Preferred $NodeExe

if (-not $resolvedNodeExe) {
  throw "Node.js runtime not found. Mock local runtime cannot start."
}

if (-not (Test-Path $mockRuntimeScript)) {
  throw "Mock local runtime script not found at '$mockRuntimeScript'."
}

$env:CARE_NOVA_NODE_EXE = $resolvedNodeExe
$env:MOCK_OLLAMA_PORT = [string]$Port

Set-Location $appDir
& $resolvedNodeExe $mockRuntimeScript
