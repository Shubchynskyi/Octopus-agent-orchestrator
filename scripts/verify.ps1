param(
    [string]$TargetRoot,
    [ValidateSet('Claude', 'Codex', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
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
$SourceOfTruth = $SourceOfTruth.Trim()
$sourceOfTruthKey = $SourceOfTruth.ToUpperInvariant().Replace(' ', '')

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

$initAnswersContractViolations = @()
$initAnswersCandidatePath = $InitAnswersPath
if (-not [System.IO.Path]::IsPathRooted($initAnswersCandidatePath)) {
    $initAnswersCandidatePath = Join-Path $TargetRoot $initAnswersCandidatePath
}

$initAnswersResolvedPath = $null
$artifactAssistantLanguage = $null
$artifactAssistantBrevity = $null
$artifactSourceOfTruth = $null

if (-not (Test-Path -LiteralPath $initAnswersCandidatePath -PathType Leaf)) {
    $initAnswersContractViolations += "Init answers artifact missing: $initAnswersCandidatePath"
} else {
    $initAnswersResolvedPath = (Resolve-Path -LiteralPath $initAnswersCandidatePath).Path
    $initAnswersRaw = Get-Content -LiteralPath $initAnswersResolvedPath -Raw
    if ([string]::IsNullOrWhiteSpace($initAnswersRaw)) {
        $initAnswersContractViolations += "Init answers artifact is empty: $initAnswersResolvedPath"
    } else {
        try {
            $initAnswers = $initAnswersRaw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            $initAnswersContractViolations += "Init answers artifact is not valid JSON: $initAnswersResolvedPath"
        }

        if ($null -ne $initAnswers) {
            $artifactAssistantLanguage = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantLanguage'
            if ([string]::IsNullOrWhiteSpace($artifactAssistantLanguage)) {
                $initAnswersContractViolations += "Init answers artifact missing AssistantLanguage: $initAnswersResolvedPath"
            } else {
                $artifactAssistantLanguage = $artifactAssistantLanguage.Trim()
            }

            $artifactAssistantBrevity = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantBrevity'
            if ([string]::IsNullOrWhiteSpace($artifactAssistantBrevity)) {
                $initAnswersContractViolations += "Init answers artifact missing AssistantBrevity: $initAnswersResolvedPath"
            } else {
                $artifactAssistantBrevity = $artifactAssistantBrevity.Trim().ToLowerInvariant()
                $allowedBrevity = @('concise', 'detailed')
                if ($allowedBrevity -notcontains $artifactAssistantBrevity) {
                    $initAnswersContractViolations += "Init answers artifact has unsupported AssistantBrevity '$artifactAssistantBrevity'. Allowed values: concise, detailed."
                }
            }

            $artifactSourceOfTruth = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'SourceOfTruth'
            if ([string]::IsNullOrWhiteSpace($artifactSourceOfTruth)) {
                $initAnswersContractViolations += "Init answers artifact missing SourceOfTruth: $initAnswersResolvedPath"
            } else {
                $artifactSourceOfTruth = $artifactSourceOfTruth.Trim()
                $artifactSourceOfTruthKey = $artifactSourceOfTruth.ToUpperInvariant().Replace(' ', '')
                if ($artifactSourceOfTruthKey -ne $sourceOfTruthKey) {
                    $initAnswersContractViolations += "Init answers SourceOfTruth '$artifactSourceOfTruth' does not match verification SourceOfTruth '$SourceOfTruth'."
                }
            }

            $artifactCollectedVia = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'CollectedVia'
            if ([string]::IsNullOrWhiteSpace($artifactCollectedVia)) {
                $initAnswersContractViolations += "Init answers artifact must include CollectedVia='AGENT_INIT_PROMPT.md': $initAnswersResolvedPath"
            } elseif (-not [string]::Equals($artifactCollectedVia.Trim(), 'AGENT_INIT_PROMPT.md', [System.StringComparison]::OrdinalIgnoreCase)) {
                $initAnswersContractViolations += "Init answers CollectedVia must be 'AGENT_INIT_PROMPT.md'. Current value: '$artifactCollectedVia'."
            }
        }
    }
}

if ([string]::IsNullOrWhiteSpace($initAnswersResolvedPath)) {
    $initAnswersResolvedPath = $initAnswersCandidatePath
}

$sourceToEntrypoint = @{
    'CLAUDE' = 'CLAUDE.md'
    'CODEX' = 'AGENTS.md'
    'GITHUBCOPILOT' = '.github/copilot-instructions.md'
    'WINDSURF' = '.windsurf/rules/rules.md'
    'JUNIE' = '.junie/guidelines.md'
    'ANTIGRAVITY' = '.antigravity/rules.md'
}
if (-not $sourceToEntrypoint.ContainsKey($sourceOfTruthKey)) {
    throw "Unsupported SourceOfTruth value '$SourceOfTruth'."
}
$canonicalEntrypoint = $sourceToEntrypoint[$sourceOfTruthKey]
$entrypointFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    '.github/copilot-instructions.md',
    '.windsurf/rules/rules.md',
    '.junie/guidelines.md',
    '.antigravity/rules.md'
)
$redirectEntrypoints = @($entrypointFiles | Where-Object { $_ -ne $canonicalEntrypoint })

$ruleFiles = @(
    '00-core.md',
    '10-project-context.md',
    '20-architecture.md',
    '30-code-style.md',
    '35-strict-coding-rules.md',
    '40-commands.md',
    '50-structure-and-docs.md',
    '60-operating-rules.md',
    '70-security.md',
    '80-task-workflow.md',
    '90-skill-catalog.md'
)

$requiredPaths = @(
    'CLAUDE.md',
    'AGENTS.md',
    'TASK.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md',
    'Octopus-agent-orchestrator/MANIFEST.md',
    'Octopus-agent-orchestrator/live/config/review-capabilities.json',
    'Octopus-agent-orchestrator/live/config/paths.json',
    'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh',
    'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md',
    'Octopus-agent-orchestrator/live/init-report.md',
    'Octopus-agent-orchestrator/live/project-discovery.md',
    'Octopus-agent-orchestrator/live/source-inventory.md',
    'Octopus-agent-orchestrator/live/USAGE.md'
)

foreach ($ruleFile in $ruleFiles) {
    $requiredPaths += "Octopus-agent-orchestrator/live/docs/agent-rules/$ruleFile"
}

$strictManagedFiles = @()

$taskManagedFile = 'TASK.md'

$gitignoreEntries = @(
    'Octopus-agent-orchestrator/',
    'AGENTS.md',
    'TASK.md',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md'
)

$taskSeedText = 'Verify orchestrator operation, full rule set, and workflow gates'
$managedStart = '<!-- Octopus-agent-orchestrator:managed-start -->'
$managedEnd = '<!-- Octopus-agent-orchestrator:managed-end -->'
$templatePlaceholderPattern = '\{\{[A-Z0-9_]+\}\}'

function Normalize-Text {
    param(
        [AllowNull()]
        [string]$Text
    )

    if ($null -eq $Text) {
        return ''
    }

    return ($Text -replace "`r`n", "`n").Trim()
}

function Get-ManagedBlock {
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

$missingPaths = @()
foreach ($relativePath in $requiredPaths) {
    $path = Join-Path $TargetRoot $relativePath
    if (-not (Test-Path $path)) {
        $missingPaths += $relativePath
    }
}

$styleViolations = @()
foreach ($relativePath in $strictManagedFiles) {
    $templatePath = Join-Path $sourceRoot $relativePath
    $targetPath = Join-Path $TargetRoot $relativePath

    if (-not (Test-Path $templatePath)) {
        $styleViolations += "Template file missing: $relativePath"
        continue
    }

    $templateBlock = Get-ManagedBlock -Path $templatePath
    if ([string]::IsNullOrWhiteSpace($templateBlock)) {
        $styleViolations += "Template managed block missing: $relativePath"
        continue
    }

    if (-not (Test-Path $targetPath)) {
        continue
    }

    $targetBlock = Get-ManagedBlock -Path $targetPath
    if ([string]::IsNullOrWhiteSpace($targetBlock)) {
        $styleViolations += "Target managed block missing: $relativePath"
        continue
    }

    if ((Normalize-Text $templateBlock) -ne (Normalize-Text $targetBlock)) {
        $styleViolations += "Target managed block out of date: $relativePath"
    }
}

$taskContractViolations = @()
$taskPath = Join-Path $TargetRoot $taskManagedFile
if (Test-Path $taskPath) {
    $taskManagedBlock = Get-ManagedBlock -Path $taskPath
    if ([string]::IsNullOrWhiteSpace($taskManagedBlock)) {
        $taskContractViolations += 'TASK.md managed block missing.'
    } else {
        if ($taskManagedBlock -notmatch '\|\s*ID\s*\|\s*Status\s*\|\s*Priority\s*\|\s*Area\s*\|\s*Title\s*\|\s*Owner\s*\|\s*Updated\s*\|\s*Depth\s*\|\s*Notes\s*\|') {
            $taskContractViolations += 'TASK.md queue header must include `Depth` column.'
        }
    }
} else {
    $taskContractViolations += 'TASK.md missing.'
}

$gitignoreMissing = @()
$gitignorePath = Join-Path $TargetRoot '.gitignore'
if (-not (Test-Path $gitignorePath)) {
    $gitignoreMissing = @($gitignoreEntries)
} else {
    $existingLines = @(Get-Content -Path $gitignorePath)
    foreach ($entry in $gitignoreEntries) {
        if ($existingLines -notcontains $entry) {
            $gitignoreMissing += $entry
        }
    }
}

$taskSeedPresent = $false
$taskPath = Join-Path $TargetRoot 'TASK.md'
if (Test-Path $taskPath) {
    $taskContent = Get-Content -Path $taskPath -Raw
    if ($taskContent -like "*$taskSeedText*") {
        $taskSeedPresent = $true
    }
}

$ruleFileViolations = @()
$templatePlaceholderViolations = @()
foreach ($ruleFile in $ruleFiles) {
    $rulePath = Join-Path $TargetRoot "Octopus-agent-orchestrator/live/docs/agent-rules/$ruleFile"
    if (-not (Test-Path $rulePath)) {
        continue
    }

    $content = Get-Content -Path $rulePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        $ruleFileViolations += "Rule file is empty: Octopus-agent-orchestrator/live/docs/agent-rules/$ruleFile"
    }

    if ($content -match $templatePlaceholderPattern) {
        $templatePlaceholderViolations += "Unresolved template placeholder in: Octopus-agent-orchestrator/live/docs/agent-rules/$ruleFile"
    }
}

$coreRuleContractViolations = @()
$coreRulePath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md'
if (Test-Path $coreRulePath) {
    $coreContent = Get-Content -Path $coreRulePath -Raw
    if ($coreContent -notmatch '(?m)^Respond in .+ for explanations and assistance\.$') {
        $coreRuleContractViolations += '00-core.md must define configured assistant language sentence.'
    }
    if ($coreContent -notmatch '(?m)^Default response brevity: .+\.$') {
        $coreRuleContractViolations += '00-core.md must define configured assistant response brevity sentence.'
    }

    if (-not [string]::IsNullOrWhiteSpace($artifactAssistantLanguage)) {
        $expectedLanguageLine = "Respond in $artifactAssistantLanguage for explanations and assistance."
        if ($coreContent -notmatch ("(?m)^" + [regex]::Escape($expectedLanguageLine) + "$")) {
            $coreRuleContractViolations += "00-core.md language does not match init answers artifact. Expected: '$expectedLanguageLine'."
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($artifactAssistantBrevity)) {
        $expectedBrevityLine = "Default response brevity: $artifactAssistantBrevity."
        if ($coreContent -notmatch ("(?m)^" + [regex]::Escape($expectedBrevityLine) + "$")) {
            $coreRuleContractViolations += "00-core.md response brevity does not match init answers artifact. Expected: '$expectedBrevityLine'."
        }
    }
} else {
    $coreRuleContractViolations += '00-core.md missing; core contract validation failed.'
}

$entrypointContractViolations = @()
$canonicalEntrypointPath = Join-Path $TargetRoot $canonicalEntrypoint
if (Test-Path $canonicalEntrypointPath) {
    $canonicalContent = Get-Content -Path $canonicalEntrypointPath -Raw

    if ($canonicalContent -notmatch '(?m)^# Octopus Agent Orchestrator Rule Index$') {
        $entrypointContractViolations += "$canonicalEntrypoint must contain canonical rule index content."
    }

    if ($canonicalContent -match '(?<!Octopus-agent-orchestrator/live/)docs/agent-rules/') {
        $entrypointContractViolations += "$canonicalEntrypoint references docs/agent-rules/ outside Octopus-agent-orchestrator/live."
    }

    $matches = [regex]::Matches($canonicalContent, 'Octopus-agent-orchestrator/live/docs/agent-rules/[0-9]{2}[-a-z]+\.md')
    $links = @($matches | ForEach-Object { $_.Value } | Sort-Object -Unique)
    if ($links.Count -lt $ruleFiles.Count) {
        $entrypointContractViolations += "$canonicalEntrypoint has fewer rule links than expected. Found=$($links.Count), ExpectedAtLeast=$($ruleFiles.Count)"
    }

    foreach ($link in $links) {
        $linkPath = Join-Path $TargetRoot $link
        if (-not (Test-Path $linkPath)) {
            $entrypointContractViolations += "$canonicalEntrypoint route target missing: $link"
        }
    }
} else {
    $entrypointContractViolations += "Canonical entrypoint missing: $canonicalEntrypoint"
}

foreach ($redirectEntrypoint in $redirectEntrypoints) {
    $redirectPath = Join-Path $TargetRoot $redirectEntrypoint
    if (-not (Test-Path $redirectPath)) {
        $entrypointContractViolations += "Redirect entrypoint missing: $redirectEntrypoint"
        continue
    }

    $redirectContent = Get-Content -Path $redirectPath -Raw
    $expectedRedirectLine = "Canonical source of truth for agent workflow rules: ``$canonicalEntrypoint``."
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must redirect to $canonicalEntrypoint."
    }
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "TemplateRoot: $sourceRoot"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "CanonicalEntrypoint: $canonicalEntrypoint"
Write-Output "RequiredPathsChecked: $($requiredPaths.Count)"
Write-Output "MissingPathCount: $($missingPaths.Count)"
Write-Output "ManagedFilesChecked: $($strictManagedFiles.Count + 1 + $entrypointFiles.Count)"
Write-Output "StyleViolationCount: $($styleViolations.Count)"
Write-Output "TaskContractViolationCount: $($taskContractViolations.Count)"
Write-Output "RuleFileViolationCount: $($ruleFileViolations.Count)"
Write-Output "TemplatePlaceholderViolationCount: $($templatePlaceholderViolations.Count)"
Write-Output "InitAnswersContractViolationCount: $($initAnswersContractViolations.Count)"
Write-Output "CoreRuleContractViolationCount: $($coreRuleContractViolations.Count)"
Write-Output "EntrypointContractViolationCount: $($entrypointContractViolations.Count)"
Write-Output "GitignoreMissingCount: $($gitignoreMissing.Count)"
Write-Output "TaskSeedPresent: $taskSeedPresent"

if ($missingPaths.Count -gt 0) {
    Write-Output 'MissingPaths:'
    foreach ($item in $missingPaths) {
        Write-Output " - $item"
    }
}

if ($styleViolations.Count -gt 0) {
    Write-Output 'StyleViolations:'
    foreach ($item in $styleViolations) {
        Write-Output " - $item"
    }
}

if ($taskContractViolations.Count -gt 0) {
    Write-Output 'TaskContractViolations:'
    foreach ($item in $taskContractViolations) {
        Write-Output " - $item"
    }
}

if ($ruleFileViolations.Count -gt 0) {
    Write-Output 'RuleFileViolations:'
    foreach ($item in $ruleFileViolations) {
        Write-Output " - $item"
    }
}

if ($templatePlaceholderViolations.Count -gt 0) {
    Write-Output 'TemplatePlaceholderViolations:'
    foreach ($item in $templatePlaceholderViolations) {
        Write-Output " - $item"
    }
}

if ($initAnswersContractViolations.Count -gt 0) {
    Write-Output 'InitAnswersContractViolations:'
    foreach ($item in $initAnswersContractViolations) {
        Write-Output " - $item"
    }
}

if ($coreRuleContractViolations.Count -gt 0) {
    Write-Output 'CoreRuleContractViolations:'
    foreach ($item in $coreRuleContractViolations) {
        Write-Output " - $item"
    }
}

if ($entrypointContractViolations.Count -gt 0) {
    Write-Output 'EntrypointContractViolations:'
    foreach ($item in $entrypointContractViolations) {
        Write-Output " - $item"
    }
}

if ($gitignoreMissing.Count -gt 0) {
    Write-Output 'MissingGitignoreEntries:'
    foreach ($item in $gitignoreMissing) {
        Write-Output " - $item"
    }
}

if (-not $taskSeedPresent) {
    Write-Output "MissingTaskSeedText: $taskSeedText"
}

if (
    $missingPaths.Count -gt 0 -or
    $styleViolations.Count -gt 0 -or
    $taskContractViolations.Count -gt 0 -or
    $ruleFileViolations.Count -gt 0 -or
    $templatePlaceholderViolations.Count -gt 0 -or
    $initAnswersContractViolations.Count -gt 0 -or
    $coreRuleContractViolations.Count -gt 0 -or
    $entrypointContractViolations.Count -gt 0 -or
    $gitignoreMissing.Count -gt 0 -or
    -not $taskSeedPresent
) {
    throw 'Verification failed. Resolve listed issues and rerun.'
}

Write-Output 'Verification: PASS'

