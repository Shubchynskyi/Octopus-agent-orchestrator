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
$ruleContractMigrationModulePath = Join-Path $scriptDir 'lib/rule-contract-migrations.ps1'
$managedConfigContractsModulePath = Join-Path $scriptDir 'lib/managed-config-contracts.ps1'

if (-not (Test-Path $sourceRoot)) {
    throw "Template directory not found: $sourceRoot"
}

if (-not (Test-Path -LiteralPath $ruleContractMigrationModulePath -PathType Leaf)) {
    throw "Rule contract migrations module not found: $ruleContractMigrationModulePath"
}
. $ruleContractMigrationModulePath

if (-not (Test-Path -LiteralPath $managedConfigContractsModulePath -PathType Leaf)) {
    throw "Managed config contracts module not found: $managedConfigContractsModulePath"
}
. $managedConfigContractsModulePath

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path
$SourceOfTruth = $SourceOfTruth.Trim()
$sourceOfTruthKey = $SourceOfTruth.ToUpperInvariant().Replace(' ', '')

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
$initAnswersCandidatePath = $null
try {
    $candidatePath = $InitAnswersPath
    if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
        $candidatePath = Join-Path $TargetRoot $candidatePath
    }

    $candidatePath = [System.IO.Path]::GetFullPath($candidatePath)
    if (-not (Test-IsPathInsideRoot -RootPath $TargetRoot -CandidatePath $candidatePath)) {
        throw "InitAnswersPath must resolve inside TargetRoot '$TargetRoot'. Resolved path: $candidatePath"
    }

    $initAnswersCandidatePath = $candidatePath
}
catch {
    $initAnswersContractViolations += $_.Exception.Message
}

$initAnswersResolvedPath = $null
$artifactAssistantLanguage = $null
$artifactAssistantBrevity = $null
$artifactSourceOfTruth = $null
$artifactEnforceNoAutoCommit = $false
$artifactClaudeOrchestratorFullAccess = $false
$artifactTokenEconomyEnabled = $false

if ($null -eq $initAnswersCandidatePath) {
    # Path resolution violation already captured above.
} elseif (-not (Test-Path -LiteralPath $initAnswersCandidatePath -PathType Leaf)) {
    $initAnswersContractViolations += "Init answers artifact missing: $initAnswersCandidatePath"
} else {
    $initAnswersResolvedPath = (Resolve-Path -LiteralPath $initAnswersCandidatePath).Path
    $initAnswersPathIsInsideRoot = Test-IsPathInsideRoot -RootPath $TargetRoot -CandidatePath $initAnswersResolvedPath
    if (-not $initAnswersPathIsInsideRoot) {
        $initAnswersContractViolations += "InitAnswersPath resolves outside TargetRoot '$TargetRoot': $initAnswersResolvedPath"
    } else {
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

                $artifactClaudeOrchestratorFullAccessRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'ClaudeOrchestratorFullAccess'
                if ([string]::IsNullOrWhiteSpace($artifactClaudeOrchestratorFullAccessRaw)) {
                    $initAnswersContractViolations += "Init answers artifact missing ClaudeOrchestratorFullAccess: $initAnswersResolvedPath"
                } else {
                    try {
                        $artifactClaudeOrchestratorFullAccess = Convert-ToBooleanAnswer -Value $artifactClaudeOrchestratorFullAccessRaw -FieldName 'ClaudeOrchestratorFullAccess' -DefaultValue $false
                    }
                    catch {
                        $initAnswersContractViolations += $_.Exception.Message
                    }
                }

                $artifactTokenEconomyEnabledRaw = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'TokenEconomyEnabled'
                try {
                    $artifactTokenEconomyEnabled = Convert-ToBooleanAnswer -Value $artifactTokenEconomyEnabledRaw -FieldName 'TokenEconomyEnabled' -DefaultValue $false
                }
                catch {
                    $initAnswersContractViolations += $_.Exception.Message
                }
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
    'Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md',
    'Octopus-agent-orchestrator/HOW_TO.md',
    'Octopus-agent-orchestrator/scripts/reinit.ps1',
    'Octopus-agent-orchestrator/scripts/reinit.sh',
    'Octopus-agent-orchestrator/scripts/check-update.ps1',
    'Octopus-agent-orchestrator/scripts/check-update.sh',
    'Octopus-agent-orchestrator/scripts/update.ps1',
    'Octopus-agent-orchestrator/scripts/update.sh',
    'Octopus-agent-orchestrator/scripts/lib/managed-config-contracts.ps1',
    'Octopus-agent-orchestrator/scripts/lib/rule-contract-migrations.ps1',
    'Octopus-agent-orchestrator/MANIFEST.md',
    'Octopus-agent-orchestrator/live/version.json',
    'Octopus-agent-orchestrator/live/config/review-capabilities.json',
    'Octopus-agent-orchestrator/live/config/paths.json',
    'Octopus-agent-orchestrator/live/config/token-economy.json',
    'Octopus-agent-orchestrator/live/config/output-filters.json',
    'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.ps1',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.sh',
    'Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1',
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

if ($artifactClaudeOrchestratorFullAccess) {
    $requiredPaths += '.claude/settings.local.json'
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
if ($artifactClaudeOrchestratorFullAccess) {
    $gitignoreEntries += '.claude/'
}

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

function Get-ManagedConfigContractResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigName,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [ref]$Violations
    )

    $result = [PSCustomObject]@{
        Value   = $null
        Changes = @()
    }

    $configPath = Join-Path $TargetRoot $RelativePath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        $Violations.Value += "$RelativePath is missing."
        return $result
    }

    try {
        $rawConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        $Violations.Value += "$RelativePath must contain valid JSON."
        return $result
    }

    $definition = Get-ManagedConfigDefinition -ConfigName $ConfigName
    $templatePath = Join-Path $sourceRoot $definition.TemplateRelativePath
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
        $Violations.Value += "Template config for '$ConfigName' is missing: $templatePath"
        $result.Value = $rawConfig
        return $result
    }

    try {
        $templateConfig = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        $Violations.Value += "Template config for '$ConfigName' must contain valid JSON: $templatePath"
        $result.Value = $rawConfig
        return $result
    }

    $mergeResult = Merge-ManagedConfigWithTemplate -ConfigName $ConfigName -TemplateConfig $templateConfig -ExistingConfig $rawConfig
    $result.Value = Convert-ToManagedConfigHashtable -Value $mergeResult.Value
    $result.Changes = @($mergeResult.Changes)
    foreach ($change in $result.Changes) {
        $Violations.Value += Format-ManagedConfigChange -RelativePath $RelativePath -Change $change
    }

    return $result
}

function Get-VerifyConfigValue {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Key)) {
            return $Object[$Key]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$Key]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-VerifyConfigStringArray {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        $single = $Value.Trim()
        if ([string]::IsNullOrWhiteSpace($single)) {
            return @()
        }
        return @($single)
    }

    $result = @()
    foreach ($item in @($Value)) {
        if ($null -eq $item) {
            continue
        }

        $text = [string]$item
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }
        $result += $text.Trim()
    }

    return @($result)
}

function Test-VerifyFilterIntegerSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [Parameter(Mandatory = $true)]
        [ref]$Violations,
        [int]$Minimum = 0
    )

    $contextKey = Get-VerifyConfigValue -Object $Value -Key 'context_key'
    if ($null -ne $contextKey) {
        if ($contextKey -isnot [string] -or [string]::IsNullOrWhiteSpace($contextKey.Trim())) {
            $Violations.Value += "$RelativePath $FieldName context reference must define non-empty string 'context_key'."
        }
        return
    }

    $resolvedInt = $null
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [short] -or $Value -is [byte]) {
        $resolvedInt = [int]$Value
    } elseif ($Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) {
        $numericValue = [double]$Value
        if ($numericValue -eq [Math]::Floor($numericValue)) {
            $resolvedInt = [int]$numericValue
        }
    }

    if ($null -eq $resolvedInt -or $resolvedInt -lt $Minimum) {
        $Violations.Value += "$RelativePath $FieldName must be integer >= $Minimum or object with non-empty 'context_key'."
    }
}

