$ErrorActionPreference = 'Stop'

$srcRoot = 'D:\Project\VRCSM\build\x64-debug\src\host'
$dstRoot = Join-Path $env:LocalAppData 'VRCSM'

Write-Host "src: $srcRoot"
Write-Host "dst: $dstRoot"

if (-not (Test-Path $dstRoot)) {
    Write-Host "Install dir missing, creating."
    New-Item -ItemType Directory -Path $dstRoot | Out-Null
}

# List current install
Write-Host "`n-- current install --"
Get-ChildItem $dstRoot -Recurse -File | ForEach-Object {
    Write-Host ("{0,10}  {1:yyyy-MM-dd HH:mm}  {2}" -f $_.Length, $_.LastWriteTime, $_.FullName.Substring($dstRoot.Length + 1))
}

# Copy VRCSM.exe
$exeSrc = Join-Path $srcRoot 'VRCSM.exe'
$exeDst = Join-Path $dstRoot 'VRCSM.exe'
Write-Host "`nCopying VRCSM.exe..."
Copy-Item -Path $exeSrc -Destination $exeDst -Force

# Copy dump_thumbnails (needed for v0.1.1 thumbnail pipeline)
$toolDirs = @('dump_thumbnails', 'dump_logs', 'dump_settings')
foreach ($tool in $toolDirs) {
    $toolSrc = Join-Path 'D:\Project\VRCSM\build\x64-debug\tools' "$tool\$tool.exe"
    if (Test-Path $toolSrc) {
        $toolDst = Join-Path $dstRoot "$tool.exe"
        Write-Host "Copying $tool.exe..."
        Copy-Item -Path $toolSrc -Destination $toolDst -Force
    }
}

# Sync web dist
$webSrc = Join-Path $srcRoot 'web'
$webDst = Join-Path $dstRoot 'web'
if (Test-Path $webSrc) {
    Write-Host "`nSyncing web dist..."
    if (Test-Path $webDst) {
        Remove-Item -Path $webDst -Recurse -Force
    }
    Copy-Item -Path $webSrc -Destination $webDst -Recurse -Force
}

# Copy WebView2Loader.dll if present
$wv2Src = Join-Path $srcRoot 'WebView2Loader.dll'
if (Test-Path $wv2Src) {
    Copy-Item -Path $wv2Src -Destination (Join-Path $dstRoot 'WebView2Loader.dll') -Force
}

Write-Host "`n-- new install --"
Get-ChildItem $dstRoot -File | ForEach-Object {
    Write-Host ("{0,10}  {1:yyyy-MM-dd HH:mm}  {2}" -f $_.Length, $_.LastWriteTime, $_.Name)
}

Write-Host "`nDONE."
