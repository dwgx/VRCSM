$cwp = Join-Path $env:LOCALAPPDATA '..\LocalLow\VRChat\VRChat\Cache-WindowsPlayer'
$cwp = [System.IO.Path]::GetFullPath($cwp)
Write-Output "cwp: $cwp"
$dirs = Get-ChildItem $cwp -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First 5
foreach ($d in $dirs) {
    Write-Output "---"
    Write-Output "top: $($d.Name)"
    $items = Get-ChildItem $d.FullName -Recurse -File -ErrorAction SilentlyContinue
    foreach ($f in $items) {
        Write-Output "  $($f.FullName.Substring($d.FullName.Length)) -> $($f.Length) bytes"
    }
}
# Also look at one of the hex-hash dirs visible in the bundles screenshot
$hex = Get-ChildItem $cwp -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[A-F0-9]{16}' } | Select-Object -First 1
if ($hex) {
    Write-Output "---"
    Write-Output "hex: $($hex.Name)"
    Get-ChildItem $hex.FullName -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Output "  $($_.FullName.Substring($hex.FullName.Length)) -> $($_.Length) bytes"
    }
}
