param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [string]$AssistantLanguage = 'English',
    [string]$AssistantBrevity = 'concise',
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [string]$SourceOfTruth = 'Claude',
    [bool]$EnforceNoAutoCommit = $false,
    [bool]$TokenEconomyEnabled = $true
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('init')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($DryRun) { $nodeArgs += '--dry-run' }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
