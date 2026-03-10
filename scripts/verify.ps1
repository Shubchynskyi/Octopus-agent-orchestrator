param(
    [string]$TargetRoot,
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

function Get-ObjectPropertyString {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        return $null
    }

    if ($null -eq $property.Value) {
        return $null
    }

    return [string]$property.Value
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

$initAnswersContractViolations = @()
$initAnswersCandidatePath = $InitAnswersPath
if (-not [System.IO.Path]::IsPathRooted($initAnswersCandidatePath)) {
    $initAnswersCandidatePath = Join-Path $TargetRoot $initAnswersCandidatePath
}

$initAnswersResolvedPath = $null
$artifactAssistantLanguage = $null
$artifactAssistantBrevity = $null
$artifactSourceOfTruth = $null
$artifactEnforceNoAutoCommit = $false

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

            $artifactEnforceNoAutoCommitRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'EnforceNoAutoCommit'
            try {
                $artifactEnforceNoAutoCommit = Convert-ToBooleanAnswer -Value $artifactEnforceNoAutoCommitRaw -FieldName 'EnforceNoAutoCommit' -DefaultValue $false
            }
            catch {
                $initAnswersContractViolations += $_.Exception.Message
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
    'GEMINI' = 'GEMINI.md'
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
    'GEMINI.md',
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
    'GEMINI.md',
    '.qwen/settings.json',
    'TASK.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.github/agents/orchestrator.md',
    '.github/agents/reviewer.md',
    '.github/agents/code-review.md',
    '.github/agents/db-review.md',
    '.github/agents/security-review.md',
    '.github/agents/refactor-review.md',
    '.github/agents/api-review.md',
    '.github/agents/test-review.md',
    '.github/agents/performance-review.md',
    '.github/agents/infra-review.md',
    '.github/agents/dependency-review.md',
    '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md',
    '.antigravity/agents/orchestrator.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md',
    'Octopus-agent-orchestrator/VERSION',
    'Octopus-agent-orchestrator/scripts/check-update.ps1',
    'Octopus-agent-orchestrator/scripts/check-update.sh',
    'Octopus-agent-orchestrator/scripts/update.ps1',
    'Octopus-agent-orchestrator/scripts/update.sh',
    'Octopus-agent-orchestrator/MANIFEST.md',
    'Octopus-agent-orchestrator/live/version.json',
    'Octopus-agent-orchestrator/live/config/review-capabilities.json',
    'Octopus-agent-orchestrator/live/config/paths.json',
    'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.sh',
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
    '.qwen/',
    '.github/agents/',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md'
)

$managedStart = '<!-- Octopus-agent-orchestrator:managed-start -->'
$managedEnd = '<!-- Octopus-agent-orchestrator:managed-end -->'
$templatePlaceholderPattern = '\{\{[A-Z0-9_]+\}\}'
$bundleVersionRelativePath = 'Octopus-agent-orchestrator/VERSION'
$liveVersionRelativePath = 'Octopus-agent-orchestrator/live/version.json'

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

$versionContractViolations = @()
$bundleVersion = $null
$bundleVersionPath = Join-Path $TargetRoot $bundleVersionRelativePath
if (Test-Path -LiteralPath $bundleVersionPath -PathType Leaf) {
    $bundleVersion = (Get-Content -LiteralPath $bundleVersionPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($bundleVersion)) {
        $versionContractViolations += "$bundleVersionRelativePath must not be empty."
    }
}

$liveVersionPath = Join-Path $TargetRoot $liveVersionRelativePath
if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
    try {
        $liveVersionObject = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $versionContractViolations += "$liveVersionRelativePath must contain valid JSON."
        $liveVersionObject = $null
    }

    if ($null -ne $liveVersionObject) {
        $liveVersion = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'Version'
        if ([string]::IsNullOrWhiteSpace($liveVersion)) {
            $versionContractViolations += "$liveVersionRelativePath must include non-empty Version."
        } else {
            $liveVersion = $liveVersion.Trim()
            if (-not [string]::IsNullOrWhiteSpace($bundleVersion) -and -not [string]::Equals($liveVersion, $bundleVersion, [System.StringComparison]::Ordinal)) {
                $versionContractViolations += "$liveVersionRelativePath Version '$liveVersion' must match $bundleVersionRelativePath '$bundleVersion'."
            }
        }

        $liveSourceOfTruth = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'SourceOfTruth'
        if ([string]::IsNullOrWhiteSpace($liveSourceOfTruth)) {
            $versionContractViolations += "$liveVersionRelativePath must include non-empty SourceOfTruth."
        } else {
            $liveSourceOfTruth = $liveSourceOfTruth.Trim()
            if (-not [string]::Equals($liveSourceOfTruth, $SourceOfTruth, [System.StringComparison]::OrdinalIgnoreCase)) {
                $versionContractViolations += "$liveVersionRelativePath SourceOfTruth '$liveSourceOfTruth' must match verification SourceOfTruth '$SourceOfTruth'."
            }
        }

        $liveCanonicalEntrypoint = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'CanonicalEntrypoint'
        if ([string]::IsNullOrWhiteSpace($liveCanonicalEntrypoint)) {
            $versionContractViolations += "$liveVersionRelativePath must include non-empty CanonicalEntrypoint."
        } else {
            $liveCanonicalEntrypoint = $liveCanonicalEntrypoint.Trim()
            if (-not [string]::Equals($liveCanonicalEntrypoint, $canonicalEntrypoint, [System.StringComparison]::Ordinal)) {
                $versionContractViolations += "$liveVersionRelativePath CanonicalEntrypoint '$liveCanonicalEntrypoint' must match expected '$canonicalEntrypoint'."
            }
        }

        $liveEnforceNoAutoCommitRaw = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'EnforceNoAutoCommit'
        try {
            $liveEnforceNoAutoCommit = Convert-ToBooleanAnswer -Value $liveEnforceNoAutoCommitRaw -FieldName 'EnforceNoAutoCommit' -DefaultValue $false
            if ($liveEnforceNoAutoCommit -ne $artifactEnforceNoAutoCommit) {
                $versionContractViolations += "$liveVersionRelativePath EnforceNoAutoCommit '$liveEnforceNoAutoCommit' must match init answers value '$artifactEnforceNoAutoCommit'."
            }
        }
        catch {
            $versionContractViolations += $_.Exception.Message
        }
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
        if ($taskManagedBlock -match '\{\{CANONICAL_ENTRYPOINT\}\}') {
            $taskContractViolations += 'TASK.md contains unresolved `{{CANONICAL_ENTRYPOINT}}` placeholder.'
        }

        $expectedTaskCanonicalLine = "Canonical instructions entrypoint for orchestration: ``$canonicalEntrypoint``."
        if ($taskManagedBlock -notmatch [regex]::Escape($expectedTaskCanonicalLine)) {
            $taskContractViolations += "TASK.md must reference canonical instructions entrypoint '$canonicalEntrypoint'."
        }

        $expectedHardStopLine = "Hard stop: first open ``$canonicalEntrypoint`` and follow its routing links. Only then execute any task from ``TASK.md``."
        if ($taskManagedBlock -notmatch [regex]::Escape($expectedHardStopLine)) {
            $taskContractViolations += "TASK.md must include hard-stop instruction to read '$canonicalEntrypoint' before task execution."
        }

        if ($taskManagedBlock -notmatch [regex]::Escape('Orchestrator mode starts when task execution is requested from this file (`TASK.md`).')) {
            $taskContractViolations += 'TASK.md must include explicit orchestrator start note.'
        }
    }
} else {
    $taskContractViolations += 'TASK.md missing.'
}

