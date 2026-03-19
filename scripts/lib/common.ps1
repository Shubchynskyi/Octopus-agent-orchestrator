<#
.SYNOPSIS
    Shared utility functions for Octopus Agent Orchestrator control-plane scripts.
.DESCRIPTION
    Dot-source this file at the top of each control-plane script to avoid
    duplicating path-resolution, boolean-parsing, and entrypoint-map logic.
#>

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
        [AllowNull()]
        [object]$DefaultValue = $null
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        if ($null -eq $DefaultValue) {
            throw "$FieldName must not be empty."
        }
        return [bool]$DefaultValue
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

function Get-AllowedCollectedViaValues {
    return @(
        'AGENT_INIT_PROMPT.md',
        'CLI_INTERACTIVE',
        'CLI_NONINTERACTIVE'
    )
}

function Convert-ToCollectedViaAnswer {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [string]$FieldName
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$FieldName must not be empty."
    }

    foreach ($allowedValue in Get-AllowedCollectedViaValues) {
        if ([string]::Equals($Value.Trim(), $allowedValue, [System.StringComparison]::OrdinalIgnoreCase)) {
            return [string]$allowedValue
        }
    }

    throw "$FieldName has unsupported value '$Value'. Allowed values: $((Get-AllowedCollectedViaValues) -join ', ')."
}

function Get-SourceToEntrypointMap {
    return @{
        'CLAUDE'        = 'CLAUDE.md'
        'CODEX'         = 'AGENTS.md'
        'GEMINI'        = 'GEMINI.md'
        'GITHUBCOPILOT' = '.github/copilot-instructions.md'
        'WINDSURF'      = '.windsurf/rules/rules.md'
        'JUNIE'         = '.junie/guidelines.md'
        'ANTIGRAVITY'   = '.antigravity/rules.md'
    }
}

function Get-AllAgentEntrypointFiles {
    return @(
        'CLAUDE.md',
        'AGENTS.md',
        'GEMINI.md',
        '.github/copilot-instructions.md',
        '.windsurf/rules/rules.md',
        '.junie/guidelines.md',
        '.antigravity/rules.md'
    )
}

function Convert-ToCanonicalEntrypointFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceOfTruth
    )

    $sourceToEntrypoint = Get-SourceToEntrypointMap
    $sourceKey = $SourceOfTruth.Trim().ToUpperInvariant().Replace(' ', '')
    if (-not $sourceToEntrypoint.ContainsKey($sourceKey)) {
        throw "Unsupported SourceOfTruth value '$SourceOfTruth'."
    }

    return [string]$sourceToEntrypoint[$sourceKey]
}

function Normalize-AgentEntrypointToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Token
    )

    $trimmed = $Token.Trim()
    $trimmed = [regex]::Replace($trimmed, '^(?i:or)\s+', '')
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $null
    }

    [int]$selectionNumber = 0
    if ([int]::TryParse($trimmed, [ref]$selectionNumber)) {
        $allowedValues = @(Get-AllAgentEntrypointFiles)
        if ($selectionNumber -lt 1 -or $selectionNumber -gt $allowedValues.Count) {
            throw "Unsupported ActiveAgentFiles selection '$Token'. Choose a number from 1 to $($allowedValues.Count), or use one of: $($allowedValues -join ', ')."
        }

        return $allowedValues[$selectionNumber - 1]
    }

    $normalizedToken = $trimmed.ToLowerInvariant().Replace('\', '/')
    switch ($normalizedToken) {
        'claude' { return 'CLAUDE.md' }
        'claude.md' { return 'CLAUDE.md' }
        'codex' { return 'AGENTS.md' }
        'agents' { return 'AGENTS.md' }
        'agents.md' { return 'AGENTS.md' }
        'gemini' { return 'GEMINI.md' }
        'gemini.md' { return 'GEMINI.md' }
        'githubcopilot' { return '.github/copilot-instructions.md' }
        'copilot' { return '.github/copilot-instructions.md' }
        '.github/copilot-instructions.md' { return '.github/copilot-instructions.md' }
        'windsurf' { return '.windsurf/rules/rules.md' }
        '.windsurf/rules/rules.md' { return '.windsurf/rules/rules.md' }
        'junie' { return '.junie/guidelines.md' }
        '.junie/guidelines.md' { return '.junie/guidelines.md' }
        'antigravity' { return '.antigravity/rules.md' }
        '.antigravity/rules.md' { return '.antigravity/rules.md' }
        default {
            foreach ($allowedValue in Get-AllAgentEntrypointFiles) {
                if ([string]::Equals($trimmed, $allowedValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return $allowedValue
                }
            }
        }
    }

    throw "Unsupported ActiveAgentFiles entry '$Token'. Allowed values: $((Get-AllAgentEntrypointFiles) -join ', '). You may also use provider aliases such as Claude, Codex, Gemini, Copilot, Windsurf, Junie, or Antigravity."
}

function Get-ActiveAgentEntrypointFiles {
    param(
        [AllowNull()]
        [string]$Value,
        [AllowNull()]
        [string]$SourceOfTruthValue
    )

    $selectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        foreach ($token in ($Value -split '[,;]')) {
            $normalizedToken = Normalize-AgentEntrypointToken -Token $token
            if (-not [string]::IsNullOrWhiteSpace($normalizedToken)) {
                [void]$selectedFiles.Add($normalizedToken)
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($SourceOfTruthValue)) {
        [void]$selectedFiles.Add((Convert-ToCanonicalEntrypointFile -SourceOfTruth $SourceOfTruthValue))
    }

    $ordered = @()
    foreach ($allowedValue in Get-AllAgentEntrypointFiles) {
        if ($selectedFiles.Contains($allowedValue)) {
            $ordered += $allowedValue
        }
    }

    return @($ordered)
}

function Convert-ActiveAgentEntrypointFilesToString {
    param(
        [AllowNull()]
        [string[]]$ActiveEntrypointFiles
    )

    $normalized = @()
    foreach ($entry in @($ActiveEntrypointFiles)) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $normalized += (Normalize-AgentEntrypointToken -Token $entry)
    }

    $ordered = @()
    $selectedSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $normalized) {
        [void]$selectedSet.Add($entry)
    }

    foreach ($allowedValue in Get-AllAgentEntrypointFiles) {
        if ($selectedSet.Contains($allowedValue)) {
            $ordered += $allowedValue
        }
    }

    if ($ordered.Count -eq 0) {
        return $null
    }

    return ($ordered -join ', ')
}

