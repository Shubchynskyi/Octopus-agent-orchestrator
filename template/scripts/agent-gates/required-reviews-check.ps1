[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [string]$CodeReviewVerdict = 'NOT_REQUIRED',
    [string]$DbReviewVerdict = 'NOT_REQUIRED',
    [string]$SecurityReviewVerdict = 'NOT_REQUIRED',
    [string]$RefactorReviewVerdict = 'NOT_REQUIRED',
    [string]$ApiReviewVerdict = 'NOT_REQUIRED',
    [string]$TestReviewVerdict = 'NOT_REQUIRED',
    [string]$PerformanceReviewVerdict = 'NOT_REQUIRED',
    [string]$InfraReviewVerdict = 'NOT_REQUIRED',
    [string]$DependencyReviewVerdict = 'NOT_REQUIRED',
    [string]$SkipReviews = '',
    [string]$SkipReason = '',
    [string]$OverrideArtifactPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    $projectRootCandidate = Join-Path $PSScriptRoot '..\..\..\..'
    if (Test-Path $projectRootCandidate) {
        return (Resolve-Path $projectRootCandidate).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($MetricsPath)) {
    $MetricsPath = Join-Path (Resolve-ProjectRoot) 'Octopus-agent-orchestrator/runtime/metrics.jsonl'
}

function Append-MetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject
    )

    if (-not $EmitMetrics) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    try {
        $metricsDir = Split-Path -Parent $Path
        if ($metricsDir -and -not (Test-Path $metricsDir)) {
            New-Item -Path $metricsDir -ItemType Directory -Force | Out-Null
        }
        $line = $EventObject | ConvertTo-Json -Depth 12 -Compress
        Add-Content -Path $Path -Value $line
    } catch {
        Write-Verbose "Metrics append failed: $($_.Exception.Message)"
    }
}

function Normalize-Path {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    return $PathValue.Replace('\', '/')
}

function Resolve-TaskId {
    param(
        [string]$ExplicitTaskId,
        [string]$PreflightPathValue
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitTaskId)) {
        return $ExplicitTaskId.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($PreflightPathValue)) {
        return $null
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PreflightPathValue)
    if ([string]::IsNullOrWhiteSpace($baseName)) {
        return $null
    }

    $candidate = $baseName -replace '-preflight$', ''
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        return $null
    }

    return $candidate.Trim()
}

function Append-TaskEvent {
    param(
        [string]$RepoRootPath,
        [string]$TaskId,
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null
    )

    if ([string]::IsNullOrWhiteSpace($TaskId)) {
        return
    }

    try {
        $eventsDir = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/task-events'
        if (-not (Test-Path $eventsDir)) {
            New-Item -Path $eventsDir -ItemType Directory -Force | Out-Null
        }

        $event = [ordered]@{
            timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
            task_id = $TaskId
            event_type = $EventType
            outcome = $Outcome
            message = $Message
            details = $Details
        }

        $line = $event | ConvertTo-Json -Depth 12 -Compress
        $taskFilePath = Join-Path $eventsDir "$TaskId.jsonl"
        $allTasksPath = Join-Path $eventsDir 'all-tasks.jsonl'

        Add-Content -Path $taskFilePath -Value $line
        Add-Content -Path $allTasksPath -Value $line
    } catch {
        Write-Verbose "Task-event append failed: $($_.Exception.Message)"
    }
}

function Parse-SkipReviews {
    param([string]$SkipValue)

    if ([string]::IsNullOrWhiteSpace($SkipValue)) {
        return @()
    }

    $items = $SkipValue -split '[,; ]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    return @($items | ForEach-Object { $_.Trim().ToLowerInvariant() } | Sort-Object -Unique)
}

