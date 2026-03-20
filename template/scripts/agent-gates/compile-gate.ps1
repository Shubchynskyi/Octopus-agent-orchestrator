[CmdletBinding()]
param(
    [string]$CommandsPath = 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md',
    [string]$TaskId = '',
    [string]$PreflightPath = '',
    [string]$CompileEvidencePath = '',
    [string]$CompileOutputPath = '',
    [int]$FailTailLines = 50,
    [string]$OutputFiltersPath = 'Octopus-agent-orchestrator/live/config/output-filters.json',
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true,
    [string]$RepoRoot
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'compile-gate')
if ($CommandsPath) { $nodeArgs += '--commands-path'; $nodeArgs += $CommandsPath }
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($CompileEvidencePath) { $nodeArgs += '--compile-evidence-path'; $nodeArgs += $CompileEvidencePath }
if ($CompileOutputPath) { $nodeArgs += '--compile-output-path'; $nodeArgs += $CompileOutputPath }
$nodeArgs += '--fail-tail-lines'; $nodeArgs += [string]$FailTailLines
if ($OutputFiltersPath) { $nodeArgs += '--output-filters-path'; $nodeArgs += $OutputFiltersPath }
if ($MetricsPath) { $nodeArgs += '--metrics-path'; $nodeArgs += $MetricsPath }
if ($PSBoundParameters.ContainsKey('EmitMetrics')) { $nodeArgs += '--emit-metrics'; $nodeArgs += $(if ($EmitMetrics) { 'true' } else { 'false' }) }
if ($RepoRoot) { $nodeArgs += '--repo-root'; $nodeArgs += $RepoRoot }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
