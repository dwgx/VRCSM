param (
    [string]$TargetDir = "..\build\x64-debug\src\host\extractor"
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Prepare Target Directory
$ExtractDir = Join-Path -Path $PSScriptRoot -ChildPath $TargetDir
if (-not (Test-Path $ExtractDir)) {
    New-Item -ItemType Directory -Path $ExtractDir | Out-Null
}

Write-Host "Fetching FBX2glTF..."
$FbxUrl = "https://github.com/bghgary/FBX2glTF/releases/download/v0.9.7/FBX2glTF-windows-x64.exe"
$FbxDest = Join-Path $ExtractDir "fbx2gltf.exe"
if (-not (Test-Path $FbxDest)) {
    Invoke-WebRequest -Uri $FbxUrl -OutFile $FbxDest
    Write-Host "FBX2glTF downloaded."
} else {
    Write-Host "FBX2glTF already exists. Skipping."
}

Write-Host "Fetching AssetStudioModCLI..."
$AsUrl = "https://github.com/aelurum/AssetStudio/releases/download/v0.19.0/AssetStudioModCLI_net472_win32_64.zip"
$AsZip = Join-Path $ExtractDir "AssetStudio.zip"
$AsExe = Join-Path $ExtractDir "AssetStudioModCLI.exe"
if (-not (Test-Path $AsExe)) {
    Invoke-WebRequest -Uri $AsUrl -OutFile $AsZip
    Write-Host "Extracting AssetStudioModCLI..."
    Expand-Archive -Path $AsZip -DestinationPath $ExtractDir -Force
    Remove-Item $AsZip
    
    $SubDirMatch = Get-ChildItem -Path $ExtractDir -Directory | Where-Object { $_.Name -like "AssetStudioModCLI_*" }
    if ($SubDirMatch) {
        Move-Item "$($SubDirMatch.FullName)\*" $ExtractDir -Force
        Remove-Item $SubDirMatch.FullName -Recurse -Force
    }

    Write-Host "AssetStudioModCLI downloaded and extracted."
} else {
    Write-Host "AssetStudioModCLI already exists. Skipping."
}

Write-Host "Done!"