function Test-VerifyFilterStringSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [Parameter(Mandatory = $true)]
        [ref]$Violations,
        [switch]$AllowEmpty
    )

    $contextKey = Get-VerifyConfigValue -Object $Value -Key 'context_key'
    if ($null -ne $contextKey) {
        if ($contextKey -isnot [string] -or [string]::IsNullOrWhiteSpace($contextKey.Trim())) {
            $Violations.Value += "$RelativePath $FieldName context reference must define non-empty string 'context_key'."
        }
        return
    }

    if ($Value -isnot [string]) {
        $Violations.Value += "$RelativePath $FieldName must be string or object with non-empty 'context_key'."
        return
    }

    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($Value.Trim())) {
        $Violations.Value += "$RelativePath $FieldName must not be empty."
    }
}

$tokenEconomyContractViolations = @()
$tokenEconomyRelativePath = 'Octopus-agent-orchestrator/live/config/token-economy.json'
$tokenEconomyContract = Get-ManagedConfigContractResult -ConfigName 'token-economy' -RelativePath $tokenEconomyRelativePath -Violations ([ref]$tokenEconomyContractViolations)
$tokenEconomyConfig = $tokenEconomyContract.Value
if ($null -ne $tokenEconomyConfig) {
    $requiredBooleanKeys = @(
        'enabled',
        'strip_examples',
        'strip_code_blocks',
        'scoped_diffs',
        'compact_reviewer_output'
    )
    foreach ($key in $requiredBooleanKeys) {
        $value = Get-VerifyConfigValue -Object $tokenEconomyConfig -Key $key
        if ($null -eq $value) {
            $tokenEconomyContractViolations += "$tokenEconomyRelativePath must include boolean '$key'."
            continue
        }

        if ($value -isnot [bool]) {
            $tokenEconomyContractViolations += "$tokenEconomyRelativePath '$key' must be boolean."
        }
    }

    $enabledValue = Get-VerifyConfigValue -Object $tokenEconomyConfig -Key 'enabled'
    if ($enabledValue -is [bool] -and [bool]$enabledValue -ne $artifactTokenEconomyEnabled) {
        $tokenEconomyContractViolations += "$tokenEconomyRelativePath 'enabled' value '$enabledValue' must match init answers TokenEconomyEnabled '$artifactTokenEconomyEnabled'."
    }

    $enabledDepthsValue = Get-VerifyConfigValue -Object $tokenEconomyConfig -Key 'enabled_depths'
    if ($null -eq $enabledDepthsValue) {
        $tokenEconomyContractViolations += "$tokenEconomyRelativePath must include array 'enabled_depths'."
    } else {
        if ($enabledDepthsValue -is [string]) {
            $tokenEconomyContractViolations += "$tokenEconomyRelativePath 'enabled_depths' must be an array of integers in range 1..3."
        } else {
            foreach ($depthValue in @($enabledDepthsValue)) {
                $depthInt = $null
                if ($depthValue -is [int] -or $depthValue -is [long] -or $depthValue -is [short] -or $depthValue -is [byte]) {
                    $depthInt = [int]$depthValue
                } elseif ($depthValue -is [double] -or $depthValue -is [decimal] -or $depthValue -is [single]) {
                    $depthNumeric = [double]$depthValue
                    if ($depthNumeric -eq [Math]::Floor($depthNumeric)) {
                        $depthInt = [int]$depthNumeric
                    }
                }

                if ($null -eq $depthInt -or $depthInt -lt 1 -or $depthInt -gt 3) {
                    $tokenEconomyContractViolations += "$tokenEconomyRelativePath 'enabled_depths' must contain only integers in range 1..3."
                    break
                }
            }
        }
    }

    $failTailRaw = Get-VerifyConfigValue -Object $tokenEconomyConfig -Key 'fail_tail_lines'
    if ($null -eq $failTailRaw) {
        $tokenEconomyContractViolations += "$tokenEconomyRelativePath must include positive integer 'fail_tail_lines'."
    } else {
        $failTailLines = $null
        if ($failTailRaw -is [int] -or $failTailRaw -is [long] -or $failTailRaw -is [short] -or $failTailRaw -is [byte]) {
            $failTailLines = [int]$failTailRaw
        } elseif ($failTailRaw -is [double] -or $failTailRaw -is [decimal] -or $failTailRaw -is [single]) {
            $failTailNumeric = [double]$failTailRaw
            if ($failTailNumeric -eq [Math]::Floor($failTailNumeric)) {
                $failTailLines = [int]$failTailNumeric
            }
        }

        if ($null -eq $failTailLines -or $failTailLines -le 0) {
            $tokenEconomyContractViolations += "$tokenEconomyRelativePath 'fail_tail_lines' must be a positive integer."
        }
    }
}

