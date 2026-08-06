$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sharedWorkspaceRoot = Split-Path -Parent $projectRoot
$localCargoHome = Join-Path $sharedWorkspaceRoot '.tooling\cargo'
$localRustupHome = Join-Path $sharedWorkspaceRoot '.tooling\rustup'
$localCargo = Join-Path $localCargoHome 'bin\cargo.exe'

if (Test-Path -LiteralPath $localCargo) {
    $env:CARGO_HOME = $localCargoHome
    $env:RUSTUP_HOME = $localRustupHome
    $env:PATH = "$(Join-Path $localCargoHome 'bin');$env:PATH"
} elseif (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust/Cargo is not available. Install Rust or restore the local .tooling directory.'
}

Push-Location $projectRoot
try {
    npm run tauri dev
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
