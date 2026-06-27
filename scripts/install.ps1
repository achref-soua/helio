# Helio - install and operate a self-hosted Helio on Windows (PowerShell 5.1+).
#
# No compiled binary (nothing for SmartScreen/antivirus to flag) and no Docker
# commands to learn: this script drives Docker Compose for you. It installs
# Docker Desktop via winget if it is missing, downloads the pinned release
# bundle, checks its checksum, generates this install's secrets, and brings
# the stack up.
#
#   irm https://raw.githubusercontent.com/achref-soua/helio/main/scripts/install.ps1 | iex
#   # or, downloaded:  .\install.ps1 [install|update|uninstall|start|stop|status] [-Full] [-Version vX.Y.Z] [-Yes]
param(
  [ValidateSet('install','update','uninstall','start','stop','status','backup','restore','doctor','menu')]
  [string]$Command = 'menu',
  [switch]$Full,
  [string]$Version,
  [string]$File,
  [switch]$Yes,
  [switch]$PurgeData
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo       = if ($env:HELIO_REPO) { $env:HELIO_REPO } else { 'achref-soua/helio' }
$HelioHome  = if ($env:HELIO_HOME) { $env:HELIO_HOME } else { Join-Path $env:USERPROFILE '.helio' }
$ComposeFile = Join-Path $HelioHome 'docker-compose.yml'
$EnvFile     = Join-Path $HelioHome '.env'
$ManifestFile = Join-Path $HelioHome 'manifest.json'

function Say($m)  { Write-Host $m }
function Step($m) { Write-Host ''; Write-Host "-- $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "   ok $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

function New-RandomBytes([int]$n) {
  $b = [byte[]]::new($n)
  ([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($b)
  return ,$b
}
# Secret kinds match the CLI/install.sh. VAPID (web push) is left empty - that
# keypair is configured later from the dashboard.
function Get-Secret([string]$kind) {
  switch ($kind) {
    'HEX32'    { -join ((New-RandomBytes 32) | ForEach-Object { $_.ToString('x2') }) }
    'HEX24'    { -join ((New-RandomBytes 24) | ForEach-Object { $_.ToString('x2') }) }
    'PASSWORD' { ([Convert]::ToBase64String((New-RandomBytes 24))) -replace '\+','-' -replace '/','_' -replace '=','' }
    'B64'      { [Convert]::ToBase64String((New-RandomBytes 32)) }
    'VAPID'    { '' }
    default    { Die "unknown secret kind: $kind" }
  }
}

function Fill-Env($templatePath, $outPath) {
  $content = [IO.File]::ReadAllText($templatePath)
  $markers = [regex]::Matches($content, '__GENERATE_[A-Z0-9_]+__') | ForEach-Object { $_.Value } | Sort-Object -Unique
  foreach ($m in $markers) {
    $kind = [regex]::Replace($m, '^__GENERATE_([A-Z0-9]+)_.*$', '$1')
    $content = $content.Replace($m, (Get-Secret $kind))   # literal replace - no regex hazard
  }
  [IO.File]::WriteAllText($outPath, $content)
}

function Get-Env([string]$key) {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Select-String -Path $EnvFile -Pattern "^$([regex]::Escape($key))=" | Select-Object -First 1
  if ($line) { return ($line.Line -replace "^$([regex]::Escape($key))=", '') } else { return $null }
}
function Set-Env([string]$key, [string]$value) {
  $lines = if (Test-Path $EnvFile) { Get-Content $EnvFile } else { @() }
  if ($lines | Where-Object { $_ -match "^$([regex]::Escape($key))=" }) {
    ($lines | ForEach-Object { if ($_ -match "^$([regex]::Escape($key))=") { "$key=$value" } else { $_ } }) | Set-Content -NoNewline:$false $EnvFile
  } else {
    Add-Content $EnvFile "$key=$value"
  }
}

function Compose { docker compose --file $ComposeFile --env-file $EnvFile @args }

function Manifest-Version {
  if (-not (Test-Path $ManifestFile)) { return 'v0.0.0' }
  ((Get-Content -Raw $ManifestFile | ConvertFrom-Json).version)
}

function Ensure-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Say 'Helio runs on Docker Desktop - a one-time, free app install.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $answer = if ($winget -and -not $Yes) { Read-Host 'Install Docker Desktop now? [Y/n]' } elseif ($winget) { 'y' } else { 'n' }
    if ($winget -and ($answer -eq '' -or $answer -match '^[Yy]')) {
      winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
      if ($LASTEXITCODE -ne 0) { Die 'Could not install Docker Desktop. Install it from https://www.docker.com/products/docker-desktop/ and re-run.' }
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
      $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
      if (Test-Path $desktop) { Start-Process $desktop }
      Say 'waiting for Docker to start (the first start sets itself up - a few minutes)...'
      $deadline = (Get-Date).AddMinutes(6); $up = $false
      $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      while ((Get-Date) -lt $deadline) {
        if (Get-Command docker -ErrorAction SilentlyContinue) { docker info *> $null; if ($LASTEXITCODE -eq 0) { $up = $true; break } }
        Start-Sleep -Seconds 5
      }
      $ErrorActionPreference = $eap
      if (-not $up) { Die 'Docker Desktop installed but not running. Reboot, open Docker Desktop once, then re-run this command.' }
    } else {
      Die 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then re-run this command.'
    }
  }
  docker info *> $null; if ($LASTEXITCODE -ne 0) { Die 'Docker is installed but its daemon is not running - start Docker Desktop, then re-run.' }
  docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose v2 is missing." }
}

function Resolve-Tag {
  if ($Version) { $t = $Version }
  else { $t = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing).tag_name }
  if (-not $t) { Die 'could not resolve the release version' }
  if ($t -notlike 'v*') { $t = "v$t" }
  return $t
}

function Download-Bundle($tag) {
  New-Item -ItemType Directory -Force -Path (Join-Path $HelioHome 'releases') | Out-Null
  $bundle = Join-Path $HelioHome "releases\helio-bundle-$tag.tar.gz"
  $sums   = Join-Path $HelioHome "releases\checksums-$tag.txt"
  $base   = "https://github.com/$Repo/releases/download/$tag"
  Invoke-WebRequest "$base/helio-bundle-$tag.tar.gz" -OutFile $bundle -UseBasicParsing
  Invoke-WebRequest "$base/checksums.txt" -OutFile $sums -UseBasicParsing
  $want = (Select-String -Path $sums -Pattern "helio-bundle-$tag.tar.gz" | Select-Object -First 1).Line.Split(' ')[0]
  if (-not $want) { Die 'no checksum for the bundle in checksums.txt' }
  $got = (Get-FileHash -Algorithm SHA256 $bundle).Hash.ToLower()
  if ($want.ToLower() -ne $got) { Die "bundle checksum mismatch (expected $want, got $got) - refusing to install" }
  Ok "bundle $tag verified (sha256 matches)"
  tar -xzf $bundle -C $HelioHome    # tar ships with Windows 10/11
  if ($LASTEXITCODE -ne 0) { Die 'could not extract the bundle (is tar available?)' }
}

function Wait-Healthy {
  $url = (Get-Env 'APP_URL'); if (-not $url) { $url = 'http://localhost:3000' }
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "$url/api/healthz" -UseBasicParsing -TimeoutSec 4 | Out-Null; return $true } catch { Start-Sleep 2 }
  }
  return $false
}

