param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [bool]$PreserveExisting = $true,
    [bool]$AlignExisting = $true,
    [bool]$RunInit = $true,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$AssistantLanguage,
    [Parameter(Mandatory = $true)]
    [ValidateSet('concise', 'detailed')]
    [string]$AssistantBrevity,
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [Parameter(Mandatory = $true)]
    [string]$SourceOfTruth,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InitAnswersPath
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$sourceRoot = Join-Path $bundleRoot 'template'

if (-not (Test-Path $sourceRoot)) {
    throw "Template directory not found: $sourceRoot"
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}

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

function Resolve-FilePathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $candidatePath = $PathValue
    if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
        $candidatePath = Join-Path $RootPath $candidatePath
    }

    $candidatePath = [System.IO.Path]::GetFullPath($candidatePath)
    if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $candidatePath)) {
        throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $candidatePath"
    }

    if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
        throw "$Label file not found: $candidatePath"
    }

    $resolvedPath = (Resolve-Path -LiteralPath $candidatePath).Path
    if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $resolvedPath)) {
        throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $resolvedPath"
    }

    return $resolvedPath
}

$AssistantLanguage = $AssistantLanguage.Trim()
if ([string]::IsNullOrWhiteSpace($AssistantLanguage)) {
    throw 'AssistantLanguage must not be empty.'
}

$AssistantBrevity = $AssistantBrevity.Trim().ToLowerInvariant()
$SourceOfTruth = $SourceOfTruth.Trim()

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

function Convert-ToBooleanAnswer {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [bool]$DefaultValue = $false
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $DefaultValue
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    switch ($normalized) {
        '1' { return $true }
        '0' { return $false }
        'true' { return $true }
        'false' { return $false }
        'yes' { return $true }
        'no' { return $false }
        'y' { return $true }
        'n' { return $false }
        'да' { return $true }
        'нет' { return $false }
        default {
            throw "Init answers artifact has unsupported $FieldName '$Value'. Allowed values: true, false, yes, no, 1, 0."
        }
    }
}

$initAnswersResolvedPath = Resolve-FilePathInsideRoot -RootPath $TargetRoot -PathValue $InitAnswersPath -Label 'InitAnswersPath'
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

$artifactAssistantLanguage = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantLanguage'
if ([string]::IsNullOrWhiteSpace($artifactAssistantLanguage)) {
    throw "Init answers artifact missing AssistantLanguage: $initAnswersResolvedPath"
}
$artifactAssistantLanguage = $artifactAssistantLanguage.Trim()

$artifactAssistantBrevity = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantBrevity'
if ([string]::IsNullOrWhiteSpace($artifactAssistantBrevity)) {
    throw "Init answers artifact missing AssistantBrevity: $initAnswersResolvedPath"
}
$artifactAssistantBrevity = $artifactAssistantBrevity.Trim().ToLowerInvariant()
$allowedBrevity = @('concise', 'detailed')
if ($allowedBrevity -notcontains $artifactAssistantBrevity) {
    throw "Init answers artifact has unsupported AssistantBrevity '$artifactAssistantBrevity'. Allowed values: concise, detailed."
}

$artifactSourceOfTruth = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'SourceOfTruth'
if ([string]::IsNullOrWhiteSpace($artifactSourceOfTruth)) {
    throw "Init answers artifact missing SourceOfTruth: $initAnswersResolvedPath"
}
$artifactSourceOfTruth = $artifactSourceOfTruth.Trim()

$artifactEnforceNoAutoCommitRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'EnforceNoAutoCommit'
$enforceNoAutoCommit = Convert-ToBooleanAnswer -Value $artifactEnforceNoAutoCommitRaw -FieldName 'EnforceNoAutoCommit' -DefaultValue $false

$artifactCollectedVia = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'CollectedVia'
if ([string]::IsNullOrWhiteSpace($artifactCollectedVia)) {
    throw "Init answers artifact must include CollectedVia='AGENT_INIT_PROMPT.md': $initAnswersResolvedPath"
}
if (-not [string]::Equals($artifactCollectedVia.Trim(), 'AGENT_INIT_PROMPT.md', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Init answers artifact CollectedVia must be 'AGENT_INIT_PROMPT.md'. Current value: '$artifactCollectedVia'."
}

$sourceOfTruthKey = $SourceOfTruth.Trim().ToUpperInvariant().Replace(' ', '')
$artifactSourceOfTruthKey = $artifactSourceOfTruth.ToUpperInvariant().Replace(' ', '')
if ($sourceOfTruthKey -ne $artifactSourceOfTruthKey) {
    throw "SourceOfTruth parameter '$SourceOfTruth' does not match init answers artifact value '$artifactSourceOfTruth'."
}

if (-not [string]::Equals($AssistantLanguage, $artifactAssistantLanguage, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "AssistantLanguage parameter '$AssistantLanguage' does not match init answers artifact value '$artifactAssistantLanguage'."
}

if ($AssistantBrevity -ne $artifactAssistantBrevity) {
    throw "AssistantBrevity parameter '$AssistantBrevity' does not match init answers artifact value '$artifactAssistantBrevity'."
}

$sourceToEntrypoint = @{
    'CLAUDE' = 'CLAUDE.md'
    'CODEX' = 'AGENTS.md'
    'GEMINI' = 'GEMINI.md'
    'GITHUBCOPILOT' = '.github/copilot-instructions.md'
    'WINDSURF' = '.windsurf/rules/rules.md'
    'JUNIE' = '.junie/guidelines.md'
    'ANTIGRAVITY' = '.antigravity/rules.md'
}
if (-not $sourceToEntrypoint.ContainsKey($sourceOfTruthKey)) {
    throw "Unsupported SourceOfTruth value '$SourceOfTruth'."
}
$canonicalEntryFile = $sourceToEntrypoint[$sourceOfTruthKey]
$entrypointFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.windsurf/rules/rules.md',
    '.junie/guidelines.md',
    '.antigravity/rules.md'
)
$redirectEntryFiles = @($entrypointFiles | Where-Object { $_ -ne $canonicalEntryFile })

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $bundleRoot "runtime/backups/$timestamp"

$exactFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    'TASK.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md'
)

