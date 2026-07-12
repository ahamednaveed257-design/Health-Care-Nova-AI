param(
  [switch]$EnableMockFallback
)

$knownOllamaPaths = @(@(
  (Get-Command ollama -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
  (Join-Path $env:ProgramFiles 'Ollama\ollama.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\CareNovaOllama\ollama.exe')
) | Where-Object { $_ -and (Test-Path $_) })

$knownLmStudioPaths = @(@(
  (Join-Path $env:LOCALAPPDATA 'Programs\LM Studio\LM Studio.exe'),
  (Join-Path $env:LOCALAPPDATA 'lm-studio\LM Studio.exe')
) | Where-Object { $_ -and (Test-Path $_) })

function Normalize-ProcessPathEnvironment {
  $processPath = [System.Environment]::GetEnvironmentVariable("Path", "Process")

  if (-not $processPath) {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $processPath = (@($machinePath, $userPath) | Where-Object { $_ } | Select-Object -Unique) -join ";"
  }

  [System.Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [System.Environment]::SetEnvironmentVariable("Path", $null, "Process")
  [System.Environment]::SetEnvironmentVariable("Path", $processPath, "Process")
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$Attempts = 15,
    [int]$DelayMs = 1000
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $null = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 4
      return $true
    } catch {
      Start-Sleep -Milliseconds $DelayMs
    }
  }

  return $false
}

function Get-LocalRuntimeInspection {
  param(
    [string]$ModelsUrl = 'http://127.0.0.1:11434/v1/models',
    [string]$TagsUrl = 'http://127.0.0.1:11434/api/tags'
  )

  $result = @{
    reachable = $false
    mockRuntime = $false
    runtimeFamily = ''
    modelIds = @()
    source = ''
  }

  try {
    $modelsResponse = Invoke-WebRequest -Uri $ModelsUrl -Method Get -TimeoutSec 4
    $payload = $modelsResponse.Content | ConvertFrom-Json
    $runtimeHeader = [string]($modelsResponse.Headers['X-Care-Nova-Runtime'])
    $runtimeFamilyHeader = [string]($modelsResponse.Headers['X-Care-Nova-Runtime-Family'])
    $payloadKind = [string]($payload.runtime.kind)
    $payloadFamily = [string]($payload.runtime.family)
    $payloadId = [string]($payload.runtime.id)

    $result.reachable = $true
    $result.source = 'models'
    $result.runtimeFamily = if ($payloadFamily) { $payloadFamily } elseif ($runtimeFamilyHeader) { $runtimeFamilyHeader } else { 'openai-compatible' }
    $result.mockRuntime = ($runtimeHeader -match 'mock') -or ($runtimeFamilyHeader -match 'mock') -or ($payloadKind -match 'mock') -or ($payloadFamily -match 'mock') -or ($payloadId -match 'care-nova-mock')
    $result.modelIds = @(
      $payload.data | ForEach-Object {
        if ($_.id) { [string]$_.id } elseif ($_.name) { [string]$_.name } elseif ($_.model) { [string]$_.model }
      } | Where-Object { $_ } | Select-Object -Unique
    )
    return $result
  } catch {}

  try {
    $tagsPayload = Invoke-RestMethod -Uri $TagsUrl -Method Get -TimeoutSec 4
    $runtimeKind = [string]($tagsPayload.runtime.kind)
    $runtimeFamily = [string]($tagsPayload.runtime.family)
    $runtimeId = [string]($tagsPayload.runtime.id)

    $result.reachable = $true
    $result.source = 'tags'
    $result.runtimeFamily = if ($runtimeFamily) { $runtimeFamily } else { 'ollama-compatible' }
    $result.mockRuntime = ($runtimeKind -match 'mock') -or ($runtimeFamily -match 'mock') -or ($runtimeId -match 'care-nova-mock')
    $result.modelIds = @(
      $tagsPayload.models | ForEach-Object {
        if ($_.name) { [string]$_.name } elseif ($_.model) { [string]$_.model } elseif ($_.id) { [string]$_.id }
      } | Where-Object { $_ } | Select-Object -Unique
    )
    return $result
  } catch {}

  return $result
}

