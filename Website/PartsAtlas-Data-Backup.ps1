[CmdletBinding()]
param(
    [ValidateSet("Menu", "Backup", "List")]
    [string]$Action = "Menu",

    [string]$BackupRoot = ""
)

$ErrorActionPreference = "Stop"
$projectDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path (Split-Path $projectDirectory -Parent) "PartsAtlas Data Backups"
}
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
$stateRoot = Join-Path $projectDirectory ".wrangler\state\v3"
$liveD1 = Join-Path $stateRoot "d1"
$liveR2 = Join-Path $stateRoot "r2"
$launcher = Join-Path $projectDirectory "Start-PartsAtlas.ps1"
$websiteUrl = "http://localhost:3000/"

function Write-Title([string]$text) {
    Write-Host ""
    Write-Host $text -ForegroundColor Cyan
    Write-Host ("=" * $text.Length) -ForegroundColor DarkCyan
}

function Format-Size([long]$bytes) {
    if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N2} KB" -f ($bytes / 1KB) }
    return "$bytes bytes"
}

function Test-PartsAtlas {
    try {
        $response = Invoke-WebRequest -Uri $websiteUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Stop-PartsAtlas {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { return $false }

    if (-not (Test-PartsAtlas)) {
        throw "Port 3000 is in use, but it does not appear to be PartsAtlas. It was not stopped."
    }

    foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        Stop-Process -Id $processId -ErrorAction Stop
    }

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    throw "PartsAtlas did not stop cleanly. No data operation was performed."
}

function Start-PartsAtlasPrompt([bool]$wasRunning) {
    if (-not $wasRunning) { return }
    $answer = Read-Host "PartsAtlas was running before this operation. Open it again now? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[Yy]') {
        & $launcher
    }
}

function Assert-ChildPath([string]$path, [string]$parent) {
    $fullPath = [IO.Path]::GetFullPath($path)
    $fullParent = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path rejected: $fullPath"
    }
    return $fullPath
}

function Copy-Tree([string]$source, [string]$destination) {
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Required data folder not found: $source"
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    & robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NP /NFL /NDL | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "Robocopy failed with exit code $code while copying $source"
    }
}

function Get-TreeStats([string]$path) {
    $files = @(Get-ChildItem -LiteralPath $path -Recurse -File -Force)
    return [pscustomobject]@{
        files = $files.Count
        bytes = [long](($files | Measure-Object Length -Sum).Sum)
    }
}

function New-DataSnapshot([string]$kind = "Backup") {
    if (-not (Test-Path -LiteralPath $liveD1 -PathType Container)) {
        throw "The local D1 data folder does not exist: $liveD1"
    }
    if (-not (Test-Path -LiteralPath $liveR2 -PathType Container)) {
        throw "The local R2 data folder does not exist: $liveR2"
    }

    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $snapshotName = "PartsAtlas-$kind-$stamp"
    $snapshot = Join-Path $BackupRoot $snapshotName
    $suffix = 2
    while (Test-Path -LiteralPath $snapshot) {
        $snapshot = Join-Path $BackupRoot "$snapshotName-$suffix"
        $suffix++
    }

    New-Item -ItemType Directory -Path $snapshot | Out-Null
    try {
        Write-Host "Copying D1 database..." -ForegroundColor Yellow
        Copy-Tree $liveD1 (Join-Path $snapshot "d1")
        Write-Host "Copying R2 images and attachments..." -ForegroundColor Yellow
        Copy-Tree $liveR2 (Join-Path $snapshot "r2")

        $d1Stats = Get-TreeStats (Join-Path $snapshot "d1")
        $r2Stats = Get-TreeStats (Join-Path $snapshot "r2")
        $manifest = [ordered]@{
            format = "PartsAtlas local D1/R2 backup"
            formatVersion = 1
            kind = $kind
            createdAt = (Get-Date).ToString("o")
            computer = $env:COMPUTERNAME
            project = $projectDirectory
            d1 = $d1Stats
            r2 = $r2Stats
            totalFiles = $d1Stats.files + $r2Stats.files
            totalBytes = $d1Stats.bytes + $r2Stats.bytes
        }
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $snapshot "manifest.json") -Encoding UTF8

        Write-Host ""
        Write-Host "Backup created successfully." -ForegroundColor Green
        Write-Host "Location: $snapshot"
        Write-Host "Files:    $($manifest.totalFiles)"
        Write-Host "Size:     $(Format-Size $manifest.totalBytes)"
        return $snapshot
    }
    catch {
        Write-Warning "The incomplete snapshot was left at $snapshot for inspection."
        throw
    }
}

