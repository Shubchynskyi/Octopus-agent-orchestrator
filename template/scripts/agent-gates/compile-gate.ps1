[CmdletBinding()]
param(
    [string]$CommandsPath = 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md',
    [string]$TaskId = '',
    [string]$PreflightPath = '',
    [string]$CompileEvidencePath = '',
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true,
    [string]$RepoRoot
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

function Resolve-PathInsideRepo {
    param(
        [string]$PathValue,
        [string]$RepoRootPath
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) { $PathValue } else { Join-Path $RepoRootPath $PathValue }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    $repoNormalized = ([System.IO.Path]::GetFullPath($RepoRootPath)).TrimEnd('\')
    if (-not $resolved.StartsWith($repoNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path '$PathValue' must resolve inside repository root '$RepoRootPath'."
    }
    return $resolved
}

function Resolve-PreflightPath {
    param(
        [string]$ExplicitPreflightPath,
        [string]$RepoRootPath,
        [string]$ResolvedTaskId
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPreflightPath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitPreflightPath -RepoRootPath $RepoRootPath
    }

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return $null
    }

    return Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-preflight.json"
}

function Resolve-CompileEvidencePath {
    param(
        [string]$ExplicitEvidencePath,
        [string]$RepoRootPath,
        [string]$ResolvedTaskId
    )

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return $null
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitEvidencePath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitEvidencePath -RepoRootPath $RepoRootPath
    }

    return Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-compile-gate.json"
}

function Get-FileSha256 {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        return $null
    }

    return (Get-FileHash -Path $PathValue -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-CompileEvidence {
    param(
        [string]$EvidencePath,
        [string]$ResolvedTaskId,
        [string]$PreflightPathResolved,
        [string]$PreflightHash,
        [string]$Status,
        [string]$Outcome,
        [string[]]$CompileCommands,
        [string]$ResolvedCommandsPath,
        [int]$DurationMs,
        [int]$ExitCode,
        [string]$ErrorMessage
    )

    if ([string]::IsNullOrWhiteSpace($EvidencePath) -or [string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return
    }

    $evidenceDir = Split-Path -Parent $EvidencePath
    if ($evidenceDir -and -not (Test-Path -LiteralPath $evidenceDir)) {
        New-Item -Path $evidenceDir -ItemType Directory -Force | Out-Null
    }

    $payload = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_source = 'compile-gate'
        task_id = $ResolvedTaskId
        status = $Status
        outcome = $Outcome
        commands_path = Normalize-Path $ResolvedCommandsPath
        compile_commands = $CompileCommands
        preflight_path = Normalize-Path $PreflightPathResolved
        preflight_hash_sha256 = $PreflightHash
        duration_ms = $DurationMs
        exit_code = $ExitCode
        error = $ErrorMessage
    }

    Set-Content -LiteralPath $EvidencePath -Value ($payload | ConvertTo-Json -Depth 12)
}

function Resolve-CommandsPath {
    param(
        [string]$PathValue,
        [string]$RepoRootPath
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw 'CommandsPath must not be empty.'
    }

    $resolved = Resolve-PathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath
    return (Resolve-Path -LiteralPath $resolved).Path
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

function Append-TaskEvent {
    param(
        [string]$RepoRootPath,
        [string]$ResolvedTaskId,
        [string]$EventType,
        [string]$Outcome,
        [string]$Message,
        [object]$Details
    )

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return
    }
    Assert-ValidTaskId -Value $ResolvedTaskId

    try {
        $eventsDir = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/task-events'
        if (-not (Test-Path $eventsDir)) {
            New-Item -Path $eventsDir -ItemType Directory -Force | Out-Null
        }

        $event = [ordered]@{
            timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
            task_id = $ResolvedTaskId
            event_type = $EventType
            outcome = $Outcome
            message = $Message
            details = $Details
        }

        $line = $event | ConvertTo-Json -Depth 12 -Compress
        $taskFilePath = Join-Path $eventsDir "$ResolvedTaskId.jsonl"
        $allTasksPath = Join-Path $eventsDir 'all-tasks.jsonl'

        Add-Content -Path $taskFilePath -Value $line
        Add-Content -Path $allTasksPath -Value $line
    } catch {
        Write-Verbose "Task-event append failed: $($_.Exception.Message)"
    }
}

function Get-CompileCommands {
    param([string]$RulePath)

    $lines = @(Get-Content -Path $RulePath)
    if ($lines.Count -eq 0) {
        throw "Commands file is empty: $RulePath"
    }

    $sectionIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '### Compile Gate (Mandatory)') {
            $sectionIndex = $i
            break
        }
    }

    if ($sectionIndex -lt 0) {
        throw "Section '### Compile Gate (Mandatory)' not found in $RulePath"
    }

    $fenceStart = -1
    for ($i = $sectionIndex + 1; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($trimmed -match '^```') {
            $fenceStart = $i
            break
        }
        if ($trimmed -match '^###\s+') {
            break
        }
    }

    if ($fenceStart -lt 0) {
        throw "Code fence with compile command not found under '### Compile Gate (Mandatory)' in $RulePath"
    }

    $commands = @()
    for ($i = $fenceStart + 1; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($trimmed -match '^```') {
            break
        }
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }
        if ($trimmed.StartsWith('#')) {
            continue
        }
        $commands += $trimmed
    }

    if ($commands.Count -eq 0) {
        throw "Compile command is missing under '### Compile Gate (Mandatory)' in $RulePath"
    }

    foreach ($command in $commands) {
        if ($command -match '^\s*<[^>]+>\s*$') {
            throw "Compile command placeholder is unresolved in ${RulePath}: $command"
        }
    }

    return $commands
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

