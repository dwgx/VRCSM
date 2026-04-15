# One-shot cleanup script: removes every avtr_* entry from
# %LocalAppData%\VRCSM\thumb-cache.json. Those entries were written when
# VrcApi still sent requests to VRChat's avatar endpoint — which always
# returns HTTP 401 for anonymous callers, producing false-negative
# not_found entries. After the v0.1.1 short-circuit landed, the right
# thing is to purge the pollution so an existing install behaves
# identically to a fresh one.
#
# Safe to re-run — a no-op if the cache is already clean.
# World entries are left alone.

$path = Join-Path $env:LOCALAPPDATA 'VRCSM\thumb-cache.json'
if (-not (Test-Path $path)) {
    Write-Output "no cache at $path — nothing to do"
    exit 0
}

$doc = Get-Content $path -Raw | ConvertFrom-Json
if ($null -eq $doc.entries) {
    Write-Output "cache has no entries block — leaving untouched"
    exit 0
}

$keep = [ordered]@{}
$removed = 0
foreach ($prop in $doc.entries.PSObject.Properties) {
    if ($prop.Name -like 'avtr_*') {
        $removed += 1
        continue
    }
    $keep[$prop.Name] = $prop.Value
}

$out = [PSCustomObject]@{ entries = $keep }
$json = $out | ConvertTo-Json -Depth 6
Set-Content -Path $path -Value $json -Encoding UTF8

$keepCount = $keep.Count
Write-Output "kept $keepCount world entries, purged $removed avatar entries"
