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

function Get-CommandAuditFromDetails {
    param([object]$DetailsObject)

    if ($null -eq $DetailsObject) {
        return $null
    }

    $existingAudit = $null
    if ($DetailsObject -is [System.Collections.IDictionary]) {
        if ($DetailsObject.Contains('command_policy_audit')) {
            $existingAudit = $DetailsObject['command_policy_audit']
        }
    } elseif ($null -ne $DetailsObject.PSObject.Properties['command_policy_audit']) {
        $existingAudit = $DetailsObject.command_policy_audit
    }
    if ($null -ne $existingAudit) {
        return $existingAudit
    }

    $commandText = $null
    $mode = 'scan'
    $justification = ''
    if ($DetailsObject -is [System.Collections.IDictionary]) {
        foreach ($candidateKey in @('command', 'command_text', 'shell_command')) {
            if ($DetailsObject.Contains($candidateKey) -and -not [string]::IsNullOrWhiteSpace([string]$DetailsObject[$candidateKey])) {
                $commandText = [string]$DetailsObject[$candidateKey]
                break
            }
        }
        if ($DetailsObject.Contains('command_mode')) {
            $mode = [string]$DetailsObject['command_mode']
        } elseif ($DetailsObject.Contains('mode')) {
            $mode = [string]$DetailsObject['mode']
        }
        if ($DetailsObject.Contains('command_justification')) {
            $justification = [string]$DetailsObject['command_justification']
        } elseif ($DetailsObject.Contains('justification')) {
            $justification = [string]$DetailsObject['justification']
        }
    } else {
        foreach ($candidateKey in @('command', 'command_text', 'shell_command')) {
            $property = $DetailsObject.PSObject.Properties[$candidateKey]
            if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                $commandText = [string]$property.Value
                break
            }
        }
        if ($null -ne $DetailsObject.PSObject.Properties['command_mode']) {
            $mode = [string]$DetailsObject.command_mode
        } elseif ($null -ne $DetailsObject.PSObject.Properties['mode']) {
            $mode = [string]$DetailsObject.mode
        }
        if ($null -ne $DetailsObject.PSObject.Properties['command_justification']) {
            $justification = [string]$DetailsObject.command_justification
        } elseif ($null -ne $DetailsObject.PSObject.Properties['justification']) {
            $justification = [string]$DetailsObject.justification
        }
    }

    if ([string]::IsNullOrWhiteSpace($commandText)) {
        return $null
    }

    return Test-GateCommandCompactness -CommandText $commandText -Mode $mode -Justification $justification
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$TaskId = $TaskId.Trim()
Assert-ValidTaskId -Value $TaskId

if ([string]::IsNullOrWhiteSpace($EventsRoot)) {
    $EventsRoot = Join-GateOrchestratorPath -RepoRootPath $RepoRoot -RelativePath 'runtime/task-events'
}

$taskEventFile = Join-Path $EventsRoot "$TaskId.jsonl"
if (-not (Test-Path $taskEventFile)) {
    throw "Task events file not found: $taskEventFile"
}

$lines = @(Get-Content -Path $taskEventFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$events = @()
$parseErrors = 0
$integrityReport = Get-GateTaskTimelineIntegrity -TaskEventFilePath $taskEventFile -TaskId $TaskId

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
    integrity = $integrityReport
    command_policy_warnings = @()
    command_policy_warning_count = 0
    first_event_utc = $(if ($events.Count -gt 0) { Format-TimestampValue -Value $events[0].timestamp_utc } else { $null })
    last_event_utc = $(if ($events.Count -gt 0) { Format-TimestampValue -Value $events[$events.Count - 1].timestamp_utc } else { $null })
    timeline = @()
}

for ($i = 0; $i -lt $events.Count; $i++) {
    $event = $events[$i]
    $eventDetails = $(if ($null -ne $event.PSObject.Properties['details']) { $event.details } else { $null })
    $commandAudit = Get-CommandAuditFromDetails -DetailsObject $eventDetails
    if ($null -ne $commandAudit -and $commandAudit.warning_count -gt 0) {
        $summary.command_policy_warnings += @($commandAudit.warnings)
    }
    $summary.timeline += [ordered]@{
        index = $i + 1
        timestamp_utc = $(if ($null -ne $event.PSObject.Properties['timestamp_utc']) { Format-TimestampValue -Value $event.timestamp_utc } else { $null })
        event_type = $(if ($null -ne $event.PSObject.Properties['event_type']) { [string]$event.event_type } else { 'UNKNOWN' })
        outcome = $(if ($null -ne $event.PSObject.Properties['outcome']) { [string]$event.outcome } else { 'UNKNOWN' })
        actor = $(if ($null -ne $event.PSObject.Properties['actor']) { [string]$event.actor } else { $null })
        message = $(if ($null -ne $event.PSObject.Properties['message']) { [string]$event.message } else { '' })
        details = $eventDetails
        command_policy_audit = $commandAudit
    }
}
$summary.command_policy_warning_count = @($summary.command_policy_warnings).Count

if ($AsJson) {
    $outputText = $summary | ConvertTo-Json -Depth 14
} else {
    $outputLines = @()
    $outputLines += "Task: $TaskId"
    $outputLines += "Source: $($summary.source_path)"
    $outputLines += "Events: $($summary.events_count)"
    $outputLines += "IntegrityStatus: $($integrityReport.status)"
    if ($parseErrors -gt 0) {
        $outputLines += "ParseErrors: $parseErrors"
    }
    if ($integrityReport.integrity_event_count -gt 0) {
        $outputLines += "IntegrityEvents: $($integrityReport.integrity_event_count)"
    }
    if ($integrityReport.legacy_event_count -gt 0) {
        $outputLines += "LegacyEvents: $($integrityReport.legacy_event_count)"
    }
    if (@($integrityReport.violations).Count -gt 0) {
        $outputLines += "IntegrityViolations: $(@($integrityReport.violations).Count)"
    }
    if ($summary.first_event_utc) {
        $outputLines += "FirstEventUTC: $($summary.first_event_utc)"
    }
    if ($summary.last_event_utc) {
        $outputLines += "LastEventUTC: $($summary.last_event_utc)"
    }
    if ($summary.command_policy_warning_count -gt 0) {
        $outputLines += "CommandPolicyWarnings: $($summary.command_policy_warning_count)"
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

    if (@($integrityReport.violations).Count -gt 0) {
        $outputLines += ''
        $outputLines += 'IntegrityViolations:'
        foreach ($violation in @($integrityReport.violations)) {
            $outputLines += "- $violation"
        }
    }
    if ($summary.command_policy_warning_count -gt 0) {
        $outputLines += ''
        $outputLines += 'CommandPolicyWarnings:'
        foreach ($warning in @($summary.command_policy_warnings)) {
            $outputLines += "- $warning"
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