$outputFiltersContractViolations = @()
$outputFiltersRelativePath = 'Octopus-agent-orchestrator/live/config/output-filters.json'
$outputFiltersContract = Get-ManagedConfigContractResult -ConfigName 'output-filters' -RelativePath $outputFiltersRelativePath -Violations ([ref]$outputFiltersContractViolations)
$outputFiltersConfig = $outputFiltersContract.Value
if ($null -ne $outputFiltersConfig) {
        $versionValue = Get-VerifyConfigValue -Object $outputFiltersConfig -Key 'version'
        $versionInt = $null
        if ($versionValue -is [int] -or $versionValue -is [long] -or $versionValue -is [short] -or $versionValue -is [byte]) {
            $versionInt = [int]$versionValue
        } elseif ($versionValue -is [double] -or $versionValue -is [decimal] -or $versionValue -is [single]) {
            $versionNumeric = [double]$versionValue
            if ($versionNumeric -eq [Math]::Floor($versionNumeric)) {
                $versionInt = [int]$versionNumeric
            }
        }
        if ($null -eq $versionInt -or $versionInt -lt 1) {
            $outputFiltersContractViolations += "$outputFiltersRelativePath must include integer 'version' >= 1."
        }

        $passthroughCeilingValue = Get-VerifyConfigValue -Object $outputFiltersConfig -Key 'passthrough_ceiling'
        if ($passthroughCeilingValue -isnot [System.Collections.IDictionary]) {
            $outputFiltersContractViolations += "$outputFiltersRelativePath must include object 'passthrough_ceiling'."
        } else {
            Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $passthroughCeilingValue -Key 'max_lines') -RelativePath $outputFiltersRelativePath -FieldName 'passthrough_ceiling.max_lines' -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
            $strategyValue = Get-VerifyConfigValue -Object $passthroughCeilingValue -Key 'strategy'
            if ($strategyValue -isnot [string] -or @('head', 'tail') -notcontains $strategyValue.Trim().ToLowerInvariant()) {
                $outputFiltersContractViolations += "$outputFiltersRelativePath passthrough_ceiling.strategy must be 'head' or 'tail'."
            }
        }

        $profilesValue = Get-VerifyConfigValue -Object $outputFiltersConfig -Key 'profiles'
        if ($profilesValue -isnot [System.Collections.IDictionary] -or $profilesValue.Count -eq 0) {
            $outputFiltersContractViolations += "$outputFiltersRelativePath must include non-empty object 'profiles'."
        } else {
            foreach ($profileEntry in $profilesValue.GetEnumerator()) {
                $profileName = [string]$profileEntry.Key
                if ([string]::IsNullOrWhiteSpace($profileName)) {
                    $outputFiltersContractViolations += "$outputFiltersRelativePath profile names must not be empty."
                    continue
                }

                $profileValue = $profileEntry.Value
                if ($profileValue -isnot [System.Collections.IDictionary]) {
                    $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' must be an object."
                    continue
                }

                $emitWhenEmptyValue = Get-VerifyConfigValue -Object $profileValue -Key 'emit_when_empty'
                if ($null -ne $emitWhenEmptyValue -and $emitWhenEmptyValue -isnot [string]) {
                    $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' field 'emit_when_empty' must be string when present."
                }

                $parserValue = Get-VerifyConfigValue -Object $profileValue -Key 'parser'
                if ($null -ne $parserValue) {
                    if ($parserValue -isnot [System.Collections.IDictionary]) {
                        $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' field 'parser' must be an object."
                    } else {
                        $parserType = Get-VerifyConfigValue -Object $parserValue -Key 'type'
                        if ($parserType -isnot [string] -or [string]::IsNullOrWhiteSpace($parserType.Trim())) {
                            $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' parser requires non-empty string 'type'."
                        } else {
                            switch ($parserType.Trim().ToLowerInvariant()) {
                                'compile_failure_summary' {
                                    $strategyValue = Get-VerifyConfigValue -Object $parserValue -Key 'strategy'
                                    if ($null -ne $strategyValue) {
                                        Test-VerifyFilterStringSpec -Value $strategyValue -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.strategy" -Violations ([ref]$outputFiltersContractViolations) -AllowEmpty
                                    }
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'max_matches') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.max_matches" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'tail_count') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.tail_count" -Violations ([ref]$outputFiltersContractViolations) -Minimum 0
                                }
                                'test_failure_summary' {
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'max_matches') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.max_matches" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'tail_count') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.tail_count" -Violations ([ref]$outputFiltersContractViolations) -Minimum 0
                                }
                                'lint_failure_summary' {
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'max_matches') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.max_matches" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'tail_count') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.tail_count" -Violations ([ref]$outputFiltersContractViolations) -Minimum 0
                                }
                                'review_gate_summary' {
                                    Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $parserValue -Key 'max_lines') -RelativePath $outputFiltersRelativePath -FieldName "profile '$profileName' parser.max_lines" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                                }
                                default {
                                    $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' parser type '$parserType' is unsupported."
                                }
                            }
                        }
                    }
                }

                $operationsValue = Get-VerifyConfigValue -Object $profileValue -Key 'operations'
                if ($null -eq $operationsValue) {
                    $operationsValue = @()
                } elseif ($operationsValue -is [string]) {
                    $outputFiltersContractViolations += "$outputFiltersRelativePath profile '$profileName' field 'operations' must be an array."
                    continue
                }

                $operationIndex = 0
                foreach ($operation in @($operationsValue)) {
                    $operationIndex++
                    $operationLabel = "profile '$profileName' operation #$operationIndex"
                    if ($operation -isnot [System.Collections.IDictionary]) {
                        $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel must be an object."
                        continue
                    }

                    $operationType = [string](Get-VerifyConfigValue -Object $operation -Key 'type')
                    if ([string]::IsNullOrWhiteSpace($operationType)) {
                        $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel requires non-empty 'type'."
                        continue
                    }

                    switch ($operationType.Trim().ToLowerInvariant()) {
                        'strip_ansi' {
                        }
                        'regex_replace' {
                            $patternValue = Get-VerifyConfigValue -Object $operation -Key 'pattern'
                            if ($patternValue -isnot [string] -or [string]::IsNullOrWhiteSpace($patternValue.Trim())) {
                                $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel requires non-empty string 'pattern'."
                            } else {
                                try {
                                    [void][regex]::new($patternValue)
                                } catch {
                                    $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel pattern '$patternValue' is invalid regex."
                                }
                            }

                            $replacementValue = Get-VerifyConfigValue -Object $operation -Key 'replacement'
                            if ($null -ne $replacementValue -and $replacementValue -isnot [string]) {
                                $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel replacement must be string when present."
                            }
                        }
                        'drop_lines_matching' {
                            $patterns = Get-VerifyConfigStringArray -Value $(Get-VerifyConfigValue -Object $operation -Key 'patterns')
                            if ($patterns.Count -eq 0) {
                                $patterns = Get-VerifyConfigStringArray -Value $(Get-VerifyConfigValue -Object $operation -Key 'pattern')
                            }
                            if ($patterns.Count -eq 0) {
                                $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel requires non-empty 'pattern' or 'patterns'."
                            } else {
                                foreach ($pattern in $patterns) {
                                    try {
                                        [void][regex]::new($pattern)
                                    } catch {
                                        $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel pattern '$pattern' is invalid regex."
                                    }
                                }
                            }
                        }
                        'keep_lines_matching' {
                            $patterns = Get-VerifyConfigStringArray -Value $(Get-VerifyConfigValue -Object $operation -Key 'patterns')
                            if ($patterns.Count -eq 0) {
                                $patterns = Get-VerifyConfigStringArray -Value $(Get-VerifyConfigValue -Object $operation -Key 'pattern')
                            }
                            if ($patterns.Count -eq 0) {
                                $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel requires non-empty 'pattern' or 'patterns'."
                            } else {
                                foreach ($pattern in $patterns) {
                                    try {
                                        [void][regex]::new($pattern)
                                    } catch {
                                        $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel pattern '$pattern' is invalid regex."
                                    }
                                }
                            }
                        }
                        'truncate_line_length' {
                            Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $operation -Key 'max_chars') -RelativePath $outputFiltersRelativePath -FieldName "$operationLabel max_chars" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                            $suffixValue = Get-VerifyConfigValue -Object $operation -Key 'suffix'
                            if ($null -ne $suffixValue -and $suffixValue -isnot [string]) {
                                $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel suffix must be string when present."
                            }
                        }
                        'head' {
                            Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $operation -Key 'count') -RelativePath $outputFiltersRelativePath -FieldName "$operationLabel count" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                        }
                        'tail' {
                            Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $operation -Key 'count') -RelativePath $outputFiltersRelativePath -FieldName "$operationLabel count" -Violations ([ref]$outputFiltersContractViolations) -Minimum 1
                        }
                        'max_total_lines' {
                            Test-VerifyFilterIntegerSpec -Value (Get-VerifyConfigValue -Object $operation -Key 'max_lines') -RelativePath $outputFiltersRelativePath -FieldName "$operationLabel max_lines" -Violations ([ref]$outputFiltersContractViolations) -Minimum 0
                            $strategyValue = Get-VerifyConfigValue -Object $operation -Key 'strategy'
                            if ($null -ne $strategyValue) {
                                if ($strategyValue -isnot [string] -or @('head', 'tail') -notcontains $strategyValue.Trim().ToLowerInvariant()) {
                                    $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel strategy must be 'head' or 'tail'."
                                }
                            }
                        }
                        default {
                            $outputFiltersContractViolations += "$outputFiltersRelativePath $operationLabel has unsupported type '$operationType'."
                        }
                    }
                }
            }

            $requiredOutputFilterProfiles = @(
                'compile_failure_console',
                'compile_failure_console_generic',
                'compile_failure_console_maven',
                'compile_failure_console_gradle',
                'compile_failure_console_node',
                'compile_failure_console_cargo',
                'compile_failure_console_dotnet',
                'compile_failure_console_go',
                'compile_success_console',
                'test_failure_console',
                'test_success_console',
                'lint_failure_console',
                'lint_success_console',
                'review_gate_failure_console',
                'review_gate_success_console'
            )
            foreach ($requiredProfileName in $requiredOutputFilterProfiles) {
                if (-not $profilesValue.Contains($requiredProfileName)) {
                    $outputFiltersContractViolations += "$outputFiltersRelativePath must include profile '$requiredProfileName'."
                }
            }
        }
    }