$qwenSettingsViolations = @()
$qwenSettingsPath = Join-Path $TargetRoot '.qwen/settings.json'
if (Test-Path $qwenSettingsPath) {
    try {
        $qwenSettings = Get-Content -Path $qwenSettingsPath -Raw | ConvertFrom-Json -ErrorAction Stop
        $configuredFileNames = @()
        if ($null -ne $qwenSettings.PSObject.Properties['context']) {
            $contextValue = $qwenSettings.context
            if ($null -ne $contextValue -and $null -ne $contextValue.PSObject.Properties['fileName']) {
                foreach ($item in @($contextValue.fileName)) {
                    if ($null -eq $item) {
                        continue
                    }

                    $text = [string]$item
                    if ([string]::IsNullOrWhiteSpace($text)) {
                        continue
                    }

                    $configuredFileNames += $text.Trim()
                }
            }
        }

        $configuredFileNames = @($configuredFileNames | Sort-Object -Unique)
        if ($configuredFileNames -notcontains 'AGENTS.md') {
            $qwenSettingsViolations += '.qwen/settings.json must include context.fileName entry `AGENTS.md`.'
        }
        if ($configuredFileNames -notcontains 'TASK.md') {
            $qwenSettingsViolations += '.qwen/settings.json must include context.fileName entry `TASK.md`.'
        }
    }
    catch {
        $qwenSettingsViolations += ".qwen/settings.json is not valid JSON: $($_.Exception.Message)"
    }
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
    if ($coreContent -notmatch '(?m)^Respond in .+ for explanations and assistance\.\r?$') {
        $coreRuleContractViolations += '00-core.md must define configured assistant language sentence.'
    }
    if ($coreContent -notmatch '(?m)^Default response brevity: .+\.\r?$') {
        $coreRuleContractViolations += '00-core.md must define configured assistant response brevity sentence.'
    }

    if (-not [string]::IsNullOrWhiteSpace($artifactAssistantLanguage)) {
        $expectedLanguageLine = "Respond in $artifactAssistantLanguage for explanations and assistance."
        if ($coreContent -notmatch ("(?m)^" + [regex]::Escape($expectedLanguageLine) + "\r?$")) {
            $coreRuleContractViolations += "00-core.md language does not match init answers artifact. Expected: '$expectedLanguageLine'."
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($artifactAssistantBrevity)) {
        $expectedBrevityLine = "Default response brevity: $artifactAssistantBrevity."
        if ($coreContent -notmatch ("(?m)^" + [regex]::Escape($expectedBrevityLine) + "\r?$")) {
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

    if ($canonicalContent -notmatch '(?m)^# Octopus Agent Orchestrator Rule Index\r?$') {
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

    $expectedRedirectHardStopLine = "Hard stop: before any task execution, open ``TASK.md`` and ``$canonicalEntrypoint``."
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectHardStopLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must include hard-stop instruction for TASK.md + $canonicalEntrypoint."
    }

    $expectedRedirectGateLine = 'Do not implement tasks directly without orchestration preflight and required review gates.'
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectGateLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must include direct-implementation prohibition for orchestration gates."
    }

    $expectedProviderBridgeLines = @(
        'For GitHub Copilot Agents, run task execution through `.github/agents/orchestrator.md`.',
        'For Windsurf Agents, run task execution through `.windsurf/agents/orchestrator.md`.',
        'For Junie Agents, run task execution through `.junie/agents/orchestrator.md`.',
        'For Antigravity Agents, run task execution through `.antigravity/agents/orchestrator.md`.'
    )
    foreach ($providerLine in $expectedProviderBridgeLines) {
        if ($redirectContent -notmatch [regex]::Escape($providerLine)) {
            $entrypointContractViolations += "$redirectEntrypoint must include provider bridge line: $providerLine"
        }
    }
}

$providerOrchestratorProfiles = @(
    [PSCustomObject]@{
        RelativePath = '.github/agents/orchestrator.md'
        ProviderLabel = 'GitHub Copilot'
    },
    [PSCustomObject]@{
        RelativePath = '.windsurf/agents/orchestrator.md'
        ProviderLabel = 'Windsurf'
    },
    [PSCustomObject]@{
        RelativePath = '.junie/agents/orchestrator.md'
        ProviderLabel = 'Junie'
    },
    [PSCustomObject]@{
        RelativePath = '.antigravity/agents/orchestrator.md'
        ProviderLabel = 'Antigravity'
    }
)

$providerSkillPaths = @(
    'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/db-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md'
)

$providerAgentContractViolations = @()
foreach ($profile in $providerOrchestratorProfiles) {
    $profilePath = Join-Path $TargetRoot $profile.RelativePath
    if (-not (Test-Path $profilePath)) {
        $providerAgentContractViolations += "$($profile.RelativePath) missing."
        continue
    }

    $profileContent = Get-Content -Path $profilePath -Raw
    $expectedCanonicalLine = "Canonical source of truth for agent workflow rules: ``$canonicalEntrypoint``."
    if ($profileContent -notmatch [regex]::Escape($expectedCanonicalLine)) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference canonical entrypoint '$canonicalEntrypoint'."
    }

    $expectedHardStopLine = "Hard stop: first open ``$canonicalEntrypoint`` and ``TASK.md``."
    if ($profileContent -notmatch [regex]::Escape($expectedHardStopLine)) {
        $providerAgentContractViolations += "$($profile.RelativePath) must include hard-stop instruction for canonical entrypoint + TASK.md."
    }

    $expectedGateLine = 'Do not implement tasks directly without orchestration preflight and required review gates.'
    if ($profileContent -notmatch [regex]::Escape($expectedGateLine)) {
        $providerAgentContractViolations += "$($profile.RelativePath) must include direct-implementation prohibition for orchestration gates."
    }

    foreach ($skillPath in $providerSkillPaths) {
        if ($profileContent -notmatch [regex]::Escape($skillPath)) {
            $providerAgentContractViolations += "$($profile.RelativePath) must route to skill '$skillPath'."
        }
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference dynamic skill source '90-skill-catalog.md'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/config/review-capabilities.json')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference optional capability flags file 'review-capabilities.json'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/skills/**')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must allow specialist skills under 'Octopus-agent-orchestrator/live/skills/**'."
    }

    if ($profileContent -notmatch [regex]::Escape('log-task-event.ps1')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference task event logger 'log-task-event.ps1'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference task timeline log path 'runtime/task-events/<task-id>.jsonl'."
    }
}

