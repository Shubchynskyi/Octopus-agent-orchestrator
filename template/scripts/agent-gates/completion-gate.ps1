[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [string]$TimelinePath,
    [string]$ReviewsRoot,
    [string]$CompileEvidencePath,
    [string]$ReviewEvidencePath,
    [string]$DocImpactPath,
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

function Convert-ToSkipReviewArray {
    param([object]$Value)

    $values = Convert-GateToStringArray -Value $Value -TrimValues
    return @($values | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique)
}

function Try-GetRequiredBoolean {
    param(
        [object]$RequiredReviews,
        [string]$Key,
        [ref]$ValueOut
    )

    $ValueOut.Value = $false
    if ($null -eq $RequiredReviews) {
        return $false
    }

    $property = $RequiredReviews.PSObject.Properties[$Key]
    if ($null -eq $property) {
        return $false
    }

    if ($property.Value -isnot [bool]) {
        return $false
    }

    $ValueOut.Value = [bool]$property.Value
    return $true
}

function Get-ValidatedPreflightContext {
    param(
        [string]$PreflightPathValue,
        [string]$ExplicitTaskId
    )

    if (-not (Test-Path -LiteralPath $PreflightPathValue -PathType Leaf)) {
        throw "Preflight artifact not found: $PreflightPathValue"
    }

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

    $requiredReviewsObject = $null
    if ($null -eq $preflightObject.PSObject.Properties['required_reviews']) {
        $errors += 'Preflight field `required_reviews` is required.'
    } else {
        $requiredReviewsObject = $preflightObject.required_reviews
        if ($null -eq $requiredReviewsObject) {
            $errors += 'Preflight field `required_reviews` must be an object.'
        }
    }

    $requiredReviewKeys = @('code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency')
    $requiredReviewFlags = [ordered]@{}
    foreach ($key in $requiredReviewKeys) {
        $flagValue = $false
        $isValid = Try-GetRequiredBoolean -RequiredReviews $requiredReviewsObject -Key $key -ValueOut ([ref]$flagValue)
        if (-not $isValid) {
            $errors += "Preflight field `required_reviews.$key` is required and must be boolean."
        }
        $requiredReviewFlags[$key] = [bool]$flagValue
    }

    $preflightResolvedPath = (Resolve-Path -LiteralPath $PreflightPathValue).Path
    return [PSCustomObject]@{
        preflight = $preflightObject
        resolved_task_id = $resolvedTaskId
        required_reviews = $requiredReviewFlags
        preflight_path = $preflightResolvedPath
        preflight_hash = Get-FileSha256 -PathValue $preflightResolvedPath
        errors = $errors
    }
}

function Get-ReviewContracts {
    return @(
        [PSCustomObject]@{ key = 'code'; pass_token = 'REVIEW PASSED' },
        [PSCustomObject]@{ key = 'db'; pass_token = 'DB REVIEW PASSED' },
        [PSCustomObject]@{ key = 'security'; pass_token = 'SECURITY REVIEW PASSED' },
        [PSCustomObject]@{ key = 'refactor'; pass_token = 'REFACTOR REVIEW PASSED' },
        [PSCustomObject]@{ key = 'api'; pass_token = 'API REVIEW PASSED' },
        [PSCustomObject]@{ key = 'test'; pass_token = 'TEST REVIEW PASSED' },
        [PSCustomObject]@{ key = 'performance'; pass_token = 'PERFORMANCE REVIEW PASSED' },
        [PSCustomObject]@{ key = 'infra'; pass_token = 'INFRA REVIEW PASSED' },
        [PSCustomObject]@{ key = 'dependency'; pass_token = 'DEPENDENCY REVIEW PASSED' }
    )
}

function Get-TimelineEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$TimelinePathValue
    )

    $result = [ordered]@{
        timeline_path = $null
        status = 'UNKNOWN'
        events_scanned = 0
        matching_events = 0
        parse_errors = 0
        compile_gate_passed = $false
        review_gate_passed = $false
        review_gate_pass_event_type = $null
        review_gate_passed_after_last_failure = $false
        rework_started_after_last_failure = $false
        last_review_gate_failed_index = $null
        last_review_gate_passed_index = $null
        skip_reviews = @()
        integrity = $null
        violations = @()
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        $result.violations += 'Task timeline cannot be validated: task id is missing.'
        return $result
    }

    $resolvedTimelinePath = $null
    if (-not [string]::IsNullOrWhiteSpace($TimelinePathValue)) {
        if ([System.IO.Path]::IsPathRooted($TimelinePathValue)) {
            $resolvedTimelinePath = $TimelinePathValue
        } else {
            $resolvedTimelinePath = Join-Path $RepoRootPath $TimelinePathValue
        }
    } else {
        $resolvedTimelinePath = Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/task-events/$ResolvedTaskId.jsonl"
    }
    $result.timeline_path = Normalize-Path $resolvedTimelinePath

    if (-not (Test-Path -LiteralPath $resolvedTimelinePath -PathType Leaf)) {
        $result.status = 'TIMELINE_MISSING'
        $result.violations += "Task timeline not found: $($result.timeline_path)"
        return $result
    }

    $integrityEvidence = Get-GateTaskTimelineIntegrity -TaskEventFilePath $resolvedTimelinePath -TaskId $ResolvedTaskId
    $result.integrity = $integrityEvidence
    $result.violations += @($integrityEvidence.violations)

    $eventIndex = 0
    $lastFailedIndex = $null
    $lastPassedIndex = $null
    $reworkIndices = @()
    $lastPassSkipReviews = @()

    foreach ($rawLine in (Get-Content -LiteralPath $resolvedTimelinePath)) {
        if ([string]::IsNullOrWhiteSpace($rawLine)) {
            continue
        }

        $eventIndex++
        $result.events_scanned = $eventIndex
        $eventObject = $null
        try {
            $eventObject = $rawLine | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $result.parse_errors++
            continue
        }

        $eventTaskId = ''
        if ($null -ne $eventObject.PSObject.Properties['task_id']) {
            $eventTaskId = [string]$eventObject.task_id
        }
        if (-not [string]::IsNullOrWhiteSpace($eventTaskId) -and -not [string]::Equals($eventTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
            continue
        }

        $result.matching_events++
        $eventType = ''
        if ($null -ne $eventObject.PSObject.Properties['event_type']) {
            $eventType = ([string]$eventObject.event_type).Trim()
        }

        switch ($eventType) {
            'COMPILE_GATE_PASSED' {
                $result.compile_gate_passed = $true
            }
            'REVIEW_GATE_FAILED' {
                $lastFailedIndex = $eventIndex
                $result.last_review_gate_failed_index = $eventIndex
            }
            'REWORK_STARTED' {
                $reworkIndices += $eventIndex
            }
            'REVIEW_GATE_PASSED' {
                $lastPassedIndex = $eventIndex
                $result.review_gate_passed = $true
                $result.review_gate_pass_event_type = 'REVIEW_GATE_PASSED'
                $lastPassSkipReviews = @()
            }
            'REVIEW_GATE_PASSED_WITH_OVERRIDE' {
                $lastPassedIndex = $eventIndex
                $result.review_gate_passed = $true
                $result.review_gate_pass_event_type = 'REVIEW_GATE_PASSED_WITH_OVERRIDE'

                $detailsObject = $null
                if ($null -ne $eventObject.PSObject.Properties['details']) {
                    $detailsObject = $eventObject.details
                }

                $skipReviewsValue = $null
                if ($null -ne $detailsObject -and $null -ne $detailsObject.PSObject.Properties['skip_reviews']) {
                    $skipReviewsValue = $detailsObject.skip_reviews
                }
                $lastPassSkipReviews = Convert-ToSkipReviewArray -Value $skipReviewsValue
            }
        }
    }

    $result.last_review_gate_passed_index = $lastPassedIndex
    $result.skip_reviews = @($lastPassSkipReviews)

    if (-not $result.compile_gate_passed) {
        $result.violations += 'Task timeline does not contain COMPILE_GATE_PASSED.'
    }

    if ($null -eq $lastPassedIndex) {
        $result.violations += 'Task timeline does not contain REVIEW_GATE_PASSED or REVIEW_GATE_PASSED_WITH_OVERRIDE.'
    }

    if ($null -ne $lastFailedIndex) {
        $reworkAfterFailure = @($reworkIndices | Where-Object { $_ -gt $lastFailedIndex })
        if ($reworkAfterFailure.Count -eq 0) {
            $result.violations += 'Task timeline contains REVIEW_GATE_FAILED but no REWORK_STARTED after latest failure.'
        } else {
            $result.rework_started_after_last_failure = $true
        }

        if ($null -eq $lastPassedIndex -or $lastPassedIndex -le $lastFailedIndex) {
            $result.violations += 'Task timeline contains REVIEW_GATE_FAILED but no review gate pass after latest failure.'
        } else {
            $result.review_gate_passed_after_last_failure = $true
        }
    }

    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

function Get-ReviewArtifactEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [System.Collections.IDictionary]$RequiredReviewFlags,
        [string[]]$SkipReviews,
        [string]$ReviewsRootValue
    )

    $result = [ordered]@{
        reviews_root = $null
        status = 'UNKNOWN'
        checked = @()
        skipped_by_override = @()
        missing = @()
        token_missing = @()
        violations = @()
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        $result.violations += 'Review artifacts cannot be validated: task id is missing.'
        return $result
    }

    $resolvedReviewsRoot = $null
    if (-not [string]::IsNullOrWhiteSpace($ReviewsRootValue)) {
        if ([System.IO.Path]::IsPathRooted($ReviewsRootValue)) {
            $resolvedReviewsRoot = $ReviewsRootValue
        } else {
            $resolvedReviewsRoot = Join-Path $RepoRootPath $ReviewsRootValue
        }
    } else {
        $resolvedReviewsRoot = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/reviews'
    }
    $result.reviews_root = Normalize-Path $resolvedReviewsRoot

    $skipLookup = @{}
    foreach ($skipItem in @($SkipReviews)) {
        $skipLookup[$skipItem.ToLowerInvariant()] = $true
    }

    foreach ($contract in (Get-ReviewContracts)) {
        $reviewKey = [string]$contract.key
        $isRequired = $false
        if ($null -ne $RequiredReviewFlags -and $RequiredReviewFlags.Contains($reviewKey)) {
            $isRequired = [bool]$RequiredReviewFlags[$reviewKey]
        }

        if (-not $isRequired) {
            continue
        }

        if ($skipLookup.ContainsKey($reviewKey)) {
            $result.skipped_by_override += $reviewKey
            continue
        }

        $artifactPath = Join-Path $resolvedReviewsRoot "$ResolvedTaskId-$reviewKey.md"
        $artifactEntry = [ordered]@{
            review = $reviewKey
            path = Normalize-Path $artifactPath
            pass_token = [string]$contract.pass_token
            present = $false
            token_found = $false
        }

        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            $result.missing += $reviewKey
            $result.violations += "Missing required review artifact: $($artifactEntry.path)"
            $result.checked += [PSCustomObject]$artifactEntry
            continue
        }

        $artifactEntry.present = $true
        $content = Get-Content -LiteralPath $artifactPath -Raw
        if ($content -match [regex]::Escape([string]$contract.pass_token)) {
            $artifactEntry.token_found = $true
        } else {
            $result.token_missing += $reviewKey
            $result.violations += "Review artifact '$($artifactEntry.path)' does not contain pass token '$([string]$contract.pass_token)'."
        }

        $result.checked += [PSCustomObject]$artifactEntry
    }

    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

