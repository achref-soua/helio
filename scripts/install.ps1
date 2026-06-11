# Helio one-line installer (Windows, PowerShell 5.1+):
#   irm https://github.com/achref-soua/helio/releases/latest/download/install.ps1 | iex
#
# Downloads helio.exe into %LOCALAPPDATA%\Helio\bin, adds it to the user
# PATH, and runs `helio install` — which checks Docker Desktop (WSL 2
# backend), generates secrets, and brings the stack up.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'achref-soua/helio'
$binDir = Join-Path $env:LOCALAPPDATA 'Helio\bin'
$exe = Join-Path $binDir 'helio.exe'

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$asset = "helio-windows-$arch.exe"
$url = if ($env:HELIO_VERSION) {
  "https://github.com/$repo/releases/download/$($env:HELIO_VERSION)/$asset"
} else {
  "https://github.com/$repo/releases/latest/download/$asset"
}

Write-Host "downloading $asset..."
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing

# Put helio on the user PATH (new shells pick it up automatically).
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$binDir;$userPath", 'User')
  $env:Path = "$binDir;$env:Path"
  Write-Host "added $binDir to your PATH"
}

Write-Host ''
Write-Host "helio installed to $exe"
Write-Host ''

if ($env:HELIO_VERSION) {
  & $exe install --version $env:HELIO_VERSION
} else {
  & $exe install
}
exit $LASTEXITCODE
