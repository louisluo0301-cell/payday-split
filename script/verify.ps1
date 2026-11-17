# PaydaySplit — on-chain evidence (Windows PowerShell)
#
# Prints the loop: origin Transfer -> Lasna mirror -> destination waterfall.
# Usage: pwsh ./script/verify.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $i = $line.IndexOf("=")
        [Environment]::SetEnvironmentVariable($line.Substring(0, $i).Trim(), $line.Substring($i + 1).Trim(), "Process")
    }
}

$destRpc = if ($env:DEST_RPC_URL) { $env:DEST_RPC_URL } else { $env:SEPOLIA_RPC_URL }
$lasna = $env:LASNA_RPC_URL
$token = $env:TOKEN_ADDR
$split = $env:SPLIT_ADDR
$reactive = $env:REACTIVE_ADDR
$user = (& cast wallet address --private-key $env:PRIVATE_KEY).Trim()
$chainId = [int]$env:DEST_CHAIN_ID

$explorer = switch ($chainId) {
    11155111 { "https://sepolia.etherscan.io" }
    84532 { "https://sepolia.basescan.org" }
    1301 { "https://sepolia.uniscan.xyz" }
    default { "" }
}

function Call([string]$rpc, [string]$to, [string]$sig) {
    (& cast call --rpc-url $rpc $to $sig 2>$null | Out-String).Trim()
}

Write-Host "`n== 1) origin chain ($chainId)" -ForegroundColor Cyan
Write-Host "   token   $token"
Write-Host "   user    $user"
$block = [int64](& cast block-number --rpc-url $destRpc)
$from = [Math]::Max(0, $block - 5000)
Write-Host "   recent Transfer logs to $user (last 5000 blocks):"
& cast logs --rpc-url $destRpc --address $token --from-block $from "Transfer(address indexed from, address indexed to, uint256 value)" 2>$null |
    Select-String -Pattern "transactionHash|blockNumber|data" | Select-Object -Last 12

Write-Host "`n== 2) Lasna reactive contract" -ForegroundColor Cyan
Write-Host "   reactive $reactive"
Write-Host "   remaining: $(Call $lasna $reactive 'remaining()(uint256)')"
Write-Host "   minPaycheck: $(Call $lasna $reactive 'minPaycheck()(uint256)')"
Write-Host "   userRemaining: $(Call $lasna $reactive 'userRemaining(address,address)(uint256)' $user $token)"
Write-Host "   owner:     $(Call $lasna $reactive 'owner()(address)')"
Write-Host "   paused:    $(Call $lasna $reactive 'paused()(bool)')"
Write-Host "   rule:"
& cast call --rpc-url $lasna $reactive "getRule(address,address)(address[],uint96[],uint16[],bool[],uint256,bool)" $user $token 2>$null
Write-Host "   browser:   https://lasna.reactscan.net/address/$reactive"

Write-Host "`n== 3) destination waterfall" -ForegroundColor Cyan
Write-Host "   split    $split"
Write-Host "   reactive: $(Call $destRpc $split 'reactive()(address)')"
Write-Host "   bucketCount: $(Call $destRpc $split 'bucketCount(address,address)(uint256)' $user $token)"
Write-Host "   ruleVersion: $(Call $destRpc $split 'ruleVersion(address,address)(uint256)' $user $token)"
Write-Host "   buckets:"
& cast call --rpc-url $destRpc $split "getBuckets(address,address)((address,uint96,uint16,bool)[])" $user $token 2>$null
Write-Host "   preview on 1,000 units (payees, amounts, retained):"
& cast call --rpc-url $destRpc $split "previewWaterfall(address,address,uint256)(address[],uint256[],uint256)" $user $token 1000000000 2>$null
Write-Host "   browser:  $explorer/address/$split"
Write-Host "   recent Split logs:"
& cast logs --rpc-url $destRpc --address $split --from-block $from "Split(address indexed user, address indexed token, address indexed payee, uint256 paycheck, uint256 amount, uint256 bucketIndex, uint256 version, uint256 originTxHash, uint256 logIndex)" 2>$null |
    Select-String -Pattern "transactionHash|blockNumber|data" | Select-Object -Last 16
Write-Host "   recent Retained logs:"
& cast logs --rpc-url $destRpc --address $split --from-block $from "Retained(address indexed user, address indexed token, uint256 amount, uint256 version, uint256 originTxHash, uint256 logIndex)" 2>$null |
    Select-String -Pattern "transactionHash|blockNumber|data" | Select-Object -Last 8

Write-Host "`nPaste the Transfer tx, the Lasna react tx, and the callback tx into the submission." -ForegroundColor Green
