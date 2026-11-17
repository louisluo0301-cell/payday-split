# PaydaySplit — one-command deployment (Windows PowerShell)
#
# Usage:
#   pwsh ./script/deploy.ps1
#
# Requires forge/cast on PATH and a funded throwaway testnet wallet in .env.
# The script deploys, binds, configures, and fires one demo paycheck, then writes
# deployments/<chainId>.json and web/public/deployments.json.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command forge -ErrorAction SilentlyContinue)) {
    throw "forge not found on PATH. Install Foundry first: https://book.getfoundry.sh/"
}
if (-not (Test-Path ".env")) {
    throw "Missing .env. Copy .env.example to .env and fill PRIVATE_KEY."
}

# Load .env into the process environment without echoing values.
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $i = $line.IndexOf("=")
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
}

$destRpc = if ($env:DEST_RPC_URL) { $env:DEST_RPC_URL } else { $env:SEPOLIA_RPC_URL }
if (-not $destRpc) { throw "Set DEST_RPC_URL (or SEPOLIA_RPC_URL) in .env" }
if (-not $env:LASNA_RPC_URL) { throw "Set LASNA_RPC_URL in .env" }
if (-not $env:PRIVATE_KEY) { throw "Set PRIVATE_KEY in .env" }
if (-not $env:CALLBACK_PROXY) { throw "Set CALLBACK_PROXY in .env" }

function Set-EnvLine([string]$key, [string]$value) {
    $path = Join-Path $root ".env"
    $lines = Get-Content $path
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($key))=") {
            $found = $true
            "$key=$value"
        } else {
            $line
        }
    }
    if (-not $found) { $out += "$key=$value" }
    [System.IO.File]::WriteAllLines($path, $out, [System.Text.UTF8Encoding]::new($false))
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
}

function Invoke-Forge([string]$signature, [string]$rpc) {
    Write-Host "`n==> forge script $signature" -ForegroundColor Cyan
    $output = & forge script $signature --rpc-url $rpc --broadcast --non-interactive -vv 2>&1 | Out-String
    Write-Host $output
    if ($LASTEXITCODE -ne 0) { throw "forge script failed: $signature" }
    return $output
}

function Get-Address([string]$text, [string]$name) {
    $m = [regex]::Match($text, "$name=\s*(0x[0-9a-fA-F]{40})")
    if (-not $m.Success) { throw "Could not parse $name from forge output" }
    return $m.Groups[1].Value
}

$out1 = Invoke-Forge "script/Deploy.s.sol:DeployDest" $destRpc
$token = Get-Address $out1 "TOKEN_ADDR"
$split = Get-Address $out1 "SPLIT_ADDR"
Set-EnvLine "TOKEN_ADDR" $token
Set-EnvLine "SPLIT_ADDR" $split

$out2 = Invoke-Forge "script/Deploy.s.sol:DeployReactive" $env:LASNA_RPC_URL
$reactive = Get-Address $out2 "REACTIVE_ADDR"
Set-EnvLine "REACTIVE_ADDR" $reactive

Invoke-Forge "script/Deploy.s.sol:Configure" $destRpc | Out-Null
Invoke-Forge "script/Deploy.s.sol:SimulatePaycheck" $destRpc | Out-Null

$chainId = [int]$env:DEST_CHAIN_ID
$network = switch ($chainId) {
    11155111 { "sepolia"; break }
    84532 { "base-sepolia"; break }
    1301 { "unichain-sepolia"; break }
    default { "chain-$chainId" }
}
$explorer = switch ($chainId) {
    11155111 { "https://sepolia.etherscan.io"; break }
    84532 { "https://sepolia.basescan.org"; break }
    1301 { "https://sepolia.uniscan.xyz"; break }
    default { "" }
}
$deployer = (& cast wallet address --private-key $env:PRIVATE_KEY).Trim()

New-Item -ItemType Directory -Force -Path "deployments", "web/public" | Out-Null
$deployment = [ordered]@{
    chainId = $chainId
    network = $network
    rpcUrl = $destRpc
    explorer = $explorer
    token = $token
    split = $split
    reactive = $reactive
    proxy = $env:CALLBACK_PROXY
    deployer = $deployer
    savings = if ($env:SAVINGS_PAYEE) { $env:SAVINGS_PAYEE } else { "0x000000000000000000000000000000000000cafE" }
    buckets = 3
    deployedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$json = $deployment | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $root "deployments/$chainId.json"), $json, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $root "web/public/deployments.json"), $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "`nDeployed PaydaySplit:" -ForegroundColor Green
Write-Host "  token      $token"
Write-Host "  split      $split"
Write-Host "  reactive   $reactive"
Write-Host "  deployment deployments/$chainId.json"
Write-Host "`nRun 'pwsh ./script/verify.ps1' to print the full-loop evidence."
