$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$message) {
    $script:failures.Add($message) | Out-Null
}

function Join-RepoPath([string]$relativePath) {
    $path = $repo
    foreach ($part in ($relativePath -split '[\\/]')) {
        if ($part.Length -gt 0) {
            $path = Join-Path $path $part
        }
    }
    return $path
}

function Read-Text([string]$relativePath) {
    return Get-Content -LiteralPath (Join-RepoPath $relativePath) -Raw
}

function Test-Contains([string]$haystack, [string]$needle) {
    return $haystack.Contains($needle)
}

$version = (Read-Text 'VERSION').Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    Add-Failure "VERSION must be semver major.minor.patch, got '$version'"
}

$webPackage = Read-Text 'web\package.json' | ConvertFrom-Json
if ($webPackage.version -ne $version) {
    Add-Failure "web/package.json version '$($webPackage.version)' does not match VERSION '$version'"
}

$vcpkg = Read-Text 'vcpkg.json' | ConvertFrom-Json
if ($vcpkg.version -ne $version) {
    Add-Failure "vcpkg.json version '$($vcpkg.version)' does not match VERSION '$version'"
}

$readme = Read-Text 'README.md'
if (-not (Test-Contains $readme "version-$version-blue")) {
    Add-Failure "README version badge does not match VERSION '$version'"
}
if (-not (Test-Contains $readme "VRCSM_v${version}_x64_Installer.msi")) {
    Add-Failure "README installer artifact name does not match VERSION '$version'"
}
if (-not (Test-Contains $readme "VRCSM_v${version}_x64.zip")) {
    Add-Failure "README portable artifact name does not match VERSION '$version'"
}
if ($readme -match '(?i)signed\s+WiX\s+installer|signed\s+installer') {
    Add-Failure "README still claims a signed installer without a signing step"
}
if ($readme -match '(?i)only reads local files') {
    Add-Failure "README still claims local-file-only behavior"
}
foreach ($required in @('local-first', 'VRChat API', 'update/plugin feed')) {
    if (-not (Test-Contains $readme $required)) {
        Add-Failure "README is missing network disclosure marker '$required'"
    }
}

$ci = Read-Text '.github\workflows\ci.yml'
foreach ($forbidden in @('npm ci', 'package-lock.json', 'cache: npm')) {
    if (Test-Contains $ci $forbidden) {
        Add-Failure ".github/workflows/ci.yml still references '$forbidden'"
    }
}
foreach ($required in @('pnpm/action-setup@v4', 'cache: pnpm', 'web/pnpm-lock.yaml', 'pnpm install --frozen-lockfile')) {
    if (-not (Test-Contains $ci $required)) {
        Add-Failure ".github/workflows/ci.yml is missing '$required'"
    }
}

$buildMsi = Read-Text 'scripts\build-msi.bat'
foreach ($forbidden in @('build-debug.bat', 'deploy-web.bat')) {
    if (Test-Contains $buildMsi $forbidden) {
        Add-Failure "scripts/build-msi.bat still points at '$forbidden'"
    }
}
foreach ($required in @('cmake --preset x64-release', 'cmake --build --preset x64-release', 'pnpm --prefix')) {
    if (-not (Test-Contains $buildMsi $required)) {
        Add-Failure "scripts/build-msi.bat is missing release/source guidance '$required'"
    }
}

$packageRelease = Read-Text 'package_release.ps1'
if (Test-Contains $packageRelease 'Compress-Archive -Path "$buildDir\*"') {
    Add-Failure "package_release.ps1 still zips buildDir directly, including stale VRCSM.exe.*.old backups"
}
$hasOldWarning = Test-Contains $packageRelease 'VRCSM.exe.*.old'
$hasOldFilter = Test-Contains $packageRelease '^VRCSM\.exe\..+\.old$'
if ((-not $hasOldWarning) -or (-not $hasOldFilter)) {
    Add-Failure "package_release.ps1 does not clearly exclude VRCSM.exe.*.old backups"
}

if ($failures.Count -gt 0) {
    Write-Host "[release-metadata] FAIL"
    foreach ($failure in $failures) {
        Write-Host "  - $failure"
    }
    exit 1
}

Write-Host "[release-metadata] OK version=$version"
