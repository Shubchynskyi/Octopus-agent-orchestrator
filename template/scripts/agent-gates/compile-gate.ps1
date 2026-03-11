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

function Normalize-RelativePath {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue -TrimValue -StripLeadingRelative
}

function Assert-ValidTaskId {
    param([string]$Value)

    Assert-GateTaskId -Value $Value
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value
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
        [bool]$IncludeUntracked
    )

    $sourceValue = if ([string]::IsNullOrWhiteSpace($DetectionSource)) { 'git_auto' } else { $DetectionSource.Trim().ToLowerInvariant() }
    $useStaged = $sourceValue -in @('git_staged_only', 'git_staged_plus_untracked')
    if ($sourceValue -eq 'git_staged_only') {
        $IncludeUntracked = $false
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

function Get-PreflightContext {
    param(
        [string]$PreflightPathValue,
        [string]$ResolvedTaskId
    )

    if ([string]::IsNullOrWhiteSpace($PreflightPathValue)) {
        throw "Preflight artifact path is required for compile gate task '$ResolvedTaskId'."
    }
    if (-not (Test-Path -LiteralPath $PreflightPathValue -PathType Leaf)) {
        throw "Preflight artifact not found: $PreflightPathValue"
    }

    try {
        $preflightObject = Get-Content -Raw -LiteralPath $PreflightPathValue | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "Preflight artifact is not valid JSON: $PreflightPathValue"
    }

    $preflightTaskId = if ($null -ne $preflightObject.PSObject.Properties['task_id']) { [string]$preflightObject.task_id } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($preflightTaskId) -and -not [string]::Equals($preflightTaskId.Trim(), $ResolvedTaskId, [System.StringComparison]::Ordinal)) {
        throw "TaskId '$ResolvedTaskId' does not match preflight.task_id '$($preflightTaskId.Trim())'."
    }

    if ($null -eq $preflightObject.PSObject.Properties['changed_files']) {
        throw 'Preflight field `changed_files` is required.'
    }
    if ($null -eq $preflightObject.PSObject.Properties['metrics'] -or $null -eq $preflightObject.metrics) {
        throw 'Preflight field `metrics` is required.'
    }
    if ($null -eq $preflightObject.PSObject.Properties['required_reviews'] -or $null -eq $preflightObject.required_reviews) {
        throw 'Preflight field `required_reviews` is required.'
    }

    $normalizedChangedFiles = @(
        Convert-ToStringArray $preflightObject.changed_files |
            ForEach-Object { Normalize-RelativePath $_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    )

    $metricChangedLines = $null
    if ($null -ne $preflightObject.metrics.PSObject.Properties['changed_lines_total']) {
        $rawChangedLines = $preflightObject.metrics.changed_lines_total
        if ($rawChangedLines -is [int] -or $rawChangedLines -is [long] -or $rawChangedLines -is [short]) {
            $metricChangedLines = [int][long]$rawChangedLines
        } elseif ($rawChangedLines -is [double] -or $rawChangedLines -is [decimal] -or $rawChangedLines -is [single]) {
            $metricChangedLines = [int][double]$rawChangedLines
        }
    }
    if ($null -eq $metricChangedLines -or $metricChangedLines -lt 0) {
        throw 'Preflight field `metrics.changed_lines_total` is required and must be non-negative.'
    }

    $detectionSource = if ($null -ne $preflightObject.PSObject.Properties['detection_source']) { [string]$preflightObject.detection_source } else { 'git_auto' }
    $includeUntracked = $true
    if ([string]::Equals($detectionSource.Trim(), 'git_staged_only', [System.StringComparison]::OrdinalIgnoreCase)) {
        $includeUntracked = $false
    }

    return [PSCustomObject]@{
        preflight = $preflightObject
        task_id = $ResolvedTaskId
        detection_source = $detectionSource
        include_untracked = [bool]$includeUntracked
        changed_files = $normalizedChangedFiles
        changed_files_count = $normalizedChangedFiles.Count
        changed_lines_total = $metricChangedLines
        changed_files_sha256 = Get-StringSha256 -Text ($normalizedChangedFiles -join "`n")
    }
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
        if ($command -match '(?i)\borg\.apache\.maven\.wrapper\.mavenwrappermain\b') {
            throw "Compile command anti-pattern detected in ${RulePath}: use wrapper entrypoint script (for example './mvnw' or '.\\mvnw.cmd') instead of MavenWrapperMain class invocation."
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
if ([string]::IsNullOrWhiteSpace($resolvedTaskId)) {
    throw 'TaskId is required for compile gate.'
}

$resolvedCommandsPath = $null
$compileCommands = @()
$resolvedPreflightPath = $null
$preflightHash = $null
$preflightContext = $null
$workspaceSnapshot = $null
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
    $preflightContext = Get-PreflightContext -PreflightPathValue $resolvedPreflightPath -ResolvedTaskId $resolvedTaskId
    $workspaceSnapshot = Get-WorkspaceSnapshot -RepoRootPath $RepoRoot -DetectionSource $preflightContext.detection_source -IncludeUntracked $preflightContext.include_untracked

    $scopeViolations = @()
    if ($workspaceSnapshot.changed_files_sha256 -ne $preflightContext.changed_files_sha256) {
        $scopeViolations += 'Preflight changed_files differ from current workspace snapshot.'
    }
    if ([int]$workspaceSnapshot.changed_lines_total -ne [int]$preflightContext.changed_lines_total) {
        $scopeViolations += "Preflight changed_lines_total=$($preflightContext.changed_lines_total) differs from current snapshot changed_lines_total=$($workspaceSnapshot.changed_lines_total)."
    }
    if ($scopeViolations.Count -gt 0) {
        $scopeDetails = [ordered]@{
            preflight_changed_files = $preflightContext.changed_files
            preflight_changed_files_count = $preflightContext.changed_files_count
            preflight_changed_lines_total = $preflightContext.changed_lines_total
            preflight_changed_files_sha256 = $preflightContext.changed_files_sha256
            snapshot_detection_source = $workspaceSnapshot.detection_source
            snapshot_include_untracked = $workspaceSnapshot.include_untracked
            snapshot_changed_files = $workspaceSnapshot.changed_files
            snapshot_changed_files_count = $workspaceSnapshot.changed_files_count
            snapshot_changed_lines_total = $workspaceSnapshot.changed_lines_total
            snapshot_changed_files_sha256 = $workspaceSnapshot.changed_files_sha256
            violations = $scopeViolations
        }
        throw ("Preflight scope drift detected. Re-run classify-change before compile gate. Details: " + ($scopeDetails | ConvertTo-Json -Depth 8 -Compress))
    }

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
    preflight_detection_source = $(if ($null -ne $preflightContext) { $preflightContext.detection_source } else { $null })
    preflight_include_untracked = $(if ($null -ne $preflightContext) { [bool]$preflightContext.include_untracked } else { $null })
    preflight_changed_files_count = $(if ($null -ne $preflightContext) { [int]$preflightContext.changed_files_count } else { $null })
    preflight_changed_lines_total = $(if ($null -ne $preflightContext) { [int]$preflightContext.changed_lines_total } else { $null })
    preflight_changed_files_sha256 = $(if ($null -ne $preflightContext) { $preflightContext.changed_files_sha256 } else { $null })
    scope_detection_source = $(if ($null -ne $workspaceSnapshot) { $workspaceSnapshot.detection_source } else { $null })
    scope_use_staged = $(if ($null -ne $workspaceSnapshot) { [bool]$workspaceSnapshot.use_staged } else { $null })
    scope_include_untracked = $(if ($null -ne $workspaceSnapshot) { [bool]$workspaceSnapshot.include_untracked } else { $null })
    scope_changed_files = $(if ($null -ne $workspaceSnapshot) { $workspaceSnapshot.changed_files } else { @() })
    scope_changed_files_count = $(if ($null -ne $workspaceSnapshot) { [int]$workspaceSnapshot.changed_files_count } else { 0 })
    scope_changed_lines_total = $(if ($null -ne $workspaceSnapshot) { [int]$workspaceSnapshot.changed_lines_total } else { 0 })
    scope_changed_files_sha256 = $(if ($null -ne $workspaceSnapshot) { $workspaceSnapshot.changed_files_sha256 } else { $null })
    scope_sha256 = $(if ($null -ne $workspaceSnapshot) { $workspaceSnapshot.scope_sha256 } else { $null })
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
