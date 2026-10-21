[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3001,
    [string]$Origin,
    [switch]$InWindow
)

$ErrorActionPreference = 'Stop'

# Running this script opens a dedicated console; -InWindow is used by that console.
if (-not $InWindow) {
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $frontendArguments = @(
        '-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $PSCommandPath), '-InWindow', '-Port', $Port
    )
    if ($Origin) { $frontendArguments += @('-Origin', $Origin) }
    Start-Process -FilePath $powershellPath -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ArgumentList $frontendArguments
    return
}

$Host.UI.RawUI.WindowTitle = "Union Link - Frontend + API - localhost:$Port"
$consoleUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $consoleUtf8
[Console]::OutputEncoding = $consoleUtf8
$OutputEncoding = $consoleUtf8
Set-Location -LiteralPath $PSScriptRoot

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path -LiteralPath (Join-Path $nodeDirectory 'npm.cmd')) {
        $env:PATH = "$nodeDirectory;$env:PATH"
        $npmCommand = Get-Command npm.cmd
    } else {
        throw 'Node.js / npm.cmd was not found. Install Node.js and reopen PowerShell.'
    }
}
if (-not (Test-Path -LiteralPath '.env')) { throw 'Missing .env. Configure this project before starting.' }
if (-not (Test-Path -LiteralPath 'node_modules/next/package.json')) { throw 'Missing dependencies. Run npm ci first.' }

# Keep these overrides local to this console and its children.
Remove-Item Env:\NPM_CONFIG_MIN_RELEASE_AGE -ErrorAction SilentlyContinue
if ($Origin) {
    $configuredOrigin = [Uri]$Origin
    if ($configuredOrigin.Scheme -notin @('http', 'https') -or $Origin -ne $configuredOrigin.GetLeftPart([UriPartial]::Authority)) {
        throw 'Origin must be a complete HTTP(S) origin without a path.'
    }
    $env:APP_ORIGIN = $Origin
} else {
    # An existing console can still carry the old localhost override. Next gives
    # process variables priority over .env, so clear it unless -Origin was explicit.
    Remove-Item Env:\APP_ORIGIN -ErrorAction SilentlyContinue
}
# Otherwise Next reads APP_ORIGIN from its environment files.
$frontendOrigin = & node -e "const {combinedEnv}=require('@next/env').loadEnvConfig(process.cwd(), true); process.stdout.write(combinedEnv.APP_ORIGIN || 'http://localhost:3000')"
if ($LASTEXITCODE -ne 0) { throw 'Failed to load the frontend origin configuration.' }
$frontendOrigin = $frontendOrigin.Trim()
$env:NEXT_DIST_DIR = '.next'
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$logPath = Join-Path $PSScriptRoot '.local\next-visible.log'
Start-Transcript -Path $logPath -Append | Out-Null
try {
    Write-Host 'Union Link - Next.js development server (frontend + HTTP API)' -ForegroundColor Cyan
    Write-Host "Login: $frontendOrigin/login"
    Write-Host "Local transport: http://localhost:$Port"
    Write-Host "Log: $logPath"
    Write-Host 'Keep this window open. Press Ctrl+C to stop.'
    # Route native output through PowerShell so Start-Transcript records it too.
    $ErrorActionPreference = 'Continue'
    & $npmCommand.Source run dev -- --port $Port --hostname 127.0.0.1 2>&1 | ForEach-Object { Write-Host $_.ToString() }
    $nativeExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($nativeExitCode -ne 0) { throw "Frontend exited with code $nativeExitCode." }
} finally {
    $ErrorActionPreference = 'Stop'
    Stop-Transcript | Out-Null
}
