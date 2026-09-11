$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sharedWorkspaceRoot = Split-Path -Parent $projectRoot
$localCargoHome = Join-Path $sharedWorkspaceRoot '.tooling\cargo'
$localRustupHome = Join-Path $sharedWorkspaceRoot '.tooling\rustup'
$localCargo = Join-Path $localCargoHome 'bin\cargo.exe'
$validationTarget = Join-Path $projectRoot 'src-tauri\target\s31-validation'

if (Test-Path -LiteralPath $localCargo) {
    $env:CARGO_HOME = $localCargoHome
    $env:RUSTUP_HOME = $localRustupHome
    $env:PATH = "$(Join-Path $localCargoHome 'bin');$env:PATH"
} elseif (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust/Cargo is not available. Install Rust or restore the local .tooling directory.'
}

$activeCompiler = Get-Process -Name rustc -ErrorAction SilentlyContinue
if ($activeCompiler) {
    throw 'Another Rust compiler is running. Wait for the desktop build to finish, then run this command again.'
}

(Get-Process -Id $PID).ProcessorAffinity = 1
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
$env:CARGO_TARGET_DIR = $validationTarget

Push-Location $projectRoot
try {
    Write-Output 'Running A2UI conformance with stable Rust, one build job, and an isolated target...'
    cargo test --manifest-path src-tauri/Cargo.toml --test a2ui_conformance -j1 -- --test-threads=1
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
