param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$NoPrompt,
    [switch]$DryRun,
    [switch]$SkipBackups,
    [string]$KeepPrimaryEntrypoint,
    [string]$KeepTaskFile,
    [string]$KeepRuntimeArtifacts
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}

. (Join-Path $scriptDir 'lib' 'common.ps1')

function Test-InteractivePromptSupport {
    try {
        if ($NoPrompt) {
            return $false
        }

        if (-not [Environment]::UserInteractive) {
            return $false
        }

        if ([Console]::IsInputRedirected) {
            return $false
        }

        return $true
    }
    catch {
        return $false
    }
}

function Resolve-Decision {
    param(
        [AllowNull()]
        [string]$ProvidedValue,
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [Parameter(Mandatory = $true)]
        [string]$PromptText
    )

    if (-not [string]::IsNullOrWhiteSpace($ProvidedValue)) {
        return Convert-ToBooleanAnswer -Value $ProvidedValue -FieldName $FieldName
    }

    if (-not $script:InteractivePrompting) {
        throw "Interactive prompt for $FieldName is unavailable. Re-run with -NoPrompt and explicit -$FieldName <yes|no>."
    }

    while ($true) {
        $answer = Read-Host $PromptText
        try {
            return Convert-ToBooleanAnswer -Value $answer -FieldName $FieldName
        }
        catch {
            Write-Warning $_.Exception.Message
        }
    }
}

function Get-CanonicalEntrypointFromSourceOfTruth {
    param(
        [AllowNull()]
        [string]$SourceOfTruthValue
    )

    if ([string]::IsNullOrWhiteSpace($SourceOfTruthValue)) {
        return $null
    }

    $lookupKey = $SourceOfTruthValue.Trim().ToUpperInvariant().Replace(' ', '')
    $map = Get-SourceToEntrypointMap
    if ($map.ContainsKey($lookupKey)) {
        return $map[$lookupKey]
    }

    return $null
}

function Try-GetCanonicalEntrypointFromJsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [switch]$PreferCanonicalProperty
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        $payload = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }

    if ($PreferCanonicalProperty) {
        $canonicalProperty = $payload.PSObject.Properties['CanonicalEntrypoint']
        if ($null -ne $canonicalProperty -and -not [string]::IsNullOrWhiteSpace([string]$canonicalProperty.Value)) {
            return ([string]$canonicalProperty.Value).Trim()
        }
    }

    $sourceProperty = $payload.PSObject.Properties['SourceOfTruth']
    if ($null -ne $sourceProperty -and -not [string]::IsNullOrWhiteSpace([string]$sourceProperty.Value)) {
        return Get-CanonicalEntrypointFromSourceOfTruth -SourceOfTruthValue ([string]$sourceProperty.Value)
    }

    return $null
}

function Try-GetActiveAgentFilesFromJsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [AllowNull()]
        [string]$FallbackSourceOfTruthValue
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @()
    }

    try {
        $payload = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return @()
    }

    $activeAgentFilesRaw = $null
    $activeAgentFilesProperty = $payload.PSObject.Properties['ActiveAgentFiles']
    if ($null -ne $activeAgentFilesProperty -and -not [string]::IsNullOrWhiteSpace([string]$activeAgentFilesProperty.Value)) {
        $activeAgentFilesRaw = [string]$activeAgentFilesProperty.Value
    }

    $sourceOfTruthValue = $FallbackSourceOfTruthValue
    $sourceProperty = $payload.PSObject.Properties['SourceOfTruth']
    if ($null -ne $sourceProperty -and -not [string]::IsNullOrWhiteSpace([string]$sourceProperty.Value)) {
        $sourceOfTruthValue = [string]$sourceProperty.Value
    }

    return @(Get-ActiveAgentEntrypointFiles -Value $activeAgentFilesRaw -SourceOfTruthValue $sourceOfTruthValue)
}