# Save this script as ~/.helio/helio.ps1 so day-2 ops are `helio.ps1 <command>`
# (a plain script — nothing for SmartScreen to flag).
function Save-Self {
  $dest = Join-Path $HelioHome 'helio.ps1'
  try {
    if ($PSCommandPath) { Copy-Item $PSCommandPath $dest -Force }
    else { Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/install.ps1" -OutFile $dest -UseBasicParsing }
  } catch { }
}

function Cmd-Install {
  Step 'Checking Docker'; Ensure-Docker; Ok 'Docker is installed and running'
  if (Test-Path $ManifestFile) { Die "Helio is already installed at $HelioHome (use update, or uninstall)." }
  New-Item -ItemType Directory -Force -Path $HelioHome | Out-Null
  $tag = Resolve-Tag
  Step "Downloading Helio $tag"; Download-Bundle $tag
  Step "Generating this install's secrets"
  Fill-Env (Join-Path $HelioHome '.env.template') $EnvFile
  Set-Env 'COMPOSE_PROFILES' $(if ($Full) { 'full' } else { 'core' })
  Copy-Item (Join-Path $HelioHome 'manifest.json') $ManifestFile -Force -ErrorAction SilentlyContinue
  Ok "configuration written to $EnvFile (keep this file with your backups)"
  $prof = if ($Full) { 'full' } else { 'core' }
  Step 'Pulling images (the first install downloads 1-2 GB)'; Compose --profile $prof pull; if ($LASTEXITCODE) { Die 'image pull failed' }
  Step 'Starting databases'; Compose up -d --wait postgres redis mailpit; if ($LASTEXITCODE) { Die 'datastores failed to start' }
  Step 'Preparing the database'; Compose --profile ops run --rm migrate deploy; if ($LASTEXITCODE) { Die 'database migration failed' }
  Step 'Starting Helio'; Compose --profile $prof up -d --wait; if ($LASTEXITCODE) { Die 'services did not become healthy (try: status)' }
  Save-Self
  $url = (Get-Env 'APP_URL'); if (-not $url) { $url = 'http://localhost:3000' }
  if (Wait-Healthy) { Ok 'the dashboard is answering' } else { Warn 'still warming up - run status to check' }
  Say ''; Say '  Helio is up.'; Say ''; Say "  dashboard   $url"
  Say "  manage      $HelioHome\helio.ps1 status | update | stop"; Say ''
  Say 'Open the dashboard and create the first account - it becomes the administrator.'
  Start-Process $url
}

function Cmd-Update {
  if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome - run install" }
  Step 'Checking Docker'; Ensure-Docker; Ok 'Docker is ready'
  $current = Manifest-Version; $tag = Resolve-Tag
  if ($tag -eq $current) { Say "already on $current - nothing to update."; return }
  Step "Updating $current -> $tag"
  Step 'Backing up the database first (the rollback path)'
  Compose --profile ops run --rm backup run pre-update; if ($LASTEXITCODE) { Die 'pre-update backup failed - fix that first.' }
  Ok "backup saved to $HelioHome\backups"
  Step "Fetching $tag"; Download-Bundle $tag
  Step 'Applying the update'
  Compose down | Out-Null
  Copy-Item (Join-Path $HelioHome 'manifest.json') $ManifestFile -Force -ErrorAction SilentlyContinue
  $prof = (Get-Env 'COMPOSE_PROFILES'); if (-not $prof) { $prof = 'core' }
  Compose --profile $prof pull; if ($LASTEXITCODE) { Die 'image pull failed' }
  Compose up -d --wait postgres redis mailpit; if ($LASTEXITCODE) { Die 'datastores failed to start' }
  Compose --profile ops run --rm migrate deploy; if ($LASTEXITCODE) { Die "migration failed - restore the pre-update backup in $HelioHome\backups" }
  Compose --profile $prof up -d --wait; if ($LASTEXITCODE) { Die 'services did not become healthy (try: status)' }
  if (Wait-Healthy) { Ok "Helio $tag is up" } else { Warn 'update applied; still warming up' }
}

function Cmd-Uninstall {
  if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome" }
  if ($PurgeData) { Warn 'This stops Helio and PERMANENTLY ERASES its database, volumes, and configuration.' }
  else { Warn 'This stops Helio and removes its containers. Your data volumes are kept.' }
  if (-not $Yes) { if ((Read-Host 'Type "uninstall" to continue') -ne 'uninstall') { Warn 'aborted - nothing changed'; exit 1 } }
  if ($PurgeData) {
    Compose --profile core --profile full --profile ops --profile update down --volumes 2>$null
    Remove-Item -Recurse -Force $HelioHome; Say "removed $HelioHome"
  } else {
    Compose --profile core --profile full --profile update down 2>$null
    Say "stopped. Data is kept in Docker volumes; run start to bring it back."
  }
}

function Cmd-Start  { if (-not (Test-Path $ManifestFile)) { Die 'no installation - run install' }; $p = (Get-Env 'COMPOSE_PROFILES'); if (-not $p) { $p = 'core' }; Compose --profile $p up -d --wait }
function Cmd-Stop   { if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome" }; Compose --profile core --profile full --profile update down }
function Cmd-Status {
  if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome - run install" }
  Say "Helio $(Manifest-Version) at $HelioHome (profile: $(Get-Env 'COMPOSE_PROFILES'))"
  Compose ps
}

function Cmd-Backup {
  if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome" }
  Compose run --rm backup run manual
  Say "backup written to $HelioHome\backups"
}

function Cmd-Restore {
  if (-not (Test-Path $ManifestFile)) { Die "no installation at $HelioHome" }
  if (-not $File) { Die "usage: .\install.ps1 restore -File <backup-file>  (see $HelioHome\backups)" }
  Warn 'Restoring REPLACES the current database with the backup - anything newer is lost.'
  if (-not $Yes) { if ((Read-Host 'Type "restore" to continue') -ne 'restore') { Warn 'aborted'; exit 1 } }
  Compose run --rm backup restore $File
}

function Cmd-Doctor {
  $healthy = $true
  if ((Get-Command docker -ErrorAction SilentlyContinue)) { docker info *> $null; if ($LASTEXITCODE -eq 0) { Ok 'Docker is installed and running' } else { Warn 'Docker daemon not running'; $healthy = $false } }
  else { Warn 'Docker not installed'; $healthy = $false }
  if (Test-Path $ManifestFile) {
    Say "   installed: Helio $(Manifest-Version) at $HelioHome (profile: $(Get-Env 'COMPOSE_PROFILES'))"
    $url = (Get-Env 'APP_URL'); if (-not $url) { $url = 'http://localhost:3000' }
    try { Invoke-WebRequest "$url/api/healthz" -UseBasicParsing -TimeoutSec 4 | Out-Null; Ok "dashboard answering at $url" } catch { Warn "dashboard not answering at $url"; $healthy = $false }
  } else { Say "   not installed here - run: .\install.ps1 install" }
  if ($healthy) { Ok 'all checks passed' } else { Warn 'some checks failed (see above)' }
}

function Cmd-Menu {
  Write-Host ''; Write-Host 'Helio - self-hosted, one script' -ForegroundColor White
  if (Test-Path $ManifestFile) {
    Say "installed: Helio $(Manifest-Version) at $HelioHome"
    Say ''; Say '  1  Open the dashboard'; Say '  2  Start'; Say '  3  Stop'; Say '  4  Status'; Say '  5  Update'; Say '  6  Uninstall'
    switch (Read-Host "`n  choose 1-6, or q to quit") {
      '1' { $u = (Get-Env 'APP_URL'); Start-Process $(if ($u) { $u } else { 'http://localhost:3000' }) }
      '2' { Cmd-Start } '3' { Cmd-Stop } '4' { Cmd-Status } '5' { Cmd-Update } '6' { Cmd-Uninstall }
      default { }
    }
  } else {
    Say ''; Say 'Helio is not installed here.'; Say '  1  Install Helio'
    if ((Read-Host "`n  press 1 to install, or q to quit") -eq '1') { Cmd-Install }
  }
}

switch ($Command) {
  'install'   { Cmd-Install }
  'update'    { Cmd-Update }
  'uninstall' { Cmd-Uninstall }
  'start'     { Cmd-Start }
  'stop'      { Cmd-Stop }
  'status'    { Cmd-Status }
  'backup'    { Cmd-Backup }
  'restore'   { Cmd-Restore }
  'doctor'    { Cmd-Doctor }
  default     { Cmd-Menu }
}
