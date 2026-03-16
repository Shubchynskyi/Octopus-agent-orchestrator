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
    [string]$ReviewsRoot = '',
    [string]$ReviewEvidencePath,
    [string]$OutputFiltersPath = 'Octopus-agent-orchestrator/live/config/output-filters.json',
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

function Normalize-Path {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue
}

function Normalize-RelativePath {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue -TrimValue -StripLeadingRelative
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value
}

function Assert-ValidTaskId {
    param([string]$Value)

    Assert-GateTaskId -Value $Value
}

function Invoke-GitLines {
    param(
        [string]$RepoRootPath,
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    $output = & git -C $RepoRootPath @Arguments 2>$null
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($exitCode -ne 0) {
        throw $FailureMessage
    }

    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Resolve-PathInsideRepo {
    param(
        [string]$PathValue,
        [string]$RepoRootPath
    )

    return Resolve-GatePathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath -AllowMissing -AllowEmpty
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $hash = Get-FileHash -Path $Path -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
}

function Get-StringSha256 {
    param([string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($(if ($null -eq $Text) { '' } else { $Text }))
        $hashBytes = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-FileLineCount {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue) -or -not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        return 0
    }

    try {
        return [int]((Get-Content -LiteralPath $PathValue -ErrorAction Stop | Measure-Object -Line).Lines)
    } catch {
        return 0
    }
}

function Get-WorkspaceSnapshot {
    param(
        [string]$RepoRootPath,
        [string]$DetectionSource,
        [bool]$IncludeUntracked,
        [string[]]$ExplicitChangedFiles = @()
    )

    $sourceValue = if ([string]::IsNullOrWhiteSpace($DetectionSource)) { 'git_auto' } else { $DetectionSource.Trim().ToLowerInvariant() }
    $useStaged = $sourceValue -in @('git_staged_only', 'git_staged_plus_untracked')
    if ($sourceValue -eq 'git_staged_only') {
        $IncludeUntracked = $false
    }

    $normalizedExplicitChangedFiles = @(
        $ExplicitChangedFiles |
            ForEach-Object { Normalize-RelativePath $_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    )

    if ($sourceValue -eq 'explicit_changed_files' -and $normalizedExplicitChangedFiles.Count -gt 0) {
        $numstatRowsByPath = @{}
        $numstatArgs = @('diff', '--numstat', '--diff-filter=ACMRTUXB', 'HEAD', '--') + $normalizedExplicitChangedFiles
        $numstatRows = Invoke-GitLines -RepoRootPath $RepoRootPath -Arguments $numstatArgs -FailureMessage 'Failed to collect explicit changed lines snapshot.'
        foreach ($row in $numstatRows) {
            $parts = $row -split "`t"
            if ($parts.Count -lt 3) {
                continue
            }

            $normalizedPath = Normalize-RelativePath $parts[2]
            if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
                continue
            }

            $numstatRowsByPath[$normalizedPath] = @{
                additions = $parts[0]
                deletions = $parts[1]
            }
        }

        $additionsTotal = 0
        $deletionsTotal = 0
        foreach ($filePath in $normalizedExplicitChangedFiles) {
            if ($numstatRowsByPath.ContainsKey($filePath)) {
                $row = $numstatRowsByPath[$filePath]
                if ($row.additions -match '^\d+$') {
                    $additionsTotal += [int]$row.additions
                }
                if ($row.deletions -match '^\d+$') {
                    $deletionsTotal += [int]$row.deletions
                }
                continue
            }

            $fullPath = Join-Path $RepoRootPath $filePath
            if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                $additionsTotal += Get-FileLineCount -PathValue $fullPath
            }
        }

        $changedLinesTotal = $additionsTotal + $deletionsTotal
        $filesFingerprint = Get-StringSha256 -Text ($normalizedExplicitChangedFiles -join "`n")
        $scopeFingerprint = Get-StringSha256 -Text ("{0}|{1}|{2}|{3}|{4}|{5}" -f $sourceValue, $false, $IncludeUntracked, $normalizedExplicitChangedFiles.Count, $changedLinesTotal, $filesFingerprint)

        return [PSCustomObject]@{
            detection_source = $sourceValue
            use_staged = $false
            include_untracked = [bool]$IncludeUntracked
            changed_files = $normalizedExplicitChangedFiles
            changed_files_count = $normalizedExplicitChangedFiles.Count
            additions_total = $additionsTotal
            deletions_total = $deletionsTotal
            changed_lines_total = $changedLinesTotal
            changed_files_sha256 = $filesFingerprint
            scope_sha256 = $scopeFingerprint
        }
    }

    $diffArgs = @('diff', '--name-only', '--diff-filter=ACMRTUXB')
    if ($useStaged) {
        $diffArgs += '--cached'
    } else {
        $diffArgs += 'HEAD'
    }
    $changedFromDiff = Invoke-GitLines -RepoRootPath $RepoRootPath -Arguments $diffArgs -FailureMessage 'Failed to collect changed files snapshot.'

    $untrackedFiles = @()
    if ($IncludeUntracked) {
        $untrackedFiles = Invoke-GitLines -RepoRootPath $RepoRootPath -Arguments @('ls-files', '--others', '--exclude-standard') -FailureMessage 'Failed to collect untracked files snapshot.'
    }

    $normalizedChangedFiles = @(
        $changedFromDiff + $untrackedFiles |
            ForEach-Object { Normalize-RelativePath $_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    )

    $numstatArgs = @('diff', '--numstat', '--diff-filter=ACMRTUXB')
    if ($useStaged) {
        $numstatArgs += '--cached'
    } else {
        $numstatArgs += 'HEAD'
    }
    $numstatRows = Invoke-GitLines -RepoRootPath $RepoRootPath -Arguments $numstatArgs -FailureMessage 'Failed to collect changed lines snapshot.'

    $additionsTotal = 0
    $deletionsTotal = 0
    foreach ($row in $numstatRows) {
        $parts = $row -split "`t"
        if ($parts.Count -lt 3) {
            continue
        }

        if ($parts[0] -match '^\d+$') {
            $additionsTotal += [int]$parts[0]
        }
        if ($parts[1] -match '^\d+$') {
            $deletionsTotal += [int]$parts[1]
        }
    }

    if ($IncludeUntracked -and $untrackedFiles.Count -gt 0) {
        foreach ($untrackedFile in $untrackedFiles) {
            $normalizedPath = Normalize-RelativePath $untrackedFile
            if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
                continue
            }

            $fullPath = Join-Path $RepoRootPath $normalizedPath
            $additionsTotal += Get-FileLineCount -PathValue $fullPath
        }
    }

    $changedLinesTotal = $additionsTotal + $deletionsTotal
    $filesFingerprint = Get-StringSha256 -Text ($normalizedChangedFiles -join "`n")
    $scopeFingerprint = Get-StringSha256 -Text ("{0}|{1}|{2}|{3}|{4}|{5}" -f $sourceValue, $useStaged, $IncludeUntracked, $normalizedChangedFiles.Count, $changedLinesTotal, $filesFingerprint)

    return [PSCustomObject]@{
        detection_source = $sourceValue
        use_staged = $useStaged
        include_untracked = [bool]$IncludeUntracked
        changed_files = $normalizedChangedFiles
        changed_files_count = $normalizedChangedFiles.Count
        additions_total = $additionsTotal
        deletions_total = $deletionsTotal
        changed_lines_total = $changedLinesTotal
        changed_files_sha256 = $filesFingerprint
        scope_sha256 = $scopeFingerprint
    }
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

    $detectionSource = if ($null -ne $preflightObject.PSObject.Properties['detection_source']) { [string]$preflightObject.detection_source } else { 'git_auto' }
    $includeUntracked = $true
    if ([string]::Equals($detectionSource.Trim(), 'git_staged_only', [System.StringComparison]::OrdinalIgnoreCase)) {
        $includeUntracked = $false
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
        detection_source = $detectionSource
        include_untracked = [bool]$includeUntracked
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

    Add-GateTaskEvent -RepoRootPath $RepoRootPath -TaskId $TaskId -EventType $EventType -Outcome $Outcome -Message $Message -Details $Details
}

function Resolve-ReviewEvidencePath {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$ReviewEvidencePathValue
    )

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return $null
    }

    if (-not [string]::IsNullOrWhiteSpace($ReviewEvidencePathValue)) {
        if ([System.IO.Path]::IsPathRooted($ReviewEvidencePathValue)) {
            return $ReviewEvidencePathValue
        }
        return Join-Path $RepoRootPath $ReviewEvidencePathValue
    }

    return Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-review-gate.json"
}

function Write-ReviewEvidence {
    param(
        [string]$EvidencePath,
        [string]$ResolvedTaskId,
        [hashtable]$Context,
        [string]$Status,
        [string]$Outcome,
        [string[]]$Violations
    )

    if ([string]::IsNullOrWhiteSpace($EvidencePath) -or [string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return
    }

    $parentDirectory = Split-Path -Parent $EvidencePath
    if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
        New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
    }

    $payload = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_source = 'required-reviews-check'
        task_id = $ResolvedTaskId
        status = $Status
        outcome = $Outcome
        violations = @($Violations)
    }
    foreach ($key in $Context.Keys) {
        $payload[$key] = $Context[$key]
    }

    Set-Content -LiteralPath $EvidencePath -Value ($payload | ConvertTo-Json -Depth 12)
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

$script:REVIEW_CONTRACTS = @(
    @{ key = 'code';        pass_token = 'REVIEW PASSED' },
    @{ key = 'db';          pass_token = 'DB REVIEW PASSED' },
    @{ key = 'security';    pass_token = 'SECURITY REVIEW PASSED' },
    @{ key = 'refactor';    pass_token = 'REFACTOR REVIEW PASSED' },
    @{ key = 'api';         pass_token = 'API REVIEW PASSED' },
    @{ key = 'test';        pass_token = 'TEST REVIEW PASSED' },
    @{ key = 'performance'; pass_token = 'PERFORMANCE REVIEW PASSED' },
    @{ key = 'infra';       pass_token = 'INFRA REVIEW PASSED' },
    @{ key = 'dependency';  pass_token = 'DEPENDENCY REVIEW PASSED' }
)

function Test-ReviewArtifacts {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [object]$RequiredReviews,
        [object]$Verdicts,
        [string[]]$SkipReviewsList,
        [string]$ReviewsRootValue
    )

    if (-not [string]::IsNullOrWhiteSpace($ReviewsRootValue)) {
        if ([System.IO.Path]::IsPathRooted($ReviewsRootValue)) {
            $reviewsRoot = $ReviewsRootValue
        } else {
            $reviewsRoot = Join-Path $RepoRootPath $ReviewsRootValue
        }
    } else {
        $reviewsRoot = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/reviews'
    }

    $result = [ordered]@{
        reviews_root = Normalize-Path $reviewsRoot
        checked = @()
        violations = @()
    }

    $skipSet = @($SkipReviewsList | ForEach-Object { $_.ToLowerInvariant() })

    foreach ($contract in $script:REVIEW_CONTRACTS) {
        $reviewKey = $contract.key
        $passToken = $contract.pass_token

        if (-not [bool]$RequiredReviews[$reviewKey]) {
            continue
        }
        $actualVerdict = if ($Verdicts.ContainsKey($reviewKey)) { $Verdicts[$reviewKey] } else { 'NOT_REQUIRED' }
        if ($actualVerdict -ne $passToken) {
            continue
        }
        if ($skipSet -contains $reviewKey) {
            continue
        }

        $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $reviewsRoot "$ResolvedTaskId-$reviewKey.md"))
        $entry = [ordered]@{
            review     = $reviewKey
            path       = Normalize-Path $artifactPath
            pass_token = $passToken
            present    = $false
            token_found = $false
            sha256     = $null
        }

        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            $result.violations += "Review artifact not found for claimed '$passToken': $($entry.path)"
            $result.checked += $entry
            continue
        }

        $entry.present = $true
        $entry.sha256 = Get-FileSha256 -Path $artifactPath
        $content = Get-Content -LiteralPath $artifactPath -Raw -Encoding UTF8
        if ($content -and $content.Contains($passToken)) {
            $entry.token_found = $true
        } else {
            $result.violations += "Review artifact '$($entry.path)' does not contain pass token '$passToken'."
        }
        $result.checked += $entry
    }

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
        task_id = $ResolvedTaskId
        evidence_path = $null
        evidence_hash = $null
        evidence_status = $null
        evidence_outcome = $null
        evidence_task_id = $null
        evidence_preflight_path = $null
        evidence_preflight_hash = $null
        evidence_source = $null
        evidence_scope_detection_source = $null
        evidence_scope_include_untracked = $null
        evidence_scope_changed_files = @()
        evidence_scope_changed_files_count = 0
        evidence_scope_changed_lines_total = 0
        evidence_scope_changed_files_sha256 = $null
        evidence_scope_sha256 = $null
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
    $result.evidence_hash = Get-FileSha256 -Path $resolvedEvidencePath

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
    $recordedScopeDetectionSource = if ($null -ne $evidenceObject.PSObject.Properties['scope_detection_source']) { [string]$evidenceObject.scope_detection_source } else { '' }
    $recordedScopeIncludeUntracked = if ($null -ne $evidenceObject.PSObject.Properties['scope_include_untracked']) { [bool]$evidenceObject.scope_include_untracked } else { $true }
    $recordedScopeChangedFiles = if ($null -ne $evidenceObject.PSObject.Properties['scope_changed_files']) { @(Convert-ToStringArray $evidenceObject.scope_changed_files) } else { @() }
    $recordedScopeChangedFilesCount = if ($null -ne $evidenceObject.PSObject.Properties['scope_changed_files_count']) { [int]$evidenceObject.scope_changed_files_count } else { 0 }
    $recordedScopeChangedLinesTotal = if ($null -ne $evidenceObject.PSObject.Properties['scope_changed_lines_total']) { [int]$evidenceObject.scope_changed_lines_total } else { 0 }
    $recordedScopeChangedFilesSha = if ($null -ne $evidenceObject.PSObject.Properties['scope_changed_files_sha256']) { [string]$evidenceObject.scope_changed_files_sha256 } else { '' }
    $recordedScopeSha = if ($null -ne $evidenceObject.PSObject.Properties['scope_sha256']) { [string]$evidenceObject.scope_sha256 } else { '' }

    $result.evidence_task_id = $recordedTaskId
    $result.evidence_status = $recordedStatus
    $result.evidence_outcome = $recordedOutcome
    $result.evidence_preflight_path = Normalize-Path $recordedPreflightPath
    $result.evidence_preflight_hash = $recordedPreflightHash
    $result.evidence_source = $recordedSource
    $result.evidence_scope_detection_source = $recordedScopeDetectionSource
    $result.evidence_scope_include_untracked = [bool]$recordedScopeIncludeUntracked
    $result.evidence_scope_changed_files = @($recordedScopeChangedFiles)
    $result.evidence_scope_changed_files_count = [int]$recordedScopeChangedFilesCount
    $result.evidence_scope_changed_lines_total = [int]$recordedScopeChangedLinesTotal
    $result.evidence_scope_changed_files_sha256 = $recordedScopeChangedFilesSha
    $result.evidence_scope_sha256 = $recordedScopeSha

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

    if ([string]::IsNullOrWhiteSpace($recordedScopeDetectionSource) -or [string]::IsNullOrWhiteSpace($recordedScopeChangedFilesSha) -or [string]::IsNullOrWhiteSpace($recordedScopeSha)) {
        $result.status = 'EVIDENCE_SCOPE_MISSING'
        return $result
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

function Test-CompileScopeDrift {
    param(
        [string]$RepoRootPath,
        [object]$CompileEvidence
    )

    $result = [ordered]@{
        status = 'UNKNOWN'
        detection_source = $null
        include_untracked = $null
        current_scope = $null
        evidence_scope_sha256 = $null
        evidence_changed_files_sha256 = $null
        evidence_changed_lines_total = $null
        violations = @()
    }

    if ($null -eq $CompileEvidence -or [string]::IsNullOrWhiteSpace([string]$CompileEvidence.evidence_scope_detection_source)) {
        $result.status = 'EVIDENCE_SCOPE_MISSING'
        $result.violations += 'Compile gate evidence does not include scope snapshot.'
        return $result
    }

    $detectionSource = [string]$CompileEvidence.evidence_scope_detection_source
    $includeUntracked = [bool]$CompileEvidence.evidence_scope_include_untracked
    $snapshot = Get-WorkspaceSnapshot -RepoRootPath $RepoRootPath -DetectionSource $detectionSource -IncludeUntracked $includeUntracked -ExplicitChangedFiles $CompileEvidence.evidence_scope_changed_files

    $result.detection_source = $detectionSource
    $result.include_untracked = [bool]$includeUntracked
    $result.current_scope = $snapshot
    $result.evidence_scope_sha256 = [string]$CompileEvidence.evidence_scope_sha256
    $result.evidence_changed_files_sha256 = [string]$CompileEvidence.evidence_scope_changed_files_sha256
    $result.evidence_changed_lines_total = [int]$CompileEvidence.evidence_scope_changed_lines_total

    if (-not [string]::Equals([string]$CompileEvidence.evidence_scope_sha256, [string]$snapshot.scope_sha256, [System.StringComparison]::Ordinal)) {
        $result.violations += 'Workspace scope fingerprint changed after compile gate.'
    }
    if (-not [string]::Equals([string]$CompileEvidence.evidence_scope_changed_files_sha256, [string]$snapshot.changed_files_sha256, [System.StringComparison]::Ordinal)) {
        $result.violations += 'Workspace changed_files fingerprint differs from compile evidence.'
    }
    if ([int]$CompileEvidence.evidence_scope_changed_lines_total -ne [int]$snapshot.changed_lines_total) {
        $result.violations += "Workspace changed_lines_total=$($snapshot.changed_lines_total) differs from compile evidence changed_lines_total=$([int]$CompileEvidence.evidence_scope_changed_lines_total)."
    }

    if ($result.violations.Count -gt 0) {
        $result.status = 'DRIFT_DETECTED'
        return $result
    }

    $result.status = 'PASS'
    return $result
}

$validatedPreflight = Get-ValidatedPreflightContext -PreflightPathValue $PreflightPath -ExplicitTaskId $TaskId
$repoRoot = Resolve-ProjectRoot
$resolvedOutputFiltersPath = Resolve-PathInsideRepo -PathValue $OutputFiltersPath -RepoRootPath $repoRoot
$preflight = $validatedPreflight.preflight
$resolvedTaskId = $validatedPreflight.resolved_task_id
$compileGateEvidence = Get-CompileGateEvidence -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -PreflightPathValue $validatedPreflight.preflight_path -PreflightHashValue $validatedPreflight.preflight_hash -CompileEvidencePathValue $CompileEvidencePath
$scopeDrift = $null
if ($compileGateEvidence.status -eq 'PASS') {
    $scopeDrift = Test-CompileScopeDrift -RepoRootPath $repoRoot -CompileEvidence $compileGateEvidence
}

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
    'EVIDENCE_SCOPE_MISSING' {
        $errors += 'Compile gate evidence is missing scope snapshot fields. Re-run compile-gate.ps1/.sh.'
    }
    'EVIDENCE_NOT_PASS' {
        $errors += "Compile gate did not pass. Evidence status='$($compileGateEvidence.evidence_status)', outcome='$($compileGateEvidence.evidence_outcome)'."
    }
}

