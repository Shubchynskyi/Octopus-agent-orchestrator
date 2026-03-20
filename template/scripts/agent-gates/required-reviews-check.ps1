[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TaskId = '',
    [string]$CodeReviewVerdict = 'NOT_REQUIRED',
    [string]$DbReviewVerdict = 'NOT_REQUIRED',
    [string]$SecurityReviewVerdict = 'NOT_REQUIRED',
    [string]$RefactorReviewVerdict = 'NOT_REQUIRED',
    [string]$ApiReviewVerdict = 'NOT_REQUIRED',
    [string]$TestReviewVerdict = 'NOT_REQUIRED',
    [string]$PerformanceReviewVerdict = 'NOT_REQUIRED',
    [string]$InfraReviewVerdict = 'NOT_REQUIRED',
    [string]$DependencyReviewVerdict = 'NOT_REQUIRED',
    [string]$SkipReviews = '',
    [string]$SkipReason = '',
    [string]$OverrideArtifactPath,
    [string]$CompileEvidencePath,
    [string]$ReviewsRoot = '',
    [string]$ReviewEvidencePath,
    [string]$OutputFiltersPath = 'Octopus-agent-orchestrator/live/config/output-filters.json',
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'required-reviews-check')
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($CodeReviewVerdict) { $nodeArgs += '--code-review-verdict'; $nodeArgs += $CodeReviewVerdict }
if ($DbReviewVerdict) { $nodeArgs += '--db-review-verdict'; $nodeArgs += $DbReviewVerdict }
if ($SecurityReviewVerdict) { $nodeArgs += '--security-review-verdict'; $nodeArgs += $SecurityReviewVerdict }
if ($RefactorReviewVerdict) { $nodeArgs += '--refactor-review-verdict'; $nodeArgs += $RefactorReviewVerdict }
if ($ApiReviewVerdict) { $nodeArgs += '--api-review-verdict'; $nodeArgs += $ApiReviewVerdict }
if ($TestReviewVerdict) { $nodeArgs += '--test-review-verdict'; $nodeArgs += $TestReviewVerdict }
if ($PerformanceReviewVerdict) { $nodeArgs += '--performance-review-verdict'; $nodeArgs += $PerformanceReviewVerdict }
if ($InfraReviewVerdict) { $nodeArgs += '--infra-review-verdict'; $nodeArgs += $InfraReviewVerdict }
if ($DependencyReviewVerdict) { $nodeArgs += '--dependency-review-verdict'; $nodeArgs += $DependencyReviewVerdict }
if ($SkipReviews) { $nodeArgs += '--skip-reviews'; $nodeArgs += $SkipReviews }
if ($SkipReason) { $nodeArgs += '--skip-reason'; $nodeArgs += $SkipReason }
if ($OverrideArtifactPath) { $nodeArgs += '--override-artifact-path'; $nodeArgs += $OverrideArtifactPath }
if ($ReviewsRoot) { $nodeArgs += '--reviews-root'; $nodeArgs += $ReviewsRoot }
if ($CompileEvidencePath) { $nodeArgs += '--compile-evidence-path'; $nodeArgs += $CompileEvidencePath }
if ($ReviewEvidencePath) { $nodeArgs += '--review-evidence-path'; $nodeArgs += $ReviewEvidencePath }
if ($OutputFiltersPath) { $nodeArgs += '--output-filters-path'; $nodeArgs += $OutputFiltersPath }
if ($MetricsPath) { $nodeArgs += '--metrics-path'; $nodeArgs += $MetricsPath }
if ($PSBoundParameters.ContainsKey('EmitMetrics')) { $nodeArgs += '--emit-metrics'; $nodeArgs += $(if ($EmitMetrics) { 'true' } else { 'false' }) }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
