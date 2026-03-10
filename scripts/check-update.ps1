param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [string]$RepoUrl,
    [string]$Branch,
    [switch]$Apply,
    [switch]$NoPrompt,
    [switch]$DryRun,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$defaultRepoUrl = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git'

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$deployedBundleRoot = Join-Path $TargetRoot 'Octopus-agent-orchestrator'
if (-not (Test-Path -LiteralPath $deployedBundleRoot -PathType Container)) {
    throw "Deployed bundle not found: $deployedBundleRoot"
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
    throw 'git is required for check-update workflow.'
}

if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
    $RepoUrl = $defaultRepoUrl
}
$RepoUrl = $RepoUrl.Trim()

$currentVersionPath = Join-Path $deployedBundleRoot 'VERSION'
if (-not (Test-Path -LiteralPath $currentVersionPath -PathType Leaf)) {
    throw "Current VERSION file not found: $currentVersionPath"
}

$currentVersion = (Get-Content -LiteralPath $currentVersionPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($currentVersion)) {
    throw "Current VERSION file is empty: $currentVersionPath"
}

function Compare-VersionStrings {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Current,
        [Parameter(Mandatory = $true)]
        [string]$Latest
    )

    try {
        $currentParsed = [version]$Current
        $latestParsed = [version]$Latest
        return $currentParsed.CompareTo($latestParsed)
    }
    catch {
        return [string]::Compare($Current, $Latest, $true)
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRepoPath = Join-Path ([System.IO.Path]::GetTempPath()) ("octopus-update-" + [guid]::NewGuid().ToString('N'))
$syncBackupRoot = Join-Path $deployedBundleRoot "runtime/bundle-backups/$timestamp"
$latestVersion = $null
$updateAvailable = $false
$syncItemCount = 0
$syncUpdatedCount = 0
$syncBackupCount = 0
$syncCopiedItems = @()
$syncBackupPathOutput = 'not-created'
$checkResult = 'UNKNOWN'
$updateApplied = $false

try {
    $cloneArgs = @('clone', '--depth', '1')
    if (-not [string]::IsNullOrWhiteSpace($Branch)) {
        $cloneArgs += @('--branch', $Branch.Trim())
    }
    $cloneArgs += @($RepoUrl, $tempRepoPath)

    & git @cloneArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to clone update source: $RepoUrl"
    }

    $latestVersionPath = Join-Path $tempRepoPath 'VERSION'
    if (-not (Test-Path -LiteralPath $latestVersionPath -PathType Leaf)) {
        throw "Latest VERSION file not found in cloned source: $latestVersionPath"
    }

    $latestVersion = (Get-Content -LiteralPath $latestVersionPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($latestVersion)) {
        throw "Latest VERSION file is empty: $latestVersionPath"
    }

    $comparison = Compare-VersionStrings -Current $currentVersion -Latest $latestVersion
    $updateAvailable = $comparison -lt 0

    if (-not $updateAvailable) {
        $checkResult = 'UP_TO_DATE'
    } else {
        $checkResult = 'UPDATE_AVAILABLE'
    }

    $applyNow = $Apply.IsPresent
    if ($updateAvailable -and -not $applyNow -and -not $NoPrompt) {
        $answer = Read-Host "Update available ($currentVersion -> $latestVersion). Apply now? (y/N)"
        if ($answer -match '^(?i:y|yes|да|д)$') {
            $applyNow = $true
        }
    }

    if ($updateAvailable -and $applyNow) {
        $syncItems = @(
            'template',
            'scripts',
            'README.md',
            'HOW_TO.md',
            'MANIFEST.md',
            'AGENT_INIT_PROMPT.md',
            'LICENSE',
            'VERSION'
        )

        foreach ($item in $syncItems) {
            $sourcePath = Join-Path $tempRepoPath $item
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                continue
            }

            $syncItemCount++
            $destinationPath = Join-Path $deployedBundleRoot $item
            $destinationExists = Test-Path -LiteralPath $destinationPath

            if ($DryRun) {
                $syncCopiedItems += $item
                continue
            }

            if ($destinationExists) {
                $backupPath = Join-Path $syncBackupRoot $item
                $backupDir = Split-Path -Parent $backupPath
                if ($backupDir -and -not (Test-Path -LiteralPath $backupDir)) {
                    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
                }
                Copy-Item -LiteralPath $destinationPath -Destination $backupPath -Recurse -Force
                $syncBackupCount++
                $syncBackupPathOutput = $syncBackupRoot
            }

            $destinationParent = Split-Path -Parent $destinationPath
            if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent)) {
                New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
            }

            if (Test-Path -LiteralPath $destinationPath -PathType Container) {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force
            }

            if (Test-Path -LiteralPath $sourcePath -PathType Container) {
                Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
            } else {
                Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
            }

            $syncUpdatedCount++
            $syncCopiedItems += $item
        }

        if (-not $DryRun) {
            $updateScriptPath = Join-Path $deployedBundleRoot 'scripts/update.ps1'
            if (-not (Test-Path -LiteralPath $updateScriptPath -PathType Leaf)) {
                throw "Updated update script not found: $updateScriptPath"
            }

            $updateParams = @{
                TargetRoot      = $TargetRoot
                InitAnswersPath = $InitAnswersPath
            }
            if ($SkipVerify) {
                $updateParams.SkipVerify = $true
            }
            if ($SkipManifestValidation) {
                $updateParams.SkipManifestValidation = $true
            }

            & $updateScriptPath @updateParams
            $updateApplied = $true
            $checkResult = 'UPDATED'
        } else {
            $checkResult = 'DRY_RUN_UPDATE_AVAILABLE'
        }
    }
}
finally {
    if (Test-Path -LiteralPath $tempRepoPath) {
        Remove-Item -LiteralPath $tempRepoPath -Recurse -Force
    }
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "RepoUrl: $RepoUrl"
if (-not [string]::IsNullOrWhiteSpace($Branch)) {
    Write-Output "Branch: $($Branch.Trim())"
}
Write-Output "CurrentVersion: $currentVersion"
Write-Output "LatestVersion: $latestVersion"
Write-Output "UpdateAvailable: $updateAvailable"
Write-Output "ApplyRequested: $($Apply.IsPresent)"
Write-Output "NoPrompt: $($NoPrompt.IsPresent)"
Write-Output "DryRun: $($DryRun.IsPresent)"
Write-Output "SyncItemsDetected: $syncItemCount"
Write-Output "SyncItemsBackedUp: $syncBackupCount"
Write-Output "SyncItemsUpdated: $syncUpdatedCount"
Write-Output "SyncBackupRoot: $syncBackupPathOutput"
if ($syncCopiedItems.Count -gt 0) {
    Write-Output ('SyncedItems: ' + ($syncCopiedItems -join ', '))
}
Write-Output "UpdateApplied: $updateApplied"
Write-Output "CheckUpdateResult: $checkResult"