$forceOverwriteFiles = @(
    $canonicalEntryFile
)

$managedEntryFiles = @(
    'AGENTS.md',
    'GEMINI.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md'
)

$directoryPrefixes = @()

$managedStart = '<!-- Octopus-agent-orchestrator:managed-start -->'
$managedEnd = '<!-- Octopus-agent-orchestrator:managed-end -->'
$taskDeploymentDatePlaceholder = '{{DEPLOYMENT_DATE}}'
$taskCanonicalEntrypointPlaceholder = '{{CANONICAL_ENTRYPOINT}}'
$qwenSettingsRelativePath = '.qwen/settings.json'
$deploymentDate = (Get-Date).ToString('yyyy-MM-dd')
$preCommitHookRelativePath = '.git/hooks/pre-commit'
$commitGuardStart = '# Octopus-agent-orchestrator:commit-guard-start'
$commitGuardEnd = '# Octopus-agent-orchestrator:commit-guard-end'
$commitGuardEnvName = 'OCTOPUS_ALLOW_COMMIT'
$bundleVersionRelativePath = 'Octopus-agent-orchestrator/VERSION'
$bundleVersionFilePath = Join-Path $bundleRoot 'VERSION'
$liveVersionRelativePath = 'Octopus-agent-orchestrator/live/version.json'
$liveVersionPath = Join-Path $bundleRoot 'live/version.json'

if (-not (Test-Path -LiteralPath $bundleVersionFilePath -PathType Leaf)) {
    throw "Bundle version file not found: $bundleVersionFilePath"
}

$bundleVersion = (Get-Content -LiteralPath $bundleVersionFilePath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($bundleVersion)) {
    throw "Bundle version file is empty: $bundleVersionFilePath"
}

function Get-TemplateContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if (-not (Test-Path $SourcePath)) {
        return $null
    }

    $content = Get-Content -Path $SourcePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $relativePathNormalized = $RelativePath.Replace('\', '/')
    if ($relativePathNormalized -eq 'TASK.md') {
        $content = $content.Replace($taskDeploymentDatePlaceholder, $deploymentDate)
        $content = $content.Replace($taskCanonicalEntrypointPlaceholder, $canonicalEntryFile)
    }

    return $content
}

function Copy-TemplateFileToDestination {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    $relativePathNormalized = $RelativePath.Replace('\', '/')
    if ($relativePathNormalized -eq 'TASK.md') {
        $content = Get-TemplateContent -SourcePath $SourcePath -RelativePath $RelativePath
        if ([string]::IsNullOrWhiteSpace($content)) {
            throw "Template content is empty: $SourcePath"
        }

        if (-not $DryRun) {
            Set-Content -Path $DestinationPath -Value $content
        }

        return
    }

    if (-not $DryRun) {
        Copy-Item -Path $SourcePath -Destination $DestinationPath -Force
    }
}

function Get-ManagedBlockFromTemplate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $content = Get-TemplateContent -SourcePath $SourcePath -RelativePath $RelativePath
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)
    $match = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        return $null
    }

    return $match.Value
}

function Get-ManagedBlockFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $content = Get-Content -Path $Path -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)
    $match = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        return $null
    }

    return $match.Value
}

