[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$websiteUrl = "http://localhost:3000/"
$projectDirectory = $PSScriptRoot
$runtimeDirectory = Join-Path $env:LOCALAPPDATA "PartsAtlas"
$serverLog = Join-Path $runtimeDirectory "server.log"
$launcherMutex = New-Object System.Threading.Mutex($false, "Local\PartsAtlasLauncher")
$hasMutex = $false

function Test-PartsAtlas {
    try {
        $response = Invoke-WebRequest -Uri $websiteUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Open-PartsAtlas {
    Start-Process $websiteUrl
}

function Show-LauncherError([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $message,
        "PartsAtlas could not start",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
}

try {
    if (Test-PartsAtlas) {
        Open-PartsAtlas
        exit 0
    }

    $hasMutex = $launcherMutex.WaitOne(0)
    if (-not $hasMutex) {
        for ($attempt = 0; $attempt -lt 150; $attempt++) {
            if (Test-PartsAtlas) {
                Open-PartsAtlas
                exit 0
            }
            Start-Sleep -Seconds 2
        }
        throw "Another PartsAtlas launcher is running, but the website did not become available."
    }

    # Check again after taking the mutex in case another launcher started the site.
    if (Test-PartsAtlas) {
        Open-PartsAtlas
        exit 0
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "Node.js/npm was not found. Install Node.js 22.13 or newer and try again."
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

    $escapedProject = $projectDirectory.Replace("'", "''")
    $escapedNpm = $npm.Source.Replace("'", "''")
    $escapedLog = $serverLog.Replace("'", "''")
    $serverCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedProject'
"`$(Get-Date -Format o) Starting PartsAtlas" | Out-File -LiteralPath '$escapedLog' -Encoding utf8
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & '$escapedNpm' install *>> '$escapedLog'
    if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
}
& '$escapedNpm' run dev *>> '$escapedLog'
exit `$LASTEXITCODE
"@
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($serverCommand)
    )

    Start-Process `
        -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", $encodedCommand
        ) `
        -WorkingDirectory $projectDirectory `
        -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 150; $attempt++) {
        if (Test-PartsAtlas) {
            Open-PartsAtlas
            exit 0
        }
        Start-Sleep -Seconds 2
    }

    throw "The local server did not become available within five minutes. See $serverLog for details."
}
catch {
    Show-LauncherError $_.Exception.Message
    exit 1
}
finally {
    if ($hasMutex) {
        $launcherMutex.ReleaseMutex()
    }
    $launcherMutex.Dispose()
}
