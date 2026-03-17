param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$DryRun,
    [switch]$NoInitAnswerPrompt,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir

$ruleContractMigrationModulePath = Join-Path $scriptDir 'lib/rule-contract-migrations.ps1'
if (-not (Test-Path -LiteralPath $ruleContractMigrationModulePath -PathType Leaf)) {
    throw "Rule contract migrations module not found: $ruleContractMigrationModulePath"
}
. $ruleContractMigrationModulePath

$initAnswerMigrationModulePath = Join-Path $scriptDir 'lib/init-answer-migrations.ps1'
if (-not (Test-Path -LiteralPath $initAnswerMigrationModulePath -PathType Leaf)) {
    throw "Init answer migrations module not found: $initAnswerMigrationModulePath"
}
. $initAnswerMigrationModulePath

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}
$targetBundleRoot = Join-Path $TargetRoot 'Octopus-agent-orchestrator'
$normalizedTargetBundleRoot = $targetBundleRoot.TrimEnd('\', '/')
$useDelegatedTargetBundleUpdate = -not [string]::Equals($normalizedBundleRoot, $normalizedTargetBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    $fullPath = [System.IO.Path]::GetFullPath($PathValue)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    if (-not [string]::IsNullOrWhiteSpace($rootPath) -and [string]::Equals($fullPath, $rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }

    return $fullPath.TrimEnd('\', '/')
}

function Test-IsPathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath
    )

    $rootFull = Get-NormalizedPath -PathValue $RootPath
    $candidateFull = Get-NormalizedPath -PathValue $CandidatePath

    if ([string]::Equals($rootFull, $candidateFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    $rootWithSeparator = if ($rootFull.EndsWith('\') -or $rootFull.EndsWith('/')) {
        $rootFull
    } else {
        $rootFull + [System.IO.Path]::DirectorySeparatorChar
    }
    return $candidateFull.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-PathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [switch]$RequireFile
    )

    $candidatePath = $PathValue
    if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
        $candidatePath = Join-Path $RootPath $candidatePath
    }

    $candidatePath = [System.IO.Path]::GetFullPath($candidatePath)
    if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $candidatePath)) {
        throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $candidatePath"
    }

    if ($RequireFile -and -not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
        throw "$Label file not found: $candidatePath"
    }

    if ($RequireFile) {
        $resolvedCandidatePath = (Resolve-Path -LiteralPath $candidatePath).Path
        if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $resolvedCandidatePath)) {
            throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $resolvedCandidatePath"
        }

        return $resolvedCandidatePath
    }

    return $candidatePath
}

function Get-RelativePathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    $rootFull = Get-NormalizedPath -PathValue $RootPath
    $candidateFull = Get-NormalizedPath -PathValue $PathValue
    if (-not (Test-IsPathInsideRoot -RootPath $rootFull -CandidatePath $candidateFull)) {
        throw "Path '$candidateFull' must resolve inside root '$rootFull'."
    }

    return [System.IO.Path]::GetRelativePath($rootFull, $candidateFull).Replace('\', '/')
}

function Get-UpdateRollbackItems {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$InitAnswersResolvedPath
    )

    $items = @(
        'CLAUDE.md',
        'AGENTS.md',
        'GEMINI.md',
        'TASK.md',
        '.claude/settings.local.json',
        '.qwen/settings.json',
        '.github/copilot-instructions.md',
        '.github/agents',
        '.windsurf/rules/rules.md',
        '.windsurf/agents',
        '.junie/guidelines.md',
        '.junie/agents',
        '.antigravity/rules.md',
        '.antigravity/agents',
        '.gitignore',
        '.git/hooks/pre-commit',
        'Octopus-agent-orchestrator/live',
        'Octopus-agent-orchestrator/template',
        'Octopus-agent-orchestrator/scripts',
        'Octopus-agent-orchestrator/README.md',
        'Octopus-agent-orchestrator/HOW_TO.md',
        'Octopus-agent-orchestrator/MANIFEST.md',
        'Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md',
        'Octopus-agent-orchestrator/CHANGELOG.md',
        'Octopus-agent-orchestrator/LICENSE',
        'Octopus-agent-orchestrator/VERSION'
    )

    $items += Get-RelativePathInsideRoot -RootPath $RootPath -PathValue $InitAnswersResolvedPath
    return @($items | Sort-Object -Unique)
}

