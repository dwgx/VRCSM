$src = Get-Content 'C:\Users\dwgx1\.claude\projects\D--Project-VRCSM\9ba2b9b7-cb4a-46d6-b3cb-3092c8d41993\tool-results\toolu_0158ckWSW4u1rFYaDz6W9hmv.txt'
$keys = $src | ForEach-Object {
    $line = $_
    # Strip "NN:" line-number prefix emitted by ripgrep
    $line = $line -replace '^\d+:', ''
    $parts = $line -split '\|'
    if ($parts.Count -ge 3) {
        $parts[1].Trim()
    }
} | Where-Object { $_ } | Sort-Object -Unique
Write-Host ('count: ' + $keys.Count)
$keys | Out-File -Encoding utf8 'D:\Project\VRCSM\scripts\bool-keys.txt'
Get-Content 'D:\Project\VRCSM\scripts\bool-keys.txt' | Select-Object -First 15
