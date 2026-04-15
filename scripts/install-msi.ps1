param([string]$Msi = "D:\Project\VRCSM\build\msi\VRCSM-0.3.0-x64.msi")

$log = "D:\Project\VRCSM\build\msi\install.log"
$p = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
    "/i", $Msi,
    "/qn",
    "/l*v", $log
)
Write-Host ("ExitCode=" + $p.ExitCode)
exit $p.ExitCode
