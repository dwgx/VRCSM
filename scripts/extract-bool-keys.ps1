param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [string]$OutputPath = (Join-Path $PSScriptRoot 'bool-keys.txt')
)

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input file not found: $InputPath"
}

$src = Get-Content -LiteralPath $InputPath
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
$keys | Out-File -Encoding utf8 -LiteralPath $OutputPath
Get-Content -LiteralPath $OutputPath | Select-Object -First 15
