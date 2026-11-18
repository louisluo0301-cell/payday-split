$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env-loader.ps1')
$tempFile = [IO.Path]::GetTempFileName()
try {
    @'
# comments and numeric values match the deployment example
PAYDAY_ENV_TEST_NUMBER=300000000 # 300 USDC
export PAYDAY_ENV_TEST_EXPORT = 2500
PAYDAY_ENV_TEST_QUOTED="space # preserved" # removed
PAYDAY_ENV_TEST_SINGLE='literal $value # preserved'
PAYDAY_ENV_TEST_URL=https://example.invalid/#fragment
PAYDAY_ENV_TEST_EMPTY=
'@ | Set-Content -LiteralPath $tempFile
    Import-PaydayEnv $tempFile
    $expected = @{
        NUMBER='300000000'; EXPORT='2500'; QUOTED='space # preserved'
        SINGLE='literal $value # preserved'; URL='https://example.invalid/#fragment'; EMPTY=''
    }
    foreach ($entry in $expected.GetEnumerator()) {
        $actual = [Environment]::GetEnvironmentVariable("PAYDAY_ENV_TEST_$($entry.Key)", 'Process')
        if ([string]$actual -cne $entry.Value) { throw "Environment parser check failed: $($entry.Key)" }
    }
    'PAYDAY_ENV_TEST_QUOTED="unterminated' | Set-Content -LiteralPath $tempFile
    $rejected = $false
    try { Import-PaydayEnv $tempFile } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unterminated quote was accepted.' }
    Write-Host 'Environment parser: 7 checks passed.'
} finally {
    Remove-Item -LiteralPath $tempFile -ErrorAction SilentlyContinue
    Get-ChildItem Env:PAYDAY_ENV_TEST_* | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
}
