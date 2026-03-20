param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [string]$RepoUrl,
    [string]$Branch,
    [switch]$Apply,
    [switch]$NoPrompt,
    [switch]$DryRun,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('check-update')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
if ($RepoUrl) { $nodeArgs += '--repo-url'; $nodeArgs += $RepoUrl }
if ($Branch) { $nodeArgs += '--branch'; $nodeArgs += $Branch }
if ($Apply) { $nodeArgs += '--apply' }
if ($NoPrompt) { $nodeArgs += '--no-prompt' }
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($SkipVerify) { $nodeArgs += '--skip-verify' }
if ($SkipManifestValidation) { $nodeArgs += '--skip-manifest-validation' }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
