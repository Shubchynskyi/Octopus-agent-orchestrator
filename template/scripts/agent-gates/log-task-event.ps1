[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [Parameter(Mandatory = $true)]
    [string]$EventType,
    [ValidateSet('INFO', 'PASS', 'FAIL', 'BLOCKED')]
    [string]$Outcome = 'INFO',
    [string]$Message = '',
    [string]$Actor = 'orchestrator',
    [string]$DetailsJson = '',
    [string]$RepoRoot,
    [string]$EventsRoot
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

function Assert-ValidTaskId {
    param([string]$Value)

    Assert-GateTaskId -Value $Value
}

function Resolve-PathInsideRepo {
    param(
        [string]$PathValue,
        [string]$RepoRootPath
    )

    return Resolve-GatePathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath -AllowMissing
}

function Convert-ToDetailsMap {
    param([object]$DetailsObject)

    if ($null -eq $DetailsObject) {
        return [ordered]@{}
    }

    if ($DetailsObject -is [System.Collections.IDictionary]) {
        $copy = [ordered]@{}
        foreach ($key in $DetailsObject.Keys) {
            $copy[$key] = $DetailsObject[$key]
        }
        return $copy
    }

    if ($DetailsObject -is [PSCustomObject]) {
        try {
            $converted = $DetailsObject | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
            if ($converted -is [System.Collections.IDictionary]) {
                $copy = [ordered]@{}
                foreach ($key in $converted.Keys) {
                    $copy[$key] = $converted[$key]
                }
                return $copy
            }
        } catch {
        }
    }

    return [ordered]@{
        input_details = $DetailsObject
    }
}

function Invoke-TerminalLogCleanup {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId
    )

    $cleanupResult = [ordered]@{
        triggered = $true
        attempted_paths = 0
        discovered_paths = @()
        deleted_paths = @()
        missing_paths = @()
        errors = @()
    }

    $candidatePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $reviewsRoot = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/reviews'

    if (Test-Path -LiteralPath $reviewsRoot -PathType Container) {
        $pattern = "$ResolvedTaskId-compile-output*.log"
        $matchedPaths = @(Get-ChildItem -Path $reviewsRoot -Filter $pattern -File -ErrorAction SilentlyContinue)
        foreach ($matchedPath in $matchedPaths) {
            [void]$candidatePaths.Add($matchedPath.FullName)
        }
    }

    $compileEvidencePath = Join-Path $reviewsRoot "$ResolvedTaskId-compile-gate.json"
    if (Test-Path -LiteralPath $compileEvidencePath -PathType Leaf) {
        try {
            $compileEvidence = Get-Content -LiteralPath $compileEvidencePath -Raw | ConvertFrom-Json -ErrorAction Stop
            $compileOutputPathProperty = $compileEvidence.PSObject.Properties['compile_output_path']
            if ($compileOutputPathProperty -and -not [string]::IsNullOrWhiteSpace([string]$compileOutputPathProperty.Value)) {
                $resolvedEvidenceOutputPath = Resolve-PathInsideRepo -PathValue ([string]$compileOutputPathProperty.Value) -RepoRootPath $RepoRootPath
                [void]$candidatePaths.Add($resolvedEvidenceOutputPath)
            }
        } catch {
            $cleanupResult.errors += "Failed to read compile evidence '$($compileEvidencePath)': $($_.Exception.Message)"
        }
    }

    foreach ($candidatePath in $candidatePaths) {
        $resolvedCandidatePath = $null
        try {
            $resolvedCandidatePath = Resolve-PathInsideRepo -PathValue $candidatePath -RepoRootPath $RepoRootPath
        } catch {
            $cleanupResult.errors += "Compile output path is invalid '$candidatePath': $($_.Exception.Message)"
            continue
        }

        $normalizedCandidatePath = Normalize-Path $resolvedCandidatePath
        $cleanupResult.discovered_paths += $normalizedCandidatePath
        $cleanupResult.attempted_paths = $cleanupResult.discovered_paths.Count

        if (-not (Test-Path -LiteralPath $resolvedCandidatePath -PathType Leaf)) {
            $cleanupResult.missing_paths += $normalizedCandidatePath
            continue
        }

        try {
            Remove-Item -LiteralPath $resolvedCandidatePath -Force -ErrorAction Stop
            $cleanupResult.deleted_paths += $normalizedCandidatePath
        } catch {
            $cleanupResult.errors += "Failed to delete compile output '$normalizedCandidatePath': $($_.Exception.Message)"
        }
    }

    return $cleanupResult
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$TaskId = $TaskId.Trim()
$EventType = $EventType.Trim()
Assert-ValidTaskId -Value $TaskId
if ([string]::IsNullOrWhiteSpace($EventType)) {
    throw 'EventType must not be empty.'
}
if ($EventType -match '^(COMPILE_GATE_|REVIEW_GATE_|PREFLIGHT_)') {
    throw "EventType '$EventType' is reserved and cannot be emitted via log-task-event."
}

if ([string]::IsNullOrWhiteSpace($EventsRoot)) {
    $EventsRoot = Join-Path $RepoRoot 'Octopus-agent-orchestrator/runtime/task-events'
}

$details = $null
if (-not [string]::IsNullOrWhiteSpace($DetailsJson)) {
    try {
        $details = $DetailsJson | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "DetailsJson is not valid JSON: $($_.Exception.Message)"
    }
}

$terminalCleanup = [ordered]@{
    triggered = $false
    attempted_paths = 0
    discovered_paths = @()
    deleted_paths = @()
    missing_paths = @()
    errors = @()
}
$cleanupFailed = $false
$eventDetails = $details

$isTerminalEvent = $EventType -in @('TASK_DONE', 'TASK_BLOCKED')
if ($isTerminalEvent) {
    $terminalCleanup = Invoke-TerminalLogCleanup -RepoRootPath $RepoRoot -ResolvedTaskId $TaskId
    $cleanupFailed = $terminalCleanup.errors.Count -gt 0
    $detailsMap = Convert-ToDetailsMap -DetailsObject $details
    $detailsMap['terminal_log_cleanup'] = $terminalCleanup
    $eventDetails = [PSCustomObject]$detailsMap
}

if (-not (Test-Path $EventsRoot)) {
    New-Item -Path $EventsRoot -ItemType Directory -Force | Out-Null
}

$event = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    task_id = $TaskId
    event_type = $EventType
    outcome = $Outcome
    actor = $Actor
    message = $Message
    details = $eventDetails
}
$taskFilePath = Join-Path $EventsRoot "$TaskId.jsonl"
$allTasksPath = Join-Path $EventsRoot 'all-tasks.jsonl'
$appendResult = Add-GateTaskEvent -RepoRootPath $RepoRoot -TaskId $TaskId -EventType $EventType -Outcome $Outcome -Message $Message -Details $eventDetails -Actor $Actor -PassThru

$result = [ordered]@{
    status = 'TASK_EVENT_LOGGED'
    task_id = $TaskId
    event_type = $EventType
    outcome = $Outcome
    actor = $Actor
    task_event_log_path = Normalize-Path $taskFilePath
    all_tasks_log_path = Normalize-Path $allTasksPath
}
if ($null -ne $appendResult) {
    if ($appendResult.Contains('integrity')) {
        $result['integrity'] = $appendResult.integrity
    }
    if ($appendResult.Contains('warnings') -and @($appendResult.warnings).Count -gt 0) {
        $result['warnings'] = @($appendResult.warnings)
    }
}
if ($isTerminalEvent) {
    $result['terminal_log_cleanup'] = $terminalCleanup
}
if ($cleanupFailed) {
    $result['status'] = 'TASK_EVENT_LOGGED_CLEANUP_FAILED'
    Write-Output ($result | ConvertTo-Json -Depth 12)
    exit 1
}

Write-Output ($result | ConvertTo-Json -Depth 8)
