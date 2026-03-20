[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [string]$RepoRoot,
    [string]$EventsRoot,
    [string]$OutputPath,
    [switch]$AsJson,
    [switch]$IncludeDetails
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'task-events-summary')
if ($TaskId) { $nodeArgs += '--task-id'; $nodeArgs += $TaskId }
if ($RepoRoot) { $nodeArgs += '--repo-root'; $nodeArgs += $RepoRoot }
if ($EventsRoot) { $nodeArgs += '--events-root'; $nodeArgs += $EventsRoot }
if ($OutputPath) { $nodeArgs += '--output-path'; $nodeArgs += $OutputPath }
if ($AsJson) { $nodeArgs += '--as-json' }
if ($IncludeDetails) { $nodeArgs += '--include-details' }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