$reviewCapabilitiesContractViolations = @()
$reviewCapabilitiesRelativePath = 'Octopus-agent-orchestrator/live/config/review-capabilities.json'
$reviewCapabilitiesContract = Get-ManagedConfigContractResult -ConfigName 'review-capabilities' -RelativePath $reviewCapabilitiesRelativePath -Violations ([ref]$reviewCapabilitiesContractViolations)
$reviewCapabilitiesConfig = $reviewCapabilitiesContract.Value
if ($null -ne $reviewCapabilitiesConfig) {
    $requiredCapabilityKeys = @('code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency')
    foreach ($key in $requiredCapabilityKeys) {
        $value = Get-VerifyConfigValue -Object $reviewCapabilitiesConfig -Key $key
        if ($value -isnot [bool]) {
            $reviewCapabilitiesContractViolations += "$reviewCapabilitiesRelativePath '$key' must be boolean."
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object $reviewCapabilitiesConfig)) {
        if ($requiredCapabilityKeys -contains [string]$entry.Name) {
            continue
        }

        if ($entry.Value -isnot [bool]) {
            $reviewCapabilitiesContractViolations += "$reviewCapabilitiesRelativePath custom capability '$($entry.Name)' must be boolean."
        }
    }
}

$pathsContractViolations = @()
$pathsRelativePath = 'Octopus-agent-orchestrator/live/config/paths.json'
$pathsContract = Get-ManagedConfigContractResult -ConfigName 'paths' -RelativePath $pathsRelativePath -Violations ([ref]$pathsContractViolations)
$pathsConfig = $pathsContract.Value
if ($null -ne $pathsConfig) {
    $metricsPathValue = Get-VerifyConfigValue -Object $pathsConfig -Key 'metrics_path'
    if ($metricsPathValue -isnot [string] -or [string]::IsNullOrWhiteSpace($metricsPathValue.Trim())) {
        $pathsContractViolations += "$pathsRelativePath must include non-empty string 'metrics_path'."
    }

    $stringArrayFields = @(
        'runtime_roots',
        'fast_path_roots',
        'fast_path_allowed_regexes',
        'fast_path_sensitive_regexes',
        'sql_or_migration_regexes',
        'code_like_regexes'
    )
    foreach ($field in $stringArrayFields) {
        $values = Get-VerifyConfigStringArray -Value (Get-VerifyConfigValue -Object $pathsConfig -Key $field)
        if ($values.Count -eq 0) {
            $pathsContractViolations += "$pathsRelativePath must include non-empty string array '$field'."
            continue
        }

        if ($field -in @('fast_path_allowed_regexes', 'fast_path_sensitive_regexes', 'sql_or_migration_regexes', 'code_like_regexes')) {
            foreach ($pattern in $values) {
                try {
                    [void][regex]::new($pattern)
                }
                catch {
                    $pathsContractViolations += "$pathsRelativePath $field regex '$pattern' is invalid."
                }
            }
        }
    }

    $triggersValue = Get-VerifyConfigValue -Object $pathsConfig -Key 'triggers'
    if ($triggersValue -isnot [System.Collections.IDictionary]) {
        $pathsContractViolations += "$pathsRelativePath must include object 'triggers'."
    } else {
        $requiredTriggerKeys = @('db', 'security', 'refactor', 'api', 'dependency', 'infra', 'test', 'performance')
        foreach ($triggerKey in $requiredTriggerKeys) {
            $patterns = Get-VerifyConfigStringArray -Value (Get-VerifyConfigValue -Object $triggersValue -Key $triggerKey)
            if ($patterns.Count -eq 0) {
                $pathsContractViolations += "$pathsRelativePath triggers.$triggerKey must be a non-empty string array."
                continue
            }

            foreach ($pattern in $patterns) {
                try {
                    [void][regex]::new($pattern)
                }
                catch {
                    $pathsContractViolations += "$pathsRelativePath triggers.$triggerKey regex '$pattern' is invalid."
                }
            }
        }

        foreach ($entry in @(Get-ManagedConfigEntries -Object $triggersValue)) {
            if ($requiredTriggerKeys -contains [string]$entry.Name) {
                continue
            }

            $patterns = Get-VerifyConfigStringArray -Value $entry.Value
            if ($patterns.Count -eq 0) {
                $pathsContractViolations += "$pathsRelativePath triggers.$($entry.Name) must be a non-empty string array."
                continue
            }

            foreach ($pattern in $patterns) {
                try {
                    [void][regex]::new($pattern)
                }
                catch {
                    $pathsContractViolations += "$pathsRelativePath triggers.$($entry.Name) regex '$pattern' is invalid."
                }
            }
        }
    }
}

$compileGateContractViolations = @()
$compileGateScriptChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1'
        Forbidden = @('Invoke-Expression')
        Required = @('CompileOutputPath', 'FailTailLines', 'compile_output_path', 'CompileOutputPath:', 'scope_detection_source', 'scope_sha256', 'Preflight scope drift detected')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1'
        Forbidden = @('Invoke-Expression')
        Required = @('CompileOutputPath', 'FailTailLines', 'compile_output_path', 'CompileOutputPath:', 'scope_detection_source', 'scope_sha256', 'Preflight scope drift detected')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh'
        Forbidden = @('shell=True')
        Required = @('--compile-output-path', '--fail-tail-lines', 'compile_output_path', 'CompileOutputPath:', 'OA_GATE_BASH_BIN', 'scope_detection_source', 'scope_sha256', 'Preflight scope drift detected')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh'
        Forbidden = @('shell=True')
        Required = @('--compile-output-path', '--fail-tail-lines', 'compile_output_path', 'CompileOutputPath:', 'OA_GATE_BASH_BIN', 'scope_detection_source', 'scope_sha256', 'Preflight scope drift detected')
    }
)

foreach ($check in $compileGateScriptChecks) {
    $scriptPath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        continue
    }

    $scriptContent = Get-Content -LiteralPath $scriptPath -Raw
    foreach ($forbiddenSnippet in @($check.Forbidden)) {
        if ($scriptContent -match [regex]::Escape([string]$forbiddenSnippet)) {
            $compileGateContractViolations += "$($check.RelativePath) must not contain '$forbiddenSnippet'."
        }
    }
    foreach ($requiredSnippet in @($check.Required)) {
        if ($scriptContent -notmatch [regex]::Escape([string]$requiredSnippet)) {
            $compileGateContractViolations += "$($check.RelativePath) must include '$requiredSnippet'."
        }
    }
}

$completionGateContractViolations = @()
$completionGateScriptChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1'
        Required = @('COMPILE_GATE_PASSED', 'REVIEW_GATE_FAILED', 'REWORK_STARTED', 'REVIEW_GATE_PASSED_WITH_OVERRIDE', 'COMPLETION_GATE_PASSED', 'COMPLETION_GATE_FAILED', 'runtime/task-events', 'runtime/reviews', 'review-gate.json', 'doc-impact.json', 'required-reviews-check', 'doc-impact-gate')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/completion-gate.ps1'
        Required = @('COMPILE_GATE_PASSED', 'REVIEW_GATE_FAILED', 'REWORK_STARTED', 'REVIEW_GATE_PASSED_WITH_OVERRIDE', 'COMPLETION_GATE_PASSED', 'COMPLETION_GATE_FAILED', 'runtime/task-events', 'runtime/reviews', 'review-gate.json', 'doc-impact.json', 'required-reviews-check', 'doc-impact-gate')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh'
        Required = @('COMPILE_GATE_PASSED', 'REVIEW_GATE_FAILED', 'REWORK_STARTED', 'REVIEW_GATE_PASSED_WITH_OVERRIDE', 'COMPLETION_GATE_PASSED', 'COMPLETION_GATE_FAILED', 'runtime/task-events', 'runtime/reviews', 'review-gate.json', 'doc-impact.json', 'required-reviews-check', 'doc-impact-gate')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/completion-gate.sh'
        Required = @('COMPILE_GATE_PASSED', 'REVIEW_GATE_FAILED', 'REWORK_STARTED', 'REVIEW_GATE_PASSED_WITH_OVERRIDE', 'COMPLETION_GATE_PASSED', 'COMPLETION_GATE_FAILED', 'runtime/task-events', 'runtime/reviews', 'review-gate.json', 'doc-impact.json', 'required-reviews-check', 'doc-impact-gate')
    }
)

