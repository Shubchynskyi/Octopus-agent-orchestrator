[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency')]
    [string]$ReviewType,
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 3)]
    [int]$Depth,
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TokenEconomyConfigPath = 'Octopus-agent-orchestrator/live/config/token-economy.json',
    [string]$ScopedDiffMetadataPath = '',
    [string]$OutputPath = '',
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

$gateUtilsModulePath = Join-Path $PSScriptRoot 'lib/gate-utils.psm1'
if (-not (Test-Path -LiteralPath $gateUtilsModulePath)) {
    throw "Missing gate utils module: $gateUtilsModulePath"
}
Import-Module -Name $gateUtilsModulePath -Force -DisableNameChecking

function Resolve-ProjectRoot {
    return Get-GateProjectRoot -ScriptRoot $PSScriptRoot
}

function Normalize-Path {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue
}

function Resolve-PathInsideRepo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [switch]$AllowMissing,
        [switch]$AllowEmpty
    )

    return Resolve-GatePathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath -AllowMissing:$AllowMissing -AllowEmpty:$AllowEmpty
}

function Ensure-ParentDirectory {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return
    }

    $parentDirectory = Split-Path -Parent $PathValue
    if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
        New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
    }
}

function Get-ObjectPropertyValue {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($PropertyName)) {
            return $Object[$PropertyName]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value -TrimValues
}

function Convert-ToIntArray {
    param([object]$Value)

    $result = @()
    foreach ($item in @(Get-ObjectPropertyValue -Object @{ value = $Value } -PropertyName 'value')) {
        if ($item -is [string]) {
            $parsed = 0
            if ([int]::TryParse($item.Trim(), [ref]$parsed)) {
                $result += $parsed
            }
            continue
        }

        if ($item -is [int] -or $item -is [long] -or $item -is [short] -or $item -is [byte]) {
            $result += [int]$item
        }
    }

    return @($result | Sort-Object -Unique)
}

function Convert-ToBoolean {
    param(
        [AllowNull()]
        [object]$Value,
        [bool]$DefaultValue = $false
    )

    if ($null -eq $Value) {
        return [bool]$DefaultValue
    }

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    $normalized = [string]$Value
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return [bool]$DefaultValue
    }

    switch ($normalized.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'y' { return $true }
        'on' { return $true }
        '0' { return $false }
        'false' { return $false }
        'no' { return $false }
        'n' { return $false }
        'off' { return $false }
        default { return [bool]$DefaultValue }
    }
}

