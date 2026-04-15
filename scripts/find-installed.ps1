$ErrorActionPreference = "Stop"

$roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)

foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        if ($p.DisplayName -like "*VRCSM*" -or $p.DisplayName -like "*VRC Settings*") {
            [PSCustomObject]@{
                Hive        = $root
                Name        = $p.DisplayName
                Version     = $p.DisplayVersion
                ProductCode = $_.PSChildName
                Uninstall   = $p.UninstallString
            }
        }
    }
}
