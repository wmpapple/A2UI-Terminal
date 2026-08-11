param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryPath
)

$ErrorActionPreference = 'Stop'
$resolvedBinary = (Resolve-Path -LiteralPath $BinaryPath).Path
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) "a2ui-terminal-smoke-$([guid]::NewGuid())"
$resolvedTemp = (Resolve-Path ([IO.Path]::GetTempPath())).Path.TrimEnd('\')
$process = $null

New-Item -ItemType Directory -Path $smokeRoot | Out-Null
try {
  $env:APPDATA = $smokeRoot
  $env:LOCALAPPDATA = $smokeRoot
  $process = Start-Process -FilePath $resolvedBinary -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 5
  if ($process.HasExited) {
    throw "Desktop process exited during startup with code $($process.ExitCode)."
  }
  Write-Output "Desktop startup smoke passed (PID $($process.Id))."
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  $resolvedSmoke = [IO.Path]::GetFullPath($smokeRoot)
  if ($resolvedSmoke.StartsWith("$resolvedTemp\a2ui-terminal-smoke-", [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force -ErrorAction SilentlyContinue
  }
}
