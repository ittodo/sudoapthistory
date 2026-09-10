[CmdletBinding()]
param(
  [switch]$RefreshTool
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SchemaPath = Join-Path (Join-Path $RepoRoot 'schemas') 'nodostream.poly'
$OutputDir = Join-Path (Join-Path $RepoRoot 'js') 'generated'
$Resolver = Join-Path $PSScriptRoot 'resolve-polygen.ps1'
$PolygenExecutable = & $Resolver -Force:$RefreshTool
$PolygenRoot = if (-not [string]::IsNullOrWhiteSpace($env:POLYGEN_ROOT)) {
  (Resolve-Path -LiteralPath $env:POLYGEN_ROOT).Path
} else {
  Split-Path -Parent $PolygenExecutable
}
$TemplatesDir = if (-not [string]::IsNullOrWhiteSpace($env:POLYGEN_TEMPLATES_DIR)) {
  (Resolve-Path -LiteralPath $env:POLYGEN_TEMPLATES_DIR).Path
} else {
  Join-Path $PolygenRoot 'templates'
}

if (-not (Test-Path -LiteralPath $TemplatesDir -PathType Container)) {
  throw "PolyGen templates not found: $TemplatesDir"
}

Push-Location $PolygenRoot
try {
  & $PolygenExecutable generate `
    --schema-path $SchemaPath `
    --lang typescript `
    --output-dir $OutputDir `
    --templates-dir $TemplatesDir
  if ($LASTEXITCODE -ne 0) { throw "PolyGen generation failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
