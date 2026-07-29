$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$extensionDir = Join-Path $root "extension"
$manifestPath = Join-Path $extensionDir "manifest.json"

if (-not (Test-Path $manifestPath)) {
  throw "Could not find extension manifest at $manifestPath"
}

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$safeName = ($manifest.name -replace "[^a-zA-Z0-9]+", "-").Trim("-").ToLowerInvariant()
$version = $manifest.version

$distDir = Join-Path $root "dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$zipPath = Join-Path $distDir "$safeName-$version.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $extensionDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Created $zipPath"
