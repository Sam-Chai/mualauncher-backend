[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3001,
    [switch]$InWindow
)

$ErrorActionPreference = 'Stop'

# Running this script opens a dedicated console; -InWindow is used by that console.
if (-not $InWindow) {
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $powershellPath -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ArgumentList @(
        '-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $PSCommandPath), '-InWindow', '-Port', $Port
    )
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
$env:APP_ORIGIN = "http://localhost:$Port"
$env:NEXT_DIST_DIR = '.next'
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$logPath = Join-Path $PSScriptRoot '.local\next-visible.log'
Start-Transcript -Path $logPath -Append | Out-Null
try {
    Write-Host 'Union Link - Next.js development server (frontend + HTTP API)' -ForegroundColor Cyan
    Write-Host "URL: http://localhost:$Port/admin"
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