if ([string]::IsNullOrWhiteSpace($MetricsPath)) {
    $MetricsPath = Join-Path $RepoRoot 'Octopus-agent-orchestrator/runtime/metrics.jsonl'
}

$resolvedTaskId = if ([string]::IsNullOrWhiteSpace($TaskId)) { $null } else { $TaskId.Trim() }
if (-not [string]::IsNullOrWhiteSpace($resolvedTaskId)) {
    Assert-ValidTaskId -Value $resolvedTaskId
}
$resolvedCommandsPath = $null
$compileCommands = @()
$resolvedPreflightPath = $null
$preflightHash = $null
$resolvedCompileEvidencePath = $null
$exitCode = 1
$durationMs = 0
$exceptionMessage = $null
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

try {
    $resolvedCommandsPath = Resolve-CommandsPath -PathValue $CommandsPath -RepoRootPath $RepoRoot
    $compileCommands = @(Get-CompileCommands -RulePath $resolvedCommandsPath)
    $resolvedPreflightPath = Resolve-PreflightPath -ExplicitPreflightPath $PreflightPath -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId
    $preflightHash = Get-FileSha256 -PathValue $resolvedPreflightPath
    $resolvedCompileEvidencePath = Resolve-CompileEvidencePath -ExplicitEvidencePath $CompileEvidencePath -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId

    Push-Location $RepoRoot
    try {
        foreach ($compileCommand in $compileCommands) {
            $global:LASTEXITCODE = 0
            Invoke-Expression $compileCommand
            $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
            if (-not $?) {
                if ($exitCode -eq 0) {
                    $exitCode = 1
                }
            }
            if ($exitCode -ne 0) {
                throw "Compile command exited with code $exitCode."
            }
        }
    } finally {
        Pop-Location
    }
} catch {
    $exceptionMessage = $_.Exception.Message
} finally {
    $stopwatch.Stop()
    $durationMs = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
}