function New-RollbackSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$SnapshotRoot,
        [Parameter(Mandatory = $true)]
        [string[]]$RelativePaths
    )

    $records = @()
    foreach ($relativePath in ($RelativePaths | Sort-Object -Unique)) {
        $targetPath = Join-Path $RootPath $relativePath
        $exists = Test-Path -LiteralPath $targetPath
        $pathType = 'missing'
        if ($exists) {
            if (Test-Path -LiteralPath $targetPath -PathType Container) {
                $pathType = 'directory'
            } else {
                $pathType = 'file'
            }

            $snapshotPath = Join-Path $SnapshotRoot $relativePath
            $snapshotParent = Split-Path -Parent $snapshotPath
            if ($snapshotParent -and -not (Test-Path -LiteralPath $snapshotParent)) {
                New-Item -ItemType Directory -Path $snapshotParent -Force | Out-Null
            }

            Copy-Item -LiteralPath $targetPath -Destination $snapshotPath -Recurse -Force
        }

        $records += [PSCustomObject]@{
            RelativePath = $relativePath
            Existed      = $exists
            PathType     = $pathType
        }
    }

    return $records
}

function Restore-RollbackSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$SnapshotRoot,
        [Parameter(Mandatory = $true)]
        [object[]]$Records
    )

    foreach ($record in $Records) {
        $relativePath = [string]$record.RelativePath
        $targetPath = Join-Path $RootPath $relativePath
        $snapshotPath = Join-Path $SnapshotRoot $relativePath
        $shouldExist = [bool]$record.Existed

        if ($shouldExist) {
            if (-not (Test-Path -LiteralPath $snapshotPath)) {
                throw "Rollback snapshot entry missing for '$relativePath': $snapshotPath"
            }

            if (Test-Path -LiteralPath $targetPath) {
                Remove-Item -LiteralPath $targetPath -Recurse -Force
            }

            $targetParent = Split-Path -Parent $targetPath
            if ($targetParent -and -not (Test-Path -LiteralPath $targetParent)) {
                New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
            }

            Copy-Item -LiteralPath $snapshotPath -Destination $targetPath -Recurse -Force
            continue
        }

        if (Test-Path -LiteralPath $targetPath) {
            Remove-Item -LiteralPath $targetPath -Recurse -Force
        }
    }
}

function Sync-WorkingTreeBundleItems {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceBundleRoot,
        [Parameter(Mandatory = $true)]
        [string]$TargetBundleRoot,
        [Parameter(Mandatory = $true)]
        [string[]]$RelativeItems
    )

    foreach ($item in ($RelativeItems | Sort-Object -Unique)) {
        $sourcePath = Join-Path $SourceBundleRoot $item
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            continue
        }

        $destinationPath = Join-Path $TargetBundleRoot $item
        if (Test-Path -LiteralPath $destinationPath) {
            Remove-Item -LiteralPath $destinationPath -Recurse -Force
        }

        $destinationParent = Split-Path -Parent $destinationPath
        if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }

        if (Test-Path -LiteralPath $sourcePath -PathType Container) {
            Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
        } else {
            Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
        }
    }
}

function Get-InitAnswerValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$LogicalName
    )

    $targetKey = $LogicalName.ToLowerInvariant().Replace('_', '').Replace('-', '')
    foreach ($property in $Answers.PSObject.Properties) {
        $propertyKey = $property.Name.ToLowerInvariant().Replace('_', '').Replace('-', '')
        if ($propertyKey -eq $targetKey) {
            if ($null -eq $property.Value) {
                return $null
            }
            return [string]$property.Value
        }
    }

    return $null
}