function Try-DetectCanonicalEntrypointFromManagedFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$EntrypointFiles
    )

    foreach ($relativePath in $EntrypointFiles) {
        $candidatePath = Join-Path $TargetRoot $relativePath
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
            continue
        }

        $content = Get-Content -LiteralPath $candidatePath -Raw
        if ([string]::IsNullOrWhiteSpace($content)) {
            continue
        }

        if ($content -match 'Octopus Agent Orchestrator Rule Index' -or $content -match '## Rule Routing') {
            return $relativePath
        }
    }

    return $null
}

function Normalize-TextAfterManagedBlockRemoval {
    param(
        [AllowNull()]
        [string]$Content
    )

    if ($null -eq $Content) {
        return ''
    }

    $normalized = $Content -replace "`r`n", "`n" -replace "`r", "`n"
    $normalized = [regex]::Replace($normalized, "\n{3,}", "`n`n")
    $trimmed = $normalized.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ''
    }

    return ($trimmed -split "`n") -join "`r`n"
}

function Remove-EmptyDirectoriesUpwards {
    param(
        [AllowNull()]
        [string]$StartDirectory
    )

    $current = $StartDirectory
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        $normalizedCurrent = Get-NormalizedPath -PathValue $current
        if ([string]::Equals($normalizedCurrent, $normalizedTargetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }

        if (-not (Test-Path -LiteralPath $current -PathType Container)) {
            $current = Split-Path -Parent $current
            continue
        }

        $entries = @(Get-ChildItem -LiteralPath $current -Force)
        if ($entries.Count -gt 0) {
            break
        }

        if (-not $DryRun) {
            Remove-Item -LiteralPath $current -Force
        }
        $script:DeletedDirectories++
        $current = Split-Path -Parent $current
    }
}

function Get-BackupRoot {
    if ([string]::IsNullOrWhiteSpace($script:BackupRoot)) {
        $script:BackupRoot = Join-Path $TargetRoot ("Octopus-agent-orchestrator-uninstall-backups\" + $timestamp)
    }

    return $script:BackupRoot
}

function Get-InitializationBackupRoot {
    if ($script:InitializationBackupRootResolved) {
        return $script:InitializationBackupRoot
    }

    $script:InitializationBackupRootResolved = $true
    $installBackupsRoot = Join-Path $orchestratorRoot 'runtime\backups'
    if (-not (Test-Path -LiteralPath $installBackupsRoot -PathType Container)) {
        $script:InitializationBackupRoot = $null
        return $null
    }

    $backupDirectories = @(Get-ChildItem -LiteralPath $installBackupsRoot -Directory | Sort-Object Name)
    if ($backupDirectories.Count -eq 0) {
        $script:InitializationBackupRoot = $null
        return $null
    }

    $script:InitializationBackupRoot = $backupDirectories[0].FullName
    return $script:InitializationBackupRoot
}

function Get-InitializationBackupPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $initializationBackupRoot = Get-InitializationBackupRoot
    if ([string]::IsNullOrWhiteSpace($initializationBackupRoot)) {
        return $null
    }

    $backupPath = Join-Path $initializationBackupRoot $RelativePath
    if (-not (Test-Path -LiteralPath $backupPath)) {
        return $null
    }

    return $backupPath
}

function Get-InitializationBackupManifest {
    if ($script:InitializationBackupManifestResolved) {
        return $script:InitializationBackupManifest
    }

    $script:InitializationBackupManifestResolved = $true
    $initializationBackupRoot = Get-InitializationBackupRoot
    if ([string]::IsNullOrWhiteSpace($initializationBackupRoot)) {
        $script:InitializationBackupManifest = $null
        return $null
    }

    $manifestPath = Join-Path $initializationBackupRoot '_install-backup.manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $script:InitializationBackupManifest = $null
        return $null
    }

    try {
        $script:InitializationBackupManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $script:InitializationBackupManifest = $null
    }

    return $script:InitializationBackupManifest
}

function Test-IsManagedOnlyBackupContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BackupPath
    )

    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
        return $false
    }

    $content = Get-Content -LiteralPath $BackupPath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $false
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)
    if (-not [regex]::IsMatch($content, $pattern)) {
        return $false
    }

    $withoutManagedBlock = [regex]::Replace($content, $pattern, '')
    $normalized = Normalize-TextAfterManagedBlockRemoval -Content $withoutManagedBlock
    return [string]::IsNullOrWhiteSpace($normalized)
}

function Test-ShouldRestoreItemFromInitializationBackup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$BackupPath
    )

    $manifest = Get-InitializationBackupManifest
    if ($null -ne $manifest) {
        $preExistingFilesProperty = $manifest.PSObject.Properties['PreExistingFiles']
        if ($null -ne $preExistingFilesProperty) {
            $normalizedRelativePath = $RelativePath.Replace('/', '\')
            foreach ($item in @($preExistingFilesProperty.Value)) {
                if ($null -eq $item) {
                    continue
                }

                $candidate = [string]$item
                if ([string]::Equals($candidate.Replace('/', '\'), $normalizedRelativePath, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return $true
                }
            }

            return $false
        }
    }

    return -not (Test-IsManagedOnlyBackupContent -BackupPath $BackupPath)
}

function Backup-Item {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [switch]$Directory,
        [switch]$ForcePreserve
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    if ($SkipBackups -and -not $ForcePreserve) {
        return
    }

    $normalizedRelativePath = $RelativePath.Replace('/', '\')
    if ($script:BackedUpSet.Contains($normalizedRelativePath)) {
        return
    }

    $backupPath = Join-Path (Get-BackupRoot) $normalizedRelativePath
    $backupParent = Split-Path -Parent $backupPath

    if (-not $DryRun) {
        if ($backupParent -and -not (Test-Path -LiteralPath $backupParent -PathType Container)) {
            New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
        }

        if ($Directory) {
            Copy-Item -LiteralPath $Path -Destination $backupPath -Recurse -Force
        } else {
            Copy-Item -LiteralPath $Path -Destination $backupPath -Force
        }
    }

    [void]$script:BackedUpSet.Add($normalizedRelativePath)
    $script:ItemsBackedUp++
}

function Restore-ItemFromInitializationBackup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $backupPath = Get-InitializationBackupPath -RelativePath $RelativePath
    if ([string]::IsNullOrWhiteSpace($backupPath)) {
        return $false
    }

    if (-not (Test-ShouldRestoreItemFromInitializationBackup -RelativePath $RelativePath -BackupPath $backupPath)) {
        return $false
    }

    $destinationPath = Join-Path $TargetRoot $RelativePath
    Backup-Item -Path $destinationPath -RelativePath $RelativePath

    if (-not $DryRun) {
        $destinationParent = Split-Path -Parent $destinationPath
        if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }

        $backupItem = Get-Item -LiteralPath $backupPath
        if (Test-Path -LiteralPath $destinationPath) {
            $destinationItem = Get-Item -LiteralPath $destinationPath
            if ($destinationItem.PSIsContainer -ne $backupItem.PSIsContainer) {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force
            }
        }

        if ($backupItem.PSIsContainer) {
            if (Test-Path -LiteralPath $destinationPath -PathType Container) {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force
            }
            Copy-Item -LiteralPath $backupPath -Destination $destinationPath -Recurse -Force
        } else {
            Copy-Item -LiteralPath $backupPath -Destination $destinationPath -Force
        }
    }

    $script:RestoredFiles++
    return $true
}

function Add-CleanupWarning {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $script:Warnings += $Message
    Write-Warning $Message
}

function Update-Or-RemoveFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [AllowNull()]
        [string]$Content
    )

    Backup-Item -Path $Path -RelativePath $RelativePath

    if ([string]::IsNullOrWhiteSpace($Content)) {
        if (-not $DryRun) {
            Remove-Item -LiteralPath $Path -Force
        }
        $script:DeletedFiles++
        Remove-EmptyDirectoriesUpwards -StartDirectory (Split-Path -Parent $Path)
        return
    }

    if (-not $DryRun) {
        Set-Content -LiteralPath $Path -Value $Content
    }
    $script:UpdatedFiles++
}