function Test-ExpectedVerdict {
    param(
        [string]$Label,
        [bool]$Required,
        [bool]$SkippedByOverride,
        [string]$ActualVerdict,
        [string]$PassVerdict
    )

    if ($Required -and -not $SkippedByOverride) {
        if ($ActualVerdict -ne $PassVerdict) {
            $script:errors += "$Label is required. Expected '$PassVerdict', got '$ActualVerdict'."
        }
        return
    }

    if ($SkippedByOverride) {
        $allowedSkippedVerdicts = @('NOT_REQUIRED', 'SKIPPED_BY_OVERRIDE', $PassVerdict)
        if ($allowedSkippedVerdicts -contains $ActualVerdict) {
            return
        }
        $script:errors += "$Label override is active. Expected one of '$($allowedSkippedVerdicts -join "', '")', got '$ActualVerdict'."
        return
    }

    if ($ActualVerdict -eq 'NOT_REQUIRED' -or $ActualVerdict -eq $PassVerdict) {
        return
    }

    $script:errors += "$Label is not required. Expected 'NOT_REQUIRED' or '$PassVerdict', got '$ActualVerdict'."
}

function Get-RequiredFlag {
    param(
        [object]$RequiredReviews,
        [string]$Key
    )

    if ($null -eq $RequiredReviews) {
        return $false
    }

    $property = $RequiredReviews.PSObject.Properties[$Key]
    if ($null -eq $property) {
        return $false
    }

    return [bool]$property.Value
}

if (-not (Test-Path $PreflightPath)) {
    throw "Preflight artifact not found: $PreflightPath"
}

$preflight = Get-Content -Raw $PreflightPath | ConvertFrom-Json
$resolvedTaskId = Resolve-TaskId -ExplicitTaskId $TaskId -PreflightPathValue $PreflightPath
$errors = @()
$skipReviewsList = Parse-SkipReviews -SkipValue $SkipReviews
$allowedSkips = @('code')

foreach ($skipItem in $skipReviewsList) {
    if ($allowedSkips -notcontains $skipItem) {
        $errors += "Unsupported skip-review value '$skipItem'. Allowed values: code."
    }
}

if ($skipReviewsList.Count -gt 0 -and [string]::IsNullOrWhiteSpace($SkipReason)) {
    $errors += 'Skip-review override requires -SkipReason.'
}
if (-not [string]::IsNullOrWhiteSpace($SkipReason) -and $SkipReason.Trim().Length -lt 12) {
    $errors += 'Skip-review reason is too short. Provide a concrete justification (>= 12 chars).'
}

$requiredCode = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'code'
$requiredDb = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'db'
$requiredSecurity = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'security'
$requiredRefactor = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'refactor'
$requiredApi = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'api'
$requiredTest = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'test'
$requiredPerformance = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'performance'
$requiredInfra = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'infra'
$requiredDependency = Get-RequiredFlag -RequiredReviews $preflight.required_reviews -Key 'dependency'

$canSkipCode = $requiredCode `
    -and -not $requiredDb `
    -and -not $requiredSecurity `
    -and -not $requiredRefactor `
    -and -not $requiredApi `
    -and -not $requiredTest `
    -and -not $requiredPerformance `
    -and -not $requiredInfra `
    -and -not $requiredDependency `
    -and ([int]$preflight.metrics.changed_files_count -le 1) `
    -and ([int]$preflight.metrics.changed_lines_total -le 8)

$skipCode = $skipReviewsList -contains 'code'
if ($skipCode -and -not $canSkipCode) {
    $errors += 'Code review override is not allowed for this change scope. Allowed only for tiny low-risk code changes (<=1 file and <=8 changed lines, with no specialized reviews).'
}
if ($skipCode -and -not $requiredCode) {
    $errors += 'Code review override was requested but code review is not required by preflight.'
}

Test-ExpectedVerdict -Label 'Code review' -Required $requiredCode -SkippedByOverride $skipCode -ActualVerdict $CodeReviewVerdict -PassVerdict 'REVIEW PASSED'
Test-ExpectedVerdict -Label 'DB review' -Required $requiredDb -SkippedByOverride $false -ActualVerdict $DbReviewVerdict -PassVerdict 'DB REVIEW PASSED'
Test-ExpectedVerdict -Label 'Security review' -Required $requiredSecurity -SkippedByOverride $false -ActualVerdict $SecurityReviewVerdict -PassVerdict 'SECURITY REVIEW PASSED'
Test-ExpectedVerdict -Label 'Refactor review' -Required $requiredRefactor -SkippedByOverride $false -ActualVerdict $RefactorReviewVerdict -PassVerdict 'REFACTOR REVIEW PASSED'
Test-ExpectedVerdict -Label 'API review' -Required $requiredApi -SkippedByOverride $false -ActualVerdict $ApiReviewVerdict -PassVerdict 'API REVIEW PASSED'
Test-ExpectedVerdict -Label 'Test review' -Required $requiredTest -SkippedByOverride $false -ActualVerdict $TestReviewVerdict -PassVerdict 'TEST REVIEW PASSED'
Test-ExpectedVerdict -Label 'Performance review' -Required $requiredPerformance -SkippedByOverride $false -ActualVerdict $PerformanceReviewVerdict -PassVerdict 'PERFORMANCE REVIEW PASSED'
Test-ExpectedVerdict -Label 'Infra review' -Required $requiredInfra -SkippedByOverride $false -ActualVerdict $InfraReviewVerdict -PassVerdict 'INFRA REVIEW PASSED'
Test-ExpectedVerdict -Label 'Dependency review' -Required $requiredDependency -SkippedByOverride $false -ActualVerdict $DependencyReviewVerdict -PassVerdict 'DEPENDENCY REVIEW PASSED'

