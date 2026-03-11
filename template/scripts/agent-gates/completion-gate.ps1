[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [string]$TimelinePath,
    [string]$ReviewsRoot,
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

$validatedPreflight = Get-ValidatedPreflightContext -PreflightPathValue $PreflightPath -ExplicitTaskId $TaskId
$repoRoot = Resolve-ProjectRoot
$resolvedTaskId = $validatedPreflight.resolved_task_id

$timelineEvidence = Get-TimelineEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -TimelinePathValue $TimelinePath
$artifactEvidence = Get-ReviewArtifactEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -RequiredReviewFlags $validatedPreflight.required_reviews -SkipReviews @($timelineEvidence.skip_reviews) -ReviewsRootValue $ReviewsRoot

$errors = @()
$errors += @($validatedPreflight.errors)
$errors += @($timelineEvidence.violations)
$errors += @($artifactEvidence.violations)

if ($errors.Count -gt 0) {
    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'completion_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        timeline = $timelineEvidence
        review_artifacts = $artifactEvidence
        violations = $errors
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent

    $taskFailureDetails = [ordered]@{
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
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
    timeline = $timelineEvidence
    review_artifacts = $artifactEvidence
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent

$taskSuccessDetails = [ordered]@{
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    timeline = $timelineEvidence
    review_artifacts = $artifactEvidence
}
Append-TaskEvent -RepoRootPath $repoRoot -TaskIdValue $resolvedTaskId -EventType 'COMPLETION_GATE_PASSED' -Outcome 'PASS' -Message 'Completion gate passed.' -Details $taskSuccessDetails

Write-Output 'COMPLETION_GATE_PASSED'
Write-Output "RequiredReviewArtifactsChecked: $($artifactEvidence.checked.Count)"
if (@($artifactEvidence.skipped_by_override).Count -gt 0) {
    Write-Output "SkippedByOverride: $(@($artifactEvidence.skipped_by_override) -join ',')"
}