$githubSkillBridgeProfiles = @(
    [PSCustomObject]@{
        RelativePath = '.github/agents/reviewer.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md'
        ReviewRequirement = 'Use preflight `required_reviews.*` flags from orchestrator.'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/code-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
        ReviewRequirement = 'required_reviews.code=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/db-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/db-review/SKILL.md'
        ReviewRequirement = 'required_reviews.db=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/security-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md'
        ReviewRequirement = 'required_reviews.security=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/refactor-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md'
        ReviewRequirement = 'required_reviews.refactor=true'
        CapabilityFlag = 'always-on'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/api-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/api-review/SKILL.md'
        ReviewRequirement = 'required_reviews.api=true'
        CapabilityFlag = 'review-capabilities.api=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/test-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/test-review/SKILL.md'
        ReviewRequirement = 'required_reviews.test=true'
        CapabilityFlag = 'review-capabilities.test=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/performance-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/performance-review/SKILL.md'
        ReviewRequirement = 'required_reviews.performance=true'
        CapabilityFlag = 'review-capabilities.performance=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/infra-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/infra-review/SKILL.md'
        ReviewRequirement = 'required_reviews.infra=true'
        CapabilityFlag = 'review-capabilities.infra=true'
    },
    [PSCustomObject]@{
        RelativePath = '.github/agents/dependency-review.md'
        SkillPath = 'Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md'
        ReviewRequirement = 'required_reviews.dependency=true'
        CapabilityFlag = 'review-capabilities.dependency=true'
    }
)

