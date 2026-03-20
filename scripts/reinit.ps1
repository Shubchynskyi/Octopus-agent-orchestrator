param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$NoPrompt,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation,
    [string]$AssistantLanguage,
    [ValidateSet('concise', 'detailed')]
    [string]$AssistantBrevity,
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [string]$SourceOfTruth,
    [string]$EnforceNoAutoCommit,
    [string]$ClaudeOrchestratorFullAccess,
    [string]$TokenEconomyEnabled
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('reinit')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
if ($NoPrompt) { $nodeArgs += '--no-prompt' }
if ($SkipVerify) { $nodeArgs += '--skip-verify' }
if ($SkipManifestValidation) { $nodeArgs += '--skip-manifest-validation' }
if ($AssistantLanguage) { $nodeArgs += '--assistant-language'; $nodeArgs += $AssistantLanguage }
if ($AssistantBrevity) { $nodeArgs += '--assistant-brevity'; $nodeArgs += $AssistantBrevity }
if ($SourceOfTruth) { $nodeArgs += '--source-of-truth'; $nodeArgs += $SourceOfTruth }
if ($EnforceNoAutoCommit) { $nodeArgs += '--enforce-no-auto-commit'; $nodeArgs += $EnforceNoAutoCommit }
if ($ClaudeOrchestratorFullAccess) { $nodeArgs += '--claude-orchestrator-full-access'; $nodeArgs += $ClaudeOrchestratorFullAccess }
if ($TokenEconomyEnabled) { $nodeArgs += '--token-economy-enabled'; $nodeArgs += $TokenEconomyEnabled }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
