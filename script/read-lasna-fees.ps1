param([string]$Rpc = 'https://lasna-rpc.rnk.dev/')
$ErrorActionPreference = 'Stop'
$systemAddress = '0x8888888888888888888888888888888888888888'
$projectRoot = Split-Path -Parent $PSScriptRoot
$chain = (& cast chain-id --rpc-url $Rpc | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $chain -ne '5318007') { throw 'Expected a working Lasna RPC (5318007).' }
$block = (& cast block-number --rpc-url $Rpc | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Block lookup failed.' }
$entries = @()
foreach ($method in @('_gasPriceCoeffPer1000','_extraGas','_maxChargeGas')) {
    $signature = "${method}()(uint256)"
    $output = (& cast call $systemAddress $signature --rpc-url $Rpc --block $block --chain 5318007 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $output -notmatch '^\d+') { throw "Read failed: $signature" }
    $entries += [ordered]@{ method=$method; command="cast call $systemAddress '$signature' --rpc-url $Rpc --block $block --chain 5318007"; output=$output; value=($output -split '\s+')[0] }
    Write-Host "$method = $output (block $block)"
}
$report = [ordered]@{ recordedAtUtc=[DateTime]::UtcNow.ToString('o'); chainId=$chain; block=$block; rpc=$Rpc; system=$systemAddress; entries=$entries }
$evidenceFile = Join-Path $projectRoot 'deployments\lasna-fees.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidenceFile -Encoding utf8
$report | ConvertTo-Json -Depth 6
