$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS, reopen PowerShell, then run this script again.' }
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw 'Node.js 24 or later is required.' }
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your Internet connection.' }
npm.cmd run setup
if ($LASTEXITCODE -ne 0) { throw 'Setup failed.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Host 'Open http://localhost:4000 in your browser. Keep this terminal running.'
npm.cmd start
