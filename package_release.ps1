$ErrorActionPreference = 'Stop'

$repo      = "D:\Project\VRCSM"
$version   = (Get-Content "$repo\VERSION" -Raw).Trim()
$buildDir  = "$repo\build\x64-release\src\host"
$outDir    = "$repo\build\release"
$zipOut    = "$outDir\VRCSM_v${version}_x64.zip"
$msiOut    = "$outDir\VRCSM_v${version}_x64_Installer.msi"
$wix       = "$env:USERPROFILE\.dotnet\tools\wix.exe"
$icon      = "$repo\resources\icons\vrcsm.ico"
$wxs       = "$repo\installer\vrcsm.wxs"
$msiVer    = "$version.0"

Write-Host "[package] Version : $version"
Write-Host "[package] BuildDir: $buildDir"
Write-Host "[package] OutDir  : $outDir"

# Validate
if (-not (Test-Path "$buildDir\VRCSM.exe"))       { Write-Error "VRCSM.exe not found"; exit 1 }
if (-not (Test-Path "$buildDir\web\index.html"))  { Write-Error "web\index.html not found"; exit 1 }
if (-not (Test-Path $wix))                        { Write-Error "wix.exe not found at $wix"; exit 1 }

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# --- ZIP ---
Write-Host "[package] Building ZIP -> $zipOut"
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
Compress-Archive -Path "$buildDir\*" -DestinationPath $zipOut
$zipSize = [math]::Round((Get-Item $zipOut).Length / 1MB, 1)
Write-Host "[package] ZIP done: ${zipSize} MB"

# --- MSI ---
Write-Host "[package] Building MSI -> $msiOut"
if (Test-Path $msiOut) { Remove-Item $msiOut -Force }

$wixVer = (& $wix --version 2>&1 | Select-Object -First 1).Trim()
$wixMajor = $wixVer.Split('.')[0]
$eulaArg = if ($wixMajor -in @('7','8')) { @('-acceptEula', 'wix7') } else { @() }

& $wix build @eulaArg $wxs -arch x64 `
    -d "BuildDir=$buildDir" `
    -d "IconFile=$icon" `
    -d "ProductVersion=$msiVer" `
    -o $msiOut

if ($LASTEXITCODE -ne 0) { Write-Error "wix build failed ($LASTEXITCODE)"; exit $LASTEXITCODE }

$msiSize = [math]::Round((Get-Item $msiOut).Length / 1MB, 1)
Write-Host "[package] MSI done: ${msiSize} MB"

Write-Host ""
Write-Host "[package] All done."
Write-Host "  ZIP : $zipOut"
Write-Host "  MSI : $msiOut"
