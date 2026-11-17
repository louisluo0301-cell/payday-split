$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path (Split-Path -Parent $projectRoot) 'release'
$packageRoot = Join-Path $releaseRoot 'PaydaySplit-v5-交付包'
if (Test-Path -LiteralPath $packageRoot) { throw 'Package already exists; choose a new release destination.' }
$sourceRoot = Join-Path $packageRoot 'payday-split'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
$rootFiles = @('README.md','LICENSE','foundry.toml','remappings.txt','Makefile','.env.example','.gitignore','.gitattributes','交付入口.md')
$allowedDirs = @('src','test','script','docs','deployments','submission','lib','.github','web/src','web/public','web/script','web/test')
$files = @()
foreach ($dir in $allowedDirs) {
    $path = Join-Path $projectRoot $dir
    if (Test-Path -LiteralPath $path) { $files += Get-ChildItem -LiteralPath $path -Recurse -File -Force }
}
foreach ($name in $rootFiles + @('web/package.json','web/package-lock.json','web/index.html','web/vite.config.js')) {
    $path = Join-Path $projectRoot $name
    if (Test-Path -LiteralPath $path) { $files += Get-Item -LiteralPath $path -Force }
}
$manifest = @()
foreach ($file in $files | Sort-Object FullName -Unique) {
    $relativePath = [IO.Path]::GetRelativePath($projectRoot,$file.FullName)
    if ($relativePath -match '(^|[\\/])(node_modules|out|cache|broadcast|\.git|\.npm-cache)([\\/]|$)') { continue }
    if ($file.Name -like '.env*' -and $file.Name -ne '.env.example') { continue }
    $destination = Join-Path $sourceRoot $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
    $manifest += [ordered]@{path=$relativePath.Replace('\','/');sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $packageRoot 'SHA256-MANIFEST.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $projectRoot '交付入口.md') -Destination (Join-Path $packageRoot '先读我.md')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $releaseRoot 'PaydaySplit-v5-交付包.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot,$zipPath)
Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
Write-Host "Packaged $($manifest.Count) files."
