param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('UnsignedAcceptance', 'SignedRelease')]
  [string]$Mode,
  [string]$BundleRoot = 'src-tauri/target/release/bundle'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$identity = Get-Content -Raw -Encoding utf8 (Join-Path $repositoryRoot 'contracts\v2\release-identity.json') | ConvertFrom-Json
$resolvedBundleRoot = Resolve-Path (Join-Path $repositoryRoot $BundleRoot) -ErrorAction Stop
$installers = @(Get-ChildItem $resolvedBundleRoot -Recurse -File | Where-Object { $_.Extension -in '.exe', '.msi' })

if (-not ($installers | Where-Object Extension -eq '.exe')) {
  throw 'No NSIS installer was produced.'
}
if (-not ($installers | Where-Object Extension -eq '.msi')) {
  throw 'No MSI installer was produced.'
}

$expectedName = [regex]::Escape("$($identity.displayName)_$($identity.releaseVersion)_")
foreach ($installer in $installers) {
  if ($installer.Name -notmatch $expectedName) {
    throw "Unexpected installer identity: $($installer.Name)"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
  if ($Mode -eq 'UnsignedAcceptance' -and $signature.Status -ne 'NotSigned') {
    throw "Unsigned acceptance artifact has unexpected signature state: $($installer.Name) ($($signature.Status))"
  }
  if ($Mode -eq 'SignedRelease' -and $signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature: $($installer.Name) ($($signature.Status))"
  }
}

$updaterSignatures = @(Get-ChildItem $resolvedBundleRoot -Recurse -Filter '*.sig' -File)
$updaterManifests = @(Get-ChildItem $resolvedBundleRoot -Recurse -Filter 'latest.json' -File)
if ($Mode -eq 'UnsignedAcceptance' -and ($updaterSignatures.Count -ne 0 -or $updaterManifests.Count -ne 0)) {
  throw 'Unsigned acceptance bundle must not contain updater signatures or latest.json.'
}
if ($Mode -eq 'SignedRelease' -and $updaterSignatures.Count -eq 0) {
  throw 'Signed release bundle does not contain updater signatures.'
}
if ($Mode -eq 'SignedRelease' -and $updaterManifests.Count -ne 1) {
  throw "Signed release bundle must contain exactly one latest.json; found $($updaterManifests.Count)."
}

Write-Output "Windows artifacts verified: $($installers.Count) installers ($Mode)."
