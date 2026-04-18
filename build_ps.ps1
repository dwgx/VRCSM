$ErrorActionPreference = 'Stop'

$vsInstall = "D:\Software\MS\Microsoft Visual Studio\18\Community"
$devShellDll = "$vsInstall\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"

if (-not (Test-Path $devShellDll)) {
    Write-Error "DevShell.dll not found: $devShellDll"
    exit 1
}

Import-Module $devShellDll
Enter-VsDevShell -VsInstallPath $vsInstall -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64"

$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
if (-not $cl) { Write-Error "cl.exe not in PATH"; exit 1 }
Write-Host "[build] cl.exe: $($cl.Path)"

Set-Location D:\Project\VRCSM

Write-Host "[build] cmake configure x64-release..."
cmake --preset x64-release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[build] cmake build x64-release..."
cmake --build --preset x64-release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[build] Syncing web dist..."
cmake -DSOURCE=D:\Project\VRCSM\web\dist -DDEST=D:\Project\VRCSM\build\x64-release\src\host\web -P D:\Project\VRCSM\cmake\sync-web-dist.cmake

Write-Host "[build] Done."
