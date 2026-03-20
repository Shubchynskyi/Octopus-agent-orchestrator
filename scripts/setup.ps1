param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$DryRun,
    [switch]$RunVerify,
    [switch]$NoPrompt,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation,
    [string]$AssistantLanguage,
    [ValidateSet('concise', 'detailed')]
    [string]$AssistantBrevity,
    [string]$ActiveAgentFiles,
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [string]$SourceOfTruth,
    [string]$EnforceNoAutoCommit,
    [string]$ClaudeOrchestratorFullAccess,
    [string]$TokenEconomyEnabled
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('setup')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($NoPrompt) { $nodeArgs += '--no-prompt' }
if ($SkipVerify) { $nodeArgs += '--skip-verify' }
if ($SkipManifestValidation) { $nodeArgs += '--skip-manifest-validation' }
if ($AssistantLanguage) { $nodeArgs += '--assistant-language'; $nodeArgs += $AssistantLanguage }
if ($AssistantBrevity) { $nodeArgs += '--assistant-brevity'; $nodeArgs += $AssistantBrevity }
if ($SourceOfTruth) { $nodeArgs += '--source-of-truth'; $nodeArgs += $SourceOfTruth }
if ($EnforceNoAutoCommit) { $nodeArgs += '--enforce-no-auto-commit'; $nodeArgs += $EnforceNoAutoCommit }
if ($ClaudeOrchestratorFullAccess) { $nodeArgs += '--claude-orchestrator-full-access'; $nodeArgs += $ClaudeOrchestratorFullAccess }
if ($TokenEconomyEnabled) { $nodeArgs += '--token-economy-enabled'; $nodeArgs += $TokenEconomyEnabled }
if ($ActiveAgentFiles) { $nodeArgs += '--active-agent-files'; $nodeArgs += $ActiveAgentFiles }
if ($RunVerify) { $nodeArgs += '--verify' }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
