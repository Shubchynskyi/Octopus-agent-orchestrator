[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [string]$TimelinePath,
    [string]$ReviewsRoot,
    [string]$CompileEvidencePath,
    [string]$ReviewEvidencePath,
    [string]$DocImpactPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'completion-gate')
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($TimelinePath) { $nodeArgs += '--timeline-path'; $nodeArgs += $TimelinePath }
if ($ReviewsRoot) { $nodeArgs += '--reviews-root'; $nodeArgs += $ReviewsRoot }
if ($CompileEvidencePath) { $nodeArgs += '--compile-evidence-path'; $nodeArgs += $CompileEvidencePath }
if ($ReviewEvidencePath) { $nodeArgs += '--review-evidence-path'; $nodeArgs += $ReviewEvidencePath }
if ($DocImpactPath) { $nodeArgs += '--doc-impact-path'; $nodeArgs += $DocImpactPath }
if ($MetricsPath) { $nodeArgs += '--metrics-path'; $nodeArgs += $MetricsPath }
if ($PSBoundParameters.ContainsKey('EmitMetrics')) { $nodeArgs += '--emit-metrics'; $nodeArgs += $(if ($EmitMetrics) { 'true' } else { 'false' }) }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
