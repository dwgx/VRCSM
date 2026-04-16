param (
    [Parameter(Mandatory=$true)][string]$AssetStudioExe,
    [Parameter(Mandatory=$true)][string]$Fbx2GltfExe,
    [Parameter(Mandatory=$true)][string]$DataPath,
    [Parameter(Mandatory=$true)][string]$TempExportDir,
    [Parameter(Mandatory=$true)][string]$GlbPath
)

$ErrorActionPreference = 'Stop'

Write-Host "Starting AssetStudio extraction..."

# AssetStudioModCLI uses -m animator to correctly traverse the hierarchy and reconstruct an FBX containing the skinned mesh and rig.
& $AssetStudioExe "$DataPath" -m animator -o "$TempExportDir"

if ($LASTEXITCODE -ne 0) {
    Write-Error "AssetStudio extraction failed with exit code $LASTEXITCODE"
    Exit $LASTEXITCODE
}

Write-Host "Locating largest FBX..."
$bestFbx = Get-ChildItem -Path $TempExportDir -Filter "*.fbx" -Recurse | Sort-Object Length -Descending | Select-Object -First 1

if (-not $bestFbx) {
    Write-Error "No .fbx file found in export directory."
    Exit 1
}

Write-Host "Found $($bestFbx.FullName). Converting to GLB..."
& $Fbx2GltfExe -i $($bestFbx.FullName) -o "$GlbPath" --binary

if ($LASTEXITCODE -ne 0) {
    Write-Error "FBX2glTF conversion failed."
    Exit $LASTEXITCODE
}

Write-Host "Pipeline completed successfully!"
Exit 0
