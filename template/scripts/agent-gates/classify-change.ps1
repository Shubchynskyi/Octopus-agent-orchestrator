[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string[]]$ChangedFiles,
    [switch]$UseStaged,
    [bool]$IncludeUntracked = $true,
    [string]$TaskId = '',
    [string]$TaskIntent = '',
    [int]$FastPathMaxFiles = 2,
    [int]$FastPathMaxChangedLines = 40,
    [int]$PerformanceHeuristicMinLines = 120,
    [string]$OutputPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'classify-change')
if ($RepoRoot) { $nodeArgs += '--repo-root'; $nodeArgs += $RepoRoot }
if ($ChangedFiles) { foreach ($item in $ChangedFiles) { $nodeArgs += '--changed-files'; $nodeArgs += $item } }
if ($UseStaged) { $nodeArgs += '--use-staged' }
if ($PSBoundParameters.ContainsKey('IncludeUntracked')) { $nodeArgs += '--include-untracked'; $nodeArgs += $(if ($IncludeUntracked) { 'true' } else { 'false' }) }
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($TaskIntent) { $nodeArgs += '--task-intent'; $nodeArgs += $TaskIntent }
$nodeArgs += '--fast-path-max-files'; $nodeArgs += [string]$FastPathMaxFiles
$nodeArgs += '--fast-path-max-changed-lines'; $nodeArgs += [string]$FastPathMaxChangedLines
$nodeArgs += '--performance-heuristic-min-lines'; $nodeArgs += [string]$PerformanceHeuristicMinLines
if ($OutputPath) { $nodeArgs += '--output-path'; $nodeArgs += $OutputPath }
if ($MetricsPath) { $nodeArgs += '--metrics-path'; $nodeArgs += $MetricsPath }
if ($PSBoundParameters.ContainsKey('EmitMetrics')) { $nodeArgs += '--emit-metrics'; $nodeArgs += $(if ($EmitMetrics) { 'true' } else { 'false' }) }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
