param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [bool]$PreserveExisting = $true,
    [bool]$AlignExisting = $true,
    [bool]$RunInit = $true,
    [switch]$AnswerDependentOnly,
    [switch]$SkipBackups,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$AssistantLanguage,
    [Parameter(Mandatory = $true)]
    [ValidateSet('concise', 'detailed')]
    [string]$AssistantBrevity,
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [Parameter(Mandatory = $true)]
    [string]$SourceOfTruth,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InitAnswersPath
)

# Node-only runtime — all logic is in bin/octopus.js (T-075)
$bundleRoot = Split-Path -Parent $PSScriptRoot
$nodeArgs = @('install')
if ($TargetRoot) { $nodeArgs += '--target-root'; $nodeArgs += $TargetRoot }
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($InitAnswersPath) { $nodeArgs += '--init-answers-path'; $nodeArgs += $InitAnswersPath }
& node (Join-Path $bundleRoot 'bin' 'octopus.js') @nodeArgs
exit $LASTEXITCODE