$githubSkillBridgeContractViolations = @()
foreach ($profile in $githubSkillBridgeProfiles) {
    $profilePath = Join-Path $TargetRoot $profile.RelativePath
    if (-not (Test-Path $profilePath)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) missing."
        continue
    }

    $profileContent = Get-Content -Path $profilePath -Raw
    $expectedCanonicalLine = "Canonical source of truth for agent workflow rules: ``$canonicalEntrypoint``."
    if ($profileContent -notmatch [regex]::Escape($expectedCanonicalLine)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference canonical entrypoint '$canonicalEntrypoint'."
    }

    $expectedHardStopLine = "Hard stop: first open ``.github/agents/orchestrator.md``, ``$canonicalEntrypoint``, and ``TASK.md``."
    if ($profileContent -notmatch [regex]::Escape($expectedHardStopLine)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must include hard-stop instruction for orchestrator + canonical entrypoint + TASK.md."
    }

    $expectedGateLine = 'Do not implement tasks directly without orchestration preflight and required review gates.'
    if ($profileContent -notmatch [regex]::Escape($expectedGateLine)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must include direct-implementation prohibition for orchestration gates."
    }

    if ($profileContent -notmatch [regex]::Escape($profile.SkillPath)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must route to skill '$($profile.SkillPath)'."
    }

    if ($profileContent -notmatch [regex]::Escape($profile.ReviewRequirement)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must include review selector '$($profile.ReviewRequirement)'."
    }

    if ($profileContent -notmatch [regex]::Escape($profile.CapabilityFlag)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must include capability selector '$($profile.CapabilityFlag)'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference dynamic skill source '90-skill-catalog.md'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/config/review-capabilities.json')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference optional capability flags file 'review-capabilities.json'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/skills/**')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must allow specialist skills under 'Octopus-agent-orchestrator/live/skills/**'."
    }

    if ($profileContent -notmatch [regex]::Escape('log-task-event.ps1')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference task event logger 'log-task-event.ps1'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference task timeline log path 'runtime/task-events/<task-id>.jsonl'."
    }
}

