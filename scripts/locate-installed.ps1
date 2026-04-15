$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'VRCSM'),
    (Join-Path $env:LOCALAPPDATA 'Programs\VRCSM'),
    (Join-Path $env:ProgramFiles 'VRCSM'),
    (Join-Path ${env:ProgramFiles(x86)} 'VRCSM')
)
foreach ($c in $candidates) {
    if (Test-Path $c) {
        Write-Output "FOUND: $c"
        Get-ChildItem $c -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
    } else {
        Write-Output "missing: $c"
    }
}

$exe = Get-Command VRCSM.exe -ErrorAction SilentlyContinue
if ($exe) {
    Write-Output "on PATH: $($exe.Source)"
}

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Get-ChildItem $startMenu -Recurse -Filter '*VRCSM*' -ErrorAction SilentlyContinue | ForEach-Object {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($_.FullName)
    Write-Output "lnk: $($_.FullName) -> $($lnk.TargetPath)"
}