function Get-DataSnapshots {
    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) { return @() }
    return @(
        Get-ChildItem -LiteralPath $BackupRoot -Directory |
            ForEach-Object {
                $manifestPath = Join-Path $_.FullName "manifest.json"
                if (Test-Path -LiteralPath $manifestPath) {
                    try {
                        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                        if (
                            $manifest.formatVersion -eq 1 -and
                            (Test-Path -LiteralPath (Join-Path $_.FullName "d1") -PathType Container) -and
                            (Test-Path -LiteralPath (Join-Path $_.FullName "r2") -PathType Container)
                        ) {
                            [pscustomobject]@{
                                path = $_.FullName
                                name = $_.Name
                                createdAt = [datetime]$manifest.createdAt
                                kind = [string]$manifest.kind
                                files = [int]$manifest.totalFiles
                                bytes = [long]$manifest.totalBytes
                            }
                        }
                    }
                    catch {
                        Write-Warning "Ignoring unreadable backup manifest: $manifestPath"
                    }
                }
            } |
            Sort-Object createdAt -Descending
    )
}

function Show-DataSnapshots {
    $snapshots = @(Get-DataSnapshots)
    Write-Title "Available PartsAtlas data backups"
    if (-not $snapshots.Count) {
        Write-Host "No backups found in $BackupRoot" -ForegroundColor Yellow
        return $snapshots
    }
    for ($index = 0; $index -lt $snapshots.Count; $index++) {
        $snapshot = $snapshots[$index]
        Write-Host ("[{0}] {1}  {2}  {3}  {4} files" -f (
            $index + 1,
            $snapshot.createdAt.ToString("yyyy-MM-dd HH:mm:ss"),
            $snapshot.kind,
            (Format-Size $snapshot.bytes),
            $snapshot.files
        ))
    }
    Write-Host ""
    Write-Host "Backup folder: $BackupRoot" -ForegroundColor DarkGray
    return $snapshots
}

function Invoke-Backup {
    Write-Title "Create PartsAtlas data backup"
    $wasRunning = Stop-PartsAtlas
    if ($wasRunning) { Write-Host "PartsAtlas was stopped for a consistent snapshot." }
    try {
        New-DataSnapshot "Backup" | Out-Null
    }
    finally {
        Start-PartsAtlasPrompt $wasRunning
    }
}

function Remove-VerifiedDirectory([string]$path, [string]$allowedParent) {
    $verified = Assert-ChildPath $path $allowedParent
    if (Test-Path -LiteralPath $verified) {
        Remove-Item -LiteralPath $verified -Recurse -Force
    }
}

