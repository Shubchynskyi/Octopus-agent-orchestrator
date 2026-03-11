[CmdletBinding()]
param(
    [string]$CommandsPath = 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md',
    [string]$TaskId = '',
    [string]$PreflightPath = '',
    [string]$CompileEvidencePath = '',
    [string]$CompileOutputPath = '',
    [int]$FailTailLines = 50,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true,
    [string]$RepoRoot
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

    return Resolve-GatePathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath -AllowMissing -AllowEmpty
}

function Ensure-ParentDirectory {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return
    }

    $parentDirectory = Split-Path -Parent $PathValue
    if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
        New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
    }
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

function Resolve-CompileOutputPath {
    param(
        [string]$ExplicitOutputPath,
        [string]$RepoRootPath,
        [string]$ResolvedTaskId
    )

    if ([string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return $null
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitOutputPath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitOutputPath -RepoRootPath $RepoRootPath
    }

    return Join-Path $RepoRootPath "Octopus-agent-orchestrator/runtime/reviews/$ResolvedTaskId-compile-output.log"
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

function Get-CompileOutputStats {
    param([string[]]$Lines)

    $warningCount = 0
    $errorCount = 0
    foreach ($line in @($Lines)) {
        if ($line -match '(?i)\bwarning\b') {
            $warningCount++
        }
        if ($line -match '(?i)\berror\b') {
            $errorCount++
        }
    }

    return [PSCustomObject]@{
        warning_lines = $warningCount
        error_lines = $errorCount
    }
}

function Append-CompileOutputEntry {
    param(
        [string]$OutputPath,
        [int]$CommandIndex,
        [int]$TotalCommands,
        [string]$Command,
        [string[]]$OutputLines
    )

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        return
    }

    Ensure-ParentDirectory -PathValue $OutputPath

    $headerLines = @(
        "==== COMMAND $CommandIndex/$TotalCommands ===="
        "COMMAND: $Command"
        "TIMESTAMP_UTC: $((Get-Date).ToUniversalTime().ToString('o'))"
        '---- OUTPUT START ----'
    )

    $footerLines = @(
        '---- OUTPUT END ----'
        ''
    )

    Add-Content -Path $OutputPath -Value $headerLines
    if ($OutputLines.Count -gt 0) {
        Add-Content -Path $OutputPath -Value $OutputLines
    }
    Add-Content -Path $OutputPath -Value $footerLines
}

function Get-OutputTail {
    param(
        [string[]]$Lines,
        [int]$TailCount
    )

    $allLines = @($Lines)
    if ($TailCount -le 0 -or $allLines.Count -eq 0) {
        return @()
    }

    if ($allLines.Count -le $TailCount) {
        return $allLines
    }

    $startIndex = $allLines.Count - $TailCount
    return $allLines[$startIndex..($allLines.Count - 1)]
}

function Write-CompileEvidence {
    param(
        [string]$EvidencePath,
        [string]$ResolvedTaskId,
        [hashtable]$GateContext,
        [string]$Status,
        [string]$Outcome,
        [string]$ErrorMessage
    )

    if ([string]::IsNullOrWhiteSpace($EvidencePath) -or [string]::IsNullOrWhiteSpace($ResolvedTaskId)) {
        return
    }

    Ensure-ParentDirectory -PathValue $EvidencePath

    $payload = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_source = 'compile-gate'
        task_id = $ResolvedTaskId
        status = $Status
        outcome = $Outcome
        error = $ErrorMessage
    }

    foreach ($key in $GateContext.Keys) {
        $payload[$key] = $GateContext[$key]
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

    Add-GateMetricsEvent -Path $Path -EventObject $EventObject -EmitMetrics $EmitMetrics
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

    Add-GateTaskEvent -RepoRootPath $RepoRootPath -TaskId $ResolvedTaskId -EventType $EventType -Outcome $Outcome -Message $Message -Details $Details
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

if ($FailTailLines -le 0) {
    throw 'FailTailLines must be a positive integer.'
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
$resolvedCompileOutputPath = $null
$compileOutputLines = New-Object 'System.Collections.Generic.List[string]'
$warningCount = 0
$errorCount = 0
$exitCode = 0
$exceptionMessage = $null
$repoLocationPushed = $false
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$pwshExecutable = (Get-Process -Id $PID).Path
if ([string]::IsNullOrWhiteSpace($pwshExecutable)) {
    $pwshExecutable = 'pwsh'
}

try {
    $resolvedCommandsPath = Resolve-CommandsPath -PathValue $CommandsPath -RepoRootPath $RepoRoot
    $compileCommands = @(Get-CompileCommands -RulePath $resolvedCommandsPath)
    $resolvedPreflightPath = Resolve-PreflightPath -ExplicitPreflightPath $PreflightPath -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId
    $preflightHash = Get-FileSha256 -PathValue $resolvedPreflightPath
    $resolvedCompileEvidencePath = Resolve-CompileEvidencePath -ExplicitEvidencePath $CompileEvidencePath -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId
    $resolvedCompileOutputPath = Resolve-CompileOutputPath -ExplicitOutputPath $CompileOutputPath -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId

    Push-Location -LiteralPath $RepoRoot
    $repoLocationPushed = $true

    for ($index = 0; $index -lt $compileCommands.Count; $index++) {
        $compileCommand = $compileCommands[$index]
        $commandOutputLines = @()
        $commandExitCode = 0

        try {
            $commandOutput = & $pwshExecutable -NoProfile -NonInteractive -Command $compileCommand 2>&1
            $commandOutputLines = @($commandOutput | ForEach-Object { [string]$_ })
            $commandExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        }
        catch {
            $commandOutputLines = @("Failed to execute compile command: $($_.Exception.Message)")
            $commandExitCode = 1
        }

        foreach ($line in $commandOutputLines) {
            $compileOutputLines.Add($line)
        }

        $stats = Get-CompileOutputStats -Lines $commandOutputLines
        $warningCount += [int]$stats.warning_lines
        $errorCount += [int]$stats.error_lines

        Append-CompileOutputEntry -OutputPath $resolvedCompileOutputPath -CommandIndex ($index + 1) -TotalCommands $compileCommands.Count -Command $compileCommand -OutputLines $commandOutputLines

        if ($commandExitCode -ne 0) {
            $exitCode = $commandExitCode
            $exceptionMessage = "Compile command #$($index + 1) exited with code $commandExitCode."
            break
        }
    }
}
catch {
    if ([string]::IsNullOrWhiteSpace($exceptionMessage)) {
        $exceptionMessage = $_.Exception.Message
    }
    if ($exitCode -eq 0) {
        $exitCode = 1
    }
}
finally {
    if ($repoLocationPushed) {
        Pop-Location
    }
    $stopwatch.Stop()
}

$durationMs = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
$totalOutputLines = $compileOutputLines.Count
$compileOutputArray = @($compileOutputLines.ToArray())
$tailOutput = Get-OutputTail -Lines $compileOutputArray -TailCount $FailTailLines

$gateContext = [ordered]@{
    commands_path = Normalize-Path $resolvedCommandsPath
    compile_commands = $compileCommands
    compile_command = $(if ($compileCommands.Count -gt 0) { $compileCommands[0] } else { $null })
    preflight_path = Normalize-Path $resolvedPreflightPath
    preflight_hash_sha256 = $preflightHash
    evidence_path = Normalize-Path $resolvedCompileEvidencePath
    compile_output_path = Normalize-Path $resolvedCompileOutputPath
    compile_output_lines = $totalOutputLines
    compile_output_warning_lines = $warningCount
    compile_output_error_lines = $errorCount
    duration_ms = $durationMs
    exit_code = $(if ($null -ne $exceptionMessage) { $exitCode } else { 0 })
}

if ($null -ne $exceptionMessage) {
    $failureEvent = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        event_type = 'compile_gate_check'
        status = 'FAILED'
        task_id = $resolvedTaskId
        error = $exceptionMessage
    }
    foreach ($key in $gateContext.Keys) {
        $failureEvent[$key] = $gateContext[$key]
    }

    Append-MetricsEvent -Path $MetricsPath -EventObject $failureEvent
    Write-CompileEvidence -EvidencePath $resolvedCompileEvidencePath -ResolvedTaskId $resolvedTaskId -GateContext $gateContext -Status 'FAILED' -Outcome 'FAIL' -ErrorMessage $exceptionMessage
    Append-TaskEvent -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId -EventType 'COMPILE_GATE_FAILED' -Outcome 'FAIL' -Message 'Compile gate failed.' -Details $failureEvent

    Write-Output 'COMPILE_GATE_FAILED'
    Write-Output ("CompileSummary: FAILED | duration_ms={0} | exit_code={1} | errors={2} | warnings={3}" -f $durationMs, $exitCode, $errorCount, $warningCount)
    if ($resolvedCompileOutputPath) {
        Write-Output ("CompileOutputPath: {0}" -f (Normalize-Path $resolvedCompileOutputPath))
    }
    if ($tailOutput.Count -gt 0) {
        Write-Output ("CompileOutputTailLast{0}Lines:" -f [Math]::Min($FailTailLines, $tailOutput.Count))
        foreach ($line in $tailOutput) {
            Write-Output $line
        }
    }
    Write-Output "Reason: $exceptionMessage"
    exit 1
}

$successEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'compile_gate_check'
    status = 'PASSED'
    task_id = $resolvedTaskId
}
foreach ($key in $gateContext.Keys) {
    $successEvent[$key] = $gateContext[$key]
}

Append-MetricsEvent -Path $MetricsPath -EventObject $successEvent
Write-CompileEvidence -EvidencePath $resolvedCompileEvidencePath -ResolvedTaskId $resolvedTaskId -GateContext $gateContext -Status 'PASSED' -Outcome 'PASS' -ErrorMessage $null
Append-TaskEvent -RepoRootPath $RepoRoot -ResolvedTaskId $resolvedTaskId -EventType 'COMPILE_GATE_PASSED' -Outcome 'PASS' -Message 'Compile gate passed.' -Details $successEvent

Write-Output 'COMPILE_GATE_PASSED'
Write-Output ("CompileSummary: PASSED | duration_ms={0} | exit_code=0 | errors={1} | warnings={2}" -f $durationMs, $errorCount, $warningCount)
if ($resolvedCompileOutputPath) {
    Write-Output ("CompileOutputPath: {0}" -f (Normalize-Path $resolvedCompileOutputPath))
}
