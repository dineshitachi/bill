param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://')]
  [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run Deploy-OnPrem.ps1 first to create the protected platform\.env file.' }

$secretLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^PROVISIONING_SECRET=' } | Select-Object -First 1
if (-not $secretLine) { throw 'PROVISIONING_SECRET is missing from platform\.env.' }
$secret = $secretLine.Substring('PROVISIONING_SECRET='.Length)
if ($secret.Length -lt 32) { throw 'PROVISIONING_SECRET must contain at least 32 characters.' }

$tenantName = Read-Host 'Workspace name (for example Dark World)'
$slug = Read-Host 'Workspace slug (lowercase letters, digits, hyphens)'
$legalName = Read-Host 'Legal entity name (default Chinnathambi Traders)'
if ([string]::IsNullOrWhiteSpace($legalName)) { $legalName = 'Chinnathambi Traders' }
$adminUsername = Read-Host 'Administrator username'
$adminDisplayName = Read-Host 'Administrator display name'
$stateCode = Read-Host 'Supplier GST state code (default 33)'
if ([string]::IsNullOrWhiteSpace($stateCode)) { $stateCode = '33' }
$securePassword = Read-Host 'Administrator password (12+ characters)' -AsSecureString
$passwordPointer = [IntPtr]::Zero
try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($plainPassword.Length -lt 12) { throw 'Administrator password must be at least 12 characters.' }
  $body = @{
    name = $tenantName
    slug = $slug
    legalName = $legalName
    adminUsername = $adminUsername
    adminDisplayName = $adminDisplayName
    adminPassword = $plainPassword
    stateCode = $stateCode
  } | ConvertTo-Json -Depth 4
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $result = Invoke-RestMethod -Method Post -Uri ($BaseUrl.TrimEnd('/') + '/api/v1/provision') `
    -Headers @{ 'x-provisioning-secret' = $secret } -ContentType 'application/json' -Body $body
  Write-Host "Tenant provisioned: $($result.tenant.name) ($($result.tenant.slug))"
  Write-Host "Sign-in URL: $BaseUrl"
  Write-Host 'API key (shown once; store in your secure secret manager):'
  Write-Host $result.installation.apiKey
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $plainPassword = $null
  $body = $null
}