foreach ($check in $completionGateScriptChecks) {
    $scriptPath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        continue
    }

    $scriptContent = Get-Content -LiteralPath $scriptPath -Raw
    foreach ($requiredSnippet in @($check.Required)) {
        if ($scriptContent -notmatch [regex]::Escape([string]$requiredSnippet)) {
            $completionGateContractViolations += "$($check.RelativePath) must include '$requiredSnippet' to enforce completion gate contract."
        }
    }
}

$docImpactGateContractViolations = @()
$docImpactGateScriptChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1'
        Required = @('DOC_IMPACT_GATE_PASSED', 'DOC_IMPACT_GATE_FAILED', 'DOC_IMPACT_ASSESSED', 'DOC_IMPACT_ASSESSMENT_FAILED', 'doc-impact-gate', 'preflight_hash_sha256', 'docs_updated', 'changelog_updated')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/doc-impact-gate.ps1'
        Required = @('DOC_IMPACT_GATE_PASSED', 'DOC_IMPACT_GATE_FAILED', 'DOC_IMPACT_ASSESSED', 'DOC_IMPACT_ASSESSMENT_FAILED', 'doc-impact-gate', 'preflight_hash_sha256', 'docs_updated', 'changelog_updated')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh'
        Required = @('--decision', '--behavior-changed', '--changelog-updated', '--rationale', 'DOC_IMPACT_GATE_PASSED', 'DOC_IMPACT_GATE_FAILED', 'DOC_IMPACT_ASSESSED', 'DOC_IMPACT_ASSESSMENT_FAILED', 'doc-impact-gate', 'preflight_hash_sha256')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/doc-impact-gate.sh'
        Required = @('--decision', '--behavior-changed', '--changelog-updated', '--rationale', 'DOC_IMPACT_GATE_PASSED', 'DOC_IMPACT_GATE_FAILED', 'DOC_IMPACT_ASSESSED', 'DOC_IMPACT_ASSESSMENT_FAILED', 'doc-impact-gate', 'preflight_hash_sha256')
    }
)

foreach ($check in $docImpactGateScriptChecks) {
    $scriptPath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        continue
    }

    $scriptContent = Get-Content -LiteralPath $scriptPath -Raw
    foreach ($requiredSnippet in @($check.Required)) {
        if ($scriptContent -notmatch [regex]::Escape([string]$requiredSnippet)) {
            $docImpactGateContractViolations += "$($check.RelativePath) must include '$requiredSnippet' to enforce documentation-impact gate contract."
        }
    }
}

$terminalCleanupContractViolations = @()
$terminalCleanupScriptChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1'
        Required = @('TASK_DONE', 'TASK_BLOCKED', 'terminal_log_cleanup', 'compile-output')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.ps1'
        Required = @('TASK_DONE', 'TASK_BLOCKED', 'terminal_log_cleanup', 'compile-output')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh'
        Required = @('TASK_DONE', 'TASK_BLOCKED', 'terminal_log_cleanup', 'compile-output')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.sh'
        Required = @('TASK_DONE', 'TASK_BLOCKED', 'terminal_log_cleanup', 'compile-output')
    }
)

foreach ($check in $terminalCleanupScriptChecks) {
    $scriptPath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        continue
    }

    $scriptContent = Get-Content -LiteralPath $scriptPath -Raw
    foreach ($requiredSnippet in @($check.Required)) {
        if ($scriptContent -notmatch [regex]::Escape([string]$requiredSnippet)) {
            $terminalCleanupContractViolations += "$($check.RelativePath) must include '$requiredSnippet' to enforce terminal full-log cleanup."
        }
    }
}

$taskEventsSummaryContractViolations = @()
$taskEventsSummaryScriptChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/task-events-summary.ps1'
        Forbidden = @('Invoke-Expression')
        Required = @('TaskId', 'AsJson', 'IncludeDetails', 'runtime/task-events', 'Timeline:', 'source_path')
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/template/scripts/agent-gates/task-events-summary.sh'
        Forbidden = @('shell=True')
        Required = @('--task-id', '--as-json', '--include-details', 'runtime/task-events', 'Timeline:', 'source_path')
    }
)

