[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [ValidateSet('NO_DOC_UPDATES', 'DOCS_UPDATED')]
    [string]$Decision = 'NO_DOC_UPDATES',
    [bool]$BehaviorChanged = $false,
    [string[]]$DocsUpdated = @(),
    [bool]$ChangelogUpdated = $false,
    [bool]$SensitiveScopeReviewed = $false,
    [string]$Rationale = '',
    [string]$ArtifactPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
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

if ([string]::IsNullOrWhiteSpace($MetricsPath)) {
    $MetricsPath = Join-Path (Resolve-ProjectRoot) 'Octopus-agent-orchestrator/runtime/metrics.jsonl'
}

function Normalize-Path {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue
}

function Assert-ValidTaskId {
    param([string]$Value)

    Assert-GateTaskId -Value $Value
}

function Get-FileSha256 {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue) -or -not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        return $null
    }

    return (Get-FileHash -Path $PathValue -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value -TrimValues
}

function Append-MetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject
    )

    Add-GateMetricsEvent -Path $Path -EventObject $EventObject -EmitMetrics $EmitMetrics
}

function Append-TaskEvent {
    param(
        [string]$RepoRootPath,
        [string]$TaskIdValue,
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null
    )

    Add-GateTaskEvent -RepoRootPath $RepoRootPath -TaskId $TaskIdValue -EventType $EventType -Outcome $Outcome -Message $Message -Details $Details
}

function Get-ValidatedPreflightContext {
    param(
        [string]$PreflightPathValue,
        [string]$ExplicitTaskId
    )

    if (-not (Test-Path -LiteralPath $PreflightPathValue -PathType Leaf)) {
        throw "Preflight artifact not found: $PreflightPathValue"
    }

    $preflightObject = $null
    try {
        $preflightObject = Get-Content -Raw -LiteralPath $PreflightPathValue | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "Preflight artifact is not valid JSON: $PreflightPathValue"
    }

    $errors = @()
    $resolvedTaskId = $null
    if (-not [string]::IsNullOrWhiteSpace($ExplicitTaskId)) {
        $resolvedTaskId = $ExplicitTaskId.Trim()
        try {
            Assert-ValidTaskId -Value $resolvedTaskId
        } catch {
            $errors += $_.Exception.Message
        }
    }

    $preflightTaskId = $null
    if ($null -ne $preflightObject.PSObject.Properties['task_id']) {
        $preflightTaskId = [string]$preflightObject.task_id
        if (-not [string]::IsNullOrWhiteSpace($preflightTaskId)) {
            $preflightTaskId = $preflightTaskId.Trim()
            try {
                Assert-ValidTaskId -Value $preflightTaskId
            } catch {
                $errors += "preflight.task_id: $($_.Exception.Message)"
            }
        } else {
            $preflightTaskId = $null
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($resolvedTaskId) -and -not [string]::IsNullOrWhiteSpace($preflightTaskId)) {
        if (-not [string]::Equals($resolvedTaskId, $preflightTaskId, [System.StringComparison]::Ordinal)) {
            $errors += "TaskId '$resolvedTaskId' does not match preflight.task_id '$preflightTaskId'."
        }
    } elseif ([string]::IsNullOrWhiteSpace($resolvedTaskId) -and -not [string]::IsNullOrWhiteSpace($preflightTaskId)) {
        $resolvedTaskId = $preflightTaskId
    }

    if ([string]::IsNullOrWhiteSpace($resolvedTaskId)) {
        $errors += 'TaskId is required and must be provided either via -TaskId or preflight.task_id.'
    }

    $resolvedPreflightPath = (Resolve-Path -LiteralPath $PreflightPathValue).Path
    return [PSCustomObject]@{
        preflight = $preflightObject
        resolved_task_id = $resolvedTaskId
        preflight_path = $resolvedPreflightPath
        preflight_hash = Get-FileSha256 -PathValue $resolvedPreflightPath
        errors = $errors
    }
}

function Resolve-ArtifactPath {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$ExplicitArtifactPath
    )

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return $null
    }
    if (-not [string]::IsNullOrWhiteSpace($ExplicitArtifactPath)) {
        if ([System.IO.Path]::IsPathRooted($ExplicitArtifactPath)) {
            return $ExplicitArtifactPath
        }
        return Join-Path $RepoRootPath $ExplicitArtifactPath
    }

    return Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-doc-impact.json"
}

$repoRoot = Resolve-ProjectRoot
$validatedPreflight = Get-ValidatedPreflightContext -PreflightPathValue $PreflightPath -ExplicitTaskId $TaskId
$resolvedTaskId = $validatedPreflight.resolved_task_id
$resolvedArtifactPath = Resolve-ArtifactPath -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -ExplicitArtifactPath $ArtifactPath

