param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$NoPrompt,
    [switch]$DryRun,
    [switch]$SkipBackups,
    [string]$KeepPrimaryEntrypoint,
    [string]$KeepTaskFile,
    [string]$KeepRuntimeArtifacts
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('uninstall')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
if ($NoPrompt) { $nodeArgs += '--no-prompt' }
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($SkipBackups) { $nodeArgs += '--skip-backups' }
if ($KeepPrimaryEntrypoint) { $nodeArgs += '--keep-primary-entrypoint'; $nodeArgs += $KeepPrimaryEntrypoint }
if ($KeepTaskFile) { $nodeArgs += '--keep-task-file'; $nodeArgs += $KeepTaskFile }
if ($KeepRuntimeArtifacts) { $nodeArgs += '--keep-runtime-artifacts'; $nodeArgs += $KeepRuntimeArtifacts }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