function Stop-ListenerProcess {
  param(
    [int]$Port
  )

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $processIds = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($processId in $processIds) {
    if ($processId) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-MockRuntimeModelIds {
  param(
    [string]$Url
  )

  try {
    $payload = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 4
    $modelIds = @(
      $payload.models | ForEach-Object {
        if ($_.model) {
          [string]$_.model
        } else {
          [string]$_.name
        }
      } | Where-Object { $_ } | Select-Object -Unique
    )
    return $modelIds
  } catch {
    return @()
  }
}

function Get-RequiredMockModelIds {
  $deepseekModel = if ($env:CARE_NOVA_DEEPSEEK_MODEL) { $env:CARE_NOVA_DEEPSEEK_MODEL } elseif ($env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL } else { 'deepseek-r1' }
  $qwenModel = if ($env:CARE_NOVA_QWEN_MODEL) { $env:CARE_NOVA_QWEN_MODEL } elseif ($env:QWEN_MODEL) { $env:QWEN_MODEL } else { 'qwen2.5:3b' }
  $llamaModel = if ($env:CARE_NOVA_LLAMA_MODEL) { $env:CARE_NOVA_LLAMA_MODEL } elseif ($env:LLAMA_MODEL) { $env:LLAMA_MODEL } else { 'llama3.2:3b' }
  $mistralModel = if ($env:CARE_NOVA_MISTRAL_MODEL) { $env:CARE_NOVA_MISTRAL_MODEL } elseif ($env:MISTRAL_MODEL) { $env:MISTRAL_MODEL } else { 'mistral' }
  $gemmaModel = if ($env:CARE_NOVA_GEMMA_MODEL) { $env:CARE_NOVA_GEMMA_MODEL } elseif ($env:GEMMA_MODEL) { $env:GEMMA_MODEL } else { 'gemma' }

  return @(
    $deepseekModel,
    $qwenModel,
    $llamaModel,
    $mistralModel,
    $gemmaModel
  ) | Where-Object { $_ } | Select-Object -Unique
}

function Resolve-NodeExe {
  $candidates = @(
    $env:CARE_NOVA_NODE_EXE,
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
    'C:\Program Files\nodejs\node.exe',
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  ) | Where-Object {
    $_ -and
    (Test-Path $_) -and
    ([System.IO.Path]::GetExtension([string]$_).ToLowerInvariant() -eq '.exe')
  }

  if ($candidates.Count -gt 0) {
    return @($candidates)[0]
  }

  return $null
}

if ($knownOllamaPaths.Count -gt 0) {
  $ollamaExe = $knownOllamaPaths[0]
  $listener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
  $runtimeInspection = Get-LocalRuntimeInspection

  if ($listener -and $runtimeInspection.reachable -and $runtimeInspection.mockRuntime) {
    Write-Output 'Detected Care Nova mock runtime on http://127.0.0.1:11434. Stopping it so native Ollama can start.'
    Stop-ListenerProcess -Port 11434
    Start-Sleep -Milliseconds 500
    $listener = $null
  }

  if (-not $listener) {
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden
  }

  if (Wait-ForUrl -Url 'http://127.0.0.1:11434/api/tags') {
    $runtimeInspection = Get-LocalRuntimeInspection

    if ($runtimeInspection.reachable -and -not $runtimeInspection.mockRuntime) {
      Write-Output "Ollama runtime is ready on http://127.0.0.1:11434"
      exit 0
    }

    Write-Error "Port 11434 responded, but a native Ollama runtime was not confirmed."
    exit 1
  }

  Write-Error "Ollama was found at '$ollamaExe' but the local API did not become ready."
  exit 1
}

if ($knownLmStudioPaths.Count -gt 0) {
  $lmStudioExe = $knownLmStudioPaths[0]
  Start-Process -FilePath $lmStudioExe -WindowStyle Hidden
  Write-Output "LM Studio was launched from '$lmStudioExe'. Enable the local server and load a model so http://127.0.0.1:1234/v1/models responds."
  exit 0
}

if ($EnableMockFallback) {
  $mockRuntimeUrl = 'http://127.0.0.1:11434/api/tags'
  $requiredMockModelIds = Get-RequiredMockModelIds

  if (Wait-ForUrl -Url $mockRuntimeUrl -Attempts 2 -DelayMs 300) {
    $runtimeInspection = Get-LocalRuntimeInspection

    if ($runtimeInspection.reachable -and -not $runtimeInspection.mockRuntime) {
      Write-Output 'A native local runtime is already responding on http://127.0.0.1:11434'
      exit 0
    }

    $existingModelIds = Get-MockRuntimeModelIds -Url $mockRuntimeUrl
    $missingMockModels = @($requiredMockModelIds | Where-Object { $existingModelIds -notcontains $_ })

    if (-not $missingMockModels.Count) {
      Write-Output 'A local OpenAI-compatible runtime is already responding on http://127.0.0.1:11434'
      exit 0
    }

    $existingListener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue

    if ($existingListener) {
      Stop-ListenerProcess -Port 11434
      Start-Sleep -Milliseconds 400
    }
  }

  $portListener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue

  if ($portListener) {
    Stop-ListenerProcess -Port 11434
    Start-Sleep -Milliseconds 400
  }

  $nodeExe = Resolve-NodeExe

  if (-not $nodeExe) {
    Write-Error 'No Node.js runtime was found to launch the Care Nova mock local runtime.'
    exit 1
  }

  $appDir = Split-Path -Parent $PSScriptRoot
  $mockRuntimeScript = Join-Path $PSScriptRoot 'mock-ollama-runtime.js'
  $mockRuntimeRunner = Join-Path $PSScriptRoot 'run-mock-local-runtime.ps1'
  $mockRuntimeOutLog = Join-Path $appDir 'mock-ollama-runtime.out.log'
  $mockRuntimeErrLog = Join-Path $appDir 'mock-ollama-runtime.err.log'

  if (-not (Test-Path $mockRuntimeScript)) {
    Write-Error "Mock local runtime script was not found at '$mockRuntimeScript'."
    exit 1
  }

  if (-not (Test-Path $mockRuntimeRunner)) {
    Write-Error "Mock local runtime runner was not found at '$mockRuntimeRunner'."
    exit 1
  }

  $runnerArgs = @(
    '-NoProfile',
    '-ExecutionPolicy Bypass',
    "-File `"$mockRuntimeRunner`"",
    "-NodeExe `"$nodeExe`"",
    '-Port "11434"'
  ) -join ' '

  Normalize-ProcessPathEnvironment

  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList $runnerArgs `
    -WorkingDirectory $appDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $mockRuntimeOutLog `
    -RedirectStandardError $mockRuntimeErrLog | Out-Null

  if (Wait-ForUrl -Url $mockRuntimeUrl) {
    Write-Output 'Care Nova mock local runtime is ready on http://127.0.0.1:11434'
    exit 0
  }

  Write-Error 'Care Nova mock local runtime did not become ready on http://127.0.0.1:11434.'
  exit 1
}

Write-Error "No Ollama or LM Studio runtime was found on this machine."
exit 1
