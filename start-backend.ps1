[CmdletBinding()]
param([switch]$InWindow)

$ErrorActionPreference = 'Stop'

# Next.js serves the HTTP API. This console runs the independent backend Worker.
if (-not $InWindow) {
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $powershellPath -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ArgumentList @(
        '-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $PSCommandPath), '-InWindow'
    )
    return
}

$Host.UI.RawUI.WindowTitle = 'Union Link - Backend Worker'
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
if (-not (Test-Path -LiteralPath 'node_modules/tsx/package.json')) { throw 'Missing dependencies. Run npm ci first.' }

Remove-Item Env:\NPM_CONFIG_MIN_RELEASE_AGE -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$logPath = Join-Path $PSScriptRoot '.local\worker-visible.log'
Start-Transcript -Path $logPath -Append | Out-Null
try {
    Write-Host 'Union Link - independent backend Worker' -ForegroundColor Cyan
    Write-Host 'Requires the PostgreSQL and object storage configured in .env.'
    Write-Host "Log: $logPath"
    Write-Host 'Keep this window open. Press Ctrl+C to stop.'
    # Route native output through PowerShell so Start-Transcript records it too.
    $ErrorActionPreference = 'Continue'
    & $npmCommand.Source run worker 2>&1 | ForEach-Object { Write-Host $_.ToString() }
    $nativeExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($nativeExitCode -ne 0) { throw "Worker exited with code $nativeExitCode." }
} finally {
    $ErrorActionPreference = 'Stop'
    Stop-Transcript | Out-Null
}