function Remove-ManagedFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $path = Join-Path $TargetRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return
    }

    $content = Get-Content -LiteralPath $path -Raw
    if ($null -eq $content) {
        $content = ''
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)
    if (-not [regex]::IsMatch($content, $pattern)) {
        Add-CleanupWarning -Message "Skipping '$RelativePath' because it no longer contains Octopus managed block markers."
        return
    }

    $updatedContent = [regex]::Replace($content, $pattern, '')
    $updatedContent = Normalize-TextAfterManagedBlockRemoval -Content $updatedContent
    Update-Or-RemoveFile -Path $path -RelativePath $RelativePath -Content $updatedContent
}

function Cleanup-QwenSettings {
    $path = Join-Path $TargetRoot $qwenSettingsRelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return
    }

    try {
        $settings = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        Add-CleanupWarning -Message "Skipping '$qwenSettingsRelativePath' because it is no longer valid JSON."
        return
    }

    if (-not ($settings -is [System.Collections.IDictionary])) {
        Add-CleanupWarning -Message "Skipping '$qwenSettingsRelativePath' because its JSON root is no longer an object."
        return
    }

    $orderedSettings = [ordered]@{}
    foreach ($key in $settings.Keys) {
        $orderedSettings[$key] = $settings[$key]
    }

    if (-not $orderedSettings.Contains('context') -or -not ($orderedSettings['context'] -is [System.Collections.IDictionary])) {
        return
    }

    $orderedContext = [ordered]@{}
    foreach ($key in $orderedSettings['context'].Keys) {
        $orderedContext[$key] = $orderedSettings['context'][$key]
    }

    $currentEntries = @()
    if ($orderedContext.Contains('fileName')) {
        foreach ($item in @($orderedContext['fileName'])) {
            if ($null -eq $item) {
                continue
            }

            $text = [string]$item
            if ([string]::IsNullOrWhiteSpace($text)) {
                continue
            }

            $currentEntries += $text.Trim()
        }
    }

    $updatedEntries = @()
    foreach ($entry in $currentEntries) {
        if ($qwenManagedEntries -contains $entry) {
            continue
        }

        $updatedEntries += $entry
    }

    if ($updatedEntries.Count -eq $currentEntries.Count) {
        return
    }

    if ($updatedEntries.Count -gt 0) {
        $orderedContext['fileName'] = $updatedEntries
    } else {
        [void]$orderedContext.Remove('fileName')
    }

    if ($orderedContext.Count -gt 0) {
        $orderedSettings['context'] = $orderedContext
    } else {
        [void]$orderedSettings.Remove('context')
    }

    if ($orderedSettings.Count -eq 0) {
        Update-Or-RemoveFile -Path $path -RelativePath $qwenSettingsRelativePath -Content ''
        return
    }

    $json = $orderedSettings | ConvertTo-Json -Depth 20
    Update-Or-RemoveFile -Path $path -RelativePath $qwenSettingsRelativePath -Content $json
}

