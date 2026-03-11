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

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}

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

$currentCheckUpdateScriptPath = [System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)

function Compare-VersionStrings {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Current,
        [Parameter(Mandatory = $true)]
        [string]$Latest
    )

    $currentNormalized = $Current.Trim()
    $latestNormalized = $Latest.Trim()
    $currentNormalized = $currentNormalized.TrimStart('v', 'V')
    $latestNormalized = $latestNormalized.TrimStart('v', 'V')

    try {
        $currentSemVer = [System.Management.Automation.SemanticVersion]::Parse($currentNormalized)
        $latestSemVer = [System.Management.Automation.SemanticVersion]::Parse($latestNormalized)
        return $currentSemVer.CompareTo($latestSemVer)
    }
    catch {
        try {
            $currentParsed = [version]$currentNormalized
            $latestParsed = [version]$latestNormalized
            return $currentParsed.CompareTo($latestParsed)
        }
        catch {
            $parseDottedSegments = {
                param([string]$Value)

                $segments = @()
                foreach ($rawSegment in ($Value -split '\.')) {
                    $segment = $rawSegment.Trim()
                    $segmentValue = 0L
                    $numericPrefixMatch = [regex]::Match($segment, '^\d+')
                    if ($numericPrefixMatch.Success) {
                        [void][long]::TryParse($numericPrefixMatch.Value, [ref]$segmentValue)
                    }
                    $segments += $segmentValue
                }

                return ,$segments
            }

            $currentSegments = & $parseDottedSegments $currentNormalized
            $latestSegments = & $parseDottedSegments $latestNormalized
            $maxLength = [Math]::Max($currentSegments.Count, $latestSegments.Count)

            for ($index = 0; $index -lt $maxLength; $index++) {
                $currentValue = if ($index -lt $currentSegments.Count) { [long]$currentSegments[$index] } else { 0L }
                $latestValue = if ($index -lt $latestSegments.Count) { [long]$latestSegments[$index] } else { 0L }

                if ($currentValue -lt $latestValue) {
                    return -1
                }
                if ($currentValue -gt $latestValue) {
                    return 1
                }
            }

            return 0
        }
    }
}

function Copy-DirectoryContentMerge {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,
        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory,
        [string[]]$SkipDestinationFiles = @()
    )

    if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    }

    $skipSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($skipFile in $SkipDestinationFiles) {
        if ([string]::IsNullOrWhiteSpace($skipFile)) {
            continue
        }
        [void]$skipSet.Add([System.IO.Path]::GetFullPath($skipFile))
    }

    $sourceRoot = [System.IO.Path]::GetFullPath($SourceDirectory)
    $expectedDestinationFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($sourceFile in Get-ChildItem -LiteralPath $SourceDirectory -Recurse -File) {
        $relativePath = [System.IO.Path]::GetRelativePath($sourceRoot, $sourceFile.FullName)
        if ([string]::IsNullOrWhiteSpace($relativePath) -or $relativePath -eq '.') {
            continue
        }

        $destinationFile = [System.IO.Path]::GetFullPath((Join-Path $DestinationDirectory $relativePath))
        [void]$expectedDestinationFiles.Add($destinationFile)
        if ($skipSet.Contains($destinationFile)) {
            continue
        }

        $destinationParent = Split-Path -Parent $destinationFile
        if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationFile -Force
    }

    foreach ($destinationFile in Get-ChildItem -LiteralPath $DestinationDirectory -Recurse -File -ErrorAction SilentlyContinue) {
        $destinationFileFull = [System.IO.Path]::GetFullPath($destinationFile.FullName)
        if ($skipSet.Contains($destinationFileFull)) {
            continue
        }
        if (-not $expectedDestinationFiles.Contains($destinationFileFull)) {
            Remove-Item -LiteralPath $destinationFileFull -Force
        }
    }

    $directories = @(Get-ChildItem -LiteralPath $DestinationDirectory -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
    foreach ($directory in $directories) {
        if ($skipSet.Contains([System.IO.Path]::GetFullPath($directory.FullName))) {
            continue
        }

        $hasChildren = @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction SilentlyContinue).Count -gt 0
        if (-not $hasChildren) {
            Remove-Item -LiteralPath $directory.FullName -Force
        }
    }
}