if ($null -ne $exceptionMessage) {
    $failureDetails = [ordered]@{
        commands_path = Normalize-Path $resolvedCommandsPath
        compile_commands = $compileCommands
        compile_command = $(if ($compileCommands.Count -gt 0) { $compileCommands[0] } else { $null })
        preflight_path = Normalize-Path $resolvedPreflightPath
        preflight_hash_sha256 = $preflightHash
        evidence_path = Normalize-Path $resolvedCompileEvidencePath
        duration_ms = $durationMs
        exit_code = $exitCode
        error = $exceptionMessage
    }

    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'compile_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        commands_path = Normalize-Path $resolvedCommandsPath
        compile_commands = $compileCommands
        compile_command = $(if ($compileCommands.Count -gt 0) { $compileCommands[0] } else { $null })
        preflight_path = Normalize-Path $resolvedPreflightPath
        preflight_hash_sha256 = $preflightHash
        evidence_path = Normalize-Path $resolvedCompileEvidencePath
        duration_ms = $durationMs
        exit_code = $exitCode
        error = $exceptionMessage
    }
    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent
    Write-CompileEvidence -EvidencePath $resolvedCompileEvidencePath -ResolvedTaskId $resolvedTaskId -PreflightPathResolved $resolvedPreflightPath -PreflightHash $preflightHash -Status 'FAILED' -Outcome 'FAIL' -CompileCommands $compileCommands -ResolvedCommandsPath $resolvedCommandsPath -DurationMs $durationMs -ExitCode $exitCode -ErrorMessage $exceptionMessage
    Append-TaskEvent -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId -EventType 'COMPILE_GATE_FAILED' -Outcome 'FAIL' -Message 'Compile gate failed.' -Details $failureDetails

    Write-Output 'COMPILE_GATE_FAILED'
    if ($resolvedCommandsPath) {
        Write-Output "CommandsPath: $($resolvedCommandsPath.Replace('\', '/'))"
    }
    if ($compileCommands.Count -gt 0) {
        Write-Output "CompileCommand: $($compileCommands[0])"
        if ($compileCommands.Count -gt 1) {
            Write-Output "CompileCommandsCount: $($compileCommands.Count)"
        }
    }
    if ($resolvedCompileEvidencePath) {
        Write-Output "CompileEvidencePath: $($resolvedCompileEvidencePath.Replace('\', '/'))"
    }
    Write-Output "DurationMs: $durationMs"
    Write-Output "ExitCode: $exitCode"
    Write-Output "Reason: $exceptionMessage"
    exit 1
}

$successDetails = [ordered]@{
    commands_path = Normalize-Path $resolvedCommandsPath
    compile_commands = $compileCommands
    compile_command = $(if ($compileCommands.Count -gt 0) { $compileCommands[0] } else { $null })
    preflight_path = Normalize-Path $resolvedPreflightPath
    preflight_hash_sha256 = $preflightHash
    evidence_path = Normalize-Path $resolvedCompileEvidencePath
    duration_ms = $durationMs
    exit_code = 0
}

$successEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'compile_gate_check'
    status = 'PASSED'
    task_id = $resolvedTaskId
    commands_path = Normalize-Path $resolvedCommandsPath
    compile_commands = $compileCommands
    compile_command = $(if ($compileCommands.Count -gt 0) { $compileCommands[0] } else { $null })
    preflight_path = Normalize-Path $resolvedPreflightPath
    preflight_hash_sha256 = $preflightHash
    evidence_path = Normalize-Path $resolvedCompileEvidencePath
    duration_ms = $durationMs
    exit_code = 0
}
Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent
Write-CompileEvidence -EvidencePath $resolvedCompileEvidencePath -ResolvedTaskId $resolvedTaskId -PreflightPathResolved $resolvedPreflightPath -PreflightHash $preflightHash -Status 'PASSED' -Outcome 'PASS' -CompileCommands $compileCommands -ResolvedCommandsPath $resolvedCommandsPath -DurationMs $durationMs -ExitCode 0 -ErrorMessage $null
Append-TaskEvent -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId -EventType 'COMPILE_GATE_PASSED' -Outcome 'PASS' -Message 'Compile gate passed.' -Details $successDetails

Write-Output 'COMPILE_GATE_PASSED'
Write-Output "CommandsPath: $($resolvedCommandsPath.Replace('\', '/'))"
if ($compileCommands.Count -gt 0) {
    Write-Output "CompileCommand: $($compileCommands[0])"
    if ($compileCommands.Count -gt 1) {
        Write-Output "CompileCommandsCount: $($compileCommands.Count)"
    }
}
if ($resolvedCompileEvidencePath) {
    Write-Output "CompileEvidencePath: $($resolvedCompileEvidencePath.Replace('\', '/'))"
}
Write-Output "DurationMs: $durationMs"
