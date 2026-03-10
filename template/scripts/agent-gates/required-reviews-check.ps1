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
    [string]$CompileEvidencePath,
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

function Assert-ValidTaskId {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'TaskId must not be empty.'
    }

    if ($Value.Length -gt 128) {
        throw 'TaskId must be 128 characters or fewer.'
    }

    if ($Value -notmatch '^[A-Za-z0-9._-]+$') {
        throw "TaskId '$Value' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$"
    }
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $hash = Get-FileHash -Path $Path -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
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

function Try-GetNonNegativeInt {
    param(
        [object]$ObjectValue,
        [string]$PropertyName,
        [ref]$ValueOut
    )

    $ValueOut.Value = 0
    if ($null -eq $ObjectValue) {
        return $false
    }

    $property = $ObjectValue.PSObject.Properties[$PropertyName]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $false
    }

    $raw = $property.Value
    if ($raw -is [int] -or $raw -is [long] -or $raw -is [short]) {
        if ([long]$raw -lt 0) {
            return $false
        }
        $ValueOut.Value = [int][long]$raw
        return $true
    }

    if ($raw -is [double] -or $raw -is [decimal] -or $raw -is [single]) {
        $doubleValue = [double]$raw
        if ($doubleValue -lt 0 -or $doubleValue -ne [Math]::Floor($doubleValue)) {
            return $false
        }
        $ValueOut.Value = [int]$doubleValue
        return $true
    }

    return $false
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
        $preflightObject = Get-Content -Raw $PreflightPathValue | ConvertFrom-Json -ErrorAction Stop
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

    $mode = $null
    if ($null -eq $preflightObject.PSObject.Properties['mode'] -or [string]::IsNullOrWhiteSpace([string]$preflightObject.mode)) {
        $errors += 'Preflight field `mode` is required.'
    } else {
        $mode = ([string]$preflightObject.mode).Trim().ToUpperInvariant()
        if (@('FULL_PATH', 'FAST_PATH') -notcontains $mode) {
            $errors += "Preflight field `mode` has unsupported value '$mode'."
        }
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

    $metricsObject = $null
    if ($null -eq $preflightObject.PSObject.Properties['metrics']) {
        $errors += 'Preflight field `metrics` is required.'
    } else {
        $metricsObject = $preflightObject.metrics
        if ($null -eq $metricsObject) {
            $errors += 'Preflight field `metrics` must be an object.'
        }
    }

    $changedFilesCount = 0
    $changedLinesTotal = 0
    if (-not (Try-GetNonNegativeInt -ObjectValue $metricsObject -PropertyName 'changed_files_count' -ValueOut ([ref]$changedFilesCount))) {
        $errors += 'Preflight field `metrics.changed_files_count` is required and must be a non-negative integer.'
    }
    if (-not (Try-GetNonNegativeInt -ObjectValue $metricsObject -PropertyName 'changed_lines_total' -ValueOut ([ref]$changedLinesTotal))) {
        $errors += 'Preflight field `metrics.changed_lines_total` is required and must be a non-negative integer.'
    }

    $preflightResolvedPath = (Resolve-Path -LiteralPath $PreflightPathValue).Path
    $preflightHash = Get-FileSha256 -Path $preflightResolvedPath

    return [PSCustomObject]@{
        preflight = $preflightObject
        resolved_task_id = $resolvedTaskId
        mode = $mode
        required_reviews = $requiredReviewFlags
        changed_files_count = $changedFilesCount
        changed_lines_total = $changedLinesTotal
        preflight_path = $preflightResolvedPath
        preflight_hash = $preflightHash
        errors = $errors
    }
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
    Assert-ValidTaskId -Value $TaskId

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

function Get-CompileGateEvidence {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$PreflightPathValue,
        [string]$PreflightHashValue,
        [string]$CompileEvidencePathValue
    )

    $result = [ordered]@{
        task_id = $ResolvedTaskId
        evidence_path = $null
        evidence_status = $null
        evidence_outcome = $null
        evidence_task_id = $null
        evidence_preflight_path = $null
        evidence_preflight_hash = $null
        evidence_source = $null
        status = 'UNKNOWN'
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        $result.status = 'TASK_ID_MISSING'
        return $result
    }

    $resolvedEvidencePath = $null
    if (-not [string]::IsNullOrWhiteSpace($CompileEvidencePathValue)) {
        if ([System.IO.Path]::IsPathRooted($CompileEvidencePathValue)) {
            $resolvedEvidencePath = $CompileEvidencePathValue
        } else {
            $resolvedEvidencePath = Join-Path $RepoRootPath $CompileEvidencePathValue
        }
    } else {
        $resolvedEvidencePath = Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-compile-gate.json"
    }
    $result.evidence_path = Normalize-Path $resolvedEvidencePath

    if (-not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) {
        $result.status = 'EVIDENCE_FILE_MISSING'
        return $result
    }

    try {
        $evidenceObject = Get-Content -Raw -LiteralPath $resolvedEvidencePath | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $result.status = 'EVIDENCE_INVALID_JSON'
        return $result
    }

    if ($null -eq $evidenceObject) {
        $result.status = 'EVIDENCE_INVALID_JSON'
        return $result
    }

    $recordedTaskId = if ($null -ne $evidenceObject.PSObject.Properties['task_id']) { [string]$evidenceObject.task_id } else { '' }
    $recordedStatus = if ($null -ne $evidenceObject.PSObject.Properties['status']) { [string]$evidenceObject.status } else { '' }
    $recordedOutcome = if ($null -ne $evidenceObject.PSObject.Properties['outcome']) { [string]$evidenceObject.outcome } else { '' }
    $recordedPreflightPath = if ($null -ne $evidenceObject.PSObject.Properties['preflight_path']) { [string]$evidenceObject.preflight_path } else { '' }
    $recordedPreflightHash = if ($null -ne $evidenceObject.PSObject.Properties['preflight_hash_sha256']) { [string]$evidenceObject.preflight_hash_sha256 } else { '' }
    $recordedSource = if ($null -ne $evidenceObject.PSObject.Properties['event_source']) { [string]$evidenceObject.event_source } else { '' }

    $result.evidence_task_id = $recordedTaskId
    $result.evidence_status = $recordedStatus
    $result.evidence_outcome = $recordedOutcome
    $result.evidence_preflight_path = Normalize-Path $recordedPreflightPath
    $result.evidence_preflight_hash = $recordedPreflightHash
    $result.evidence_source = $recordedSource

    if ([string]::IsNullOrWhiteSpace($recordedTaskId) -or -not [string]::Equals($recordedTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
        $result.status = 'EVIDENCE_TASK_MISMATCH'
        return $result
    }

    if (-not [string]::Equals($recordedSource.Trim(), 'compile-gate', [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.status = 'EVIDENCE_SOURCE_INVALID'
        return $result
    }

    if ([string]::IsNullOrWhiteSpace($recordedPreflightHash) -or -not [string]::Equals($recordedPreflightHash.Trim().ToLowerInvariant(), $PreflightHashValue.Trim().ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
        $result.status = 'EVIDENCE_PREFLIGHT_HASH_MISMATCH'
        return $result
    }

    if (-not [string]::IsNullOrWhiteSpace($recordedPreflightPath)) {
        $expectedPreflightPath = Normalize-Path (Resolve-Path -LiteralPath $PreflightPathValue).Path
        if (-not [string]::Equals((Normalize-Path $recordedPreflightPath), $expectedPreflightPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $result.status = 'EVIDENCE_PREFLIGHT_PATH_MISMATCH'
            return $result
        }
    }

    $statusNormalized = $recordedStatus.Trim().ToUpperInvariant()
    $outcomeNormalized = $recordedOutcome.Trim().ToUpperInvariant()
    if ($statusNormalized -eq 'PASSED' -and $outcomeNormalized -eq 'PASS') {
        $result.status = 'PASS'
        return $result
    }

    $result.status = 'EVIDENCE_NOT_PASS'
    return $result
}

$validatedPreflight = Get-ValidatedPreflightContext -PreflightPathValue $PreflightPath -ExplicitTaskId $TaskId
$repoRoot = Resolve-ProjectRoot
$preflight = $validatedPreflight.preflight
$resolvedTaskId = $validatedPreflight.resolved_task_id
$compileGateEvidence = Get-CompileGateEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -PreflightPathValue $validatedPreflight.preflight_path -PreflightHashValue $validatedPreflight.preflight_hash -CompileEvidencePathValue $CompileEvidencePath

$errors = @()
$errors += @($validatedPreflight.errors)
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

switch ($compileGateEvidence.status) {
    'TASK_ID_MISSING' {
        $errors += 'Compile gate evidence cannot be verified: task id is missing.'
    }
    'EVIDENCE_FILE_MISSING' {
        $errors += "Compile gate evidence missing: file not found at '$($compileGateEvidence.evidence_path)'. Run compile-gate.ps1/.sh first."
    }
    'EVIDENCE_INVALID_JSON' {
        $errors += "Compile gate evidence is invalid JSON at '$($compileGateEvidence.evidence_path)'. Re-run compile-gate.ps1/.sh."
    }
    'EVIDENCE_TASK_MISMATCH' {
        $errors += "Compile gate evidence task mismatch. Expected '$resolvedTaskId', got '$($compileGateEvidence.evidence_task_id)'."
    }
    'EVIDENCE_SOURCE_INVALID' {
        $errors += "Compile gate evidence source is invalid. Expected 'compile-gate', got '$($compileGateEvidence.evidence_source)'."
    }
    'EVIDENCE_PREFLIGHT_HASH_MISMATCH' {
        $errors += 'Compile gate evidence preflight hash mismatch. Re-run compile-gate.ps1/.sh for the current preflight artifact.'
    }
    'EVIDENCE_PREFLIGHT_PATH_MISMATCH' {
        $errors += "Compile gate evidence preflight path mismatch. Evidence path='$($compileGateEvidence.evidence_preflight_path)'."
    }
    'EVIDENCE_NOT_PASS' {
        $errors += "Compile gate did not pass. Evidence status='$($compileGateEvidence.evidence_status)', outcome='$($compileGateEvidence.evidence_outcome)'."
    }
}

$requiredCode = [bool]$validatedPreflight.required_reviews.code
$requiredDb = [bool]$validatedPreflight.required_reviews.db
$requiredSecurity = [bool]$validatedPreflight.required_reviews.security
$requiredRefactor = [bool]$validatedPreflight.required_reviews.refactor
$requiredApi = [bool]$validatedPreflight.required_reviews.api
$requiredTest = [bool]$validatedPreflight.required_reviews.test
$requiredPerformance = [bool]$validatedPreflight.required_reviews.performance
$requiredInfra = [bool]$validatedPreflight.required_reviews.infra
$requiredDependency = [bool]$validatedPreflight.required_reviews.dependency

$canSkipCode = $requiredCode `
    -and -not $requiredDb `
    -and -not $requiredSecurity `
    -and -not $requiredRefactor `
    -and -not $requiredApi `
    -and -not $requiredTest `
    -and -not $requiredPerformance `
    -and -not $requiredInfra `
    -and -not $requiredDependency `
    -and ($validatedPreflight.changed_files_count -le 1) `
    -and ($validatedPreflight.changed_lines_total -le 8)

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
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        mode = $validatedPreflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        compile_gate = $compileGateEvidence
        violations = $errors
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent

    $taskFailureDetails = [ordered]@{
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        mode = $validatedPreflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        compile_gate = $compileGateEvidence
        violations = $errors
    }
    Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_FAILED' -Outcome 'FAIL' -Message 'Required reviews gate failed.' -Details $taskFailureDetails

    Write-Output 'REVIEW_GATE_FAILED'
    Write-Output "Mode: $($validatedPreflight.mode)"
    Write-Output 'Violations:'
    $errors | ForEach-Object { Write-Output "- $_" }
    exit 1
}

$overrideArtifact = $null
if ($skipCode) {
    if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) {
        $preflightDir = Split-Path -Parent $validatedPreflight.preflight_path
        $preflightName = [System.IO.Path]::GetFileNameWithoutExtension($validatedPreflight.preflight_path)
        $baseName = $preflightName -replace '-preflight$', ''
        $OverrideArtifactPath = Join-Path $preflightDir "$baseName-override.json"
    }

    $overrideArtifact = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        preflight_path = (Normalize-Path $validatedPreflight.preflight_path)
        mode = $validatedPreflight.mode
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
            changed_files_count = $validatedPreflight.changed_files_count
            changed_lines_total = $validatedPreflight.changed_lines_total
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
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    mode = $validatedPreflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    compile_gate = $compileGateEvidence
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent

$taskSuccessDetails = [ordered]@{
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    mode = $validatedPreflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    compile_gate = $compileGateEvidence
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}

if ($skipCode) {
    Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED_WITH_OVERRIDE' -Outcome 'PASS' -Message 'Required reviews gate passed with audited override.' -Details $taskSuccessDetails
    Write-Output 'REVIEW_GATE_PASSED_WITH_OVERRIDE'
    Write-Output "Mode: $($validatedPreflight.mode)"
    Write-Output 'SkippedReviews: code'
    Write-Output "OverrideArtifact: $OverrideArtifactPath"
    exit 0
}

Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED' -Outcome 'PASS' -Message 'Required reviews gate passed.' -Details $taskSuccessDetails
Write-Output 'REVIEW_GATE_PASSED'
Write-Output "Mode: $($validatedPreflight.mode)"