$copilotInstructionContractViolations = @()
$copilotInstructionsPath = Join-Path $TargetRoot '.github/copilot-instructions.md'
if (Test-Path $copilotInstructionsPath) {
    $copilotInstructionsContent = Get-Content -Path $copilotInstructionsPath -Raw
    if ($copilotInstructionsContent -notmatch [regex]::Escape('.github/agents/orchestrator.md')) {
        $copilotInstructionContractViolations += '.github/copilot-instructions.md must route task execution to .github/agents/orchestrator.md.'
    }
}

$commitGuardContractViolations = @()
$commitGuardStart = '# Octopus-agent-orchestrator:commit-guard-start'
$commitGuardEnd = '# Octopus-agent-orchestrator:commit-guard-end'
if ($artifactEnforceNoAutoCommit) {
    $gitDirPath = Join-Path $TargetRoot '.git'
    if (-not (Test-Path -LiteralPath $gitDirPath -PathType Container)) {
        $commitGuardContractViolations += 'EnforceNoAutoCommit=true but .git directory is missing, cannot enforce pre-commit guard.'
    } else {
        $preCommitHookPath = Join-Path $TargetRoot '.git/hooks/pre-commit'
        if (-not (Test-Path -LiteralPath $preCommitHookPath -PathType Leaf)) {
            $commitGuardContractViolations += 'EnforceNoAutoCommit=true but .git/hooks/pre-commit is missing.'
        } else {
            $preCommitHookContent = Get-Content -Path $preCommitHookPath -Raw
            if ($preCommitHookContent -notmatch [regex]::Escape($commitGuardStart) -or $preCommitHookContent -notmatch [regex]::Escape($commitGuardEnd)) {
                $commitGuardContractViolations += 'EnforceNoAutoCommit=true but pre-commit hook does not contain Octopus managed guard block.'
            }
        }
    }
}

$reviewerExecutionContractViolations = @()
$orchestrationSkillPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md'
if (Test-Path -LiteralPath $orchestrationSkillPath -PathType Leaf) {
    $orchestrationSkillContent = Get-Content -Path $orchestrationSkillPath -Raw
    $requiredSkillSnippets = @(
        '## Reviewer Agent Execution (Claude Code)',
        'Launch reviewer via Agent tool using clean context (`fork_context=false`).',
        'review artifact write path: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>.md`.',
        'required-reviews-check.ps1 -PreflightPath "<path>" -TaskId "<task-id>"',
        '-CodeReviewVerdict "<...>"',
        '-DbReviewVerdict "<...>"',
        '-SecurityReviewVerdict "<...>"',
        '-RefactorReviewVerdict "<...>"',
        '-ApiReviewVerdict "<...>"',
        '-TestReviewVerdict "<...>"',
        '-PerformanceReviewVerdict "<...>"',
        '-InfraReviewVerdict "<...>"',
        '-DependencyReviewVerdict "<...>"',
        'single-agent fallback mode (no Agent tool)'
    )

    foreach ($snippet in $requiredSkillSnippets) {
        if ($orchestrationSkillContent -notmatch [regex]::Escape($snippet)) {
            $reviewerExecutionContractViolations += "Missing reviewer execution contract snippet in live/skills/orchestration/SKILL.md: $snippet"
        }
    }
}