foreach ($check in $taskEventsSummaryScriptChecks) {
    $scriptPath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        $taskEventsSummaryContractViolations += "$($check.RelativePath) missing."
        continue
    }

    $scriptContent = Get-Content -LiteralPath $scriptPath -Raw
    foreach ($forbiddenSnippet in @($check.Forbidden)) {
        if ($scriptContent -match [regex]::Escape([string]$forbiddenSnippet)) {
            $taskEventsSummaryContractViolations += "$($check.RelativePath) must not contain '$forbiddenSnippet'."
        }
    }
    foreach ($requiredSnippet in @($check.Required)) {
        if ($scriptContent -notmatch [regex]::Escape([string]$requiredSnippet)) {
            $taskEventsSummaryContractViolations += "$($check.RelativePath) must include '$requiredSnippet'."
        }
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

        $liveClaudeOrchestratorFullAccessRaw = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'ClaudeOrchestratorFullAccess'
        try {
            $liveClaudeOrchestratorFullAccess = Convert-ToBooleanAnswer -Value $liveClaudeOrchestratorFullAccessRaw -FieldName 'ClaudeOrchestratorFullAccess' -DefaultValue $false
            if ($liveClaudeOrchestratorFullAccess -ne $artifactClaudeOrchestratorFullAccess) {
                $versionContractViolations += "$liveVersionRelativePath ClaudeOrchestratorFullAccess '$liveClaudeOrchestratorFullAccess' must match init answers value '$artifactClaudeOrchestratorFullAccess'."
            }
        }
        catch {
            $versionContractViolations += $_.Exception.Message
        }

        $liveTokenEconomyEnabledRaw = Get-ObjectPropertyString -Object $liveVersionObject -PropertyName 'TokenEconomyEnabled'
        try {
            $liveTokenEconomyEnabled = Convert-ToBooleanAnswer -Value $liveTokenEconomyEnabledRaw -FieldName 'TokenEconomyEnabled' -DefaultValue $false
            if ($liveTokenEconomyEnabled -ne $artifactTokenEconomyEnabled) {
                $versionContractViolations += "$liveVersionRelativePath TokenEconomyEnabled '$liveTokenEconomyEnabled' must match init answers value '$artifactTokenEconomyEnabled'."
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
        if ($taskManagedBlock -notmatch [regex]::Escape('Do not force-add it to git unless the user explicitly asks to version orchestration control-plane files.')) {
            $taskContractViolations += 'TASK.md must explain that it should not be force-added to git.'
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

$claudeLocalSettingsViolations = @()
$claudeLocalSettingsPath = Join-Path $TargetRoot '.claude/settings.local.json'
if ($artifactClaudeOrchestratorFullAccess -and (Test-Path $claudeLocalSettingsPath)) {
    try {
        $claudeLocalSettings = Get-Content -Path $claudeLocalSettingsPath -Raw | ConvertFrom-Json -ErrorAction Stop
        $configuredAllowEntries = @()
        if ($null -ne $claudeLocalSettings.PSObject.Properties['permissions']) {
            $permissionsValue = $claudeLocalSettings.permissions
            if ($null -ne $permissionsValue -and $null -ne $permissionsValue.PSObject.Properties['allow']) {
                foreach ($item in @($permissionsValue.allow)) {
                    if ($null -eq $item) {
                        continue
                    }

                    $text = [string]$item
                    if ([string]::IsNullOrWhiteSpace($text)) {
                        continue
                    }

                    $configuredAllowEntries += $text.Trim()
                }
            }
        }

        $configuredAllowEntries = @($configuredAllowEntries | Sort-Object -Unique)
        $requiredClaudeAllowEntries = @(
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
        foreach ($requiredEntry in $requiredClaudeAllowEntries) {
            if ($configuredAllowEntries -notcontains $requiredEntry) {
                $claudeLocalSettingsViolations += ".claude/settings.local.json must include permissions.allow entry ``$requiredEntry``."
            }
        }
    }
    catch {
        $claudeLocalSettingsViolations += ".claude/settings.local.json is not valid JSON: $($_.Exception.Message)"
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

$commandsContractViolations = @()
$commandsRulePath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md'
if (Test-Path $commandsRulePath) {
    $commandsContent = Get-Content -Path $commandsRulePath -Raw
    $requiredCommandSnippets = @(
        '### Compile Gate (Mandatory)',
        'compile-gate.ps1',
        'compile-gate.sh',
        'build-scoped-diff.ps1',
        'build-scoped-diff.sh',
        'build-review-context.ps1',
        'build-review-context.sh',
        'task-events-summary.ps1',
        'task-events-summary.sh'
    )
    $commandContractMigrations = @(Get-RuleContractMigrationsForPath -RelativePath 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md')
    foreach ($migration in $commandContractMigrations) {
        foreach ($entry in @($migration.Entries)) {
            $matchSnippet = [string]$entry.Match
            if (-not [string]::IsNullOrWhiteSpace($matchSnippet)) {
                $requiredCommandSnippets += $matchSnippet
            }
        }
    }
    $requiredCommandSnippets = @($requiredCommandSnippets | Sort-Object -Unique)

    foreach ($snippet in $requiredCommandSnippets) {
        if ($commandsContent -notmatch [regex]::Escape($snippet)) {
            $commandsContractViolations += "40-commands.md must include gate contract snippet '$snippet'."
        }
    }

    $forbiddenCommandPlaceholders = @(
        '<install dependencies command>',
        '<local environment bootstrap command>',
        '<start backend command>',
        '<start frontend command>',
        '<start worker or background job command>',
        '<unit test command>',
        '<integration test command>',
        '<e2e test command>',
        '<lint command>',
        '<type-check command>',
        '<format check command>',
        '<compile command>',
        '<build command>',
        '<container or artifact packaging command>'
    )

    foreach ($placeholder in $forbiddenCommandPlaceholders) {
        if ($commandsContent -match [regex]::Escape($placeholder)) {
            $commandsContractViolations += "40-commands.md contains unresolved command placeholder: $placeholder"
        }
    }

    $expectedCommandBoundaryLine = 'Do not use `git add -f` for ignored orchestration control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`); their absence from staged diff is expected.'
    if ($commandsContent -notmatch [regex]::Escape($expectedCommandBoundaryLine)) {
        $commandsContractViolations += '40-commands.md must document ignored orchestration control-plane staging behavior.'
    }

    $compileSectionMatch = [regex]::Match(
        $commandsContent,
        '(?ms)^### Compile Gate \(Mandatory\)\s*```[^\r\n]*\r?\n(?<body>.*?)\r?\n```'
    )

    if (-not $compileSectionMatch.Success) {
        $commandsContractViolations += '40-commands.md must define a fenced command block under `### Compile Gate (Mandatory)`.'
    } else {
        $compileCommandLines = @(
            $compileSectionMatch.Groups['body'].Value -split "\r?\n" |
                ForEach-Object { $_.Trim() } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and -not $_.StartsWith('#') }
        )

        if ($compileCommandLines.Count -eq 0) {
            $commandsContractViolations += '40-commands.md compile gate section must contain at least one non-comment command.'
        } elseif ($compileCommandLines[0] -match '^\s*<[^>]+>\s*$') {
            $commandsContractViolations += "40-commands.md compile gate command is unresolved placeholder: $($compileCommandLines[0])"
        }
    }
}

$manifestContractViolations = @()
$manifestPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/MANIFEST.md'
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $manifestContent = Get-Content -LiteralPath $manifestPath -Raw
    foreach ($snippet in @('live/USAGE.md')) {
        if ($manifestContent -notmatch [regex]::Escape($snippet)) {
            $manifestContractViolations += "MANIFEST.md must include '$snippet'."
        }
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
    $hasFinalizationReminder = (
        ($coreContent -match [regex]::Escape('implementation summary')) -and
        ($coreContent -match [regex]::Escape('git commit -m "<message>"')) -and
        ($coreContent -match [regex]::Escape('Do you want me to commit now? (yes/no)')) -and
        ($coreContent -match [regex]::Escape('80-task-workflow.md'))
    )
    if (-not $hasFinalizationReminder) {
        $coreRuleContractViolations += '00-core.md must include finalization reminder line that points to mandatory completion report order.'
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

$orchestratorGitBoundaryRuleChecks = @(
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md'
        Required = @(
            'Every completed runtime behavior-change task requires an entry in `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`.',
            'this internal changelog is local orchestration evidence and may stay gitignored; update it on disk, but do not use `git add -f` unless the user explicitly asks to version orchestrator internals.'
        )
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md'
        Required = @(
            '## Orchestrator Git Boundary',
            'Their absence from `git status`, staged diff, or PR scope is normal and must not be treated as a workflow failure.'
        )
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md'
        Required = @(
            'Never use `git add -f` / `git add --force` to stage ignored orchestration files just to satisfy gates or documentation bookkeeping.',
            'If doc-impact or audit trail requires updates to ignored orchestrator files, write them on disk and continue without expanding the project commit scope unless the user explicitly asks for it.'
        )
    },
    [PSCustomObject]@{
        RelativePath = 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
        Required = @(
            'Required changelog or evidence updates to ignored orchestrator paths must stay local on disk; do not use `git add -f` unless the user explicitly requests versioning orchestrator internals.',
            'HARD STOP: do not force-stage ignored orchestration control-plane files just because gates, changelog, or reviews reference them.'
        )
    }
)

foreach ($check in $orchestratorGitBoundaryRuleChecks) {
    $rulePath = Join-Path $TargetRoot $check.RelativePath
    if (-not (Test-Path -LiteralPath $rulePath -PathType Leaf)) {
        continue
    }

    $content = Get-Content -Path $rulePath -Raw
    foreach ($snippet in @($check.Required)) {
        if ($content -notmatch [regex]::Escape([string]$snippet)) {
            $ruleFileViolations += "$($check.RelativePath) must include orchestrator git-boundary snippet '$snippet'."
        }
    }
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

    $expectedRedirectReadLine = "Hard stop: read ``$canonicalEntrypoint`` first and follow its routing links before responding to anything."
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectReadLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must include hard-stop instruction to read $canonicalEntrypoint before any response."
    }

    $expectedRedirectHardStopLine = "Hard stop: before any task execution, open ``TASK.md`` and ``$canonicalEntrypoint``."
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectHardStopLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must include hard-stop instruction for TASK.md + $canonicalEntrypoint."
    }

    $expectedRedirectGateLine = 'Do not implement tasks directly without orchestration preflight and required review gates.'
    if ($redirectContent -notmatch [regex]::Escape($expectedRedirectGateLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must include direct-implementation prohibition for orchestration gates."
    }

    $expectedIgnoredArtifactsLine = 'Ignored orchestration control-plane files (for example `TASK.md`, `Octopus-agent-orchestrator/runtime/**`, and `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) are expected local artifacts; never `git add -f` them unless the user explicitly asks to version orchestrator internals.'
    if ($redirectContent -notmatch [regex]::Escape($expectedIgnoredArtifactsLine)) {
        $entrypointContractViolations += "$redirectEntrypoint must explain ignored orchestration control-plane git boundary."
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

    $expectedIgnoredArtifactsLine = 'Ignored orchestration control-plane files (for example `TASK.md`, `Octopus-agent-orchestrator/runtime/**`, and `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) are expected local artifacts; never `git add -f` them unless the user explicitly asks to version orchestrator internals.'
    if ($profileContent -notmatch [regex]::Escape($expectedIgnoredArtifactsLine)) {
        $providerAgentContractViolations += "$($profile.RelativePath) must explain ignored orchestration control-plane git boundary."
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

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/config/output-filters.json')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference output filter config 'output-filters.json'."
    }

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/skills/**')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must allow specialist skills under 'Octopus-agent-orchestrator/live/skills/**'."
    }

    if ($profileContent -notmatch [regex]::Escape('log-task-event.ps1')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference task event logger 'log-task-event.ps1'."
    }

    if ($profileContent -notmatch [regex]::Escape('compile-gate.ps1')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference compile gate script 'compile-gate.ps1'."
    }

    if ($profileContent -notmatch [regex]::Escape('completion-gate.ps1')) {
        $providerAgentContractViolations += "$($profile.RelativePath) must reference completion gate script 'completion-gate.ps1'."
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

    $expectedIgnoredArtifactsLine = 'Ignored orchestration control-plane files (for example `TASK.md`, `Octopus-agent-orchestrator/runtime/**`, and `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) are expected local artifacts; never `git add -f` them unless the user explicitly asks to version orchestrator internals.'
    if ($profileContent -notmatch [regex]::Escape($expectedIgnoredArtifactsLine)) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must explain ignored orchestration control-plane git boundary."
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

    if ($profileContent -notmatch [regex]::Escape('Octopus-agent-orchestrator/live/config/output-filters.json')) {
        $githubSkillBridgeContractViolations += "$($profile.RelativePath) must reference output filter config 'output-filters.json'."
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

$initPromptContractViolations = @()
$initPromptPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md'
if (Test-Path -LiteralPath $initPromptPath -PathType Leaf) {
    $initPromptContent = Get-Content -Path $initPromptPath -Raw
    $requiredInitPromptSnippets = @(
        'ask (4th mandatory question): a localized equivalent of `Should the no-auto-commit guard be strengthened? (yes/no)`',
        'ask (5th mandatory question): a localized equivalent of `Give Claude full access to orchestrator files? (yes/no)`',
        'ask (6th mandatory question): a localized equivalent of `Enable token-economy mode by default? (yes/no)`',
        'Hard-stop rule: **if all 6 answers are not collected, do not run installation**.',
        '"ClaudeOrchestratorFullAccess": "<claude-orchestrator-full-access>"',
        '"TokenEconomyEnabled": "<token-economy-enabled>"',
        '`Already configured specialist skills`:',
        '`Available specialist skills to enable/create now`:',
        '`Recommendation for this project`:',
        'Do you want to add additional specialist skills now? (yes/no)',
        'still include the presented `already configured` list, `available` list, and recommendation in the report for traceability.'
    )

    foreach ($snippet in $requiredInitPromptSnippets) {
        if ($initPromptContent -notmatch [regex]::Escape($snippet)) {
            $initPromptContractViolations += "Missing specialist-skills init contract snippet in AGENT_INIT_PROMPT.md: $snippet"
        }
    }
}

$reviewerExecutionContractViolations = @()
$orchestrationSkillPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md'
if (Test-Path -LiteralPath $orchestrationSkillPath -PathType Leaf) {
    $orchestrationSkillContent = Get-Content -Path $orchestrationSkillPath -Raw
    $requiredSkillSnippets = @(
        'compile-gate.ps1 -TaskId "<task-id>" -CommandsPath "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"',
        'COMPILE_GATE_PASSED',
        'build-review-context.ps1 -ReviewType "<review-type>" -Depth "<1|2|3>"',
        'build-scoped-diff.ps1 -ReviewType "<db|security|refactor>"',
        'review artifact write path: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>.md`.',
        'required-reviews-check.ps1 -PreflightPath "<path>" -TaskId "<task-id>"',
        'doc-impact-gate.ps1 -PreflightPath "<path>" -TaskId "<task-id>"',
        'completion-gate.ps1 -PreflightPath "<path>" -TaskId "<task-id>"',
        'bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"',
        'runtime/reviews/<task-id>-review-gate.json',
        'runtime/reviews/<task-id>-doc-impact.json',
        'DOC_IMPACT_ASSESSED',
        '-CodeReviewVerdict "<...>"',
        '-DbReviewVerdict "<...>"',
        '-SecurityReviewVerdict "<...>"',
        '-RefactorReviewVerdict "<...>"',
        '-ApiReviewVerdict "<...>"',
        '-TestReviewVerdict "<...>"',
        '-PerformanceReviewVerdict "<...>"',
        '-InfraReviewVerdict "<...>"',
        '-DependencyReviewVerdict "<...>"',
        'COMPLETION_GATE_PASSED',
        'single-agent fallback mode (no Agent tool)',
        'use `enabled=true` with `depth=1` only for small, well-localized tasks',
        'Optional timeline summary for final report: `task-events-summary.ps1` / `.sh` output.',
        'do not `git add -f` them unless the user explicitly asks to version orchestrator internals.'
    )

    foreach ($snippet in $requiredSkillSnippets) {
        if ($orchestrationSkillContent -notmatch [regex]::Escape($snippet)) {
            $reviewerExecutionContractViolations += "Missing reviewer execution contract snippet in live/skills/orchestration/SKILL.md: $snippet"
        }
    }

    $requiredAnyOfSnippetGroups = @(
        @(
            '## Reviewer Agent Execution (Claude Code)',
            '## Reviewer Agent Execution (Platform-Agnostic)'
        ),
        @(
            'Launch reviewer via Agent tool using clean context (`fork_context=false`).',
            'Launch reviewer using the platform mapping above with clean context isolation.'
        )
    )

    foreach ($snippetGroup in $requiredAnyOfSnippetGroups) {
        $groupMatched = $false
        foreach ($candidateSnippet in $snippetGroup) {
            if ($orchestrationSkillContent -match [regex]::Escape([string]$candidateSnippet)) {
                $groupMatched = $true
                break
            }
        }

        if (-not $groupMatched) {
            $joinedCandidates = ($snippetGroup | ForEach-Object { [string]$_ }) -join ' || '
            $reviewerExecutionContractViolations += "Missing reviewer execution contract snippet group in live/skills/orchestration/SKILL.md: $joinedCandidates"
        }
    }
}

$taskWorkflowRulePath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
if (Test-Path -LiteralPath $taskWorkflowRulePath -PathType Leaf) {
    $taskWorkflowRuleContent = Get-Content -Path $taskWorkflowRulePath -Raw
    $requiredWorkflowSnippets = @()
    $workflowContractMigrations = @(Get-RuleContractMigrationsForPath -RelativePath 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md')
    foreach ($migration in $workflowContractMigrations) {
        foreach ($entry in @($migration.Entries)) {
            $matchSnippet = [string]$entry.Match
            if (-not [string]::IsNullOrWhiteSpace($matchSnippet)) {
                $requiredWorkflowSnippets += $matchSnippet
            }
        }
    }
    $requiredWorkflowSnippets = @($requiredWorkflowSnippets | Sort-Object -Unique)

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
Write-Output "ClaudeOrchestratorFullAccess: $artifactClaudeOrchestratorFullAccess"
Write-Output "TokenEconomyEnabled: $artifactTokenEconomyEnabled"
Write-Output "CanonicalEntrypoint: $canonicalEntrypoint"
Write-Output "RequiredPathsChecked: $($requiredPaths.Count)"
Write-Output "MissingPathCount: $($missingPaths.Count)"
Write-Output "ReviewCapabilitiesContractViolationCount: $($reviewCapabilitiesContractViolations.Count)"
Write-Output "PathsContractViolationCount: $($pathsContractViolations.Count)"
Write-Output "TokenEconomyContractViolationCount: $($tokenEconomyContractViolations.Count)"
Write-Output "OutputFiltersContractViolationCount: $($outputFiltersContractViolations.Count)"
Write-Output "CompileGateContractViolationCount: $($compileGateContractViolations.Count)"
Write-Output "CompletionGateContractViolationCount: $($completionGateContractViolations.Count)"
Write-Output "DocImpactGateContractViolationCount: $($docImpactGateContractViolations.Count)"
Write-Output "TerminalCleanupContractViolationCount: $($terminalCleanupContractViolations.Count)"
Write-Output "TaskEventsSummaryContractViolationCount: $($taskEventsSummaryContractViolations.Count)"
Write-Output "BundleVersion: $bundleVersion"
Write-Output "VersionContractViolationCount: $($versionContractViolations.Count)"
Write-Output "ManagedFilesChecked: $($strictManagedFiles.Count + 1 + $entrypointFiles.Count)"
Write-Output "StyleViolationCount: $($styleViolations.Count)"
Write-Output "TaskContractViolationCount: $($taskContractViolations.Count)"
Write-Output "QwenSettingsViolationCount: $($qwenSettingsViolations.Count)"
Write-Output "ClaudeLocalSettingsViolationCount: $($claudeLocalSettingsViolations.Count)"
Write-Output "RuleFileViolationCount: $($ruleFileViolations.Count)"
Write-Output "TemplatePlaceholderViolationCount: $($templatePlaceholderViolations.Count)"
Write-Output "CommandsContractViolationCount: $($commandsContractViolations.Count)"
Write-Output "ManifestContractViolationCount: $($manifestContractViolations.Count)"
Write-Output "InitAnswersContractViolationCount: $($initAnswersContractViolations.Count)"
Write-Output "CoreRuleContractViolationCount: $($coreRuleContractViolations.Count)"
Write-Output "EntrypointContractViolationCount: $($entrypointContractViolations.Count)"
Write-Output "ProviderAgentContractViolationCount: $($providerAgentContractViolations.Count)"
Write-Output "GitHubSkillBridgeContractViolationCount: $($githubSkillBridgeContractViolations.Count)"
Write-Output "CopilotInstructionContractViolationCount: $($copilotInstructionContractViolations.Count)"
Write-Output "CommitGuardContractViolationCount: $($commitGuardContractViolations.Count)"
Write-Output "InitPromptContractViolationCount: $($initPromptContractViolations.Count)"
Write-Output "ReviewerExecutionContractViolationCount: $($reviewerExecutionContractViolations.Count)"
Write-Output "GitignoreMissingCount: $($gitignoreMissing.Count)"

if ($missingPaths.Count -gt 0) {
    Write-Output 'MissingPaths:'
    foreach ($item in $missingPaths) {
        Write-Output " - $item"
    }
}

if ($reviewCapabilitiesContractViolations.Count -gt 0) {
    Write-Output 'ReviewCapabilitiesContractViolations:'
    foreach ($item in $reviewCapabilitiesContractViolations) {
        Write-Output " - $item"
    }
}

if ($pathsContractViolations.Count -gt 0) {
    Write-Output 'PathsContractViolations:'
    foreach ($item in $pathsContractViolations) {
        Write-Output " - $item"
    }
}

if ($tokenEconomyContractViolations.Count -gt 0) {
    Write-Output 'TokenEconomyContractViolations:'
    foreach ($item in $tokenEconomyContractViolations) {
        Write-Output " - $item"
    }
}

if ($outputFiltersContractViolations.Count -gt 0) {
    Write-Output 'OutputFiltersContractViolations:'
    foreach ($item in $outputFiltersContractViolations) {
        Write-Output " - $item"
    }
}

if ($compileGateContractViolations.Count -gt 0) {
    Write-Output 'CompileGateContractViolations:'
    foreach ($item in $compileGateContractViolations) {
        Write-Output " - $item"
    }
}

if ($completionGateContractViolations.Count -gt 0) {
    Write-Output 'CompletionGateContractViolations:'
    foreach ($item in $completionGateContractViolations) {
        Write-Output " - $item"
    }
}

if ($docImpactGateContractViolations.Count -gt 0) {
    Write-Output 'DocImpactGateContractViolations:'
    foreach ($item in $docImpactGateContractViolations) {
        Write-Output " - $item"
    }
}

if ($terminalCleanupContractViolations.Count -gt 0) {
    Write-Output 'TerminalCleanupContractViolations:'
    foreach ($item in $terminalCleanupContractViolations) {
        Write-Output " - $item"
    }
}

if ($taskEventsSummaryContractViolations.Count -gt 0) {
    Write-Output 'TaskEventsSummaryContractViolations:'
    foreach ($item in $taskEventsSummaryContractViolations) {
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

if ($claudeLocalSettingsViolations.Count -gt 0) {
    Write-Output 'ClaudeLocalSettingsViolations:'
    foreach ($item in $claudeLocalSettingsViolations) {
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

if ($commandsContractViolations.Count -gt 0) {
    Write-Output 'CommandsContractViolations:'
    foreach ($item in $commandsContractViolations) {
        Write-Output " - $item"
    }
}

if ($manifestContractViolations.Count -gt 0) {
    Write-Output 'ManifestContractViolations:'
    foreach ($item in $manifestContractViolations) {
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

if ($initPromptContractViolations.Count -gt 0) {
    Write-Output 'InitPromptContractViolations:'
    foreach ($item in $initPromptContractViolations) {
        Write-Output " - $item"
    }
}

if ($reviewerExecutionContractViolations.Count -gt 0) {
    Write-Output 'ReviewerExecutionContractViolations:'
    foreach ($item in $reviewerExecutionContractViolations) {
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
    $reviewCapabilitiesContractViolations.Count -gt 0 -or
    $pathsContractViolations.Count -gt 0 -or
    $tokenEconomyContractViolations.Count -gt 0 -or
    $outputFiltersContractViolations.Count -gt 0 -or
    $compileGateContractViolations.Count -gt 0 -or
    $completionGateContractViolations.Count -gt 0 -or
    $docImpactGateContractViolations.Count -gt 0 -or
    $terminalCleanupContractViolations.Count -gt 0 -or
    $taskEventsSummaryContractViolations.Count -gt 0 -or
    $versionContractViolations.Count -gt 0 -or
    $styleViolations.Count -gt 0 -or
    $taskContractViolations.Count -gt 0 -or
    $qwenSettingsViolations.Count -gt 0 -or
    $claudeLocalSettingsViolations.Count -gt 0 -or
    $ruleFileViolations.Count -gt 0 -or
    $templatePlaceholderViolations.Count -gt 0 -or
    $commandsContractViolations.Count -gt 0 -or
    $manifestContractViolations.Count -gt 0 -or
    $initAnswersContractViolations.Count -gt 0 -or
    $coreRuleContractViolations.Count -gt 0 -or
    $entrypointContractViolations.Count -gt 0 -or
    $providerAgentContractViolations.Count -gt 0 -or
    $githubSkillBridgeContractViolations.Count -gt 0 -or
    $copilotInstructionContractViolations.Count -gt 0 -or
    $commitGuardContractViolations.Count -gt 0 -or
    $initPromptContractViolations.Count -gt 0 -or
    $reviewerExecutionContractViolations.Count -gt 0 -or
    $gitignoreMissing.Count -gt 0
) {
    throw 'Verification failed. Resolve listed issues and rerun.'
}

Write-Output 'Verification: PASS'
