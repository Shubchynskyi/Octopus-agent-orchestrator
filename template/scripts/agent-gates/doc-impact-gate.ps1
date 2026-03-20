[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [ValidateSet('NO_DOC_UPDATES', 'DOCS_UPDATED')]
    [string]$Decision = 'NO_DOC_UPDATES',
    [bool]$BehaviorChanged = $false,
    [string[]]$DocsUpdated = @(),
    [bool]$ChangelogUpdated = $false,
    [bool]$SensitiveScopeReviewed = $false,
    [string]$Rationale = '',
    [string]$ArtifactPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'doc-impact-gate')
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($Decision) { $nodeArgs += '--decision'; $nodeArgs += $Decision }
if ($PSBoundParameters.ContainsKey('BehaviorChanged')) { $nodeArgs += '--behavior-changed'; $nodeArgs += $(if ($BehaviorChanged) { 'true' } else { 'false' }) }
if ($DocsUpdated) { foreach ($item in $DocsUpdated) { $nodeArgs += '--docs-updated'; $nodeArgs += $item } }
if ($PSBoundParameters.ContainsKey('ChangelogUpdated')) { $nodeArgs += '--changelog-updated'; $nodeArgs += $(if ($ChangelogUpdated) { 'true' } else { 'false' }) }
if ($PSBoundParameters.ContainsKey('SensitiveScopeReviewed')) { $nodeArgs += '--sensitive-scope-reviewed'; $nodeArgs += $(if ($SensitiveScopeReviewed) { 'true' } else { 'false' }) }
if ($Rationale) { $nodeArgs += '--rationale'; $nodeArgs += $Rationale }
if ($ArtifactPath) { $nodeArgs += '--artifact-path'; $nodeArgs += $ArtifactPath }
if ($MetricsPath) { $nodeArgs += '--metrics-path'; $nodeArgs += $MetricsPath }
if ($PSBoundParameters.ContainsKey('EmitMetrics')) { $nodeArgs += '--emit-metrics'; $nodeArgs += $(if ($EmitMetrics) { 'true' } else { 'false' }) }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