$taskWorkflowRulePath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
if (Test-Path -LiteralPath $taskWorkflowRulePath -PathType Leaf) {
    $taskWorkflowRuleContent = Get-Content -Path $taskWorkflowRulePath -Raw
    $requiredWorkflowSnippets = @(
        'Reviewer-agent execution mechanics are defined in `orchestration/SKILL.md` section `Reviewer Agent Execution (Claude Code)`.',
        'Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.',
        'Do you want me to commit now? (yes/no)'
    )

    foreach ($snippet in $requiredWorkflowSnippets) {
        if ($taskWorkflowRuleContent -notmatch [regex]::Escape($snippet)) {
            $reviewerExecutionContractViolations += "Missing reviewer execution linkage in live/docs/agent-rules/80-task-workflow.md: $snippet"
        }
    }
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "TemplateRoot: $sourceRoot"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "EnforceNoAutoCommit: $artifactEnforceNoAutoCommit"
Write-Output "CanonicalEntrypoint: $canonicalEntrypoint"
Write-Output "RequiredPathsChecked: $($requiredPaths.Count)"
Write-Output "MissingPathCount: $($missingPaths.Count)"
Write-Output "BundleVersion: $bundleVersion"
Write-Output "VersionContractViolationCount: $($versionContractViolations.Count)"
Write-Output "ManagedFilesChecked: $($strictManagedFiles.Count + 1 + $entrypointFiles.Count)"
Write-Output "StyleViolationCount: $($styleViolations.Count)"
Write-Output "TaskContractViolationCount: $($taskContractViolations.Count)"
Write-Output "QwenSettingsViolationCount: $($qwenSettingsViolations.Count)"
Write-Output "RuleFileViolationCount: $($ruleFileViolations.Count)"
Write-Output "TemplatePlaceholderViolationCount: $($templatePlaceholderViolations.Count)"
Write-Output "InitAnswersContractViolationCount: $($initAnswersContractViolations.Count)"
Write-Output "CoreRuleContractViolationCount: $($coreRuleContractViolations.Count)"
Write-Output "EntrypointContractViolationCount: $($entrypointContractViolations.Count)"
Write-Output "ProviderAgentContractViolationCount: $($providerAgentContractViolations.Count)"
Write-Output "GitHubSkillBridgeContractViolationCount: $($githubSkillBridgeContractViolations.Count)"
Write-Output "CopilotInstructionContractViolationCount: $($copilotInstructionContractViolations.Count)"
Write-Output "CommitGuardContractViolationCount: $($commitGuardContractViolations.Count)"
Write-Output "GitignoreMissingCount: $($gitignoreMissing.Count)"

if ($missingPaths.Count -gt 0) {
    Write-Output 'MissingPaths:'
    foreach ($item in $missingPaths) {
        Write-Output " - $item"
    }
}

if ($versionContractViolations.Count -gt 0) {
    Write-Output 'VersionContractViolations:'
    foreach ($item in $versionContractViolations) {
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

if ($qwenSettingsViolations.Count -gt 0) {
    Write-Output 'QwenSettingsViolations:'
    foreach ($item in $qwenSettingsViolations) {
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

if ($providerAgentContractViolations.Count -gt 0) {
    Write-Output 'ProviderAgentContractViolations:'
    foreach ($item in $providerAgentContractViolations) {
        Write-Output " - $item"
    }
}

if ($githubSkillBridgeContractViolations.Count -gt 0) {
    Write-Output 'GitHubSkillBridgeContractViolations:'
    foreach ($item in $githubSkillBridgeContractViolations) {
        Write-Output " - $item"
    }
}

if ($copilotInstructionContractViolations.Count -gt 0) {
    Write-Output 'CopilotInstructionContractViolations:'
    foreach ($item in $copilotInstructionContractViolations) {
        Write-Output " - $item"
    }
}

if ($commitGuardContractViolations.Count -gt 0) {
    Write-Output 'CommitGuardContractViolations:'
    foreach ($item in $commitGuardContractViolations) {
        Write-Output " - $item"
    }
}

if ($gitignoreMissing.Count -gt 0) {
    Write-Output 'MissingGitignoreEntries:'
    foreach ($item in $gitignoreMissing) {
        Write-Output " - $item"
    }
}

if (
    $missingPaths.Count -gt 0 -or
    $versionContractViolations.Count -gt 0 -or
    $styleViolations.Count -gt 0 -or
    $taskContractViolations.Count -gt 0 -or
    $qwenSettingsViolations.Count -gt 0 -or
    $ruleFileViolations.Count -gt 0 -or
    $templatePlaceholderViolations.Count -gt 0 -or
    $initAnswersContractViolations.Count -gt 0 -or
    $coreRuleContractViolations.Count -gt 0 -or
    $entrypointContractViolations.Count -gt 0 -or
    $providerAgentContractViolations.Count -gt 0 -or
    $githubSkillBridgeContractViolations.Count -gt 0 -or
    $copilotInstructionContractViolations.Count -gt 0 -or
    $commitGuardContractViolations.Count -gt 0 -or
    $gitignoreMissing.Count -gt 0
) {
    throw 'Verification failed. Resolve listed issues and rerun.'
}

Write-Output 'Verification: PASS'

