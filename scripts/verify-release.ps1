param(
  [string]$Tag = ''
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json
$tauri = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$cargoText = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'src-tauri\Cargo.toml')
$cargoMatch = [regex]::Match($cargoText, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')

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
if ($Tag -and $Tag -ne "v$version") {
  throw "Tag '$Tag' must exactly match application version 'v$version'."
}

Write-Output "Release version verified: $version"