$normalizedDocsUpdated = @(
    Convert-ToStringArray $DocsUpdated |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique
)

$normalizedDecision = $Decision.Trim().ToUpperInvariant()

$sensitiveTriggersFired = @()
$preflightObj = $validatedPreflight.preflight
if ($null -ne $preflightObj -and $null -ne $preflightObj.PSObject.Properties['triggers']) {
    $triggersObj = $preflightObj.PSObject.Properties['triggers'].Value
    foreach ($triggerName in @('api', 'security', 'infra', 'dependency', 'db')) {
        $prop = $triggersObj.PSObject.Properties[$triggerName]
        if ($null -ne $prop -and [bool]$prop.Value) {
            $sensitiveTriggersFired += $triggerName
        }
    }
}

$errors = @()
$errors += @($validatedPreflight.errors)
if ([string]::IsNullOrWhiteSpace($Rationale) -or $Rationale.Trim().Length -lt 12) {
    $errors += 'Rationale is required (>= 12 chars).'
}
if ($normalizedDecision -eq 'DOCS_UPDATED' -and $normalizedDocsUpdated.Count -eq 0) {
    $errors += 'Decision DOCS_UPDATED requires non-empty DocsUpdated list.'
}
if ($BehaviorChanged -and $normalizedDecision -ne 'DOCS_UPDATED') {
    $errors += 'BehaviorChanged=true requires Decision=DOCS_UPDATED.'
}
if ($BehaviorChanged -and -not $ChangelogUpdated) {
    $errors += 'BehaviorChanged=true requires ChangelogUpdated=true.'
}
if ($sensitiveTriggersFired.Count -gt 0 -and $normalizedDecision -eq 'NO_DOC_UPDATES' -and -not $SensitiveScopeReviewed) {
    $triggersStr = $sensitiveTriggersFired -join ', '
    $errors += "Sensitive scope triggers detected ($triggersStr): NO_DOC_UPDATES requires -SensitiveScopeReviewed:`$true with rationale explaining why no documentation updates are needed."
}

$status = if ($errors.Count -gt 0) { 'FAILED' } else { 'PASSED' }
$outcome = if ($errors.Count -gt 0) { 'FAIL' } else { 'PASS' }

$artifact = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_source = 'doc-impact-gate'
    task_id = $resolvedTaskId
    status = $status
    outcome = $outcome
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    preflight_hash_sha256 = $validatedPreflight.preflight_hash
    decision = $normalizedDecision
    behavior_changed = [bool]$BehaviorChanged
    changelog_updated = [bool]$ChangelogUpdated
    sensitive_triggers_detected = $sensitiveTriggersFired
    sensitive_scope_reviewed = [bool]$SensitiveScopeReviewed
    docs_updated = $normalizedDocsUpdated
    rationale = $(if ([string]::IsNullOrWhiteSpace($Rationale)) { '' } else { $Rationale.Trim() })
    violations = @($errors)
}

if (-not [string]::IsNullOrWhiteSpace($resolvedArtifactPath)) {
    $artifactDir = Split-Path -Parent $resolvedArtifactPath
    if ($artifactDir -and -not (Test-Path -LiteralPath $artifactDir)) {
        New-Item -Path $artifactDir -ItemType Directory -Force | Out-Null
    }
    Set-Content -LiteralPath $resolvedArtifactPath -Value ($artifact | ConvertTo-Json -Depth 12)
}

$eventObject = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'doc_impact_gate_check'
    status = $status
    task_id = $resolvedTaskId
    artifact_path = Normalize-Path $resolvedArtifactPath
    artifact = $artifact
}
Append-MetricsEvent -Path $MetricsPath -EventObject $eventObject

$taskEventType = if ($errors.Count -gt 0) { 'DOC_IMPACT_ASSESSMENT_FAILED' } else { 'DOC_IMPACT_ASSESSED' }
$taskMessage = if ($errors.Count -gt 0) { 'Doc impact gate failed.' } else { 'Doc impact gate passed.' }
Append-TaskEvent -RepoRootPath $repoRoot -TaskIdValue $resolvedTaskId -EventType $taskEventType -Outcome $outcome -Message $taskMessage -Details $artifact

if ($errors.Count -gt 0) {
    Write-Output 'DOC_IMPACT_GATE_FAILED'
    Write-Output 'Violations:'
    $errors | ForEach-Object { Write-Output "- $_" }
    exit 1
}

Write-Output 'DOC_IMPACT_GATE_PASSED'
if ($resolvedArtifactPath) {
    Write-Output ("DocImpactArtifactPath: {0}" -f (Normalize-Path $resolvedArtifactPath))
}