function Get-ProviderOrchestratorProfileDefinitions {
    return @(
        [PSCustomObject]@{
            EntrypointFile         = '.github/copilot-instructions.md'
            ProviderLabel          = 'GitHub Copilot'
            OrchestratorRelativePath = '.github/agents/orchestrator.md'
            GitignoreEntries       = @('.github/agents/', '.github/copilot-instructions.md')
        },
        [PSCustomObject]@{
            EntrypointFile         = '.windsurf/rules/rules.md'
            ProviderLabel          = 'Windsurf'
            OrchestratorRelativePath = '.windsurf/agents/orchestrator.md'
            GitignoreEntries       = @('.windsurf/', '.windsurf/rules/rules.md')
        },
        [PSCustomObject]@{
            EntrypointFile         = '.junie/guidelines.md'
            ProviderLabel          = 'Junie'
            OrchestratorRelativePath = '.junie/agents/orchestrator.md'
            GitignoreEntries       = @('.junie/', '.junie/guidelines.md')
        },
        [PSCustomObject]@{
            EntrypointFile         = '.antigravity/rules.md'
            ProviderLabel          = 'Antigravity'
            OrchestratorRelativePath = '.antigravity/agents/orchestrator.md'
            GitignoreEntries       = @('.antigravity/', '.antigravity/rules.md')
        }
    )
}

function Get-GitHubSkillBridgeProfileDefinitions {
    return @(
        [PSCustomObject]@{
            RelativePath      = '.github/agents/reviewer.md'
            ProfileTitle      = 'Reviewer Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md'
            ReviewRequirement = 'Use preflight `required_reviews.*` flags from orchestrator.'
            CapabilityFlag    = 'always-on'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/code-review.md'
            ProfileTitle      = 'Code Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
            ReviewRequirement = 'required_reviews.code=true'
            CapabilityFlag    = 'always-on'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/db-review.md'
            ProfileTitle      = 'DB Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/db-review/SKILL.md'
            ReviewRequirement = 'required_reviews.db=true'
            CapabilityFlag    = 'always-on'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/security-review.md'
            ProfileTitle      = 'Security Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md'
            ReviewRequirement = 'required_reviews.security=true'
            CapabilityFlag    = 'always-on'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/refactor-review.md'
            ProfileTitle      = 'Refactor Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md'
            ReviewRequirement = 'required_reviews.refactor=true'
            CapabilityFlag    = 'always-on'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/api-review.md'
            ProfileTitle      = 'API Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/api-review/SKILL.md'
            ReviewRequirement = 'required_reviews.api=true'
            CapabilityFlag    = 'review-capabilities.api=true'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/test-review.md'
            ProfileTitle      = 'Test Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/test-review/SKILL.md'
            ReviewRequirement = 'required_reviews.test=true'
            CapabilityFlag    = 'review-capabilities.test=true'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/performance-review.md'
            ProfileTitle      = 'Performance Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/performance-review/SKILL.md'
            ReviewRequirement = 'required_reviews.performance=true'
            CapabilityFlag    = 'review-capabilities.performance=true'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/infra-review.md'
            ProfileTitle      = 'Infra Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/infra-review/SKILL.md'
            ReviewRequirement = 'required_reviews.infra=true'
            CapabilityFlag    = 'review-capabilities.infra=true'
        },
        [PSCustomObject]@{
            RelativePath      = '.github/agents/dependency-review.md'
            ProfileTitle      = 'Dependency Review Bridge'
            SkillPath         = 'Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md'
            ReviewRequirement = 'required_reviews.dependency=true'
            CapabilityFlag    = 'review-capabilities.dependency=true'
        }
    )
}
