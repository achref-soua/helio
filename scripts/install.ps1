# Helio one-line installer (Windows, PowerShell 5.1+):
#   irm https://github.com/achref-soua/helio/releases/latest/download/install.ps1 | iex
#
# Downloads helio.exe into %LOCALAPPDATA%\Helio\bin, adds it to the user
# PATH, offers to install Docker Desktop if it's missing (the one-time
# prerequisite), and runs `helio install` — which generates secrets and
# brings the stack up.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'achref-soua/helio'
$binDir = Join-Path $env:LOCALAPPDATA 'Helio\bin'
$exe = Join-Path $binDir 'helio.exe'

# Only x64 ships today; Windows-on-ARM runs it via the built-in emulation.
$asset = 'helio-windows-x64.exe'
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

# One-time prerequisite: Docker Desktop — a normal, free app install.
# When it's missing, offer to install it right here through winget
# (ships with Windows 10/11) instead of sending people to a website.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Helio runs on Docker Desktop — a one-time, free app install.'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  $answer = if ($winget) { Read-Host 'Install Docker Desktop now? [Y/n]' } else { 'n' }
  if ($winget -and ($answer -eq '' -or $answer -match '^[Yy]')) {
    winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'winget could not install Docker Desktop. Install it from'
      Write-Host 'https://www.docker.com/products/docker-desktop/ and run this command again.'
      exit 1
    }
    # The fresh install is not on this session's PATH yet.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
      [Environment]::GetEnvironmentVariable('Path', 'User')
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) { Start-Process $desktop }
    Write-Host 'waiting for Docker to start (the first start sets itself up — a few minutes)...'
    $deadline = (Get-Date).AddMinutes(6)
    $up = $false
    # Engine-down probes write to stderr; under 'Stop' PS 5.1 would treat
    # that as terminating, so relax the preference just for the wait loop.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    while ((Get-Date) -lt $deadline) {
      if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { $up = $true; break }
      }
      Start-Sleep -Seconds 5
    }
    $ErrorActionPreference = $eap
    if (-not $up) {
      Write-Host ''
      Write-Host 'Docker Desktop is installed but not running yet. On a first install Windows'
      Write-Host 'sometimes needs a restart: reboot, open Docker Desktop once, then run this'
      Write-Host 'installer command again — it picks up exactly where it left off.'
      exit 1
    }
  } else {
    Write-Host 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/'
    Write-Host 'then run this installer command again.'
    exit 1
  }
}

if ($env:HELIO_VERSION) {
  & $exe install --version $env:HELIO_VERSION
} else {
  & $exe install
}
exit $LASTEXITCODE