$initAnswersResolvedPath = Resolve-PathInsideRoot -RootPath $TargetRoot -PathValue $InitAnswersPath -Label 'InitAnswersPath' -RequireFile
$initAnswersRaw = Get-Content -LiteralPath $initAnswersResolvedPath -Raw
if ([string]::IsNullOrWhiteSpace($initAnswersRaw)) {
    throw "Init answers artifact is empty: $initAnswersResolvedPath"
}

try {
    $initAnswers = $initAnswersRaw | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Init answers artifact is not valid JSON: $initAnswersResolvedPath"
}

$liveVersionPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/version.json'
$existingLiveVersion = $null
$previousVersion = 'unknown'
$previousVersionSource = 'missing'
if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
    try {
        $existingLiveVersion = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $existingLiveVersion -and $null -ne $existingLiveVersion.PSObject.Properties['Version']) {
            $parsedVersion = [string]$existingLiveVersion.Version
            if (-not [string]::IsNullOrWhiteSpace($parsedVersion)) {
                $previousVersion = $parsedVersion.Trim()
                $previousVersionSource = 'live/version.json'
            } else {
                $previousVersionSource = 'live/version.json-empty'
            }
        } else {
            $previousVersionSource = 'live/version.json-no-version-field'
        }
    }
    catch {
        $previousVersionSource = 'live/version.json-invalid-json'
    }
}

$tokenEconomyConfigPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/config/token-economy.json'
$existingTokenEconomyConfig = $null
if (Test-Path -LiteralPath $tokenEconomyConfigPath -PathType Leaf) {
    try {
        $existingTokenEconomyConfig = Get-Content -LiteralPath $tokenEconomyConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        $existingTokenEconomyConfig = $null
    }
}

