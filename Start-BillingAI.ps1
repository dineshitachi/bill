param([int]$Port = 0, [switch]$NoBrowser, [switch]$NoShortcut, [switch]$AppMode)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$gatewayPath = Join-Path $root 'local-api\server.mjs'
$launcherPath = Join-Path $root 'Start-BillingAI.ps1'
$selectedPort = $null

function Test-BillingServer([int]$CandidatePort) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$CandidatePort/health" -TimeoutSec 2
    return $response.status -in @('ok', 'degraded') -and $response.storage -eq 'sqlite' -and $response.gateway -eq 'fastify'
  } catch { return $false }
}

function Test-PortAvailable([int]$CandidatePort) {
  $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
  try { $probe.Start(); return $true }
  catch { return $false }
  finally { try { $probe.Stop() } catch { } }
}

$candidatePorts = if ($Port -gt 0) { @($Port) + (($Port + 1)..($Port + 20)) } else { 8766..8785 }
foreach ($candidatePort in $candidatePorts) {
  if (Test-BillingServer $candidatePort) { $selectedPort = $candidatePort; break }
  if (Test-PortAvailable $candidatePort) { $selectedPort = $candidatePort; break }
}
if ($null -eq $selectedPort) {
  if ($Port -gt 0) { throw "No available local app port was found between $Port and $($Port + 20)." }
  throw 'No available local app port was found between 8766 and 8785.'
}

if (-not (Test-BillingServer $selectedPort)) {
  if (-not (Test-Path -LiteralPath $gatewayPath)) { throw 'Fastify gateway entry point was not found.' }
  $arguments = "`"$gatewayPath`" --port $selectedPort"
  $serverProcess = Start-Process -FilePath 'node.exe' -ArgumentList $arguments -WorkingDirectory $root -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-BillingServer $selectedPort) { $ready = $true; break }
    if ($serverProcess.HasExited) { throw "Billing server exited during startup (exit code $($serverProcess.ExitCode))." }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Billing server did not become ready at http://127.0.0.1:$selectedPort/ within 15 seconds." }
}

if (-not $NoShortcut) {
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not [string]::IsNullOrWhiteSpace($desktop)) {
    $shortcutPath = Join-Path $desktop 'Billing AI.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $appModeArgument = if ($AppMode) { ' -AppMode' } else { '' }
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`"$appModeArgument"
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Start the local billing app'
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
    $shortcut.Save()
  }
} catch { Write-Warning 'Could not create a desktop shortcut. Start-BillingAI.cmd remains available in the app folder.' }
}

$appUrl = "http://127.0.0.1:$selectedPort/"
if (-not $NoBrowser) {
  if ($AppMode) {
    $edgePaths = @((Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'))
    $edgePath = $edgePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($edgePath) { Start-Process -FilePath $edgePath -ArgumentList @('--app=' + $appUrl) }
    else { Start-Process $appUrl }
  } else { Start-Process $appUrl }
}
Write-Host "Billing app is ready at $appUrl"