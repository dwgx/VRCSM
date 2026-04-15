$bytes = [System.IO.File]::ReadAllBytes('C:\Users\dwgx1\AppData\Local\VRCSM\VRCSM.exe')
$text = [System.Text.Encoding]::ASCII.GetString($bytes)
if ($text.Contains('shell.openUrl')) { Write-Output 'found shell.openUrl' } else { Write-Output 'NOT FOUND shell.openUrl' }
if ($text.Contains('vrchat://')) { Write-Output 'found vrchat:// scheme check' } else { Write-Output 'no scheme check found' }