if ($errors.Count -gt 0) {
    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'review_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        preflight_path = Normalize-Path $PreflightPath
        mode = $preflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        violations = $errors
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent

    $taskFailureDetails = [ordered]@{
        preflight_path = Normalize-Path $PreflightPath
        mode = $preflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        violations = $errors
    }
    Append-TaskEvent -RepoRootPath (Resolve-ProjectRoot) -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_FAILED' -Outcome 'FAIL' -Message 'Required reviews gate failed.' -Details $taskFailureDetails

    Write-Output 'REVIEW_GATE_FAILED'
    Write-Output "Mode: $($preflight.mode)"
    Write-Output 'Violations:'
    $errors | ForEach-Object { Write-Output "- $_" }
    exit 1
}

$overrideArtifact = $null
if ($skipCode) {
    if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) {
        $preflightDir = Split-Path -Parent $PreflightPath
        $preflightName = [System.IO.Path]::GetFileNameWithoutExtension($PreflightPath)
        $baseName = $preflightName -replace '-preflight$', ''
        $OverrideArtifactPath = Join-Path $preflightDir "$baseName-override.json"
    }

    $overrideArtifact = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        preflight_path = $PreflightPath.Replace('\', '/')
        mode = $preflight.mode
        skipped_reviews = @('code')
        reason = $SkipReason.Trim()
        guardrails = [ordered]@{
            required_db = $requiredDb
            required_security = $requiredSecurity
            required_refactor = $requiredRefactor
            required_api = $requiredApi
            required_test = $requiredTest
            required_performance = $requiredPerformance
            required_infra = $requiredInfra
            required_dependency = $requiredDependency
            changed_files_count = [int]$preflight.metrics.changed_files_count
            changed_lines_total = [int]$preflight.metrics.changed_lines_total
        }
    }

    $overrideDir = Split-Path -Parent $OverrideArtifactPath
    if ($overrideDir -and -not (Test-Path $overrideDir)) {
        New-Item -Path $overrideDir -ItemType Directory -Force | Out-Null
    }
    Set-Content -Path $OverrideArtifactPath -Value ($overrideArtifact | ConvertTo-Json -Depth 8)
}

$successEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'review_gate_check'
    status = 'PASSED'
    task_id = $resolvedTaskId
    preflight_path = Normalize-Path $PreflightPath
    mode = $preflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent

$taskSuccessDetails = [ordered]@{
    preflight_path = Normalize-Path $PreflightPath
    mode = $preflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}

if ($skipCode) {
    Append-TaskEvent -RepoRootPath (Resolve-ProjectRoot) -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED_WITH_OVERRIDE' -Outcome 'PASS' -Message 'Required reviews gate passed with audited override.' -Details $taskSuccessDetails
    Write-Output 'REVIEW_GATE_PASSED_WITH_OVERRIDE'
    Write-Output "Mode: $($preflight.mode)"
    Write-Output 'SkippedReviews: code'
    Write-Output "OverrideArtifact: $OverrideArtifactPath"
    exit 0
}

Append-TaskEvent -RepoRootPath (Resolve-ProjectRoot) -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED' -Outcome 'PASS' -Message 'Required reviews gate passed.' -Details $taskSuccessDetails
Write-Output 'REVIEW_GATE_PASSED'
Write-Output "Mode: $($preflight.mode)"