function Get-ReviewRulePack {
    param([string]$ReviewTypeValue)

    switch ($ReviewTypeValue) {
        'code' {
            return [ordered]@{
                full = @('00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md')
                depth1 = @('00-core.md', '80-task-workflow.md')
                depth2 = @('00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md')
            }
        }
        'db' {
            return [ordered]@{
                full = @('00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md')
                depth1 = @('00-core.md', '80-task-workflow.md')
                depth2 = @('00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md')
            }
        }
        'security' {
            return [ordered]@{
                full = @('00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md')
                depth1 = @('00-core.md', '80-task-workflow.md')
                depth2 = @('00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md')
            }
        }
        'refactor' {
            return [ordered]@{
                full = @('00-core.md', '30-code-style.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '80-task-workflow.md')
                depth1 = @('00-core.md', '80-task-workflow.md')
                depth2 = @('00-core.md', '30-code-style.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '80-task-workflow.md')
            }
        }
        default {
            return [ordered]@{
                full = @('00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md')
                depth1 = @('00-core.md', '80-task-workflow.md')
                depth2 = @('00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md')
            }
        }
    }
}

function Resolve-ScopedDiffMetadataPath {
    param(
        [string]$ExplicitMetadataPath,
        [string]$ResolvedPreflightPath,
        [string]$ReviewTypeValue,
        [string]$RepoRootPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitMetadataPath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitMetadataPath -RepoRootPath $RepoRootPath -AllowMissing
    }

    $preflightDirectory = Split-Path -Parent $ResolvedPreflightPath
    $preflightName = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedPreflightPath)
    $baseName = [regex]::Replace($preflightName, '-preflight$', '')
    return Join-Path $preflightDirectory "$baseName-$ReviewTypeValue-scoped.json"
}

function Resolve-OutputPath {
    param(
        [string]$ExplicitOutputPath,
        [string]$ResolvedPreflightPath,
        [string]$ReviewTypeValue,
        [string]$RepoRootPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitOutputPath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitOutputPath -RepoRootPath $RepoRootPath -AllowMissing
    }

    $preflightDirectory = Split-Path -Parent $ResolvedPreflightPath
    $preflightName = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedPreflightPath)
    $baseName = [regex]::Replace($preflightName, '-preflight$', '')
    return Join-Path $preflightDirectory "$baseName-$ReviewTypeValue-context.json"
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$resolvedPreflightPath = Resolve-PathInsideRepo -PathValue $PreflightPath -RepoRootPath $RepoRoot
$resolvedTokenEconomyConfigPath = Resolve-PathInsideRepo -PathValue $TokenEconomyConfigPath -RepoRootPath $RepoRoot -AllowMissing
$resolvedScopedDiffMetadataPath = Resolve-ScopedDiffMetadataPath -ExplicitMetadataPath $ScopedDiffMetadataPath -ResolvedPreflightPath $resolvedPreflightPath -ReviewTypeValue $ReviewType -RepoRootPath $RepoRoot
$resolvedOutputPath = Resolve-OutputPath -ExplicitOutputPath $OutputPath -ResolvedPreflightPath $resolvedPreflightPath -ReviewTypeValue $ReviewType -RepoRootPath $RepoRoot

$preflight = Get-Content -LiteralPath $resolvedPreflightPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
$tokenEconomyConfig = $null
if (-not [string]::IsNullOrWhiteSpace($resolvedTokenEconomyConfigPath) -and (Test-Path -LiteralPath $resolvedTokenEconomyConfigPath -PathType Leaf)) {
    $tokenEconomyConfig = Get-Content -LiteralPath $resolvedTokenEconomyConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
}

$tokenEconomyEnabled = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'enabled')
$enabledDepths = Convert-ToIntArray -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'enabled_depths')
$tokenEconomyActive = $tokenEconomyEnabled -and ($enabledDepths -contains $Depth)

$rulePack = Get-ReviewRulePack -ReviewTypeValue $ReviewType
$fullRuleFiles = @($rulePack.full)
$selectedRuleFiles = if (-not $tokenEconomyActive -or $Depth -ge 3) {
    @($fullRuleFiles)
} elseif ($Depth -eq 1) {
    @($rulePack.depth1)
} else {
    @($rulePack.depth2)
}

$omittedRuleFiles = @($fullRuleFiles | Where-Object { $selectedRuleFiles -notcontains $_ })
$fullRulePaths = @($fullRuleFiles | ForEach-Object { "Octopus-agent-orchestrator/live/docs/agent-rules/$_" })
$selectedRulePaths = @($selectedRuleFiles | ForEach-Object { "Octopus-agent-orchestrator/live/docs/agent-rules/$_" })
$omittedRulePaths = @($omittedRuleFiles | ForEach-Object { "Octopus-agent-orchestrator/live/docs/agent-rules/$_" })
$rulePackOmissionReason = if ($omittedRulePaths.Count -gt 0) { 'deferred_by_depth' } else { 'none' }

$requiredReviews = Get-ObjectPropertyValue -Object $preflight -PropertyName 'required_reviews'
$requiredReviewFlag = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $requiredReviews -PropertyName $ReviewType)

$scopedDiffExpected = $tokenEconomyActive -and $ReviewType -in @('db', 'security') -and (Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'scoped_diffs'))
$scopedDiffMetadata = $null
if (-not [string]::IsNullOrWhiteSpace($resolvedScopedDiffMetadataPath) -and (Test-Path -LiteralPath $resolvedScopedDiffMetadataPath -PathType Leaf)) {
    try {
        $scopedDiffMetadata = Get-Content -LiteralPath $resolvedScopedDiffMetadataPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        $scopedDiffMetadata = [ordered]@{
            metadata_path = Normalize-Path $resolvedScopedDiffMetadataPath
            parse_error = $_.Exception.Message
        }
    }
}