function Get-TaskQueueTableRange {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    if ([string]::IsNullOrWhiteSpace($ManagedBlock)) {
        return $null
    }

    $normalized = $ManagedBlock -replace "`r`n", "`n" -replace "`r", "`n"
    $lines = @($normalized -split "`n")
    if ($lines.Count -eq 0) {
        return $null
    }

    $activeQueueIndex = -1
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index].Trim() -eq '## Active Queue') {
            $activeQueueIndex = $index
            break
        }
    }
    if ($activeQueueIndex -lt 0) {
        return $null
    }

    $headerIndex = -1
    for ($index = $activeQueueIndex + 1; $index -lt $lines.Count; $index++) {
        $trimmed = $lines[$index].Trim()
        if ($trimmed.StartsWith('|')) {
            $headerIndex = $index
            break
        }
    }
    if ($headerIndex -lt 0) {
        return $null
    }

    $separatorIndex = -1
    if ($headerIndex + 1 -lt $lines.Count) {
        $separatorCandidate = $lines[$headerIndex + 1].Trim()
        if ($separatorCandidate.StartsWith('|')) {
            $separatorIndex = $headerIndex + 1
        }
    }
    if ($separatorIndex -lt 0) {
        return $null
    }

    $rowsStartIndex = $separatorIndex + 1
    $rowsEndIndex = $rowsStartIndex
    while ($rowsEndIndex -lt $lines.Count) {
        $trimmed = $lines[$rowsEndIndex].Trim()
        if ($trimmed.StartsWith('|')) {
            $rowsEndIndex++
            continue
        }
        break
    }

    return [PSCustomObject]@{
        Lines = $lines
        RowsStartIndex = $rowsStartIndex
        RowsEndIndex = $rowsEndIndex
    }
}

function Get-TaskQueueRowsFromManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    $range = Get-TaskQueueTableRange -ManagedBlock $ManagedBlock
    if ($null -eq $range) {
        return @()
    }

    $rows = @()
    for ($index = $range.RowsStartIndex; $index -lt $range.RowsEndIndex; $index++) {
        $line = $range.Lines[$index]
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        $rows += $line
    }

    return $rows
}

function Set-TaskQueueRowsInManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock,
        [Parameter(Mandatory = $true)]
        [string[]]$Rows
    )

    $range = Get-TaskQueueTableRange -ManagedBlock $ManagedBlock
    if ($null -eq $range) {
        return $ManagedBlock
    }

    $prefix = @()
    if ($range.RowsStartIndex -gt 0) {
        $prefix = $range.Lines[0..($range.RowsStartIndex - 1)]
    }

    $suffix = @()
    if ($range.RowsEndIndex -lt $range.Lines.Count) {
        $suffix = $range.Lines[$range.RowsEndIndex..($range.Lines.Count - 1)]
    }

    $mergedLines = @($prefix + $Rows + $suffix)
    return ($mergedLines -join "`r`n")
}

function Build-TaskManagedBlockWithExistingQueue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    $templateManagedBlock = Get-ManagedBlockFromTemplate -SourcePath $SourcePath -RelativePath $RelativePath
    if ([string]::IsNullOrWhiteSpace($templateManagedBlock)) {
        return $null
    }

    $existingManagedBlock = Get-ManagedBlockFromFile -Path $DestinationPath
    if ([string]::IsNullOrWhiteSpace($existingManagedBlock)) {
        return $templateManagedBlock
    }

    $existingRows = Get-TaskQueueRowsFromManagedBlock -ManagedBlock $existingManagedBlock
    if ($existingRows.Count -eq 0) {
        return $templateManagedBlock
    }

    return Set-TaskQueueRowsInManagedBlock -ManagedBlock $templateManagedBlock -Rows $existingRows
}

function Get-CommitGuardManagedBlock {
    $block = @'
{START}
# Commit blocked by Octopus auto-commit guard.
if [ "${{ENV_NAME}:-}" != "1" ]; then
  echo "Commit blocked: auto-commit guard is enabled."
  echo "Use human commit helper:"
  echo "  pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.ps1 -m \"<message>\""
  echo "or:"
  echo "  bash Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.sh -m \"<message>\""
  exit 1
fi
{END}
'@

    return $block.Replace('{START}', $commitGuardStart).
        Replace('{END}', $commitGuardEnd).
        Replace('{ENV_NAME}', $commitGuardEnvName).
        Trim()
}

function Apply-CommitGuardHook {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Enabled
    )

    $gitDirPath = Join-Path $TargetRoot '.git'
    if (-not (Test-Path -LiteralPath $gitDirPath -PathType Container)) {
        if ($Enabled) {
            throw "EnforceNoAutoCommit=true but .git directory is missing at '$gitDirPath'. Initialize git or set EnforceNoAutoCommit=false in init answers."
        }
        return $false
    }

    $hookPath = Join-Path $TargetRoot $preCommitHookRelativePath
    $hookDir = Split-Path -Parent $hookPath
    $managedBlock = Get-CommitGuardManagedBlock
    $pattern = '(?s)' + [regex]::Escape($commitGuardStart) + '.*?' + [regex]::Escape($commitGuardEnd)

    if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
        if (-not $Enabled) {
            return $false
        }

        if (-not $DryRun) {
            if ($hookDir -and -not (Test-Path -LiteralPath $hookDir)) {
                New-Item -ItemType Directory -Path $hookDir -Force | Out-Null
            }

            $hookContent = @(
                '#!/usr/bin/env bash',
                '',
                $managedBlock,
                ''
            ) -join "`r`n"
            Set-Content -Path $hookPath -Value $hookContent
        }

        return $true
    }

    $content = Get-Content -Path $hookPath -Raw
    if ($null -eq $content) {
        $content = ''
    }

    $updatedContent = $content
    if ($Enabled) {
        if ([regex]::IsMatch($content, $pattern)) {
            $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
                param($match)
                return $managedBlock
            }
            $updatedContent = [regex]::Replace($content, $pattern, $evaluator)
        } else {
            if ([string]::IsNullOrWhiteSpace($content)) {
                $updatedContent = @(
                    '#!/usr/bin/env bash',
                    '',
                    $managedBlock,
                    ''
                ) -join "`r`n"
            } else {
                $updatedContent = $content.TrimEnd() + "`r`n`r`n" + $managedBlock + "`r`n"
            }
        }
    } else {
        if ([regex]::IsMatch($content, $pattern)) {
            $updatedContent = [regex]::Replace($content, $pattern, '')
            $updatedContent = $updatedContent.TrimEnd() + "`r`n"
        } else {
            return $false
        }
    }

    if ($updatedContent -eq $content) {
        return $false
    }

    Backup-DestinationFile -DestinationPath $hookPath -RelativePath $preCommitHookRelativePath
    if (-not $DryRun) {
        Set-Content -Path $hookPath -Value $updatedContent
    }

    return $true
}

