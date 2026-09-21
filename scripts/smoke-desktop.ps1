param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryPath
)

$ErrorActionPreference = 'Stop'
$resolvedBinary = (Resolve-Path -LiteralPath $BinaryPath).Path
# Refuse older binaries before launch: they would ignore the isolation argument.
$marker = 'A2UI_SMOKE_ISOLATION_V1'
if (-not [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($resolvedBinary)).Contains($marker)) {
  throw 'This binary does not support isolated desktop smoke tests. Rebuild it first.'
}
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) "a2ui-terminal-smoke-$([guid]::NewGuid())"
$resolvedTemp = (Resolve-Path ([IO.Path]::GetTempPath())).Path.TrimEnd('\')
$process = $null

New-Item -ItemType Directory -Path $smokeRoot | Out-Null
try {
  $process = Start-Process -FilePath $resolvedBinary -ArgumentList @('--smoke-test-root', "`"$smokeRoot`"") -PassThru -WindowStyle Hidden
  $receiptPath = Join-Path $smokeRoot 'ready.json'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while (-not (Test-Path -LiteralPath $receiptPath) -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
  }
  if ($process.HasExited) {
    throw "Desktop process exited during startup with code $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $receiptPath)) {
    throw 'Desktop startup did not produce its isolation receipt within 30 seconds.'
  }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.protocol -ne $marker -or $receipt.credentialsDisabled -ne $true -or
      $receipt.database -ne 'app-data/a2ui-terminal.sqlite3' -or $receipt.webview -ne 'webview' -or
      -not (Test-Path -LiteralPath (Join-Path $smokeRoot 'app-data/a2ui-terminal.sqlite3'))) {
    throw 'Desktop startup isolation receipt or temporary database is invalid.'
  }
  Start-Sleep -Seconds 5
  $process.Refresh()
  if ($process.HasExited) { throw 'Desktop process exited after initialization.' }
  Write-Output "Desktop startup smoke passed (PID $($process.Id)); isolated database and WebView; system credentials disabled."
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  $resolvedSmoke = (Resolve-Path -LiteralPath $smokeRoot).Path
  $smokeItem = Get-Item -LiteralPath $resolvedSmoke
  if ([IO.Path]::GetDirectoryName($resolvedSmoke).Equals($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
      $smokeItem.Name -match '^a2ui-terminal-smoke-[0-9a-f-]{36}$' -and
      -not ($smokeItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $resolvedSmoke); $attempt++) {
      Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $resolvedSmoke) { Start-Sleep -Milliseconds 500 }
    }
    if (Test-Path -LiteralPath $resolvedSmoke) { throw "Temporary smoke directory cleanup failed: $resolvedSmoke" }
  } else {
    throw "Refusing cleanup outside the verified temporary smoke directory: $resolvedSmoke"
  }
}
