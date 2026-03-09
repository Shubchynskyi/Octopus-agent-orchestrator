[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [string]$RepoRoot,
    [string]$EventsRoot,
    [string]$OutputPath,
    [switch]$AsJson,
    [switch]$IncludeDetails
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

function Get-EventTimestamp {
    param([object]$EventRecord)

    $rawValue = $null
    if ($null -ne $EventRecord.PSObject.Properties['timestamp_utc']) {
        $rawValue = [string]$EventRecord.timestamp_utc
    }

    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return [datetime]::MinValue
    }

    try {
        return [datetime]::Parse($rawValue, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    } catch {
        return [datetime]::MinValue
    }
}

function Format-TimestampValue {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime().ToString('o')
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    try {
        $parsed = [datetime]::Parse($text, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
        return $parsed.ToUniversalTime().ToString('o')
    } catch {
        return $text
    }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$TaskId = $TaskId.Trim()
if ([string]::IsNullOrWhiteSpace($TaskId)) {
    throw 'TaskId must not be empty.'
}

if ([string]::IsNullOrWhiteSpace($EventsRoot)) {
    $EventsRoot = Join-Path $RepoRoot 'Octopus-agent-orchestrator/runtime/task-events'
}

$taskEventFile = Join-Path $EventsRoot "$TaskId.jsonl"
if (-not (Test-Path $taskEventFile)) {
    throw "Task events file not found: $taskEventFile"
}

$lines = @(Get-Content -Path $taskEventFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$events = @()
$parseErrors = 0

foreach ($line in $lines) {
    try {
        $event = $line | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $event) {
            continue
        }
        $events += $event
    } catch {
        $parseErrors++
    }
}

$events = @($events | Sort-Object { Get-EventTimestamp -EventRecord $_ })

$summary = [ordered]@{
    task_id = $TaskId
    source_path = Normalize-Path $taskEventFile
    events_count = $events.Count
    parse_errors = $parseErrors
    first_event_utc = $(if ($events.Count -gt 0) { Format-TimestampValue -Value $events[0].timestamp_utc } else { $null })
    last_event_utc = $(if ($events.Count -gt 0) { Format-TimestampValue -Value $events[$events.Count - 1].timestamp_utc } else { $null })
    timeline = @()
}

for ($i = 0; $i -lt $events.Count; $i++) {
    $event = $events[$i]
    $summary.timeline += [ordered]@{
        index = $i + 1
        timestamp_utc = $(if ($null -ne $event.PSObject.Properties['timestamp_utc']) { Format-TimestampValue -Value $event.timestamp_utc } else { $null })
        event_type = $(if ($null -ne $event.PSObject.Properties['event_type']) { [string]$event.event_type } else { 'UNKNOWN' })
        outcome = $(if ($null -ne $event.PSObject.Properties['outcome']) { [string]$event.outcome } else { 'UNKNOWN' })
        actor = $(if ($null -ne $event.PSObject.Properties['actor']) { [string]$event.actor } else { $null })
        message = $(if ($null -ne $event.PSObject.Properties['message']) { [string]$event.message } else { '' })
        details = $(if ($null -ne $event.PSObject.Properties['details']) { $event.details } else { $null })
    }
}

if ($AsJson) {
    $outputText = $summary | ConvertTo-Json -Depth 14
} else {
    $outputLines = @()
    $outputLines += "Task: $TaskId"
    $outputLines += "Source: $($summary.source_path)"
    $outputLines += "Events: $($summary.events_count)"
    if ($parseErrors -gt 0) {
        $outputLines += "ParseErrors: $parseErrors"
    }
    if ($summary.first_event_utc) {
        $outputLines += "FirstEventUTC: $($summary.first_event_utc)"
    }
    if ($summary.last_event_utc) {
        $outputLines += "LastEventUTC: $($summary.last_event_utc)"
    }
    $outputLines += ''
    $outputLines += 'Timeline:'

    foreach ($item in $summary.timeline) {
        $line = ('[{0:00}] {1} | {2} | {3}' -f $item.index, $item.timestamp_utc, $item.event_type, $item.outcome)
        if (-not [string]::IsNullOrWhiteSpace($item.actor)) {
            $line += " | actor=$($item.actor)"
        }
        if (-not [string]::IsNullOrWhiteSpace($item.message)) {
            $line += " | $($item.message)"
        }
        $outputLines += $line

        if ($IncludeDetails -and $null -ne $item.details) {
            $detailsJson = $item.details | ConvertTo-Json -Depth 12 -Compress
            $outputLines += "       details=$detailsJson"
        }
    }

    $outputText = $outputLines -join "`r`n"
}

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $outputDir = Split-Path -Parent $OutputPath
    if ($outputDir -and -not (Test-Path $outputDir)) {
        New-Item -Path $outputDir -ItemType Directory -Force | Out-Null
    }
    Set-Content -Path $OutputPath -Value $outputText
}

Write-Output $outputText
