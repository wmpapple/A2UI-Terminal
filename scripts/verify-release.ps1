param(
  [string]$Tag = '',
  [ValidateSet('Development', 'UnsignedAcceptance', 'SignedRelease')]
  [string]$Mode = 'Development'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json
$tauri = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$identity = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'contracts\v2\release-identity.json') | ConvertFrom-Json
$cargoText = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'src-tauri\Cargo.toml')
$cargoMatch = [regex]::Match($cargoText, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
  if ([string]$Actual -cne [string]$Expected) {
    throw "$Label mismatch. Expected '$Expected', got '$Actual'."
  }
}

function Assert-SourceContains([string]$RelativePath, [string]$Expected, [string]$Label) {
  $content = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot $RelativePath)
  if (-not $content.Contains($Expected)) {
    throw "$Label is missing from $RelativePath."
  }
}

if (-not $cargoMatch.Success) {
  throw 'Unable to read the Cargo package version.'
}

$versions = @{
  package = [string]$package.version
  tauri = [string]$tauri.version
  cargo = $cargoMatch.Groups[1].Value
}
$uniqueVersions = @($versions.Values | Select-Object -Unique)
if ($uniqueVersions.Count -ne 1) {
  throw "Release versions are not synchronized: $($versions | ConvertTo-Json -Compress)"
}

$version = $uniqueVersions[0]
Assert-Equal $version $identity.releaseVersion 'Release contract version'
Assert-Equal $package.name $identity.repositoryPackageName 'Repository package name'
Assert-Equal $tauri.productName $identity.displayName 'Product display name'
Assert-Equal $tauri.app.windows[0].title $identity.displayName 'Main window title'
Assert-Equal $tauri.identifier $identity.technicalIdentity.bundleIdentifier 'Bundle identifier'
Assert-Equal $tauri.mainBinaryName $identity.technicalIdentity.mainBinaryName 'Main binary name'
Assert-Equal $tauri.bundle.windows.allowDowngrades $identity.windows.allowDowngrades 'Downgrade policy'
Assert-Equal $tauri.bundle.windows.nsis.installMode $identity.windows.installMode 'NSIS install mode'
Assert-Equal $tauri.bundle.windows.wix.upgradeCode $identity.windows.wixUpgradeCode 'MSI upgrade code'
Assert-Equal $tauri.bundle.windows.wix.language $identity.windows.wixLanguage 'MSI language/codepage'

if ($tauri.bundle.createUpdaterArtifacts -ne $false) {
  throw 'Base configuration must not create updater artifacts.'
}
if (-not [string]::IsNullOrEmpty([string]$tauri.plugins.updater.pubkey) -or @($tauri.plugins.updater.endpoints).Count -ne 0) {
  throw 'Base configuration must not contain an updater key or endpoint.'
}

Assert-SourceContains 'src-tauri\src\lib.rs' $identity.technicalIdentity.databaseFileName 'Stable database filename'
Assert-SourceContains 'src-tauri\src\security\credentials.rs' $identity.technicalIdentity.credentialService 'Stable credential service'
Assert-SourceContains $identity.windows.legacyMigrationHook $identity.windows.legacyNsisProductName 'Legacy NSIS product migration'
Assert-SourceContains $identity.windows.legacyMigrationHook '/UPDATE /P' 'NSIS data-preserving migration mode'
Assert-SourceContains $identity.windows.legacyMigrationHook 'NSIS_HOOK_PREUNINSTALL' 'NSIS uninstall data guard'
Assert-SourceContains $identity.windows.legacyMigrationHook 'DeleteAppDataCheckboxState = 1' 'NSIS managed-result deletion guard'

if ($Tag -and $Tag -ne "v$version") {
  throw "Tag '$Tag' must exactly match application version 'v$version'."
}

if ($Mode -eq 'SignedRelease') {
  if (-not $Tag) {
    throw 'SignedRelease mode requires an explicit version tag.'
  }
  $required = @(
    'WINDOWS_CERTIFICATE_BASE64',
    'WINDOWS_CERTIFICATE_PASSWORD',
    'WINDOWS_PUBLISHER',
    'TAURI_UPDATER_PUBLIC_KEY',
    'TAURI_SIGNING_PRIVATE_KEY'
  )
  $missing = $required | Where-Object {
    -not (Test-Path "Env:$_") -or [string]::IsNullOrWhiteSpace((Get-Item "Env:$_").Value)
  }
  if ($missing) {
    throw "Missing protected production release inputs: $($missing -join ', ')"
  }
  if ($env:WINDOWS_PUBLISHER -ceq $identity.displayName) {
    throw 'WINDOWS_PUBLISHER must identify the publisher and cannot equal the product name.'
  }
}

Write-Output "Release identity verified: $($identity.displayName) $version ($Mode)"
