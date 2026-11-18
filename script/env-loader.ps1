# Read the simple dotenv format used by .env.example without evaluating shell code.
function Import-PaydayEnv([string]$Path) {
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $Path) {
        $lineNumber++
        if ($line -match '^\s*(#.*)?$') { continue }
        if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            throw "Invalid environment assignment at line $lineNumber."
        }
        $key = $Matches[1]
        $value = $Matches[2]
        if ($value.StartsWith('"')) {
            if ($value -notmatch '^"([^"]*)"\s*(?:#.*)?$') { throw "Invalid quoted environment value at line $lineNumber." }
            $value = $Matches[1]
        } elseif ($value.StartsWith("'")) {
            if ($value -notmatch "^'([^']*)'\s*(?:#.*)?$") { throw "Invalid quoted environment value at line $lineNumber." }
            $value = $Matches[1]
        } else {
            $value = ($value -replace '\s+#.*$', '').TrimEnd()
        }
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}
