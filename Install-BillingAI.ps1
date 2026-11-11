$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$launcherPath = Join-Path $root 'Start-BillingAI.ps1'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Start-BillingAI.ps1 was not found beside this installer.' }

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$shortcutTargets = [System.Collections.Generic.List[string]]::new()
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not [string]::IsNullOrWhiteSpace($desktop)) { $shortcutTargets.Add((Join-Path $desktop 'Billing AI.lnk')) }
$startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
if (-not (Test-Path -LiteralPath $startMenu)) { New-Item -ItemType Directory -Path $startMenu -Force | Out-Null }
$shortcutTargets.Add((Join-Path $startMenu 'Billing AI.lnk'))

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in $shortcutTargets) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powerShellPath
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" -AppMode -NoShortcut"
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'Start CHINNATHAMBI TRADERS Billing AI'
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  $shortcut.Save()
}

Write-Host 'Billing AI shortcuts installed for this Windows user.'
Write-Host 'Choose Billing AI from the Desktop or Start Menu to launch the app window.'
Write-Host 'The existing app files and billing database remain in this folder.'
Write-Host 'Run Uninstall-BillingAI.ps1 to remove the shortcuts.'