function Cleanup-ClaudeLocalSettings {
    $path = Join-Path $TargetRoot $claudeLocalSettingsRelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return
    }

    try {
        $settings = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        Add-CleanupWarning -Message "Skipping '$claudeLocalSettingsRelativePath' because it is no longer valid JSON."
        return
    }

    if (-not ($settings -is [System.Collections.IDictionary])) {
        Add-CleanupWarning -Message "Skipping '$claudeLocalSettingsRelativePath' because its JSON root is no longer an object."
        return
    }

    $orderedSettings = [ordered]@{}
    foreach ($key in $settings.Keys) {
        $orderedSettings[$key] = $settings[$key]
    }

    if (-not $orderedSettings.Contains('permissions') -or -not ($orderedSettings['permissions'] -is [System.Collections.IDictionary])) {
        return
    }

    $orderedPermissions = [ordered]@{}
    foreach ($key in $orderedSettings['permissions'].Keys) {
        $orderedPermissions[$key] = $orderedSettings['permissions'][$key]
    }

    $currentAllowEntries = @()
    if ($orderedPermissions.Contains('allow')) {
        foreach ($item in @($orderedPermissions['allow'])) {
            if ($null -eq $item) {
                continue
            }

            $text = [string]$item
            if ([string]::IsNullOrWhiteSpace($text)) {
                continue
            }

            $currentAllowEntries += $text.Trim()
        }
    }

    $updatedAllowEntries = @()
    foreach ($entry in $currentAllowEntries) {
        if ($claudeManagedAllowEntries -contains $entry) {
            continue
        }

        $updatedAllowEntries += $entry
    }

    if ($updatedAllowEntries.Count -eq $currentAllowEntries.Count) {
        return
    }

    if ($updatedAllowEntries.Count -gt 0) {
        $orderedPermissions['allow'] = $updatedAllowEntries
    } else {
        [void]$orderedPermissions.Remove('allow')
    }

    if ($orderedPermissions.Count -gt 0) {
        $orderedSettings['permissions'] = $orderedPermissions
    } else {
        [void]$orderedSettings.Remove('permissions')
    }

    if ($orderedSettings.Count -eq 0) {
        Update-Or-RemoveFile -Path $path -RelativePath $claudeLocalSettingsRelativePath -Content ''
        return
    }

    $json = $orderedSettings | ConvertTo-Json -Depth 20
    Update-Or-RemoveFile -Path $path -RelativePath $claudeLocalSettingsRelativePath -Content $json
}

function Cleanup-Gitignore {
    $path = Join-Path $TargetRoot '.gitignore'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return
    }

    $lines = @(Get-Content -LiteralPath $path)
    $updatedLines = New-Object 'System.Collections.Generic.List[string]'
    $changed = $false

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = [string]$lines[$index]
        if ($line -eq $gitignoreManagedComment) {
            $changed = $true
            $index++
            while ($index -lt $lines.Count) {
                $candidate = [string]$lines[$index]
                if ($gitignoreManagedEntries -contains $candidate) {
                    $changed = $true
                    $index++
                    continue
                }
                $index--
                break
            }
            continue
        }

        $updatedLines.Add($line) | Out-Null
    }

    if (-not $changed) {
        return
    }

    $updatedContent = Normalize-TextAfterManagedBlockRemoval -Content ($updatedLines -join "`r`n")
    Update-Or-RemoveFile -Path $path -RelativePath '.gitignore' -Content $updatedContent
}

function Cleanup-CommitGuardHook {
    $path = Join-Path $TargetRoot $preCommitHookRelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return
    }

    $content = Get-Content -LiteralPath $path -Raw
    if ($null -eq $content) {
        $content = ''
    }

    $pattern = '(?s)' + [regex]::Escape($commitGuardStart) + '.*?' + [regex]::Escape($commitGuardEnd)
    if (-not [regex]::IsMatch($content, $pattern)) {
        return
    }

    $updatedContent = [regex]::Replace($content, $pattern, '')
    $updatedContent = Normalize-TextAfterManagedBlockRemoval -Content $updatedContent
    if ($updatedContent -match '^\#\!/usr/bin/env bash\s*$') {
        $updatedContent = ''
    }

    Update-Or-RemoveFile -Path $path -RelativePath $preCommitHookRelativePath -Content $updatedContent
}

