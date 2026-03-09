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

$initAnswersCandidatePath = $InitAnswersPath
if (-not [System.IO.Path]::IsPathRooted($initAnswersCandidatePath)) {
    $initAnswersCandidatePath = Join-Path $TargetRoot $initAnswersCandidatePath
}

if (-not (Test-Path -LiteralPath $initAnswersCandidatePath -PathType Leaf)) {
    throw "Init answers artifact not found: $initAnswersCandidatePath"
}

$initAnswersResolvedPath = (Resolve-Path -LiteralPath $initAnswersCandidatePath).Path
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
    'TASK.md',
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
    $json = @'
{
  "context": {
    "fileName": [
      "AGENTS.md",
      "TASK.md"
    ]
  }
}
'@

    return $json.Trim()
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
5. Run required independent reviews and gate check (`required-reviews-check.ps1` or `.sh`) before marking `DONE`.
6. Update task status and artifacts in `TASK.md`.
7. Log lifecycle events by task id (`log-task-event.ps1` or `.sh`) into `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.

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
$qwenSettingsContent = Get-QwenSettingsContent

if (Test-Path $qwenSettingsPath) {
    if (-not $PreserveExisting) {
        Backup-DestinationFile -DestinationPath $qwenSettingsPath -RelativePath $qwenSettingsRelativePath
        if (-not $DryRun) {
            Set-Content -Path $qwenSettingsPath -Value $qwenSettingsContent
        }
        $deployed++
    }
} else {
    if (-not $DryRun) {
        if ($qwenSettingsDir -and -not (Test-Path $qwenSettingsDir)) {
            New-Item -ItemType Directory -Path $qwenSettingsDir -Force | Out-Null
        }
        Set-Content -Path $qwenSettingsPath -Value $qwenSettingsContent
    }
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

if ($RunInit -and -not $DryRun) {
    $initScriptPath = Join-Path $scriptDir 'init.ps1'
    if (-not (Test-Path $initScriptPath)) {
        throw "Init script not found: $initScriptPath"
    }

    & $initScriptPath -TargetRoot $TargetRoot -AssistantLanguage $AssistantLanguage -AssistantBrevity $AssistantBrevity -SourceOfTruth $SourceOfTruth
    $initInvoked = $true
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "TemplateRoot: $sourceRoot"
Write-Output "PreserveExisting: $PreserveExisting"
Write-Output "AlignExisting: $AlignExisting"
Write-Output "RunInit: $RunInit"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "DeploymentDate: $deploymentDate"
Write-Output "AssistantLanguage: $AssistantLanguage"
Write-Output "AssistantBrevity: $AssistantBrevity"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "CanonicalEntrypoint: $canonicalEntryFile"
Write-Output "FilesDeployed: $deployed"
Write-Output "FilesForcedOverwrite: $forcedOverwrites"
Write-Output "FilesSkippedExisting: $skippedExisting"
Write-Output "FilesAligned: $aligned"
Write-Output "FilesBackedUp: $backedUp"
Write-Output "GitignoreEntriesAdded: $gitignoreAdded"
Write-Output "InitInvoked: $initInvoked"
if (-not $DryRun) {
    Write-Output "BackupRoot: $backupRoot"
}

