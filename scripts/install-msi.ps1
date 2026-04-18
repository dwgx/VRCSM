$ErrorActionPreference = 'Stop'

param(
    [string]$Msi,
    [switch]$Passive
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$msiDir = Join-Path $repoRoot 'build\msi'

if ([string]::IsNullOrWhiteSpace($Msi)) {
    $latest = Get-ChildItem -LiteralPath $msiDir -Filter '*.msi' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) {
        throw "No MSI found under $msiDir"
    }
    $Msi = $latest.FullName
}
elseif (-not [System.IO.Path]::IsPathRooted($Msi)) {
    $Msi = Join-Path $repoRoot $Msi
}

if (-not (Test-Path -LiteralPath $Msi)) {
    throw "MSI not found: $Msi"
}

$log = Join-Path $msiDir 'install.log'
$uiArg = if ($Passive) { '/passive' } else { '/qn' }

Write-Host "Installing: $Msi"
Write-Host "Log: $log"

$p = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
    '/i', $Msi,
    $uiArg,
    '/l*v', $log
)

Write-Host ("ExitCode=" + $p.ExitCode)
exit $p.ExitCode
