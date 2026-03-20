[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency')]
    [string]$ReviewType,
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 3)]
    [int]$Depth,
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$TokenEconomyConfigPath = 'Octopus-agent-orchestrator/live/config/token-economy.json',
    [string]$ScopedDiffMetadataPath = '',
    [string]$OutputPath = '',
    [string]$RepoRoot
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'build-review-context')
if ($ReviewType) { $nodeArgs += '--review-type'; $nodeArgs += $ReviewType }
$nodeArgs += '--depth'; $nodeArgs += [string]$Depth
if ($PreflightPath) { $nodeArgs += '--preflight-path'; $nodeArgs += $PreflightPath }
if ($TokenEconomyConfigPath) { $nodeArgs += '--token-economy-config-path'; $nodeArgs += $TokenEconomyConfigPath }
if ($ScopedDiffMetadataPath) { $nodeArgs += '--scoped-diff-metadata-path'; $nodeArgs += $ScopedDiffMetadataPath }
if ($OutputPath) { $nodeArgs += '--output-path'; $nodeArgs += $OutputPath }
if ($RepoRoot) { $nodeArgs += '--repo-root'; $nodeArgs += $RepoRoot }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
