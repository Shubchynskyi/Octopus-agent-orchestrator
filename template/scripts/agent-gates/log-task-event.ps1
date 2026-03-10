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

function Resolve-ProjectRoot {
    $projectRootCandidate = Join-Path $PSScriptRoot '..\..\..\..'
    if (Test-Path $projectRootCandidate) {
        return (Resolve-Path $projectRootCandidate).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
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
    details = $details
}

$line = $event | ConvertTo-Json -Depth 12 -Compress
$taskFilePath = Join-Path $EventsRoot "$TaskId.jsonl"
$allTasksPath = Join-Path $EventsRoot 'all-tasks.jsonl'

Add-Content -Path $taskFilePath -Value $line
Add-Content -Path $allTasksPath -Value $line

$result = [ordered]@{
    status = 'TASK_EVENT_LOGGED'
    task_id = $TaskId
    event_type = $EventType
    outcome = $Outcome
    actor = $Actor
    task_event_log_path = Normalize-Path $taskFilePath
    all_tasks_log_path = Normalize-Path $allTasksPath
}

Write-Output ($result | ConvertTo-Json -Depth 8)
