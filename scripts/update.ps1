param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$DryRun,
    [switch]$NoInitAnswerPrompt,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('update')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($NoInitAnswerPrompt) { $nodeArgs += '--no-prompt' }
if ($SkipVerify) { $nodeArgs += '--skip-verify' }
if ($SkipManifestValidation) { $nodeArgs += '--skip-manifest-validation' }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
