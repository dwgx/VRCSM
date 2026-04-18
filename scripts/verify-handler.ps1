param(
    [string]$ExePath = (Join-Path $env:LOCALAPPDATA 'VRCSM\VRCSM.exe')
)

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Executable not found: $ExePath"
}

$bytes = [System.IO.File]::ReadAllBytes($ExePath)
$text = [System.Text.Encoding]::ASCII.GetString($bytes)
if ($text.Contains('shell.openUrl')) { Write-Output 'found shell.openUrl' } else { Write-Output 'NOT FOUND shell.openUrl' }
if ($text.Contains('vrchat://')) { Write-Output 'found vrchat:// scheme check' } else { Write-Output 'no scheme check found' }
