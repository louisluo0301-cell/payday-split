# PaydaySplit — one-command local demo (Windows PowerShell)
#
# Starts local Anvil, deploys the whole stack with a MockSystem at 0x8888,
# runs one real paycheck through react() + a proxy-like callback, and writes:
#   deployments/31337.json
#   deployments/31337.evidence.json
#   web/public/deployments.local.json
#
# Then open http://127.0.0.1:5173/?local=1 (npm run dev in web/).
param([ValidateRange(1024,65535)][int]$Port = 8545, [switch]$Reset)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$rpc = "http://127.0.0.1:$Port"
$key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" # public Anvil account #0

foreach ($cmd in @("forge", "cast", "anvil", "node")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "$cmd not found on PATH."
    }
}

$up = $false
try {
    & cast block-number --rpc-url $rpc *> $null
    $up = ($LASTEXITCODE -eq 0)
} catch {
    $up = $false
}

if (-not $up) {
    Write-Host "Starting anvil on $Port..." -ForegroundColor Cyan
    Start-Process -FilePath "anvil" -ArgumentList @("--host", "127.0.0.1", "--port", "$Port", "--chain-id", "31337", "--silent") -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

$client = & cast rpc web3_clientVersion --rpc-url $rpc
if ($LASTEXITCODE -ne 0 -or $client -notmatch 'anvil') { throw "Expected local Anvil at $rpc." }
$chainId = & cast chain-id --rpc-url $rpc
if ($LASTEXITCODE -ne 0 -or $chainId -ne '31337') { throw "Expected Anvil chain 31337 at $rpc." }
if ($up) {
    if (-not $Reset) { throw "Anvil is already running at $rpc. Choose another port with -Port, or pass -Reset to clear this disposable chain." }
    Write-Host "Resetting local chain..." -ForegroundColor Cyan
    & cast rpc anvil_reset --rpc-url $rpc *> $null
    if ($LASTEXITCODE -ne 0) { throw "Unable to reset local Anvil." }
}

Write-Host "Building contracts..." -ForegroundColor Cyan
& forge build -q *> $null
if ($LASTEXITCODE -ne 0) { throw 'Contract build failed; refusing to deploy cached artifacts.' }

$artifact = Get-Content "out/PaydaySplit.t.sol/MockSystem.json" -Raw | ConvertFrom-Json
& cast rpc anvil_setCode 0x8888888888888888888888888888888888888888 $artifact.deployedBytecode.object --rpc-url $rpc *> $null
if ($LASTEXITCODE -ne 0) { throw 'Unable to install local MockSystem.' }

Write-Host "Deploying MockProxy..." -ForegroundColor Cyan
$proxyOut = & forge create test/PaydaySplit.t.sol:MockProxy --rpc-url $rpc --private-key $key --broadcast --gas-price 100000000000 2>&1 | Out-String
$proxy = [regex]::Match($proxyOut, "Deployed to: (0x[0-9a-fA-F]{40})").Groups[1].Value
if (-not $proxy) { throw "Failed to deploy MockProxy`n$proxyOut" }

$env:PRIVATE_KEY = $key
$env:CALLBACK_PROXY = $proxy
$env:DEST_CHAIN_ID = "31337"
$env:DEST_RPC_URL = $rpc
$env:SEPOLIA_RPC_URL = $rpc
$env:LASNA_RPC_URL = $rpc
$env:RENT_PAYEE = "0x000000000000000000000000000000000000dEaD"
$env:TAX_PAYEE = "0x000000000000000000000000000000000000bEEF"
$env:SAVINGS_PAYEE = "0x000000000000000000000000000000000000cafE"
$env:MAX_CALLBACKS = "100"
$env:MIN_PAYCHECK = "1000000"
$env:REACTIVE_FUND_WEI = "500000000000000000"
$env:CALLBACK_FUND_WEI = "20000000000000000"
$env:RETRY_CRON_TICKS = "0"
$env:RENT_FIXED = "300000000"
$env:TAX_BPS = "2500"
$env:SAVINGS_BPS = "1500"
$env:APPROVAL_AMOUNT = "10000000000" # finite 10,000 demo-USDC approval for this local harness
Remove-Item Env:TOKEN_ADDR -ErrorAction SilentlyContinue
Remove-Item Env:SPLIT_ADDR -ErrorAction SilentlyContinue
Remove-Item Env:REACTIVE_ADDR -ErrorAction SilentlyContinue

Write-Host "Deploying DemoUSDC + PaydaySplit..." -ForegroundColor Cyan
$out1 = & forge script script/Deploy.s.sol:DeployDest --rpc-url $rpc --broadcast --non-interactive --gas-price 100000000000 -vv 2>&1 | Out-String
$token = [regex]::Match($out1, "TOKEN_ADDR=\s*(0x[0-9a-fA-F]{40})").Groups[1].Value
$split = [regex]::Match($out1, "SPLIT_ADDR=\s*(0x[0-9a-fA-F]{40})").Groups[1].Value
$factory = [regex]::Match($out1, "MODULE_FACTORY=\s*(0x[0-9a-fA-F]{40})").Groups[1].Value
$queue = [regex]::Match($out1, "RETRY_QUEUE=\s*(0x[0-9a-fA-F]{40})").Groups[1].Value
if (-not $token -or -not $split -or -not $factory -or -not $queue) { throw "Failed to parse destination addresses`n$out1" }
$env:TOKEN_ADDR = $token
$env:SPLIT_ADDR = $split

Write-Host "Deploying PaydaySplitReactive..." -ForegroundColor Cyan
$out2 = & forge script script/Deploy.s.sol:DeployReactive --rpc-url $rpc --broadcast --non-interactive --gas-price 100000000000 -vv 2>&1 | Out-String
$reactive = [regex]::Match($out2, "REACTIVE_ADDR=\s*(0x[0-9a-fA-F]{40})").Groups[1].Value
if (-not $reactive) { throw "Failed to parse REACTIVE_ADDR`n$out2" }
$env:REACTIVE_ADDR = $reactive

$poolOut = & forge create test/IncomeModules.t.sol:AavePoolForModules --rpc-url $rpc --private-key $key --broadcast --gas-price 100000000000 --constructor-args $token 2>&1 | Out-String
$pool = [regex]::Match($poolOut, "Deployed to: (0x[0-9a-fA-F]{40})").Groups[1].Value
if ($LASTEXITCODE -ne 0 -or -not $pool) { throw 'Local Aave mock deployment failed.' }

$wethOut = & forge create test/IncomeModules.t.sol:WrappedEtherForModules --rpc-url $rpc --private-key $key --broadcast --gas-price 100000000000 2>&1 | Out-String
$weth = [regex]::Match($wethOut, "Deployed to: (0x[0-9a-fA-F]{40})").Groups[1].Value
if ($LASTEXITCODE -ne 0 -or -not $weth) { throw 'Local wrapped ETH deployment failed.' }

Write-Host "Binding + setting the demo rule..." -ForegroundColor Cyan
& forge script script/Deploy.s.sol:Configure --rpc-url $rpc --broadcast --non-interactive --gas-price 100000000000 -vv *> $null
if ($LASTEXITCODE -ne 0) { throw 'Local rule configuration failed.' }

$deployer = (& cast wallet address --private-key $key).Trim()
$deployment = [ordered]@{
    chainId = 31337
    network = "anvil"
    rpcUrl = $rpc
    explorer = ""
    lasnaRpc = $rpc
    lasnaExplorer = ""
    token = $token
    split = $split
    modules = [ordered]@{ factory = $factory; retryQueue = $queue; wrappedNative = $weth; aavePool = $pool }
    assets = @(
        [ordered]@{ id = 'dusdc'; token = $token; label = 'Demo USDC'; aavePool = $pool }
        [ordered]@{ id = 'weth'; token = $weth; label = 'Wrapped ETH' }
    )
    reactive = $reactive
    proxy = $proxy
    deployer = $deployer
    savings = $env:SAVINGS_PAYEE
    bps = 1500
    deployedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$json = $deployment | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $root "deployments/31337.json"), $json, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $root "web/public/deployments.local.json"), $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Running one full paycheck loop..." -ForegroundColor Cyan
Push-Location "web"
try {
    & node script/local-watcher.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local callback verification failed.' }
} finally {
    Pop-Location
}

Write-Host "`nLocal demo ready:" -ForegroundColor Green
Write-Host "  token      $token"
Write-Host "  wrapped    $weth"
Write-Host "  split      $split"
Write-Host "  reactive   $reactive"
Write-Host "  evidence   deployments/31337.evidence.json"
Write-Host "`nOpen the dashboard:" -ForegroundColor Green
Write-Host "  cd web; npm run dev"
Write-Host "  http://127.0.0.1:5173/?local=1"
Write-Host "  Run npm run local:watch in a separate terminal for automatic local callbacks."
