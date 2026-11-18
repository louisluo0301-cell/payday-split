param([string]$Version = 'v9', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^v[0-9]+$') { throw 'Version must look like v9.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path (Split-Path -Parent $projectRoot) 'release'
if ($OutputDirectory) { $releaseRoot = [IO.Path]::GetFullPath($OutputDirectory) }
$packageRoot = Join-Path $releaseRoot "PaydaySplit-$Version-交付包"
$zipPath = Join-Path $releaseRoot "PaydaySplit-$Version-交付包.zip"
if ((Test-Path -LiteralPath $packageRoot) -or (Test-Path -LiteralPath $zipPath)) {
    throw 'Package already exists; choose a new release destination.'
}
$revision = & git -C $projectRoot rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Package from a committed Git checkout.' }
$tracked = & git -C $projectRoot ls-tree -r --name-only $revision
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the delivery revision.' }
foreach ($path in $tracked) {
    if ($path -match '(^|/)(node_modules|out|cache|broadcast|\.git|\.npm-cache)(/|$)' -or
        $path -match '(^|/)\.env(?!\.example$)[^/]*(/|$)' -or $path -match '\.(pem|pfx|key)$') {
        throw "Review this committed path before packaging: $path"
    }
}
$sourceRoot = Join-Path $packageRoot 'payday-split'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Path]::GetTempFileName()
try {
    & git -C $projectRoot archive --format=zip --prefix=payday-split/ "--output=$archive" $revision
    if ($LASTEXITCODE -ne 0) { throw 'Could not archive the committed revision.' }
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$packageRoot)
} finally {
    Remove-Item -LiteralPath $archive
}
$manifest = foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | Sort-Object FullName) {
    $relativePath = [IO.Path]::GetRelativePath($sourceRoot,$file.FullName).Replace('\','/')
    [ordered]@{path=$relativePath;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $packageRoot 'SHA256-MANIFEST.json') -Encoding utf8
$revision | Set-Content (Join-Path $packageRoot 'REVISION.txt') -Encoding utf8
$entry = Get-Content -LiteralPath (Join-Path $sourceRoot '交付入口.md') -Raw
($entry -replace '\]\((docs|notes)/', '](payday-split/$1/') |
    Set-Content -LiteralPath (Join-Path $packageRoot '先读我.md') -Encoding utf8 -NoNewline
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot,$zipPath)
Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
Write-Host "Packaged $($manifest.Count) source files from $revision."
