# Enumerate all REG_BINARY values in HKCU\Software\VRChat\VRChat, classify
# them by the same heuristic VrcSettings.cpp uses (new-format string if ends
# in NUL and prefix is valid UTF-8; new-format float if exactly 4 bytes;
# legacy tag 0x00-0x03 fallback), and print a summary.
$ErrorActionPreference = 'Stop'

function Test-Utf8NoNul {
  param([byte[]]$Data)
  if ($null -eq $Data -or $Data.Length -eq 0) {
    return $true
  }
  $i = 0
  while ($i -lt $Data.Length) {
    $b = $Data[$i]
    if ($b -eq 0) { return $false }
    if ($b -lt 0x80) { $i++; continue }
    $extra = 0
    if (($b -band 0xE0) -eq 0xC0 -and $b -ge 0xC2) { $extra = 1 }
    elseif (($b -band 0xF0) -eq 0xE0) { $extra = 2 }
    elseif (($b -band 0xF8) -eq 0xF0 -and $b -le 0xF4) { $extra = 3 }
    else { return $false }
    if (($i + $extra) -ge $Data.Length) { return $false }
    for ($j = 1; $j -le $extra; $j++) {
      if (($Data[$i + $j] -band 0xC0) -ne 0x80) { return $false }
    }
    $i += $extra + 1
  }
  return $true
}

function Classify {
  param([byte[]]$Data)
  if ($null -eq $Data -or $Data.Length -eq 0) {
    return @{ type = 'empty' }
  }
  if ($Data[$Data.Length - 1] -eq 0) {
    $prefix = @()
    if ($Data.Length -gt 1) {
      $prefix = $Data[0..($Data.Length - 2)]
    }
    if (Test-Utf8NoNul $prefix) {
      $text = ''
      if ($prefix.Length -gt 0) {
        $text = [System.Text.Encoding]::UTF8.GetString($prefix)
      }
      return @{ type = 'string'; value = $text }
    }
  }
  if ($Data.Length -eq 4) {
    return @{ type = 'float'; value = [System.BitConverter]::ToSingle($Data, 0) }
  }
  $tag = $Data[0]
  if ($tag -in 0, 1, 2, 3) {
    return @{ type = "legacy_tag_$tag"; }
  }
  return @{ type = 'raw' }
}

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\VRChat\VRChat')
if ($null -eq $key) {
  Write-Error 'VRChat PlayerPrefs key not found'
  exit 1
}

$stats = @{
  total     = 0
  dword     = 0
  qword     = 0
  binary    = 0
  newString = 0
  newFloat  = 0
  legacy    = 0
  raw       = 0
}

$sampleStrings = @()
$sampleFloats  = @()
$sampleRaws    = @()

foreach ($name in $key.GetValueNames()) {
  $stats.total++
  $kind = $key.GetValueKind($name)
  switch ($kind) {
    'DWord'  { $stats.dword++ }
    'QWord'  { $stats.qword++ }
    'Binary' {
      $stats.binary++
      $data = $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
      $cls = Classify $data
      switch -Regex ($cls.type) {
        '^string$' {
          $stats.newString++
          if ($sampleStrings.Count -lt 6) {
            $sampleStrings += "$name -> [$($data.Length) bytes] `"$($cls.value)`""
          }
        }
        '^float$' {
          $stats.newFloat++
          if ($sampleFloats.Count -lt 8) {
            $hex = ($data | ForEach-Object { $_.ToString('X2') }) -join ' '
            $sampleFloats += "$name -> [$hex] = $($cls.value)"
          }
        }
        '^legacy_tag_' {
          $stats.legacy++
        }
        '^raw$' {
          $stats.raw++
          if ($sampleRaws.Count -lt 4) {
            $hex = ($data | ForEach-Object { $_.ToString('X2') }) -join ' '
            $sampleRaws += "$name [$($data.Length) bytes]: $hex"
          }
        }
        default {}
      }
    }
    default { }
  }
}

$key.Close()

Write-Output ''
Write-Output '=== Registry summary ==='
Write-Output "total values   : $($stats.total)"
Write-Output "  DWord        : $($stats.dword)"
Write-Output "  QWord        : $($stats.qword)"
Write-Output "  Binary       : $($stats.binary)"
Write-Output "    newString  : $($stats.newString)"
Write-Output "    newFloat   : $($stats.newFloat)"
Write-Output "    legacy tag : $($stats.legacy)"
Write-Output "    raw/other  : $($stats.raw)"
Write-Output ''
Write-Output '=== Sample strings ==='
$sampleStrings | ForEach-Object { Write-Output $_ }
Write-Output ''
Write-Output '=== Sample floats ==='
$sampleFloats | ForEach-Object { Write-Output $_ }
Write-Output ''
Write-Output '=== Sample unclassified raws ==='
$sampleRaws | ForEach-Object { Write-Output $_ }
