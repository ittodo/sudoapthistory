$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$PolygenRoot = if ($env:POLYGEN_ROOT) { $env:POLYGEN_ROOT } else { 'D:\Work\PolyGen' }
$SchemaPath = Join-Path $RepoRoot 'schemas\nodostream.poly'
$OutputDir = Join-Path $RepoRoot 'js\generated'
$TemplatesDir = Join-Path $PolygenRoot 'templates'

if (-not (Test-Path -LiteralPath $PolygenRoot)) {
  throw "PolyGen root not found: $PolygenRoot"
}

Push-Location $PolygenRoot
try {
  cargo run --release -- generate `
    --schema-path $SchemaPath `
    --lang typescript `
    --output-dir $OutputDir `
    --templates-dir $TemplatesDir
} finally {
  Pop-Location
}