function Remove-BundleDirectory {
    if (-not (Test-Path -LiteralPath $orchestratorRoot -PathType Container)) {
        return
    }

    $currentLocation = (Get-Location).Path
    if (Test-IsPathInsideRoot -RootPath $orchestratorRoot -CandidatePath $currentLocation) {
        Set-Location -LiteralPath $TargetRoot
    }

    if (-not $SkipBackups) {
        Backup-Item -Path $orchestratorRoot -RelativePath 'Octopus-agent-orchestrator' -Directory
        if ($KeepRuntimeArtifactsValue) {
            $script:PreservedRuntimePath = Join-Path (Get-BackupRoot) 'Octopus-agent-orchestrator\runtime'
        }
    } elseif ($KeepRuntimeArtifactsValue) {
        $runtimePath = Join-Path $orchestratorRoot 'runtime'
        if (Test-Path -LiteralPath $runtimePath -PathType Container) {
            Backup-Item -Path $runtimePath -RelativePath 'Octopus-agent-orchestrator\runtime' -Directory -ForcePreserve
            $script:PreservedRuntimePath = Join-Path (Get-BackupRoot) 'Octopus-agent-orchestrator\runtime'
        }
    }

    if (-not $DryRun) {
        Remove-Item -LiteralPath $orchestratorRoot -Recurse -Force
    }
    $script:DeletedDirectories++
}

$managedStart = '<!-- Octopus-agent-orchestrator:managed-start -->'
$managedEnd = '<!-- Octopus-agent-orchestrator:managed-end -->'
$commitGuardStart = '# Octopus-agent-orchestrator:commit-guard-start'
$commitGuardEnd = '# Octopus-agent-orchestrator:commit-guard-end'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$orchestratorRoot = Join-Path $TargetRoot 'Octopus-agent-orchestrator'
$initAnswersCandidatePath = Resolve-PathInsideRoot -RootPath $TargetRoot -PathValue $InitAnswersPath -Label 'InitAnswersPath'
$liveVersionPath = Join-Path $orchestratorRoot 'live\version.json'

$entrypointFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.windsurf/rules/rules.md',
    '.junie/guidelines.md',
    '.antigravity/rules.md'
)
$providerAgentFiles = @(
    '.github/agents/orchestrator.md',
    '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md',
    '.antigravity/agents/orchestrator.md'
)
$githubSkillBridgeFiles = @(
    '.github/agents/reviewer.md',
    '.github/agents/code-review.md',
    '.github/agents/db-review.md',
    '.github/agents/security-review.md',
    '.github/agents/refactor-review.md',
    '.github/agents/api-review.md',
    '.github/agents/test-review.md',
    '.github/agents/performance-review.md',
    '.github/agents/infra-review.md',
    '.github/agents/dependency-review.md'
)
$qwenSettingsRelativePath = '.qwen/settings.json'
$claudeLocalSettingsRelativePath = '.claude/settings.local.json'
$preCommitHookRelativePath = '.git/hooks/pre-commit'
$qwenManagedEntries = @('TASK.md')
$claudeManagedAllowEntries = @(
    'Bash(pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/*:*)',
    'Bash(bash Octopus-agent-orchestrator/live/scripts/agent-gates/*:*)',
    'Bash(pwsh -File Octopus-agent-orchestrator/scripts/*:*)',
    'Bash(bash Octopus-agent-orchestrator/scripts/*:*)',
    'Bash(cd * && pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/*:*)',
    'Bash(cd * && bash Octopus-agent-orchestrator/live/scripts/agent-gates/*:*)',
    'Bash(cd * && pwsh -File Octopus-agent-orchestrator/scripts/*:*)',
    'Bash(cd * && bash Octopus-agent-orchestrator/scripts/*:*)',
    'Bash(cd * && git diff *:*)',
    'Bash(cd * && git log *:*)',
    'Bash(grep -n * | head * && echo * && grep -n * | head *:*)',
    'Bash(cd * && grep -n * | head * && echo * && grep -n * | head *:*)'
)
$gitignoreManagedComment = '# Octopus-agent-orchestrator managed ignores'
$gitignoreManagedEntries = @(
    'Octopus-agent-orchestrator/',
    'AGENTS.md',
    'TASK.md',
    '.qwen/',
    '.github/agents/',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md',
    '.claude/'
)

