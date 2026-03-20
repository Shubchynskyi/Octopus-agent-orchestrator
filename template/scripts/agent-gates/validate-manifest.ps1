[CmdletBinding()]
param(
    [string]$ManifestPath = 'Octopus-agent-orchestrator/MANIFEST.md'
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$nodeArgs = @('gate', 'validate-manifest')
if ($ManifestPath) { $nodeArgs += '--manifest-path'; $nodeArgs += $ManifestPath }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