function Build-CanonicalManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile
    )

    $baseBlock = Get-ManagedBlockFromTemplate -SourcePath (Join-Path $sourceRoot 'CLAUDE.md') -RelativePath 'CLAUDE.md'
    if ([string]::IsNullOrWhiteSpace($baseBlock)) {
        throw 'Template CLAUDE.md managed block is missing; cannot build canonical entrypoint.'
    }

    $updated = [regex]::Replace($baseBlock, '(?m)^# CLAUDE\.md$', "# $CanonicalFile")
    return $updated
}

function Build-RedirectManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetFile,
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile
    )

    $title = "# $TargetFile"
    $template = @'
{MANAGED_START}
{TITLE}

This file is a redirect.
Canonical source of truth for agent workflow rules: `{CANONICAL_FILE}`.

Read `{CANONICAL_FILE}` first, then follow its routing links.
Hard stop: before any task execution, open `TASK.md` and `{CANONICAL_FILE}`.
Do not implement tasks directly without orchestration preflight and required review gates.
For GitHub Copilot Agents, run task execution through `.github/agents/orchestrator.md`.
For Windsurf Agents, run task execution through `.windsurf/agents/orchestrator.md`.
For Junie Agents, run task execution through `.junie/agents/orchestrator.md`.
For Antigravity Agents, run task execution through `.antigravity/agents/orchestrator.md`.
{MANAGED_END}
'@

    return $template.Replace('{MANAGED_START}', $managedStart).
        Replace('{TITLE}', $title).
        Replace('{CANONICAL_FILE}', $CanonicalFile).
        Replace('{MANAGED_END}', $managedEnd)
}

function Get-QwenSettingsContent {
    param(
        [AllowNull()]
        [string]$ExistingContent
    )

    $requiredEntries = @('AGENTS.md', 'TASK.md')
    $settingsMap = [ordered]@{}
    $needsUpdate = $false
    $parseMode = 'default'

    if (-not [string]::IsNullOrWhiteSpace($ExistingContent)) {
        try {
            $parsed = $ExistingContent | ConvertFrom-Json -AsHashtable -ErrorAction Stop
            if ($parsed -is [System.Collections.IDictionary]) {
                foreach ($key in $parsed.Keys) {
                    $settingsMap[$key] = $parsed[$key]
                }
                $parseMode = 'merge-existing'
            } else {
                $needsUpdate = $true
                $parseMode = 'invalid-root'
            }
        }
        catch {
            $needsUpdate = $true
            $parseMode = 'invalid-json'
        }
    } else {
        $needsUpdate = $true
    }

    if (-not $settingsMap.Contains('context') -or -not ($settingsMap['context'] -is [System.Collections.IDictionary])) {
        $settingsMap['context'] = [ordered]@{}
        $needsUpdate = $true
    }

    $contextMap = $settingsMap['context']
    $currentEntries = @()
    if ($contextMap.Contains('fileName')) {
        foreach ($item in @($contextMap['fileName'])) {
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

    $existingEntrySet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $currentEntries) {
        [void]$existingEntrySet.Add($entry)
    }

    foreach ($requiredEntry in $requiredEntries) {
        if (-not $existingEntrySet.Contains($requiredEntry)) {
            $currentEntries += $requiredEntry
            [void]$existingEntrySet.Add($requiredEntry)
            $needsUpdate = $true
        }
    }

    $contextMap['fileName'] = $currentEntries
    $settingsMap['context'] = $contextMap

    $json = $settingsMap | ConvertTo-Json -Depth 20
    return [PSCustomObject]@{
        Content    = $json
        NeedsUpdate = $needsUpdate
        ParseMode  = $parseMode
    }
}

function Get-ProviderOrchestratorAgentContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProviderLabel,
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile,
        [Parameter(Mandatory = $true)]
        [string]$BridgePath
    )

    $content = @'
{MANAGED_START}
# {PROVIDER_LABEL} Agent: Orchestrator