$script:InteractivePrompting = Test-InteractivePromptSupport
$script:BackedUpSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$script:Warnings = @()
$script:BackupRoot = $null
$script:InitializationBackupRoot = $null
$script:InitializationBackupRootResolved = $false
$script:InitializationBackupManifest = $null
$script:InitializationBackupManifestResolved = $false
$script:PreservedRuntimePath = $null
$script:DeletedFiles = 0
$script:UpdatedFiles = 0
$script:DeletedDirectories = 0
$script:ItemsBackedUp = 0
$script:RestoredFiles = 0

$canonicalEntrypoint = Try-GetCanonicalEntrypointFromJsonFile -Path $initAnswersCandidatePath
if ([string]::IsNullOrWhiteSpace($canonicalEntrypoint)) {
    $canonicalEntrypoint = Try-GetCanonicalEntrypointFromJsonFile -Path $liveVersionPath -PreferCanonicalProperty
}
if ([string]::IsNullOrWhiteSpace($canonicalEntrypoint)) {
    $canonicalEntrypoint = Try-DetectCanonicalEntrypointFromManagedFiles -EntrypointFiles $entrypointFiles
}

$detectedActiveAgentFiles = @()
if (Test-Path -LiteralPath $initAnswersCandidatePath -PathType Leaf) {
    $detectedActiveAgentFiles = @(Try-GetActiveAgentFilesFromJsonFile -Path $initAnswersCandidatePath)
}
if ($detectedActiveAgentFiles.Count -eq 0 -and (Test-Path -LiteralPath $liveVersionPath -PathType Leaf)) {
    $detectedActiveAgentFiles = @(Try-GetActiveAgentFilesFromJsonFile -Path $liveVersionPath)
}
if ($detectedActiveAgentFiles.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($canonicalEntrypoint)) {
    $detectedActiveAgentFiles = @($canonicalEntrypoint)
}
$qwenManagedEntries = @(
    @('TASK.md') + @($detectedActiveAgentFiles | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
)
$qwenManagedEntries = @($qwenManagedEntries | Sort-Object -Unique)

$canonicalEntrypointPath = $null
if (-not [string]::IsNullOrWhiteSpace($canonicalEntrypoint)) {
    $canonicalEntrypointPath = Join-Path $TargetRoot $canonicalEntrypoint
}

$taskPath = Join-Path $TargetRoot 'TASK.md'
$runtimePath = Join-Path $orchestratorRoot 'runtime'

$KeepPrimaryEntrypointValue = $false
if (-not [string]::IsNullOrWhiteSpace($canonicalEntrypoint) -and (Test-Path -LiteralPath $canonicalEntrypointPath -PathType Leaf)) {
    if (-not [string]::IsNullOrWhiteSpace($KeepPrimaryEntrypoint)) {
        $KeepPrimaryEntrypointValue = Convert-ToBooleanAnswer -Value $KeepPrimaryEntrypoint -FieldName 'KeepPrimaryEntrypoint'
    }
}

$KeepTaskFileValue = $false
if (Test-Path -LiteralPath $taskPath -PathType Leaf) {
    if (-not [string]::IsNullOrWhiteSpace($KeepTaskFile)) {
        $KeepTaskFileValue = Convert-ToBooleanAnswer -Value $KeepTaskFile -FieldName 'KeepTaskFile'
    }
}

$KeepRuntimeArtifactsValue = $false
if (Test-Path -LiteralPath $runtimePath -PathType Container) {
    if (-not [string]::IsNullOrWhiteSpace($KeepRuntimeArtifacts)) {
        $KeepRuntimeArtifactsValue = Convert-ToBooleanAnswer -Value $KeepRuntimeArtifacts -FieldName 'KeepRuntimeArtifacts'
    }
}

if (-not $KeepTaskFileValue) {
    if (-not (Restore-ItemFromInitializationBackup -RelativePath 'TASK.md')) {
        Remove-ManagedFile -RelativePath 'TASK.md'
    }
}

foreach ($relativePath in $entrypointFiles) {
    if ($KeepPrimaryEntrypointValue -and -not [string]::IsNullOrWhiteSpace($canonicalEntrypoint) -and [string]::Equals($relativePath, $canonicalEntrypoint, [System.StringComparison]::OrdinalIgnoreCase)) {
        continue
    }

    if (-not (Restore-ItemFromInitializationBackup -RelativePath $relativePath)) {
        Remove-ManagedFile -RelativePath $relativePath
    }
}

foreach ($relativePath in @($providerAgentFiles + $githubSkillBridgeFiles)) {
    if (-not (Restore-ItemFromInitializationBackup -RelativePath $relativePath)) {
        Remove-ManagedFile -RelativePath $relativePath
    }
}

if (-not (Restore-ItemFromInitializationBackup -RelativePath $qwenSettingsRelativePath)) {
    Cleanup-QwenSettings
}
if (-not (Restore-ItemFromInitializationBackup -RelativePath $claudeLocalSettingsRelativePath)) {
    Cleanup-ClaudeLocalSettings
}
if (-not (Restore-ItemFromInitializationBackup -RelativePath $preCommitHookRelativePath)) {
    Cleanup-CommitGuardHook
}
if (-not (Restore-ItemFromInitializationBackup -RelativePath '.gitignore')) {
    Cleanup-Gitignore
}
Remove-BundleDirectory

Write-Output "TargetRoot: $TargetRoot"
Write-Output "OrchestratorRoot: $orchestratorRoot"
Write-Output "InitAnswersPath: $initAnswersCandidatePath"
Write-Output "InitializationBackupRoot: $(if ([string]::IsNullOrWhiteSpace((Get-InitializationBackupRoot))) { '<none>' } else { Get-InitializationBackupRoot })"
Write-Output "CanonicalEntrypoint: $(if ([string]::IsNullOrWhiteSpace($canonicalEntrypoint)) { '<unknown>' } else { $canonicalEntrypoint })"
Write-Output "KeepPrimaryEntrypoint: $KeepPrimaryEntrypointValue"
Write-Output "KeepTaskFile: $KeepTaskFileValue"
Write-Output "KeepRuntimeArtifacts: $KeepRuntimeArtifactsValue"
Write-Output "DryRun: $DryRun"
Write-Output "SkipBackups: $SkipBackups"
Write-Output "BackupRoot: $(if ([string]::IsNullOrWhiteSpace($script:BackupRoot)) { '<none>' } else { $script:BackupRoot })"
Write-Output "PreservedRuntimePath: $(if ([string]::IsNullOrWhiteSpace($script:PreservedRuntimePath)) { '<none>' } else { $script:PreservedRuntimePath })"
Write-Output "FilesUpdated: $($script:UpdatedFiles)"
Write-Output "FilesDeleted: $($script:DeletedFiles)"
Write-Output "FilesRestored: $($script:RestoredFiles)"
Write-Output "DirectoriesDeleted: $($script:DeletedDirectories)"
Write-Output "ItemsBackedUp: $($script:ItemsBackedUp)"
Write-Output "WarningsCount: $($script:Warnings.Count)"
Write-Output "Result: $(if ($DryRun) { 'DRY_RUN' } else { 'SUCCESS' })"

if (-not $DryRun) {
    $backupBasePath = Join-Path $TargetRoot 'Octopus-agent-orchestrator-uninstall-backups'
    Write-Host ''
    Write-Host 'Octopus orchestrator was removed from this project.' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $backupBasePath -PathType Container) {
        Write-Host "Uninstall backups are stored in '$backupBasePath'." -ForegroundColor Yellow
        Write-Host 'You can delete that folder manually when you no longer need the backup.' -ForegroundColor Yellow
    }
}
