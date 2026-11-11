param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$')]
  [string]$Domain
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) }
  finally { $generator.Dispose() }
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Get-StrongEnvironmentSecret([string]$Path, [string]$Name) {
  $entries = @(Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" })
  if ($entries.Count -ne 1) { throw "platform\.env must contain exactly one $Name entry." }

  $value = [regex]::Match($entries[0], "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$").Groups[1].Value
  if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length - 1] -eq '"') -or ($value[0] -eq "'" -and $value[$value.Length - 1] -eq "'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^(?i:REPLACE|CHANGE|YOUR|EXAMPLE|CHANGEME)') {
    throw "$Name in platform\.env is a placeholder or empty. Replace it with a unique random secret of at least 32 bytes."
  }

  try {
    if ($value -match '^(?:[0-9a-fA-F]{2}){32,}$') {
      $secretBytes = New-Object byte[] ($value.Length / 2)
      for ($index = 0; $index -lt $secretBytes.Length; $index++) {
        [void]($secretBytes[$index] = [Convert]::ToByte($value.Substring($index * 2, 2), 16))
      }
    } elseif ($value -match '^[A-Za-z0-9+/_-]+={0,2}$') {
      $base64 = $value.Replace('-', '+').Replace('_', '/').TrimEnd('=')
      if (($base64.Length % 4) -eq 1) { throw 'Invalid secret encoding.' }
      $base64 += '=' * ((4 - ($base64.Length % 4)) % 4)
      $secretBytes = [Convert]::FromBase64String($base64)
    } else {
      throw 'Invalid secret encoding.'
    }
  } catch {
    throw "$Name in platform\.env must be a unique random secret encoded as hexadecimal or Base64 with at least 32 bytes."
  }

  if ($secretBytes.Length -lt 32) { throw "$Name in platform\.env must contain at least 32 random bytes." }
  if (@($secretBytes | Select-Object -Unique).Count -lt 16) { throw "$Name in platform\.env is too repetitive. Generate a new random secret." }
  return [Convert]::ToBase64String($secretBytes)
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) { throw 'Docker is required. Install Docker Engine or Docker Desktop with the Compose plugin.' }
& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  $adminPassword = New-RandomSecret
  $appPassword = New-RandomSecret
  $jwtSecret = New-RandomSecret
  $provisionSecret = New-RandomSecret
  $dataEncryptionKey = New-RandomSecret
  $content = @"
DOMAIN=$Domain
POSTGRES_DB=namma_bill
POSTGRES_SUPERUSER=postgres
POSTGRES_ADMIN_PASSWORD=$adminPassword
APP_DB_USER=namma_bill
APP_DB_PASSWORD=$appPassword
DATABASE_URL=postgresql://namma_bill:$appPassword@db:5432/namma_bill?schema=public
JWT_SECRET=$jwtSecret
PROVISIONING_SECRET=$provisionSecret
DATA_ENCRYPTION_KEY=$dataEncryptionKey
NODE_ENV=production
PORT=3000
GSTIN_PROVIDER_URL=
GSTIN_PROVIDER_TOKEN=
AI_BASE_URL=
AI_MODEL=
AI_API_KEY=
"@
  [IO.File]::WriteAllText($envPath, $content + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  if (Get-Command icacls.exe -ErrorAction SilentlyContinue) {
    & icacls.exe $envPath /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not restrict .env file permissions; secure the file manually.' }
  }
  Write-Host 'Generated strong database and application secrets in platform\.env.'
}

$jwtSecretBytes = Get-StrongEnvironmentSecret $envPath 'JWT_SECRET'
$provisionSecretBytes = Get-StrongEnvironmentSecret $envPath 'PROVISIONING_SECRET'
$dataEncryptionKeyBytes = Get-StrongEnvironmentSecret $envPath 'DATA_ENCRYPTION_KEY'
$decodedDataEncryptionKey = [Convert]::FromBase64String($dataEncryptionKeyBytes)
if ($decodedDataEncryptionKey.Length -ne 32) {
  throw 'DATA_ENCRYPTION_KEY must encode exactly 32 random bytes.'
}
if (
  [string]::Equals($jwtSecretBytes, $provisionSecretBytes, [StringComparison]::Ordinal) -or
  [string]::Equals($jwtSecretBytes, $dataEncryptionKeyBytes, [StringComparison]::Ordinal) -or
  [string]::Equals($provisionSecretBytes, $dataEncryptionKeyBytes, [StringComparison]::Ordinal)
) {
  throw 'JWT_SECRET, PROVISIONING_SECRET, and DATA_ENCRYPTION_KEY must be different random secrets.'
}

$certificate = Join-Path $root 'certs\fullchain.pem'
$privateKey = Join-Path $root 'certs\privkey.pem'
if (-not (Test-Path -LiteralPath $certificate) -or -not (Test-Path -LiteralPath $privateKey)) {
  Write-Host ''
  Write-Host "TLS certificate files are required before the reverse proxy can start:"
  Write-Host "  $certificate"
  Write-Host "  $privateKey"
  Write-Host "Point DNS for $Domain to this server, obtain a trusted certificate, and copy its full chain and key to those paths."
  Write-Host 'Do not use a self-signed certificate for public production use.'
  return
}

Push-Location $root
try {
  & docker compose --env-file $envPath up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose deployment failed. Review: docker compose logs --tail 100' }
  & docker compose --env-file $envPath ps
  Write-Host "Deployment started at https://$Domain"
}
finally {
  Pop-Location
}