$omittedSections = @()
if ($tokenEconomyActive -and $Depth -eq 1) {
    $omittedSections += [ordered]@{
        section = 'rule_pack'
        reason = 'deferred_by_depth'
        details = 'Only minimal reviewer rule context is selected at depth=1.'
    }
}
if ($tokenEconomyActive -and (Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'strip_examples'))) {
    $omittedSections += [ordered]@{
        section = 'examples'
        reason = 'token_economy_strip_examples'
        details = 'Examples may be omitted from reviewer context.'
    }
}
if ($tokenEconomyActive -and (Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'strip_code_blocks'))) {
    $omittedSections += [ordered]@{
        section = 'code_blocks'
        reason = 'token_economy_strip_code_blocks'
        details = 'Code blocks may be omitted from reviewer context.'
    }
}

$tokenEconomyFlags = [ordered]@{
    enabled = [bool]$tokenEconomyEnabled
    enabled_depths = $enabledDepths
    strip_examples = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'strip_examples')
    strip_code_blocks = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'strip_code_blocks')
    scoped_diffs = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'scoped_diffs')
    compact_reviewer_output = Convert-ToBoolean -Value (Get-ObjectPropertyValue -Object $tokenEconomyConfig -PropertyName 'compact_reviewer_output')
}
$tokenEconomyOmissionReason = if ($omittedSections.Count -gt 0 -or $omittedRulePaths.Count -gt 0) { 'token_economy_compaction' } else { 'none' }
$compatibilityInfo = [ordered]@{
    note = 'Use nested rule_pack.* and token_economy.* fields. Legacy top-level duplicates were removed in schema_version=2.'
    legacy_top_level_fields_removed = [ordered]@{
        selected_rule_files = 'rule_pack.selected_rule_files'
        selected_rule_count = 'rule_pack.selected_rule_count'
        full_rule_pack_files = 'rule_pack.full_rule_pack_files'
        omitted_rule_files = 'rule_pack.omitted_rule_files'
        omitted_rule_count = 'rule_pack.omitted_rule_count'
        omission_reason = 'rule_pack.omission_reason'
        token_economy_flags = 'token_economy.flags'
        omitted_sections = 'token_economy.omitted_sections'
        omitted_sections_count = 'token_economy.omitted_sections_count'
    }
}

$result = [ordered]@{
    schema_version = 2
    review_type = $ReviewType
    depth = $Depth
    token_economy_active = [bool]$tokenEconomyActive
    required_review = [bool]$requiredReviewFlag
    preflight_path = Normalize-Path $resolvedPreflightPath
    output_path = Normalize-Path $resolvedOutputPath
    token_economy_config_path = Normalize-Path $resolvedTokenEconomyConfigPath
    compatibility = $compatibilityInfo
    rule_pack = [ordered]@{
        selected_rule_files = $selectedRulePaths
        selected_rule_count = $selectedRulePaths.Count
        full_rule_pack_files = $fullRulePaths
        omitted_rule_files = $omittedRulePaths
        omitted_rule_count = $omittedRulePaths.Count
        omission_reason = $rulePackOmissionReason
    }
    token_economy = [ordered]@{
        active = [bool]$tokenEconomyActive
        flags = $tokenEconomyFlags
        omitted_sections = $omittedSections
        omitted_sections_count = $omittedSections.Count
        omission_reason = $tokenEconomyOmissionReason
    }
    scoped_diff = [ordered]@{
        expected = [bool]$scopedDiffExpected
        metadata_path = Normalize-Path $resolvedScopedDiffMetadataPath
        metadata = $scopedDiffMetadata
    }
}

Ensure-ParentDirectory -PathValue $resolvedOutputPath
Set-Content -LiteralPath $resolvedOutputPath -Value ($result | ConvertTo-Json -Depth 16)

Write-Output 'REVIEW_CONTEXT_READY'
Write-Output "ReviewType: $ReviewType"
Write-Output "Depth: $Depth"
Write-Output "TokenEconomyActive: $($tokenEconomyActive.ToString().ToLowerInvariant())"
Write-Output "OmittedRuleCount: $($omittedRulePaths.Count)"
Write-Output "OutputPath: $(Normalize-Path $resolvedOutputPath)"
Write-Output ($result | ConvertTo-Json -Depth 16)