Canonical source of truth for agent workflow rules: `{CANONICAL_FILE}`.

Hard stop: first open `{CANONICAL_FILE}` and `TASK.md`.
Do not implement tasks directly without orchestration preflight and required review gates.
This provider profile is a strict bridge to Octopus skills and gate scripts.
Do not execute task or review workflow with provider-default reviewer agents that bypass this bridge.

## Required Execution Contract
1. Read `{CANONICAL_FILE}` and its routing links before making changes.
2. Read `TASK.md` and select/create a task row before implementation.
3. Execute task workflow only in orchestrator mode: `Execute task <task-id> depth=<1|2|3>`.
4. Run preflight classification before implementation (`classify-change.ps1` or `.sh`).
5. Run compile gate before review (`compile-gate.ps1` or `.sh`) using `live/docs/agent-rules/40-commands.md`.
6. Run required independent reviews and gate check (`required-reviews-check.ps1` or `.sh`) before marking `DONE`.
7. Update task status and artifacts in `TASK.md`.
8. Log lifecycle events by task id (`log-task-event.ps1` or `.sh`) into `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.

## Skill Routing
- Orchestration: `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`
- Code review: `Octopus-agent-orchestrator/live/skills/code-review/SKILL.md`
- DB review: `Octopus-agent-orchestrator/live/skills/db-review/SKILL.md`
- Security review: `Octopus-agent-orchestrator/live/skills/security-review/SKILL.md`
- Refactor review: `Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md`

## Dynamic Skill Discovery (Required)
- Canonical skill list: `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`
- Optional-skill capability flags: `Octopus-agent-orchestrator/live/config/review-capabilities.json`
- Include specialist skills added after initialization from `Octopus-agent-orchestrator/live/skills/**` when required by preflight and capability flags.

## Task Timeline Logging (Required)
- Event logger: `Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1` or `.sh`
- Log file (per task): `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`
- Aggregate log: `Octopus-agent-orchestrator/runtime/task-events/all-tasks.jsonl`

Bridge path for this provider: `{BRIDGE_PATH}`.
{MANAGED_END}
'@

    return $content.Replace('{MANAGED_START}', $managedStart).
        Replace('{PROVIDER_LABEL}', $ProviderLabel).
        Replace('{CANONICAL_FILE}', $CanonicalFile).
        Replace('{BRIDGE_PATH}', $BridgePath).
        Replace('{MANAGED_END}', $managedEnd).
        Trim()
}

function Get-GitHubSkillBridgeAgentContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProfileTitle,
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile,
        [Parameter(Mandatory = $true)]
        [string]$SkillPath,
        [Parameter(Mandatory = $true)]
        [string]$ReviewRequirement,
        [Parameter(Mandatory = $true)]
        [string]$CapabilityFlag
    )

    $content = @'
{MANAGED_START}
# GitHub Agent: {PROFILE_TITLE}

Canonical source of truth for agent workflow rules: `{CANONICAL_FILE}`.

Hard stop: first open `.github/agents/orchestrator.md`, `{CANONICAL_FILE}`, and `TASK.md`.
Do not implement tasks directly without orchestration preflight and required review gates.

## Skill Bridge Contract
- Use this profile only as a bridge to skill: `{SKILL_PATH}`
- Required review selector: `{REVIEW_REQUIREMENT}`
- Capability flag gate: `{CAPABILITY_FLAG}`
- Re-read `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md` before execution.
- Re-read `Octopus-agent-orchestrator/live/config/review-capabilities.json` before execution.
- Honor specialist skills added after initialization under `Octopus-agent-orchestrator/live/skills/**`.
- Log review invocation and outcomes via `log-task-event.ps1` or `.sh` into task timeline.
- Task timeline path (per task): `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Review verdicts and completion status are recorded only through orchestrator workflow.
- Never mark task `DONE` from this profile; hand off to `.github/agents/orchestrator.md`.
{MANAGED_END}
'@

    return $content.Replace('{MANAGED_START}', $managedStart).
        Replace('{PROFILE_TITLE}', $ProfileTitle).
        Replace('{CANONICAL_FILE}', $CanonicalFile).
        Replace('{SKILL_PATH}', $SkillPath).
        Replace('{REVIEW_REQUIREMENT}', $ReviewRequirement).
        Replace('{CAPABILITY_FLAG}', $CapabilityFlag).
        Replace('{MANAGED_END}', $managedEnd).
        Trim()
}

$backedUpSet = @{}
$deployed = 0
$backedUp = 0
$skippedExisting = 0
$aligned = 0
$forcedOverwrites = 0
$initInvoked = $false
$commitGuardHookUpdated = $false

function Backup-DestinationFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if (-not (Test-Path $DestinationPath)) {
        return
    }

    $key = $RelativePath.ToLowerInvariant().Replace('\', '/')
    if ($backedUpSet.ContainsKey($key)) {
        return
    }

    $backupPath = Join-Path $backupRoot $RelativePath
    $backupDir = Split-Path -Parent $backupPath

    if (-not $DryRun) {
        if ($backupDir -and -not (Test-Path $backupDir)) {
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        }
        Copy-Item -Path $DestinationPath -Destination $backupPath -Force
    }

    $script:backedUp++
    $backedUpSet[$key] = $true
}

function Sync-ManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    if (-not (Test-Path $DestinationPath)) {
        return $false
    }

    $content = Get-Content -Path $DestinationPath -Raw
    if ($null -eq $content) {
        $content = ''
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)

    $newContent = $content
    if ([regex]::IsMatch($content, $pattern)) {
        $replacementEvaluator = [System.Text.RegularExpressions.MatchEvaluator]{
            param($match)
            return $ManagedBlock
        }
        $newContent = [regex]::Replace($content, $pattern, $replacementEvaluator)
    } else {
        if ([string]::IsNullOrWhiteSpace($content)) {
            $newContent = $ManagedBlock + "`r`n"
        } else {
            $newContent = $content.TrimEnd() + "`r`n`r`n" + $ManagedBlock + "`r`n"
        }
    }

    if ($newContent -eq $content) {
        return $false
    }

    Backup-DestinationFile -DestinationPath $DestinationPath -RelativePath $RelativePath

    if (-not $DryRun) {
        Set-Content -Path $DestinationPath -Value $newContent
    }

    return $true
}

function Apply-EntrypointManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    $destinationPath = Join-Path $TargetRoot $RelativePath
    $destinationDir = Split-Path -Parent $destinationPath

    if (-not (Test-Path $destinationPath)) {
        if (-not $DryRun) {
            if ($destinationDir -and -not (Test-Path $destinationDir)) {
                New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
            }
            Set-Content -Path $destinationPath -Value ($ManagedBlock + "`r`n")
        }
        $script:deployed++
        return
    }

    $wasAligned = Sync-ManagedBlock -DestinationPath $destinationPath -RelativePath $RelativePath -ManagedBlock $ManagedBlock
    if ($wasAligned) {
        $script:aligned++
    }
}

$files = @()
foreach ($relativePath in $exactFiles) {
    $full = Join-Path $sourceRoot $relativePath
    if (Test-Path $full) {
        $files += Get-Item -Path $full
    }
}

foreach ($relativeDirectory in $directoryPrefixes) {
    $full = Join-Path $sourceRoot $relativeDirectory
    if (Test-Path $full) {
        $files += Get-ChildItem -Path $full -Recurse -File
    }
}

$files = $files | Sort-Object FullName -Unique

foreach ($file in $files) {
    $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\','/')
    $relativeNormalized = $relative.Replace('\', '/')
    $destination = Join-Path $TargetRoot $relative
    $destinationDir = Split-Path -Parent $destination

    if (-not (Test-Path $destinationDir)) {
        if (-not $DryRun) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }
    }

    $isForceOverwrite = $forceOverwriteFiles -contains $relativeNormalized

    if (Test-Path $destination) {
        if ($isForceOverwrite) {
            Backup-DestinationFile -DestinationPath $destination -RelativePath $relative
            Copy-TemplateFileToDestination -SourcePath $file.FullName -RelativePath $relativeNormalized -DestinationPath $destination
            $deployed++
            $forcedOverwrites++
            continue
        }

        if ($PreserveExisting) {
            $skippedExisting++

            if ($relativeNormalized -eq 'TASK.md') {
                $taskManagedBlock = Build-TaskManagedBlockWithExistingQueue -SourcePath $file.FullName -RelativePath $relativeNormalized -DestinationPath $destination
                if (-not [string]::IsNullOrWhiteSpace($taskManagedBlock)) {
                    $wasAligned = Sync-ManagedBlock -DestinationPath $destination -RelativePath $relative -ManagedBlock $taskManagedBlock
                    if ($wasAligned) {
                        $aligned++
                    }
                }
                continue
            }

            if ($AlignExisting -and ($managedEntryFiles -contains $relativeNormalized)) {
                $managedBlock = Get-ManagedBlockFromTemplate -SourcePath $file.FullName -RelativePath $relativeNormalized
                if (-not [string]::IsNullOrWhiteSpace($managedBlock)) {
                    $wasAligned = Sync-ManagedBlock -DestinationPath $destination -RelativePath $relative -ManagedBlock $managedBlock
                    if ($wasAligned) {
                        $aligned++
                    }
                }
            }

            continue
        }

        Backup-DestinationFile -DestinationPath $destination -RelativePath $relative
    }

    Copy-TemplateFileToDestination -SourcePath $file.FullName -RelativePath $relativeNormalized -DestinationPath $destination
    $deployed++
}

$canonicalManagedBlock = Build-CanonicalManagedBlock -CanonicalFile $canonicalEntryFile
Apply-EntrypointManagedBlock -RelativePath $canonicalEntryFile -ManagedBlock $canonicalManagedBlock

foreach ($redirectFile in $redirectEntryFiles) {
    $redirectManagedBlock = Build-RedirectManagedBlock -TargetFile $redirectFile -CanonicalFile $canonicalEntryFile
    Apply-EntrypointManagedBlock -RelativePath $redirectFile -ManagedBlock $redirectManagedBlock
}

$qwenSettingsPath = Join-Path $TargetRoot $qwenSettingsRelativePath
$qwenSettingsDir = Split-Path -Parent $qwenSettingsPath
$qwenSettingsExistingContent = $null
if (Test-Path $qwenSettingsPath) {
    $qwenSettingsExistingContent = Get-Content -Path $qwenSettingsPath -Raw
}
$qwenSettingsPlan = Get-QwenSettingsContent -ExistingContent $qwenSettingsExistingContent
$qwenSettingsContent = $qwenSettingsPlan.Content
$qwenSettingsNeedsUpdate = [bool]$qwenSettingsPlan.NeedsUpdate
$qwenSettingsParseMode = [string]$qwenSettingsPlan.ParseMode
$qwenSettingsUpdated = $false

if (Test-Path $qwenSettingsPath) {
    if (-not $PreserveExisting -or $qwenSettingsNeedsUpdate) {
        Backup-DestinationFile -DestinationPath $qwenSettingsPath -RelativePath $qwenSettingsRelativePath
        if (-not $DryRun) {
            Set-Content -Path $qwenSettingsPath -Value $qwenSettingsContent
        }
        $qwenSettingsUpdated = $true
        if ($PreserveExisting) {
            $aligned++
        } else {
            $deployed++
        }
    }
} else {
    if (-not $DryRun) {
        if ($qwenSettingsDir -and -not (Test-Path $qwenSettingsDir)) {
            New-Item -ItemType Directory -Path $qwenSettingsDir -Force | Out-Null
        }
        Set-Content -Path $qwenSettingsPath -Value $qwenSettingsContent
    }
    $qwenSettingsUpdated = $true
    $deployed++
}

$providerOrchestratorProfiles = @(
    [PSCustomObject]@{
        ProviderLabel = 'GitHub Copilot'
        RelativePath = '.github/agents/orchestrator.md'
    },
    [PSCustomObject]@{
        ProviderLabel = 'Windsurf'
        RelativePath = '.windsurf/agents/orchestrator.md'
    },
    [PSCustomObject]@{
        ProviderLabel = 'Junie'
        RelativePath = '.junie/agents/orchestrator.md'
    },
    [PSCustomObject]@{
        ProviderLabel = 'Antigravity'
        RelativePath = '.antigravity/agents/orchestrator.md'
    }
)

foreach ($profile in $providerOrchestratorProfiles) {
    $managedBlock = Get-ProviderOrchestratorAgentContent -ProviderLabel $profile.ProviderLabel -CanonicalFile $canonicalEntryFile -BridgePath $profile.RelativePath
    Apply-EntrypointManagedBlock -RelativePath $profile.RelativePath -ManagedBlock $managedBlock
}

$githubSkillBridgeProfiles = @(
    [PSCustomObject]@{
        RelativePath = '.github/agents/reviewer.md'
        ProfileTitle = 'Reviewer Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md'
        ReviewRequirement = 'Use preflight `required_reviews.*` flags from orchestrator.'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/code-review.md'
        ProfileTitle = 'Code Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
        ReviewRequirement = 'required_reviews.code=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/db-review.md'
        ProfileTitle = 'DB Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/db-review/SKILL.md'
        ReviewRequirement = 'required_reviews.db=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/security-review.md'
        ProfileTitle = 'Security Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md'
        ReviewRequirement = 'required_reviews.security=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/refactor-review.md'
        ProfileTitle = 'Refactor Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md'
        ReviewRequirement = 'required_reviews.refactor=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/api-review.md'
        ProfileTitle = 'API Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/api-review/SKILL.md'
        ReviewRequirement = 'required_reviews.api=true'
        CapabilityFlag = 'review-capabilities.api=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/test-review.md'
        ProfileTitle = 'Test Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/test-review/SKILL.md'
        ReviewRequirement = 'required_reviews.test=true'
        CapabilityFlag = 'review-capabilities.test=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/performance-review.md'
        ProfileTitle = 'Performance Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/performance-review/SKILL.md'
        ReviewRequirement = 'required_reviews.performance=true'
        CapabilityFlag = 'review-capabilities.performance=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/infra-review.md'
        ProfileTitle = 'Infra Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/infra-review/SKILL.md'
        ReviewRequirement = 'required_reviews.infra=true'
        CapabilityFlag = 'review-capabilities.infra=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/dependency-review.md'
        ProfileTitle = 'Dependency Review Bridge'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md'
        ReviewRequirement = 'required_reviews.dependency=true'
        CapabilityFlag = 'review-capabilities.dependency=true'
    }
)

foreach ($profile in $githubSkillBridgeProfiles) {
    $managedBlock = Get-GitHubSkillBridgeAgentContent -ProfileTitle $profile.ProfileTitle -CanonicalFile $canonicalEntryFile -SkillPath $profile.SkillPath -ReviewRequirement $profile.ReviewRequirement -CapabilityFlag $profile.CapabilityFlag
    Apply-EntrypointManagedBlock -RelativePath $profile.RelativePath -ManagedBlock $managedBlock
}

$gitignoreEntries = @(
    'Octopus-agent-orchestrator/',
    'AGENTS.md',
    'TASK.md',
    '.qwen/',
    '.github/agents/',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md'
)

$gitignoreAdded = 0
$gitignorePath = Join-Path $TargetRoot '.gitignore'
if (-not $DryRun) {
    if (-not (Test-Path $gitignorePath)) {
        New-Item -ItemType File -Path $gitignorePath -Force | Out-Null
    }

    $existingLines = @(Get-Content -Path $gitignorePath)
    $appendLines = @()
    foreach ($entry in $gitignoreEntries) {
        if ($existingLines -notcontains $entry) {
            $appendLines += $entry
        }
    }

    if ($appendLines.Count -gt 0) {
        Add-Content -Path $gitignorePath -Value ''
        Add-Content -Path $gitignorePath -Value '# Octopus-agent-orchestrator managed ignores'
        Add-Content -Path $gitignorePath -Value $appendLines
        $gitignoreAdded = $appendLines.Count
    }
} else {
    if (Test-Path $gitignorePath) {
        $existingLines = @(Get-Content -Path $gitignorePath)
        foreach ($entry in $gitignoreEntries) {
            if ($existingLines -notcontains $entry) {
                $gitignoreAdded++
            }
        }
    } else {
        $gitignoreAdded = $gitignoreEntries.Count
    }
}

$commitGuardHookUpdated = Apply-CommitGuardHook -Enabled $enforceNoAutoCommit

if ($RunInit -and -not $DryRun) {
    $initScriptPath = Join-Path $scriptDir 'init.ps1'
    if (-not (Test-Path $initScriptPath)) {
        throw "Init script not found: $initScriptPath"
    }

    & $initScriptPath -TargetRoot $TargetRoot -AssistantLanguage $AssistantLanguage -AssistantBrevity $AssistantBrevity -SourceOfTruth $SourceOfTruth -EnforceNoAutoCommit $enforceNoAutoCommit
    $initInvoked = $true
}

$liveVersionWritten = $false
if (-not $DryRun) {
    $liveVersionDir = Split-Path -Parent $liveVersionPath
    if ($liveVersionDir -and -not (Test-Path $liveVersionDir)) {
        New-Item -ItemType Directory -Path $liveVersionDir -Force | Out-Null
    }

    $liveVersionPayload = [ordered]@{
        Version            = $bundleVersion
        UpdatedAt          = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        SourceOfTruth      = $SourceOfTruth
        CanonicalEntrypoint = $canonicalEntryFile
        AssistantLanguage  = $AssistantLanguage
        AssistantBrevity   = $AssistantBrevity
        EnforceNoAutoCommit = $enforceNoAutoCommit
        InitAnswersPath    = $initAnswersResolvedPath
    }
    $liveVersionJson = $liveVersionPayload | ConvertTo-Json -Depth 5
    Set-Content -Path $liveVersionPath -Value $liveVersionJson
    $liveVersionWritten = $true
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "TemplateRoot: $sourceRoot"
Write-Output "PreserveExisting: $PreserveExisting"
Write-Output "AlignExisting: $AlignExisting"
Write-Output "RunInit: $RunInit"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "DeploymentDate: $deploymentDate"
Write-Output "BundleVersion: $bundleVersion"
Write-Output "BundleVersionPath: $bundleVersionRelativePath"
Write-Output "AssistantLanguage: $AssistantLanguage"
Write-Output "AssistantBrevity: $AssistantBrevity"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "EnforceNoAutoCommit: $enforceNoAutoCommit"
Write-Output "CanonicalEntrypoint: $canonicalEntryFile"
Write-Output "FilesDeployed: $deployed"
Write-Output "FilesForcedOverwrite: $forcedOverwrites"
Write-Output "FilesSkippedExisting: $skippedExisting"
Write-Output "FilesAligned: $aligned"
Write-Output "FilesBackedUp: $backedUp"
Write-Output "GitignoreEntriesAdded: $gitignoreAdded"
Write-Output "QwenSettingsParseMode: $qwenSettingsParseMode"
Write-Output "QwenSettingsNeedsUpdate: $qwenSettingsNeedsUpdate"
Write-Output "QwenSettingsUpdated: $qwenSettingsUpdated"
Write-Output "InitInvoked: $initInvoked"
Write-Output "PreCommitHookPath: $preCommitHookRelativePath"
Write-Output "PreCommitHookUpdated: $commitGuardHookUpdated"
Write-Output "LiveVersionPath: $liveVersionRelativePath"
Write-Output "LiveVersionWritten: $liveVersionWritten"
if (-not $DryRun) {
    Write-Output "BackupRoot: $backupRoot"
}

