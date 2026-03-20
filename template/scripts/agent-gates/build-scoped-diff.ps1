[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('db', 'security', 'refactor')]
    [string]$ReviewType,
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$PathsConfigPath = 'Octopus-agent-orchestrator/live/config/paths.json',
    [string]$OutputPath = '',
    [string]$MetadataPath = '',
    [string]$FullDiffPath = '',
    [switch]$UseStaged,
    [string]$RepoRoot
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'build-scoped-diff')
if ($ReviewType) { $nodeArgs += '--review-type'; $nodeArgs += $ReviewType }
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($PathsConfigPath) { $nodeArgs += '--paths-config-path'; $nodeArgs += $PathsConfigPath }
if ($OutputPath) { $nodeArgs += '--output-path'; $nodeArgs += $OutputPath }
if ($MetadataPath) { $nodeArgs += '--metadata-path'; $nodeArgs += $MetadataPath }
if ($FullDiffPath) { $nodeArgs += '--full-diff-path'; $nodeArgs += $FullDiffPath }
if ($UseStaged) { $nodeArgs += '--use-staged' }
if ($RepoRoot) { $nodeArgs += '--repo-root'; $nodeArgs += $RepoRoot }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