$initAnswerMigrationPromptingEnabled = (Test-UpdateInitAnswerPromptSupport) -and (-not $NoInitAnswerPrompt)
$initAnswerMigrationResult = Invoke-UpdateInitAnswerMigration `
    -Answers $initAnswers `
    -LiveVersion $existingLiveVersion `
    -TokenEconomyConfig $existingTokenEconomyConfig `
    -InitAnswersPath $initAnswersResolvedPath `
    -InteractivePrompting $initAnswerMigrationPromptingEnabled
$initAnswers = $initAnswerMigrationResult.Answers
$initAnswerMigrationChanges = @($initAnswerMigrationResult.Changes)
$initAnswerMigrationStatus = if ($initAnswerMigrationChanges.Count -gt 0) {
    if ($DryRun) { 'DRY_RUN_PENDING' } else { 'PENDING_WRITE' }
} else {
    'NOT_NEEDED'
}
$initAnswerMigrationPromptedCount = @($initAnswerMigrationChanges | Where-Object { $_.Action -in @('prompted', 'recommended_default') }).Count
$initAnswerMigrationRecommendedDefaultCount = @($initAnswerMigrationChanges | Where-Object { $_.Action -eq 'recommended_default' }).Count
$initAnswerMigrationDefaultedCount = @($initAnswerMigrationChanges | Where-Object { $_.Action -eq 'defaulted' }).Count
$initAnswerMigrationInferredCount = @($initAnswerMigrationChanges | Where-Object { $_.Action -eq 'inferred' }).Count

$assistantLanguage = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantLanguage'
if ([string]::IsNullOrWhiteSpace($assistantLanguage)) {
    throw "Init answers artifact missing AssistantLanguage: $initAnswersResolvedPath"
}
$assistantLanguage = $assistantLanguage.Trim()

$assistantBrevity = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantBrevity'
if ([string]::IsNullOrWhiteSpace($assistantBrevity)) {
    throw "Init answers artifact missing AssistantBrevity: $initAnswersResolvedPath"
}
$assistantBrevity = $assistantBrevity.Trim().ToLowerInvariant()
$allowedBrevity = @('concise', 'detailed')
if ($allowedBrevity -notcontains $assistantBrevity) {
    throw "Init answers artifact has unsupported AssistantBrevity '$assistantBrevity'. Allowed values: concise, detailed."
}

$sourceOfTruth = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'SourceOfTruth'
if ([string]::IsNullOrWhiteSpace($sourceOfTruth)) {
    throw "Init answers artifact missing SourceOfTruth: $initAnswersResolvedPath"
}
$sourceOfTruth = $sourceOfTruth.Trim()
$allowedSources = @('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')
if ($allowedSources -notcontains $sourceOfTruth) {
    throw "Init answers artifact has unsupported SourceOfTruth '$sourceOfTruth'. Allowed values: $($allowedSources -join ', ')."
}

$claudeOrchestratorFullAccessRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'ClaudeOrchestratorFullAccess'
if ([string]::IsNullOrWhiteSpace($claudeOrchestratorFullAccessRaw)) {
    throw "Init answers artifact missing ClaudeOrchestratorFullAccess: $initAnswersResolvedPath"
}
$claudeOrchestratorFullAccessNormalized = $claudeOrchestratorFullAccessRaw.Trim().ToLowerInvariant()
$allowedBooleanAnswers = @('1', '0', 'true', 'false', 'yes', 'no', 'y', 'n', 'да', 'нет')
if ($allowedBooleanAnswers -notcontains $claudeOrchestratorFullAccessNormalized) {
    throw "Init answers artifact has unsupported ClaudeOrchestratorFullAccess '$claudeOrchestratorFullAccessRaw'. Allowed values: true, false, yes, no, 1, 0."
}

$tokenEconomyEnabledRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'TokenEconomyEnabled'
if (-not [string]::IsNullOrWhiteSpace($tokenEconomyEnabledRaw)) {
    $tokenEconomyEnabledNormalized = $tokenEconomyEnabledRaw.Trim().ToLowerInvariant()
    if ($allowedBooleanAnswers -notcontains $tokenEconomyEnabledNormalized) {
        throw "Init answers artifact has unsupported TokenEconomyEnabled '$tokenEconomyEnabledRaw'. Allowed values: true, false, yes, no, 1, 0."
    }
}

$bundleVersionPath = Join-Path $bundleRoot 'VERSION'
if (-not (Test-Path -LiteralPath $bundleVersionPath -PathType Leaf)) {
    throw "Bundle version file not found: $bundleVersionPath"
}

$bundleVersion = (Get-Content -LiteralPath $bundleVersionPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($bundleVersion)) {
    throw "Bundle version file is empty: $bundleVersionPath"
}

$installScriptPath = Join-Path $scriptDir 'install.ps1'
$verifyScriptPath = Join-Path $scriptDir 'verify.ps1'
$manifestScriptPath = Join-Path $bundleRoot 'live/scripts/agent-gates/validate-manifest.ps1'
$manifestPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/MANIFEST.md'
$bundleSyncItems = @(
    'template',
    'scripts',
    'README.md',
    'HOW_TO.md',
    'MANIFEST.md',
    'AGENT_INIT_PROMPT.md',
    'CHANGELOG.md',
    'LICENSE',
    'VERSION'
)

if (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf)) {
    throw "Install script not found: $installScriptPath"
}
if (-not (Test-Path -LiteralPath $verifyScriptPath -PathType Leaf)) {
    throw "Verify script not found: $verifyScriptPath"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$updateReportRelativePath = "Octopus-agent-orchestrator/runtime/update-reports/update-$timestamp.md"
$updateReportPath = Join-Path $TargetRoot $updateReportRelativePath
$rollbackSnapshotRelativePath = "Octopus-agent-orchestrator/runtime/update-rollbacks/update-$timestamp"
$rollbackSnapshotPath = Join-Path $TargetRoot $rollbackSnapshotRelativePath
$rollbackSnapshotCreated = $false
$rollbackRecordCount = 0
$rollbackStatus = 'NOT_NEEDED'
$rollbackRecords = @()

$installStatus = 'NOT_RUN'
$contractMigrationStatus = 'NOT_RUN'
$verifyStatus = 'NOT_RUN'
$manifestStatus = 'NOT_RUN'
$updatedVersion = $bundleVersion
$contractMigrationCount = 0
$contractMigrationFiles = @()
$initAnswerMigrationAppliedCount = $initAnswerMigrationChanges.Count

$installParams = @{
    TargetRoot        = $TargetRoot
    AssistantLanguage = $assistantLanguage
    AssistantBrevity  = $assistantBrevity
    SourceOfTruth     = $sourceOfTruth
    InitAnswersPath   = $initAnswersResolvedPath
}
if ($DryRun) {
    $installParams.DryRun = $true
}

if (-not $DryRun) {
    $rollbackRootDir = Split-Path -Parent $rollbackSnapshotPath
    if ($rollbackRootDir -and -not (Test-Path -LiteralPath $rollbackRootDir)) {
        New-Item -ItemType Directory -Path $rollbackRootDir -Force | Out-Null
    }

    $rollbackRecords = New-RollbackSnapshot -RootPath $TargetRoot -SnapshotRoot $rollbackSnapshotPath -RelativePaths (Get-UpdateRollbackItems -RootPath $TargetRoot -InitAnswersResolvedPath $initAnswersResolvedPath)
    $rollbackRecordCount = $rollbackRecords.Count
    $rollbackSnapshotCreated = $true
}

$currentStage = 'INIT_ANSWER_MIGRATION'
try {
    if (-not $DryRun -and $initAnswerMigrationChanges.Count -gt 0) {
        $initAnswersDirectory = Split-Path -Parent $initAnswersResolvedPath
        if ($initAnswersDirectory -and -not (Test-Path -LiteralPath $initAnswersDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $initAnswersDirectory -Force | Out-Null
        }

        $initAnswersJson = $initAnswers | ConvertTo-Json -Depth 10
        Set-Content -LiteralPath $initAnswersResolvedPath -Value $initAnswersJson
        $initAnswerMigrationStatus = 'PASS'
    } elseif ($initAnswerMigrationChanges.Count -eq 0) {
        $initAnswerMigrationStatus = 'NOT_NEEDED'
    }

    if (-not $DryRun -and $useDelegatedTargetBundleUpdate) {
        $currentStage = 'BUNDLE_SYNC'
        Sync-WorkingTreeBundleItems -SourceBundleRoot $bundleRoot -TargetBundleRoot $targetBundleRoot -RelativeItems $bundleSyncItems

        $currentStage = 'DELEGATED_UPDATE'
        $delegatedUpdateScriptPath = Join-Path $targetBundleRoot 'scripts/update.ps1'
        if (-not (Test-Path -LiteralPath $delegatedUpdateScriptPath -PathType Leaf)) {
            throw "Delegated update script not found after bundle sync: $delegatedUpdateScriptPath"
        }

        $delegatedParams = @{
            TargetRoot      = $TargetRoot
            InitAnswersPath = $initAnswersResolvedPath
        }
        if ($NoInitAnswerPrompt) {
            $delegatedParams.NoInitAnswerPrompt = $true
        }
        if ($SkipVerify) {
            $delegatedParams.SkipVerify = $true
        }
        if ($SkipManifestValidation) {
            $delegatedParams.SkipManifestValidation = $true
        }

        & $delegatedUpdateScriptPath @delegatedParams
        return
    }

    $currentStage = 'INSTALL'
    & $installScriptPath @installParams
    $installStatus = 'PASS'

    if ($DryRun) {
        $contractMigrationStatus = 'SKIPPED_DRY_RUN'
        $verifyStatus = 'SKIPPED_DRY_RUN'
        $manifestStatus = 'SKIPPED_DRY_RUN'
    } else {
        $currentStage = 'CONTRACT_MIGRATIONS'
        $contractMigrationResult = Invoke-RuleContractMigrationsOnDisk -RootPath $TargetRoot
        $contractMigrationCount = [int]$contractMigrationResult.AppliedCount
        if ($contractMigrationCount -gt 0) {
            $contractMigrationFiles = @($contractMigrationResult.AppliedFiles)
        }
        $contractMigrationStatus = 'PASS'

        $currentStage = 'VERIFY'
        if ($SkipVerify) {
            $verifyStatus = 'SKIPPED'
        } else {
            & $verifyScriptPath -TargetRoot $TargetRoot -SourceOfTruth $sourceOfTruth -InitAnswersPath $initAnswersResolvedPath
            $verifyStatus = 'PASS'
        }

        $currentStage = 'MANIFEST_VALIDATION'
        if ($SkipManifestValidation) {
            $manifestStatus = 'SKIPPED'
        } else {
            if (-not (Test-Path -LiteralPath $manifestScriptPath -PathType Leaf)) {
                throw "Manifest validation script not found: $manifestScriptPath"
            }
            if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
                throw "Manifest file not found: $manifestPath"
            }

            & $manifestScriptPath -ManifestPath $manifestPath
            $manifestStatus = 'PASS'
        }

        if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
            try {
                $newLiveVersion = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
                if ($null -ne $newLiveVersion -and $null -ne $newLiveVersion.PSObject.Properties['Version']) {
                    $newParsedVersion = [string]$newLiveVersion.Version
                    if (-not [string]::IsNullOrWhiteSpace($newParsedVersion)) {
                        $updatedVersion = $newParsedVersion.Trim()
                    }
                }
            }
            catch {
                $updatedVersion = 'unknown'
            }
        }
    }
}
catch {
    switch ($currentStage) {
        'INIT_ANSWER_MIGRATION' { $initAnswerMigrationStatus = 'FAIL' }
        'INSTALL' { $installStatus = 'FAIL' }
        'BUNDLE_SYNC' { $installStatus = 'FAIL' }
        'DELEGATED_UPDATE' { $installStatus = 'FAIL' }
        'CONTRACT_MIGRATIONS' { $contractMigrationStatus = 'FAIL' }
        'VERIFY' { $verifyStatus = 'FAIL' }
        'MANIFEST_VALIDATION' { $manifestStatus = 'FAIL' }
    }

    $originalError = $_.Exception.Message
    if (-not $DryRun -and $rollbackSnapshotCreated) {
        $rollbackStatus = 'ATTEMPTED'
        $rollbackFailed = $false
        $rollbackError = $null
        try {
            Restore-RollbackSnapshot -RootPath $TargetRoot -SnapshotRoot $rollbackSnapshotPath -Records $rollbackRecords
            $rollbackStatus = 'SUCCESS'
        }
        catch {
            $rollbackFailed = $true
            $rollbackError = $_.Exception.Message
            $rollbackStatus = "FAILED: $rollbackError"
        }

        if ($rollbackFailed) {
            throw "Update failed during $currentStage. Original error: $originalError. Rollback failed: $rollbackError"
        }

        throw "Update failed during $currentStage and rollback completed successfully. Original error: $originalError"
    }

    throw "Update failed during $currentStage. Error: $originalError"
}

if (-not $DryRun -and $rollbackSnapshotCreated -and $rollbackStatus -eq 'NOT_NEEDED') {
    $rollbackStatus = 'NOT_TRIGGERED'
}

if (-not $DryRun) {
    $reportDir = Split-Path -Parent $updateReportPath
    if ($reportDir -and -not (Test-Path $reportDir)) {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    }

    $reportLines = @()
    $reportLines += '# Update Report'
    $reportLines += ''
    $reportLines += "GeneratedAt: $((Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK'))"
    $reportLines += "TargetRoot: $TargetRoot"
    $reportLines += "InitAnswersPath: $initAnswersResolvedPath"
    $reportLines += "RollbackSnapshotPath: $rollbackSnapshotRelativePath"
    $reportLines += "RollbackSnapshotRecordCount: $rollbackRecordCount"
    $reportLines += "RollbackStatus: $rollbackStatus"
    $reportLines += ''
    $reportLines += '## Version'
    $reportLines += "PreviousVersion: $previousVersion"
    $reportLines += "PreviousVersionSource: $previousVersionSource"
    $reportLines += "BundleVersion: $bundleVersion"
    $reportLines += "UpdatedVersion: $updatedVersion"
    $reportLines += ''
    $reportLines += '## InitAnswerMigration'
    $reportLines += "Status: $initAnswerMigrationStatus"
    $reportLines += "PromptingEnabled: $initAnswerMigrationPromptingEnabled"
    $reportLines += "AppliedCount: $initAnswerMigrationAppliedCount"
    $reportLines += "PromptedCount: $initAnswerMigrationPromptedCount"
    $reportLines += "RecommendedDefaultCount: $initAnswerMigrationRecommendedDefaultCount"
    $reportLines += "DefaultedCount: $initAnswerMigrationDefaultedCount"
    $reportLines += "InferredCount: $initAnswerMigrationInferredCount"
    if ($initAnswerMigrationChanges.Count -gt 0) {
        foreach ($change in $initAnswerMigrationChanges) {
            $reportLines += "- $($change.Key): action=$($change.Action); value=$($change.Value); source=$($change.Source); note=$($change.Note)"
        }
    } else {
        $reportLines += '- Changes: none'
    }
    $reportLines += ''
    $reportLines += '## CommandStatus'
    $reportLines += "InitAnswerMigration: $initAnswerMigrationStatus"
    $reportLines += "Install: $installStatus"
    $reportLines += "ContractMigrations: $contractMigrationStatus"
    $reportLines += "Verify: $verifyStatus"
    $reportLines += "ManifestValidation: $manifestStatus"
    $reportLines += ''
    $reportLines += '## ContractMigrations'
    $reportLines += "AppliedCount: $contractMigrationCount"
    if ($contractMigrationFiles.Count -gt 0) {
        $reportLines += "AppliedFiles: $($contractMigrationFiles -join ', ')"
    } else {
        $reportLines += 'AppliedFiles: none'
    }

    Set-Content -Path $updateReportPath -Value ($reportLines -join "`r`n")
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "RollbackSnapshotPath: $rollbackSnapshotRelativePath"
Write-Output "RollbackSnapshotCreated: $rollbackSnapshotCreated"
Write-Output "RollbackSnapshotRecordCount: $rollbackRecordCount"
Write-Output "RollbackStatus: $rollbackStatus"
Write-Output "InitAnswerMigrationStatus: $initAnswerMigrationStatus"
Write-Output "InitAnswerMigrationPromptingEnabled: $initAnswerMigrationPromptingEnabled"
Write-Output "InitAnswerMigrationCount: $initAnswerMigrationAppliedCount"
Write-Output "InitAnswerMigrationPromptedCount: $initAnswerMigrationPromptedCount"
Write-Output "InitAnswerMigrationRecommendedDefaultCount: $initAnswerMigrationRecommendedDefaultCount"
Write-Output "InitAnswerMigrationDefaultedCount: $initAnswerMigrationDefaultedCount"
Write-Output "InitAnswerMigrationInferredCount: $initAnswerMigrationInferredCount"
if ($initAnswerMigrationChanges.Count -gt 0) {
    foreach ($change in $initAnswerMigrationChanges) {
        Write-Output "InitAnswerMigration[$($change.Key)]: action=$($change.Action); value=$($change.Value); source=$($change.Source); note=$($change.Note)"
    }
}
Write-Output "AssistantLanguage: $assistantLanguage"
Write-Output "AssistantBrevity: $assistantBrevity"
Write-Output "SourceOfTruth: $sourceOfTruth"
Write-Output "PreviousVersion: $previousVersion"
Write-Output "PreviousVersionSource: $previousVersionSource"
Write-Output "BundleVersion: $bundleVersion"
Write-Output "UpdatedVersion: $updatedVersion"
Write-Output "InstallStatus: $installStatus"
Write-Output "ContractMigrationStatus: $contractMigrationStatus"
Write-Output "ContractMigrationCount: $contractMigrationCount"
if ($contractMigrationFiles.Count -gt 0) {
    Write-Output "ContractMigrationFiles: $($contractMigrationFiles -join ', ')"
}
Write-Output "VerifyStatus: $verifyStatus"
Write-Output "ManifestValidationStatus: $manifestStatus"
if ($DryRun) {
    Write-Output 'UpdateReportPath: not-generated-in-dry-run'
} else {
    Write-Output "UpdateReportPath: $updateReportRelativePath"
}
Write-Output 'Update: PASS'
