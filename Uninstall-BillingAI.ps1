$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
$shortcutPaths = @(
  (Join-Path $desktop 'Billing AI.lnk'),
  (Join-Path $startMenu 'Billing AI.lnk')
)
foreach ($shortcutPath in $shortcutPaths) {
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
}

Write-Host 'Billing AI shortcuts removed. App files and billing data were preserved.'