function Invoke-Restore {
    $snapshots = @(Show-DataSnapshots)
    if (-not $snapshots.Count) { return }

    $selection = Read-Host "Enter the backup number to restore, or press Enter to cancel"
    if ([string]::IsNullOrWhiteSpace($selection)) { return }
    $selectedNumber = 0
    if (-not [int]::TryParse($selection, [ref]$selectedNumber) -or $selectedNumber -lt 1 -or $selectedNumber -gt $snapshots.Count) {
        Write-Host "Invalid selection." -ForegroundColor Red
        return
    }

    $selected = $snapshots[$selectedNumber - 1]
    $resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot)
    $selectedPath = Assert-ChildPath $selected.path $resolvedBackupRoot
    Write-Host ""
    Write-Host "Selected: $($selected.name)" -ForegroundColor Yellow
    Write-Host "This will replace the current local database, images, and attachments."
    Write-Host "An automatic safety backup of the current data will be created first."
    $confirmation = Read-Host "Type RESTORE to continue"
    if ($confirmation -cne "RESTORE") {
        Write-Host "Restore cancelled."
        return
    }

    $wasRunning = Stop-PartsAtlas
    if ($wasRunning) { Write-Host "PartsAtlas was stopped for a safe restore." }

    $rollbackRoot = Join-Path $stateRoot ("restore-rollback-" + (Get-Date -Format "yyyyMMddHHmmss"))
    $rollbackRoot = Assert-ChildPath $rollbackRoot $stateRoot
    $safetySnapshot = $null
    try {
        Write-Host "Creating automatic pre-restore safety backup..." -ForegroundColor Yellow
        $safetySnapshot = New-DataSnapshot "Before-Restore"

        New-Item -ItemType Directory -Path $rollbackRoot | Out-Null
        $rollbackD1 = Join-Path $rollbackRoot "d1"
        $rollbackR2 = Join-Path $rollbackRoot "r2"
        try {
            Move-Item -LiteralPath $liveD1 -Destination $rollbackD1
            Move-Item -LiteralPath $liveR2 -Destination $rollbackR2

            Write-Host "Restoring D1 database..." -ForegroundColor Yellow
            Copy-Tree (Join-Path $selectedPath "d1") $liveD1
            Write-Host "Restoring R2 images and attachments..." -ForegroundColor Yellow
            Copy-Tree (Join-Path $selectedPath "r2") $liveR2

            $expectedManifest = Get-Content -LiteralPath (Join-Path $selectedPath "manifest.json") -Raw | ConvertFrom-Json
            $actualD1 = Get-TreeStats $liveD1
            $actualR2 = Get-TreeStats $liveR2
            if (
                $actualD1.files -ne [int]$expectedManifest.d1.files -or
                $actualD1.bytes -ne [long]$expectedManifest.d1.bytes -or
                $actualR2.files -ne [int]$expectedManifest.r2.files -or
                $actualR2.bytes -ne [long]$expectedManifest.r2.bytes
            ) {
                throw "Restored file counts or sizes do not match the selected backup."
            }
        }
        catch {
            Write-Warning "Restore failed. Returning the original data to service."
            if (Test-Path -LiteralPath $rollbackD1 -PathType Container) {
                Remove-VerifiedDirectory $liveD1 $stateRoot
                Move-Item -LiteralPath $rollbackD1 -Destination $liveD1
            }
            if (Test-Path -LiteralPath $rollbackR2 -PathType Container) {
                Remove-VerifiedDirectory $liveR2 $stateRoot
                Move-Item -LiteralPath $rollbackR2 -Destination $liveR2
            }
            throw
        }

        Remove-VerifiedDirectory $rollbackRoot $stateRoot
        Write-Host ""
        Write-Host "Restore completed and verified successfully." -ForegroundColor Green
        Write-Host "Restored:       $selectedPath"
        Write-Host "Safety backup:  $safetySnapshot"
    }
    finally {
        Start-PartsAtlasPrompt $wasRunning
    }
}

function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Title "PartsAtlas local data backup and restore"
        Write-Host "Backs up only the local D1 database and R2 images/attachments."
        Write-Host "This tool does not use Git." -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "[1] Create a backup"
        Write-Host "[2] Restore a backup"
        Write-Host "[3] List backups"
        Write-Host "[4] Open the backup folder"
        Write-Host "[Q] Quit"
        Write-Host ""
        $choice = Read-Host "Choose an option"
        try {
            switch ($choice.ToUpperInvariant()) {
                "1" { Invoke-Backup }
                "2" { Invoke-Restore }
                "3" { Show-DataSnapshots | Out-Null }
                "4" {
                    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
                    Start-Process explorer.exe -ArgumentList $BackupRoot
                }
                "Q" { return }
                default { Write-Host "Unknown option." -ForegroundColor Red }
            }
        }
        catch {
            Write-Host ""
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
        Write-Host ""
        Read-Host "Press Enter to return to the menu" | Out-Null
    }
}

switch ($Action) {
    "Backup" { Invoke-Backup }
    "List" { Show-DataSnapshots | Out-Null }
    default { Show-Menu }
}