function Get-CompileGateEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$PreflightPathValue,
        [string]$PreflightHashValue,
        [string]$CompileEvidencePathValue
    )

    $result = [ordered]@{
        evidence_path = $null
        evidence_hash = $null
        status = 'UNKNOWN'
        violations = @()
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        $result.violations += 'Compile evidence cannot be validated: task id is missing.'
        return $result
    }

    $resolvedEvidencePath = if ([string]::IsNullOrWhiteSpace($CompileEvidencePathValue)) {
        Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-compile-gate.json"
    } elseif ([System.IO.Path]::IsPathRooted($CompileEvidencePathValue)) {
        $CompileEvidencePathValue
    } else {
        Join-Path $RepoRootPath $CompileEvidencePathValue
    }

    $result.evidence_path = Normalize-Path $resolvedEvidencePath
    if (-not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) {
        $result.status = 'EVIDENCE_FILE_MISSING'
        $result.violations += "Compile evidence file not found: $($result.evidence_path)"
        return $result
    }

    $result.evidence_hash = Get-FileSha256 -PathValue $resolvedEvidencePath
    $evidenceObject = $null
    try {
        $evidenceObject = Get-Content -Raw -LiteralPath $resolvedEvidencePath | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $result.status = 'EVIDENCE_INVALID_JSON'
        $result.violations += "Compile evidence is invalid JSON: $($result.evidence_path)"
        return $result
    }

    $recordedTaskId = if ($null -ne $evidenceObject.PSObject.Properties['task_id']) { [string]$evidenceObject.task_id } else { '' }
    $recordedSource = if ($null -ne $evidenceObject.PSObject.Properties['event_source']) { [string]$evidenceObject.event_source } else { '' }
    $recordedStatus = if ($null -ne $evidenceObject.PSObject.Properties['status']) { [string]$evidenceObject.status } else { '' }
    $recordedOutcome = if ($null -ne $evidenceObject.PSObject.Properties['outcome']) { [string]$evidenceObject.outcome } else { '' }
    $recordedPreflightPath = if ($null -ne $evidenceObject.PSObject.Properties['preflight_path']) { [string]$evidenceObject.preflight_path } else { '' }
    $recordedPreflightHash = if ($null -ne $evidenceObject.PSObject.Properties['preflight_hash_sha256']) { [string]$evidenceObject.preflight_hash_sha256 } else { '' }

    if (-not [string]::Equals($recordedTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
        $result.violations += "Compile evidence task mismatch. Expected '$ResolvedTaskId', got '$recordedTaskId'."
    }
    if (-not [string]::Equals($recordedSource.Trim(), 'compile-gate', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Compile evidence source mismatch. Expected 'compile-gate', got '$recordedSource'."
    }
    if (-not [string]::Equals($recordedStatus.Trim(), 'PASSED', [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals($recordedOutcome.Trim(), 'PASS', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Compile evidence is not PASS. status='$recordedStatus', outcome='$recordedOutcome'."
    }
    if (-not [string]::Equals($recordedPreflightHash.Trim().ToLowerInvariant(), $PreflightHashValue.Trim().ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
        $result.violations += 'Compile evidence preflight hash mismatch.'
    }

    if (-not [string]::IsNullOrWhiteSpace($recordedPreflightPath)) {
        $expectedPreflightPath = Normalize-Path (Resolve-Path -LiteralPath $PreflightPathValue).Path
        if (-not [string]::Equals((Normalize-Path $recordedPreflightPath), $expectedPreflightPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $result.violations += 'Compile evidence preflight path mismatch.'
        }
    }

    $result.evidence = $evidenceObject
    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

function Get-ReviewGateEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$PreflightPathValue,
        [string]$PreflightHashValue,
        [string]$ReviewEvidencePathValue,
        [object]$CompileEvidence
    )

    $result = [ordered]@{
        evidence_path = $null
        status = 'UNKNOWN'
        violations = @()
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        $result.violations += 'Review evidence cannot be validated: task id is missing.'
        return $result
    }

    $resolvedEvidencePath = if ([string]::IsNullOrWhiteSpace($ReviewEvidencePathValue)) {
        Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-review-gate.json"
    } elseif ([System.IO.Path]::IsPathRooted($ReviewEvidencePathValue)) {
        $ReviewEvidencePathValue
    } else {
        Join-Path $RepoRootPath $ReviewEvidencePathValue
    }

    $result.evidence_path = Normalize-Path $resolvedEvidencePath
    if (-not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) {
        $result.status = 'EVIDENCE_FILE_MISSING'
        $result.violations += "Review evidence file not found: $($result.evidence_path)"
        return $result
    }

    $evidenceObject = $null
    try {
        $evidenceObject = Get-Content -Raw -LiteralPath $resolvedEvidencePath | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $result.status = 'EVIDENCE_INVALID_JSON'
        $result.violations += "Review evidence is invalid JSON: $($result.evidence_path)"
        return $result
    }

    $recordedTaskId = if ($null -ne $evidenceObject.PSObject.Properties['task_id']) { [string]$evidenceObject.task_id } else { '' }
    $recordedSource = if ($null -ne $evidenceObject.PSObject.Properties['event_source']) { [string]$evidenceObject.event_source } else { '' }
    $recordedStatus = if ($null -ne $evidenceObject.PSObject.Properties['status']) { [string]$evidenceObject.status } else { '' }
    $recordedOutcome = if ($null -ne $evidenceObject.PSObject.Properties['outcome']) { [string]$evidenceObject.outcome } else { '' }
    $recordedPreflightPath = if ($null -ne $evidenceObject.PSObject.Properties['preflight_path']) { [string]$evidenceObject.preflight_path } else { '' }
    $recordedPreflightHash = if ($null -ne $evidenceObject.PSObject.Properties['preflight_hash_sha256']) { [string]$evidenceObject.preflight_hash_sha256 } else { '' }
    $recordedCompilePath = if ($null -ne $evidenceObject.PSObject.Properties['compile_evidence_path']) { [string]$evidenceObject.compile_evidence_path } else { '' }
    $recordedCompileHash = if ($null -ne $evidenceObject.PSObject.Properties['compile_evidence_hash_sha256']) { [string]$evidenceObject.compile_evidence_hash_sha256 } else { '' }

    if (-not [string]::Equals($recordedTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
        $result.violations += "Review evidence task mismatch. Expected '$ResolvedTaskId', got '$recordedTaskId'."
    }
    if (-not [string]::Equals($recordedSource.Trim(), 'required-reviews-check', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Review evidence source mismatch. Expected 'required-reviews-check', got '$recordedSource'."
    }
    if (-not [string]::Equals($recordedStatus.Trim(), 'PASSED', [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals($recordedOutcome.Trim(), 'PASS', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Review evidence is not PASS. status='$recordedStatus', outcome='$recordedOutcome'."
    }
    if (-not [string]::Equals($recordedPreflightHash.Trim().ToLowerInvariant(), $PreflightHashValue.Trim().ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
        $result.violations += 'Review evidence preflight hash mismatch.'
    }

    if (-not [string]::IsNullOrWhiteSpace($recordedPreflightPath)) {
        $expectedPreflightPath = Normalize-Path (Resolve-Path -LiteralPath $PreflightPathValue).Path
        if (-not [string]::Equals((Normalize-Path $recordedPreflightPath), $expectedPreflightPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $result.violations += 'Review evidence preflight path mismatch.'
        }
    }
    if ($null -ne $CompileEvidence) {
        if (-not [string]::IsNullOrWhiteSpace($recordedCompilePath) -and -not [string]::Equals((Normalize-Path $recordedCompilePath), [string]$CompileEvidence.evidence_path, [System.StringComparison]::OrdinalIgnoreCase)) {
            $result.violations += 'Review evidence compile path mismatch.'
        }
        if (-not [string]::IsNullOrWhiteSpace($recordedCompileHash) -and -not [string]::Equals($recordedCompileHash.Trim().ToLowerInvariant(), ([string]$CompileEvidence.evidence_hash).Trim().ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
            $result.violations += 'Review evidence compile hash mismatch.'
        }
    }

    $result.evidence = $evidenceObject
    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

function Get-DocImpactEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$PreflightPathValue,
        [string]$PreflightHashValue,
        [string]$DocImpactPathValue
    )

    $result = [ordered]@{
        evidence_path = $null
        status = 'UNKNOWN'
        violations = @()
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        $result.violations += 'Doc impact evidence cannot be validated: task id is missing.'
        return $result
    }

    $resolvedEvidencePath = if ([string]::IsNullOrWhiteSpace($DocImpactPathValue)) {
        Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-doc-impact.json"
    } elseif ([System.IO.Path]::IsPathRooted($DocImpactPathValue)) {
        $DocImpactPathValue
    } else {
        Join-Path $RepoRootPath $DocImpactPathValue
    }

    $result.evidence_path = Normalize-Path $resolvedEvidencePath
    if (-not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) {
        $result.status = 'EVIDENCE_FILE_MISSING'
        $result.violations += "Doc impact evidence file not found: $($result.evidence_path)"
        return $result
    }

    $evidenceObject = $null
    try {
        $evidenceObject = Get-Content -Raw -LiteralPath $resolvedEvidencePath | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $result.status = 'EVIDENCE_INVALID_JSON'
        $result.violations += "Doc impact evidence is invalid JSON: $($result.evidence_path)"
        return $result
    }

    $recordedTaskId = if ($null -ne $evidenceObject.PSObject.Properties['task_id']) { [string]$evidenceObject.task_id } else { '' }
    $recordedSource = if ($null -ne $evidenceObject.PSObject.Properties['event_source']) { [string]$evidenceObject.event_source } else { '' }
    $recordedStatus = if ($null -ne $evidenceObject.PSObject.Properties['status']) { [string]$evidenceObject.status } else { '' }
    $recordedOutcome = if ($null -ne $evidenceObject.PSObject.Properties['outcome']) { [string]$evidenceObject.outcome } else { '' }
    $recordedPreflightPath = if ($null -ne $evidenceObject.PSObject.Properties['preflight_path']) { [string]$evidenceObject.preflight_path } else { '' }
    $recordedPreflightHash = if ($null -ne $evidenceObject.PSObject.Properties['preflight_hash_sha256']) { [string]$evidenceObject.preflight_hash_sha256 } else { '' }
    $recordedDecision = if ($null -ne $evidenceObject.PSObject.Properties['decision']) { [string]$evidenceObject.decision } else { '' }
    $recordedRationale = if ($null -ne $evidenceObject.PSObject.Properties['rationale']) { [string]$evidenceObject.rationale } else { '' }
    $recordedBehaviorChanged = if ($null -ne $evidenceObject.PSObject.Properties['behavior_changed']) { [bool]$evidenceObject.behavior_changed } else { $false }
    $recordedChangelogUpdated = if ($null -ne $evidenceObject.PSObject.Properties['changelog_updated']) { [bool]$evidenceObject.changelog_updated } else { $false }
    $recordedDocsUpdated = @()
    if ($null -ne $evidenceObject.PSObject.Properties['docs_updated']) {
        $recordedDocsUpdated = @(
            Convert-GateToStringArray -Value $evidenceObject.docs_updated -TrimValues |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    }
    $recordedSensitiveTriggers = @()
    if ($null -ne $evidenceObject.PSObject.Properties['sensitive_triggers_detected']) {
        $recordedSensitiveTriggers = @(
            Convert-GateToStringArray -Value $evidenceObject.sensitive_triggers_detected -TrimValues |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    }
    $recordedSensitiveScopeReviewed = $false
    if ($null -ne $evidenceObject.PSObject.Properties['sensitive_scope_reviewed']) {
        $recordedSensitiveScopeReviewed = [bool]$evidenceObject.sensitive_scope_reviewed
    }

    if (-not [string]::Equals($recordedTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
        $result.violations += "Doc impact evidence task mismatch. Expected '$ResolvedTaskId', got '$recordedTaskId'."
    }
    if (-not [string]::Equals($recordedSource.Trim(), 'doc-impact-gate', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Doc impact evidence source mismatch. Expected 'doc-impact-gate', got '$recordedSource'."
    }
    if (-not [string]::Equals($recordedStatus.Trim(), 'PASSED', [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals($recordedOutcome.Trim(), 'PASS', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.violations += "Doc impact evidence is not PASS. status='$recordedStatus', outcome='$recordedOutcome'."
    }
    if (-not [string]::Equals($recordedPreflightHash.Trim().ToLowerInvariant(), $PreflightHashValue.Trim().ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
        $result.violations += 'Doc impact evidence preflight hash mismatch.'
    }
    if (-not [string]::IsNullOrWhiteSpace($recordedPreflightPath)) {
        $expectedPreflightPath = Normalize-Path (Resolve-Path -LiteralPath $PreflightPathValue).Path
        if (-not [string]::Equals((Normalize-Path $recordedPreflightPath), $expectedPreflightPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $result.violations += 'Doc impact evidence preflight path mismatch.'
        }
    }

    $decisionNormalized = $recordedDecision.Trim().ToUpperInvariant()
    if (@('NO_DOC_UPDATES', 'DOCS_UPDATED') -notcontains $decisionNormalized) {
        $result.violations += "Doc impact decision '$recordedDecision' is invalid."
    }
    if ([string]::IsNullOrWhiteSpace($recordedRationale) -or $recordedRationale.Trim().Length -lt 12) {
        $result.violations += 'Doc impact rationale must be provided (>= 12 chars).'
    }
    if ($decisionNormalized -eq 'DOCS_UPDATED' -and $recordedDocsUpdated.Count -eq 0) {
        $result.violations += 'Doc impact decision DOCS_UPDATED requires non-empty docs_updated list.'
    }
    if ($recordedBehaviorChanged -and $decisionNormalized -ne 'DOCS_UPDATED') {
        $result.violations += 'Behavior-changed tasks must set decision=DOCS_UPDATED.'
    }
    if ($recordedBehaviorChanged -and -not $recordedChangelogUpdated) {
        $result.violations += 'Behavior-changed tasks must set changelog_updated=true.'
    }
    if ($recordedSensitiveTriggers.Count -gt 0 -and $decisionNormalized -eq 'NO_DOC_UPDATES' -and -not $recordedSensitiveScopeReviewed) {
        $triggersStr = $recordedSensitiveTriggers -join ', '
        $result.violations += "Sensitive scope triggers ($triggersStr) detected: NO_DOC_UPDATES requires sensitive_scope_reviewed=true."
    }

    $result.evidence = $evidenceObject
    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

$validatedPreflight = Get-ValidatedPreflightContext -PreflightPathValue $PreflightPath -ExplicitTaskId $TaskId
$repoRoot = Resolve-ProjectRoot
$resolvedTaskId = $validatedPreflight.resolved_task_id

$compileEvidence = Get-CompileGateEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -PreflightPathValue $validatedPreflight.preflight_path -PreflightHashValue $validatedPreflight.preflight_hash -CompileEvidencePathValue $CompileEvidencePath
$reviewGateEvidence = Get-ReviewGateEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -PreflightPathValue $validatedPreflight.preflight_path -PreflightHashValue $validatedPreflight.preflight_hash -ReviewEvidencePathValue $ReviewEvidencePath -CompileEvidence $compileEvidence
$docImpactEvidence = Get-DocImpactEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -PreflightPathValue $validatedPreflight.preflight_path -PreflightHashValue $validatedPreflight.preflight_hash -DocImpactPathValue $DocImpactPath
$timelineEvidence = Get-TimelineEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -TimelinePathValue $TimelinePath
$artifactEvidence = Get-ReviewArtifactEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -RequiredReviewFlags $validatedPreflight.required_reviews -SkipReviews @($timelineEvidence.skip_reviews) -ReviewsRootValue $ReviewsRoot

$errors = @()
$errors += @($validatedPreflight.errors)
$errors += @($compileEvidence.violations)
$errors += @($reviewGateEvidence.violations)
$errors += @($docImpactEvidence.violations)
$errors += @($timelineEvidence.violations)
$errors += @($artifactEvidence.violations)

if ($errors.Count -gt 0) {
    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'completion_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        compile_evidence = $compileEvidence
        review_gate_evidence = $reviewGateEvidence
        doc_impact_evidence = $docImpactEvidence
        timeline = $timelineEvidence
        review_artifacts = $artifactEvidence
        violations = $errors
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent

    $taskFailureDetails = [ordered]@{
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        compile_evidence = $compileEvidence
        review_gate_evidence = $reviewGateEvidence
        doc_impact_evidence = $docImpactEvidence
        timeline = $timelineEvidence
        review_artifacts = $artifactEvidence
        violations = $errors
    }
    Append-TaskEvent -RepoRootPath $repoRoot -TaskIdValue $resolvedTaskId -EventType 'COMPLETION_GATE_FAILED' -Outcome 'FAIL' -Message 'Completion gate failed.' -Details $taskFailureDetails

    Write-Output 'COMPLETION_GATE_FAILED'
    Write-Output 'Violations:'
    $errors | ForEach-Object { Write-Output "- $_" }
    exit 1
}

$successEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'completion_gate_check'
    status = 'PASSED'
    task_id = $resolvedTaskId
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    compile_evidence = $compileEvidence
    review_gate_evidence = $reviewGateEvidence
    doc_impact_evidence = $docImpactEvidence
    timeline = $timelineEvidence
    review_artifacts = $artifactEvidence
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent

$taskSuccessDetails = [ordered]@{
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    compile_evidence = $compileEvidence
    review_gate_evidence = $reviewGateEvidence
    doc_impact_evidence = $docImpactEvidence
    timeline = $timelineEvidence
    review_artifacts = $artifactEvidence
}
Append-TaskEvent -RepoRootPath $repoRoot -TaskIdValue $resolvedTaskId -EventType 'COMPLETION_GATE_PASSED' -Outcome 'PASS' -Message 'Completion gate passed.' -Details $taskSuccessDetails

Write-Output 'COMPLETION_GATE_PASSED'
Write-Output "RequiredReviewArtifactsChecked: $($artifactEvidence.checked.Count)"
if (@($artifactEvidence.skipped_by_override).Count -gt 0) {
    Write-Output "SkippedByOverride: $(@($artifactEvidence.skipped_by_override) -join ',')"
}
