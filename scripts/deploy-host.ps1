$ErrorActionPreference = 'Stop'

param(
    [ValidateSet('x64-debug', 'x64-release')]
    [string]$Preset = 'x64-debug'
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcRoot = Join-Path $repoRoot "build\$Preset\src\host"
$toolsRoot = Join-Path $repoRoot "build\$Preset\tools"
$dstRoot = Join-Path $env:LocalAppData 'VRCSM'

Write-Host "src: $srcRoot"
Write-Host "dst: $dstRoot"

if (-not (Test-Path -LiteralPath $srcRoot)) {
    throw "Host build output not found: $srcRoot"
}

if (-not (Test-Path -LiteralPath $dstRoot)) {
    Write-Host "Install dir missing, creating."
    New-Item -ItemType Directory -Path $dstRoot | Out-Null
}

Write-Host "`n-- current install --"
Get-ChildItem $dstRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("{0,10}  {1:yyyy-MM-dd HH:mm}  {2}" -f $_.Length, $_.LastWriteTime, $_.FullName.Substring($dstRoot.Length + 1))
}

$exeSrc = Join-Path $srcRoot 'VRCSM.exe'
$exeDst = Join-Path $dstRoot 'VRCSM.exe'
Write-Host "`nCopying VRCSM.exe..."
Copy-Item -LiteralPath $exeSrc -Destination $exeDst -Force

$toolDirs = @('dump_thumbnails', 'dump_logs', 'dump_settings', 'dump_avatar_details', 'tail_probe')
foreach ($tool in $toolDirs) {
    $toolSrc = Join-Path $toolsRoot "$tool\$tool.exe"
    if (Test-Path -LiteralPath $toolSrc) {
        $toolDst = Join-Path $dstRoot "$tool.exe"
        Write-Host "Copying $tool.exe..."
        Copy-Item -LiteralPath $toolSrc -Destination $toolDst -Force
    }
}

$webSrc = Join-Path $srcRoot 'web'
$webDst = Join-Path $dstRoot 'web'
if (Test-Path -LiteralPath $webSrc) {
    Write-Host "`nSyncing web dist..."
    if (Test-Path -LiteralPath $webDst) {
        Remove-Item -LiteralPath $webDst -Recurse -Force
    }
    Copy-Item -LiteralPath $webSrc -Destination $webDst -Recurse -Force
}

$extraFiles = @('WebView2Loader.dll', 'VRCSM.ico')
foreach ($name in $extraFiles) {
    $src = Join-Path $srcRoot $name
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $dstRoot $name) -Force
    }
}

Write-Host "`n-- new install --"
Get-ChildItem $dstRoot -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("{0,10}  {1:yyyy-MM-dd HH:mm}  {2}" -f $_.Length, $_.LastWriteTime, $_.Name)
}

Write-Host "`nDONE."