if ($null -ne $scopeDrift) {
    if ($scopeDrift.status -eq 'EVIDENCE_SCOPE_MISSING') {
        $errors += @($scopeDrift.violations)
    } elseif ($scopeDrift.status -eq 'DRIFT_DETECTED') {
        $errors += 'Workspace changed after compile gate; rerun compile-gate.ps1/.sh before review gate.'
        $errors += @($scopeDrift.violations)
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

$artifactEvidence = Test-ReviewArtifacts `
    -RepoRootPath $repoRoot `
    -ResolvedTaskId $resolvedTaskId `
    -RequiredReviews $validatedPreflight.required_reviews `
    -Verdicts @{
        code = $CodeReviewVerdict; db = $DbReviewVerdict; security = $SecurityReviewVerdict
        refactor = $RefactorReviewVerdict; api = $ApiReviewVerdict; test = $TestReviewVerdict
        performance = $PerformanceReviewVerdict; infra = $InfraReviewVerdict; dependency = $DependencyReviewVerdict
    } `
    -SkipReviewsList $skipReviewsList `
    -ReviewsRootValue $ReviewsRoot
$errors += @($artifactEvidence.violations)

$resolvedReviewEvidencePath = Resolve-ReviewEvidencePath -RepoRootPath $repoRoot -ResolvedTaskId $resolvedTaskId -ReviewEvidencePathValue $ReviewEvidencePath
$reviewEvidenceContext = [ordered]@{
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    preflight_hash_sha256 = $validatedPreflight.preflight_hash
    mode = $validatedPreflight.mode
    compile_evidence_path = $compileGateEvidence.evidence_path
    compile_evidence_hash_sha256 = $compileGateEvidence.evidence_hash
    output_filters_path = Normalize-Path $resolvedOutputFiltersPath
    scope_drift = $scopeDrift
    required_reviews = $validatedPreflight.required_reviews
    verdicts = [ordered]@{
        code = $CodeReviewVerdict
        db = $DbReviewVerdict
        security = $SecurityReviewVerdict
        refactor = $RefactorReviewVerdict
        api = $ApiReviewVerdict
        test = $TestReviewVerdict
        performance = $PerformanceReviewVerdict
        infra = $InfraReviewVerdict
        dependency = $DependencyReviewVerdict
    }
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
    artifact_evidence = $artifactEvidence
}

if ($errors.Count -gt 0) {
    $failureOutputLines = New-Object 'System.Collections.Generic.List[string]'
    $failureOutputLines.Add('REVIEW_GATE_FAILED')
    $failureOutputLines.Add("Mode: $($validatedPreflight.mode)")
    $failureOutputLines.Add('Violations:')
    foreach ($errorLine in @($errors)) {
        $failureOutputLines.Add("- $errorLine")
    }
    $filteredFailureOutput = Invoke-GateOutputFilter -Lines $failureOutputLines -ConfigPath $resolvedOutputFiltersPath -ProfileName 'review_gate_failure_console'
    $filteredFailureOutputLines = @($filteredFailureOutput.lines)
    $failureOutputTelemetry = Get-GateOutputTelemetry -RawLines $failureOutputLines -FilteredLines $filteredFailureOutputLines -FilterMode $filteredFailureOutput.filter_mode -FallbackMode $filteredFailureOutput.fallback_mode -ParserMode $filteredFailureOutput.parser_mode -ParserName $filteredFailureOutput.parser_name -ParserStrategy $filteredFailureOutput.parser_strategy
    $reviewEvidenceContext['output_telemetry'] = $failureOutputTelemetry

    Write-ReviewEvidence -EvidencePath $resolvedReviewEvidencePath -ResolvedTaskId $resolvedTaskId -Context $reviewEvidenceContext -Status 'FAILED' -Outcome 'FAIL' -Violations @($errors)

    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'review_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        review_evidence_path = Normalize-Path $resolvedReviewEvidencePath
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        mode = $validatedPreflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        output_filters_path = Normalize-Path $resolvedOutputFiltersPath
        compile_gate = $compileGateEvidence
        violations = $errors
    }
    foreach ($key in $failureOutputTelemetry.Keys) {
        $failureEvent[$key] = $failureOutputTelemetry[$key]
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent

    $taskFailureDetails = [ordered]@{
        review_evidence_path = Normalize-Path $resolvedReviewEvidencePath
        preflight_path = Normalize-Path $validatedPreflight.preflight_path
        mode = $validatedPreflight.mode
        skip_reviews = $skipReviewsList
        skip_reason = $SkipReason
        compile_gate = $compileGateEvidence
        violations = $errors
    }
    Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_FAILED' -Outcome 'FAIL' -Message 'Required reviews gate failed.' -Details $taskFailureDetails

    foreach ($line in $filteredFailureOutputLines) {
        Write-Output $line
    }
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

$successOutputLines = New-Object 'System.Collections.Generic.List[string]'
if ($skipCode) {
    $successOutputLines.Add('REVIEW_GATE_PASSED_WITH_OVERRIDE')
    $successOutputLines.Add("Mode: $($validatedPreflight.mode)")
    $successOutputLines.Add('SkippedReviews: code')
    if (-not [string]::IsNullOrWhiteSpace($OverrideArtifactPath)) {
        $successOutputLines.Add("OverrideArtifact: $OverrideArtifactPath")
    }
} else {
    $successOutputLines.Add('REVIEW_GATE_PASSED')
    $successOutputLines.Add("Mode: $($validatedPreflight.mode)")
}
$filteredSuccessOutput = Invoke-GateOutputFilter -Lines $successOutputLines -ConfigPath $resolvedOutputFiltersPath -ProfileName 'review_gate_success_console'
$filteredSuccessOutputLines = @($filteredSuccessOutput.lines)
$successOutputTelemetry = Get-GateOutputTelemetry -RawLines $successOutputLines -FilteredLines $filteredSuccessOutputLines -FilterMode $filteredSuccessOutput.filter_mode -FallbackMode $filteredSuccessOutput.fallback_mode -ParserMode $filteredSuccessOutput.parser_mode -ParserName $filteredSuccessOutput.parser_name -ParserStrategy $filteredSuccessOutput.parser_strategy
$reviewEvidenceContext['override_artifact'] = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
$reviewEvidenceContext['output_telemetry'] = $successOutputTelemetry
Write-ReviewEvidence -EvidencePath $resolvedReviewEvidencePath -ResolvedTaskId $resolvedTaskId -Context $reviewEvidenceContext -Status 'PASSED' -Outcome 'PASS' -Violations @()

$successEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'review_gate_check'
    status = 'PASSED'
    task_id = $resolvedTaskId
    review_evidence_path = Normalize-Path $resolvedReviewEvidencePath
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    mode = $validatedPreflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    output_filters_path = Normalize-Path $resolvedOutputFiltersPath
    compile_gate = $compileGateEvidence
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}
foreach ($key in $successOutputTelemetry.Keys) {
    $successEvent[$key] = $successOutputTelemetry[$key]
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent

$taskSuccessDetails = [ordered]@{
    review_evidence_path = Normalize-Path $resolvedReviewEvidencePath
    preflight_path = Normalize-Path $validatedPreflight.preflight_path
    mode = $validatedPreflight.mode
    skip_reviews = $skipReviewsList
    skip_reason = $SkipReason
    compile_gate = $compileGateEvidence
    override_artifact = $(if ([string]::IsNullOrWhiteSpace($OverrideArtifactPath)) { $null } else { Normalize-Path $OverrideArtifactPath })
}

if ($skipCode) {
    Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED_WITH_OVERRIDE' -Outcome 'PASS' -Message 'Required reviews gate passed with audited override.' -Details $taskSuccessDetails
    foreach ($line in $filteredSuccessOutputLines) {
        Write-Output $line
    }
    exit 0
}

Append-TaskEvent -RepoRootPath $repoRoot -TaskId $resolvedTaskId -EventType 'REVIEW_GATE_PASSED' -Outcome 'PASS' -Message 'Required reviews gate passed.' -Details $taskSuccessDetails
foreach ($line in $filteredSuccessOutputLines) {
    Write-Output $line
}

