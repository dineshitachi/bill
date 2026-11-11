param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$ruleName = 'Namma Bill POS HTTPS Reverse Proxy'
$isAdministrator = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdministrator) { throw 'Run PowerShell as Administrator to manage Windows Firewall rules.' }

if ($Remove) {
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    $existing | Remove-NetFirewallRule
    Write-Host 'Removed the Namma Bill POS firewall rule.'
  } else {
    Write-Host 'The Namma Bill POS firewall rule was not present.'
  }
  return
}

if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -Profile Domain,Private
}
Write-Host 'Allowed inbound HTTP/HTTPS on Domain and Private network profiles only.'
Write-Host 'Remove the rule with: .\Install-ProxyAccess.ps1 -Remove'