function Restore-SyncedItemsFromBackup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetBundleRoot,
        [Parameter(Mandatory = $true)]
        [string]$BackupRoot,
        [Parameter(Mandatory = $true)]
        [hashtable]$PreexistingMap,
        [AllowNull()]
        [string]$RunningScriptPath
    )

    foreach ($item in $PreexistingMap.Keys) {
        $destinationPath = Join-Path $TargetBundleRoot $item
        $preexisting = [bool]$PreexistingMap[$item]

        if ($preexisting) {
            $backupPath = Join-Path $BackupRoot $item
            if (-not (Test-Path -LiteralPath $backupPath)) {
                throw "Missing backup entry for '$item': $backupPath"
            }

            $isScriptsDirectory = [string]::Equals($item, 'scripts', [System.StringComparison]::OrdinalIgnoreCase)
            if ($isScriptsDirectory -and (Test-Path -LiteralPath $backupPath -PathType Container)) {
                if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
                    if (Test-Path -LiteralPath $destinationPath) {
                        Remove-Item -LiteralPath $destinationPath -Recurse -Force
                    }
                    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
                }

                $skipPaths = @()
                if (-not [string]::IsNullOrWhiteSpace($RunningScriptPath)) {
                    $skipPaths += [System.IO.Path]::GetFullPath($RunningScriptPath)
                }
                Copy-DirectoryContentMerge -SourceDirectory $backupPath -DestinationDirectory $destinationPath -SkipDestinationFiles $skipPaths
                continue
            }

            if (Test-Path -LiteralPath $destinationPath) {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force
            }

            $destinationParent = Split-Path -Parent $destinationPath
            if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent)) {
                New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
            }

            Copy-Item -LiteralPath $backupPath -Destination $destinationPath -Recurse -Force
            continue
        }

        if (Test-Path -LiteralPath $destinationPath) {
            Remove-Item -LiteralPath $destinationPath -Recurse -Force
        }
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
$syncRollbackStatus = 'NOT_NEEDED'
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
        $syncPreexistingMap = @{}

        try {
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

                if (-not $syncPreexistingMap.ContainsKey($item)) {
                    $syncPreexistingMap[$item] = $destinationExists
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

                $sourceIsDirectory = Test-Path -LiteralPath $sourcePath -PathType Container
                $isScriptsDirectory = [string]::Equals($item, 'scripts', [System.StringComparison]::OrdinalIgnoreCase)
                if ($sourceIsDirectory) {
                    if ($isScriptsDirectory) {
                        if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
                            if (Test-Path -LiteralPath $destinationPath) {
                                Remove-Item -LiteralPath $destinationPath -Recurse -Force
                            }
                            New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
                        }

                        $skipPaths = @($currentCheckUpdateScriptPath)
                        Copy-DirectoryContentMerge -SourceDirectory $sourcePath -DestinationDirectory $destinationPath -SkipDestinationFiles $skipPaths
                    } else {
                        if (Test-Path -LiteralPath $destinationPath -PathType Container) {
                            Remove-Item -LiteralPath $destinationPath -Recurse -Force
                        } elseif (Test-Path -LiteralPath $destinationPath) {
                            Remove-Item -LiteralPath $destinationPath -Force
                        }
                        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
                    }
                } else {
                    if (Test-Path -LiteralPath $destinationPath -PathType Container) {
                        Remove-Item -LiteralPath $destinationPath -Recurse -Force
                    }
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
                if ($syncPreexistingMap.Count -gt 0 -and $syncRollbackStatus -eq 'NOT_NEEDED') {
                    $syncRollbackStatus = 'NOT_TRIGGERED'
                }
            } else {
                $checkResult = 'DRY_RUN_UPDATE_AVAILABLE'
            }
        }
        catch {
            $originalError = $_.Exception.Message
            if (-not $DryRun -and $syncPreexistingMap.Count -gt 0) {
                $syncRollbackStatus = 'ATTEMPTED'
                $rollbackFailed = $false
                $rollbackError = $null
                try {
                    Restore-SyncedItemsFromBackup -TargetBundleRoot $deployedBundleRoot -BackupRoot $syncBackupRoot -PreexistingMap $syncPreexistingMap -RunningScriptPath $currentCheckUpdateScriptPath
                    $syncRollbackStatus = 'SUCCESS'
                }
                catch {
                    $rollbackFailed = $true
                    $rollbackError = $_.Exception.Message
                    $syncRollbackStatus = "FAILED: $rollbackError"
                }

                if ($rollbackFailed) {
                    throw "Update apply failed. Original error: $originalError. Sync rollback failed: $rollbackError"
                }

                throw "Update apply failed and sync rollback completed. Original error: $originalError"
            }

            throw "Update apply failed. Error: $originalError"
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
Write-Output "SyncRollbackStatus: $syncRollbackStatus"
if ($syncCopiedItems.Count -gt 0) {
    Write-Output ('SyncedItems: ' + ($syncCopiedItems -join ', '))
}
Write-Output "UpdateApplied: $updateApplied"
Write-Output "CheckUpdateResult: $checkResult"
