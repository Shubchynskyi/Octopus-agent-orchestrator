Set-StrictMode -Version Latest

function Get-GateProjectRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptRoot
    )

    $projectRootCandidate = Join-Path $ScriptRoot '..\..\..\..'
    if (Test-Path -LiteralPath $projectRootCandidate) {
        return (Resolve-Path -LiteralPath $projectRootCandidate).Path
    }

    return (Resolve-Path -LiteralPath (Join-Path $ScriptRoot '..\..')).Path
}

function Convert-GatePathToUnix {
    param(
        [string]$PathValue,
        [switch]$TrimValue,
        [switch]$StripLeadingRelative
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $normalized = $PathValue.Replace('\', '/')
    if ($TrimValue) {
        $normalized = $normalized.Trim()
    }

    if ($StripLeadingRelative) {
        while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
            $normalized = $normalized.Substring(2)
        }
        $normalized = $normalized.TrimStart('/')
    }

    return $normalized
}

function Assert-GateTaskId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

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

function Resolve-GatePathInsideRepo {
    param(
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [switch]$AllowMissing,
        [switch]$AllowEmpty
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        if ($AllowEmpty) {
            return $null
        }
        throw 'Path value must not be empty.'
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) { $PathValue } else { Join-Path $RepoRootPath $PathValue }
    $fullPath = [System.IO.Path]::GetFullPath($candidate)
    $fullPathTrimmed = $fullPath.TrimEnd('\', '/')
    $repoNormalized = ([System.IO.Path]::GetFullPath($RepoRootPath)).TrimEnd('\', '/')
    $repoBoundary = $repoNormalized + [System.IO.Path]::DirectorySeparatorChar
    if (-not (
            [string]::Equals($fullPathTrimmed, $repoNormalized, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullPath.StartsWith($repoBoundary, [System.StringComparison]::OrdinalIgnoreCase)
        )) {
        throw "Path '$PathValue' must resolve inside repository root '$RepoRootPath'."
    }

    if (-not $AllowMissing -and -not (Test-Path -LiteralPath $fullPath)) {
        throw "Path not found: $fullPath"
    }

    if (Test-Path -LiteralPath $fullPath) {
        return (Resolve-Path -LiteralPath $fullPath).Path
    }

    return $fullPath
}

function Convert-GateToStringArray {
    param(
        [object]$Value,
        [switch]$TrimValues
    )

    if ($null -eq $Value) {
        return @()
    }

    $result = @()
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($entry in $Value) {
            if ($null -eq $entry) {
                continue
            }

            $stringValue = [string]$entry
            if ($TrimValues) {
                $stringValue = $stringValue.Trim()
            }

            if ([string]::IsNullOrWhiteSpace($stringValue)) {
                continue
            }

            $result += $stringValue
        }
        return $result
    }

    $singleValue = [string]$Value
    if ($TrimValues) {
        $singleValue = $singleValue.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($singleValue)) {
        return @()
    }

    return @($singleValue)
}

function Test-GateMatchAnyRegex {
    param(
        [string]$PathValue,
        [string[]]$Regexes,
        [switch]$SkipInvalidRegex,
        [string]$InvalidRegexContext = ''
    )

    foreach ($regex in @($Regexes)) {
        if ([string]::IsNullOrWhiteSpace($regex)) {
            continue
        }

        if (-not $SkipInvalidRegex) {
            if ($PathValue -match $regex) {
                return $true
            }
            continue
        }

        try {
            if ([regex]::IsMatch($PathValue, $regex)) {
                return $true
            }
        } catch {
            if ([string]::IsNullOrWhiteSpace($InvalidRegexContext)) {
                Write-Warning "Invalid regex '$regex': $($_.Exception.Message)"
            } else {
                Write-Warning "Invalid regex '$regex' for ${InvalidRegexContext}: $($_.Exception.Message)"
            }
        }
    }

    return $false
}

function Add-GateMetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject,
        [bool]$EmitMetrics = $true
    )

    if (-not $EmitMetrics) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    try {
        $metricsDir = Split-Path -Parent $Path
        if ($metricsDir -and -not (Test-Path -LiteralPath $metricsDir)) {
            New-Item -Path $metricsDir -ItemType Directory -Force | Out-Null
        }

        $line = $EventObject | ConvertTo-Json -Depth 12 -Compress
        Add-Content -LiteralPath $Path -Value $line
    } catch {
        Write-Warning "Metrics append failed: $($_.Exception.Message)"
    }
}

function Add-GateTaskEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null
    )

    if ([string]::IsNullOrWhiteSpace($TaskId)) {
        return
    }

    Assert-GateTaskId -Value $TaskId

    try {
        $eventsDir = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/task-events'
        if (-not (Test-Path -LiteralPath $eventsDir)) {
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

        Add-Content -LiteralPath $taskFilePath -Value $line
        Add-Content -LiteralPath $allTasksPath -Value $line
    } catch {
        Write-Warning "Task-event append failed: $($_.Exception.Message)"
    }
}

Export-ModuleMember -Function @(
    'Get-GateProjectRoot',
    'Convert-GatePathToUnix',
    'Assert-GateTaskId',
    'Resolve-GatePathInsideRepo',
    'Convert-GateToStringArray',
    'Test-GateMatchAnyRegex',
    'Add-GateMetricsEvent',
    'Add-GateTaskEvent'
)
