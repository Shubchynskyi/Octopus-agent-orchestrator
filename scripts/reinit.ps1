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

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$sourceRoot = Join-Path $bundleRoot 'template'

$initAnswerMigrationModulePath = Join-Path $scriptDir 'lib/init-answer-migrations.ps1'
if (-not (Test-Path -LiteralPath $initAnswerMigrationModulePath -PathType Leaf)) {
    throw "Init answer migrations module not found: $initAnswerMigrationModulePath"
}
. $initAnswerMigrationModulePath

$managedConfigContractsModulePath = Join-Path $scriptDir 'lib/managed-config-contracts.ps1'
if (-not (Test-Path -LiteralPath $managedConfigContractsModulePath -PathType Leaf)) {
    throw "Managed config contracts module not found: $managedConfigContractsModulePath"
}
. $managedConfigContractsModulePath

. (Join-Path $scriptDir 'lib' 'common.ps1')

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Template directory not found: $sourceRoot"
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}

function Get-AnswerDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    foreach ($definition in Get-InitAnswerMigrationSchema) {
        if ([string]::Equals([string]$definition.Key, $Key, [System.StringComparison]::Ordinal)) {
            return $definition
        }
    }

    throw "Unsupported init answer key '$Key'."
}

function Get-RequiredAnswerString {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $value = Get-InitAnswerMigrationValue -Answers $Answers -LogicalName $Key
    $normalized = Convert-InitAnswerMigrationValue -Definition (Get-AnswerDefinition -Key $Key) -Value $value
    if ([string]::IsNullOrWhiteSpace([string]$normalized)) {
        throw "Reinit answer '$Key' must not be empty."
    }

    return [string]$normalized
}

function Get-RequiredAnswerBoolean {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $normalized = Get-RequiredAnswerString -Answers $Answers -Key $Key
    return [string]::Equals($normalized, 'true', [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-OptionalAnswerString {
    param(
        [AllowNull()]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if ($null -eq $Answers) {
        return $null
    }

    $value = Get-InitAnswerValue -Answers $Answers -LogicalName $Key
    if ($null -eq $value) {
        return $null
    }

    $text = [string]$value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text.Trim()
}

function Set-OptionalAnswerString {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [AllowNull()]
        [string]$Value
    )

    $existingProperty = $Answers.PSObject.Properties[$Key]
    if ([string]::IsNullOrWhiteSpace($Value)) {
        if ($null -ne $existingProperty) {
            [void]$Answers.PSObject.Properties.Remove($Key)
        }
        return
    }

    if ($null -ne $existingProperty) {
        $existingProperty.Value = $Value
        return
    }

    Add-Member -InputObject $Answers -MemberType NoteProperty -Name $Key -Value $Value
}

function Apply-AssistantDefaultsToCoreRule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$Language,
        [Parameter(Mandatory = $true)]
        [string]$Brevity
    )

    $updated = $Content.Replace('{{ASSISTANT_RESPONSE_LANGUAGE}}', $Language)
    $updated = $updated.Replace('{{ASSISTANT_RESPONSE_BREVITY}}', $Brevity)
    $updated = [regex]::Replace(
        $updated,
        '(?m)^Respond in .+ for explanations and assistance\.$',
        "Respond in $Language for explanations and assistance."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^1\. Respond in .+\.$',
        "1. Respond in $Language."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^Default response brevity: .+\.$',
        "Default response brevity: $Brevity."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^2\. Keep responses .+ unless the user explicitly asks for more or less detail\.$',
        "2. Keep responses $Brevity unless the user explicitly asks for more or less detail."
    )

    return $updated
}

function Set-FileContentIfChanged {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $existingContent = $null
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $existingContent = Get-Content -LiteralPath $Path -Raw
    }

    if ($existingContent -eq $Content) {
        return $false
    }

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Set-Content -LiteralPath $Path -Value $Content
    return $true
}

function Update-CoreRuleFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Language,
        [Parameter(Mandatory = $true)]
        [string]$Brevity
    )

    $liveCoreRulePath = Join-Path $bundleRoot 'live/docs/agent-rules/00-core.md'
    $templateCoreRulePath = Join-Path $sourceRoot 'docs/agent-rules/00-core.md'
    $sourcePath = if (Test-Path -LiteralPath $liveCoreRulePath -PathType Leaf) {
        $liveCoreRulePath
    } elseif (Test-Path -LiteralPath $templateCoreRulePath -PathType Leaf) {
        $templateCoreRulePath
    } else {
        throw "Core rule source not found. Checked: $liveCoreRulePath and $templateCoreRulePath"
    }

    $content = Get-Content -LiteralPath $sourcePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        throw "Core rule source is empty: $sourcePath"
    }

    $updatedContent = Apply-AssistantDefaultsToCoreRule -Content $content -Language $Language -Brevity $Brevity
    return Set-FileContentIfChanged -Path $liveCoreRulePath -Content $updatedContent
}

function Update-TokenEconomyConfig {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Enabled
    )

    $definition = Get-ManagedConfigDefinition -ConfigName 'token-economy'
    $templatePath = Join-Path $sourceRoot $definition.TemplateRelativePath
    $destinationPath = Join-Path $bundleRoot ('live/' + $definition.LiveRelativePath).Replace('/', '\')

    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
        throw "Token economy template config not found: $templatePath"
    }

    $templateConfig = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    $existingConfig = $null
    if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
        try {
            $existingConfig = Get-Content -LiteralPath $destinationPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        }
        catch {
            Write-Warning "Existing token-economy config is invalid JSON and will be replaced with merged template defaults: $destinationPath"
            $existingConfig = $null
        }
    }

    $mergeResult = Merge-ManagedConfigWithTemplate -ConfigName 'token-economy' -TemplateConfig $templateConfig -ExistingConfig $existingConfig
    $materializedConfig = Convert-ToManagedConfigHashtable -Value $mergeResult.Value
    $materializedConfig['enabled'] = [bool]$Enabled
    $json = $materializedConfig | ConvertTo-Json -Depth 24
    $updated = Set-FileContentIfChanged -Path $destinationPath -Content $json

    return [PSCustomObject]@{
        Updated = $updated
        Changes = @($mergeResult.Changes)
        Path    = $destinationPath
    }
}

$installScriptPath = Join-Path $scriptDir 'install.ps1'
$verifyScriptPath = Join-Path $scriptDir 'verify.ps1'
$manifestScriptPath = Join-Path $bundleRoot 'live/scripts/agent-gates/validate-manifest.ps1'
$manifestPath = Join-Path $bundleRoot 'MANIFEST.md'

if (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf)) {
    throw "Install script not found: $installScriptPath"
}
if (-not (Test-Path -LiteralPath $verifyScriptPath -PathType Leaf)) {
    throw "Verify script not found: $verifyScriptPath"
}

$initAnswersResolvedPath = Resolve-PathInsideRoot -RootPath $TargetRoot -PathValue $InitAnswersPath -Label 'InitAnswersPath'

$existingAnswers = $null
if (Test-Path -LiteralPath $initAnswersResolvedPath -PathType Leaf) {
    $existingInitAnswersRaw = Get-Content -LiteralPath $initAnswersResolvedPath -Raw
    if ([string]::IsNullOrWhiteSpace($existingInitAnswersRaw)) {
        Write-Warning "Existing init answers artifact is empty and will be regenerated: $initAnswersResolvedPath"
    } else {
        try {
            $existingAnswers = $existingInitAnswersRaw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            Write-Warning "Existing init answers artifact is invalid JSON and will be regenerated: $initAnswersResolvedPath"
            $existingAnswers = $null
        }
    }
}

$liveVersionPath = Join-Path $bundleRoot 'live/version.json'
$existingLiveVersion = $null
if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
    try {
        $existingLiveVersion = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Write-Warning "Existing live/version.json is invalid JSON and will not be used for reinit recommendations: $liveVersionPath"
        $existingLiveVersion = $null
    }
}

$tokenEconomyConfigPath = Join-Path $bundleRoot 'live/config/token-economy.json'
$existingTokenEconomyConfig = $null
if (Test-Path -LiteralPath $tokenEconomyConfigPath -PathType Leaf) {
    try {
        $existingTokenEconomyConfig = Get-Content -LiteralPath $tokenEconomyConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        Write-Warning "Existing token-economy config is invalid JSON and will not be used for reinit recommendations: $tokenEconomyConfigPath"
        $existingTokenEconomyConfig = $null
    }
}

$overrideMap = [ordered]@{}
if ($PSBoundParameters.ContainsKey('AssistantLanguage')) {
    $overrideMap['AssistantLanguage'] = $AssistantLanguage
}
if ($PSBoundParameters.ContainsKey('AssistantBrevity')) {
    $overrideMap['AssistantBrevity'] = $AssistantBrevity
}
if ($PSBoundParameters.ContainsKey('SourceOfTruth')) {
    $overrideMap['SourceOfTruth'] = $SourceOfTruth
}
if ($PSBoundParameters.ContainsKey('EnforceNoAutoCommit')) {
    $overrideMap['EnforceNoAutoCommit'] = $EnforceNoAutoCommit
}
if ($PSBoundParameters.ContainsKey('ClaudeOrchestratorFullAccess')) {
    $overrideMap['ClaudeOrchestratorFullAccess'] = $ClaudeOrchestratorFullAccess
}
if ($PSBoundParameters.ContainsKey('TokenEconomyEnabled')) {
    $overrideMap['TokenEconomyEnabled'] = $TokenEconomyEnabled
}
$overrideAnswers = if ($overrideMap.Count -gt 0) { [PSCustomObject]$overrideMap } else { $null }

$interactivePrompting = (Test-UpdateInitAnswerPromptSupport) -and (-not $NoPrompt)
$recollectResult = Invoke-RecollectInitAnswers `
    -Answers $existingAnswers `
    -LiveVersion $existingLiveVersion `
    -TokenEconomyConfig $existingTokenEconomyConfig `
    -InteractivePrompting $interactivePrompting `
    -Overrides $overrideAnswers
$initAnswers = $recollectResult.Answers
$reinitChanges = @($recollectResult.Changes)

$resolvedAssistantLanguage = Get-RequiredAnswerString -Answers $initAnswers -Key 'AssistantLanguage'
$resolvedAssistantBrevity = Get-RequiredAnswerString -Answers $initAnswers -Key 'AssistantBrevity'
$resolvedSourceOfTruth = Get-RequiredAnswerString -Answers $initAnswers -Key 'SourceOfTruth'
$resolvedEnforceNoAutoCommit = Get-RequiredAnswerBoolean -Answers $initAnswers -Key 'EnforceNoAutoCommit'
$resolvedClaudeOrchestratorFullAccess = Get-RequiredAnswerBoolean -Answers $initAnswers -Key 'ClaudeOrchestratorFullAccess'
$resolvedTokenEconomyEnabled = Get-RequiredAnswerBoolean -Answers $initAnswers -Key 'TokenEconomyEnabled'
$existingActiveAgentFiles = Get-OptionalAnswerString -Answers $existingAnswers -Key 'ActiveAgentFiles'
if ([string]::IsNullOrWhiteSpace($existingActiveAgentFiles)) {
    $existingActiveAgentFiles = Get-OptionalAnswerString -Answers $existingLiveVersion -Key 'ActiveAgentFiles'
}
if ([string]::IsNullOrWhiteSpace($existingActiveAgentFiles)) {
    $existingLiveCanonicalEntrypoint = Get-OptionalAnswerString -Answers $existingLiveVersion -Key 'CanonicalEntrypoint'
    if ([string]::IsNullOrWhiteSpace($existingLiveCanonicalEntrypoint)) {
        $existingLiveSourceOfTruth = Get-OptionalAnswerString -Answers $existingLiveVersion -Key 'SourceOfTruth'
        if (-not [string]::IsNullOrWhiteSpace($existingLiveSourceOfTruth)) {
            $existingLiveCanonicalEntrypoint = Convert-ToCanonicalEntrypointFile -SourceOfTruth $existingLiveSourceOfTruth
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($existingLiveCanonicalEntrypoint)) {
        $existingActiveAgentFiles = $existingLiveCanonicalEntrypoint
    }
}
$resolvedActiveAgentFiles = Convert-ActiveAgentEntrypointFilesToString -ActiveEntrypointFiles (
    Get-ActiveAgentEntrypointFiles -Value $existingActiveAgentFiles -SourceOfTruthValue $resolvedSourceOfTruth
)
Set-OptionalAnswerString -Answers $initAnswers -Key 'ActiveAgentFiles' -Value $resolvedActiveAgentFiles

$gitDirPath = Join-Path $TargetRoot '.git'
if ($resolvedEnforceNoAutoCommit -and -not (Test-Path -LiteralPath $gitDirPath -PathType Container)) {
    throw "EnforceNoAutoCommit=true but .git directory is missing at '$gitDirPath'. Initialize git or rerun reinit with EnforceNoAutoCommit=false."
}

$initAnswersDirectory = Split-Path -Parent $initAnswersResolvedPath
if ($initAnswersDirectory -and -not (Test-Path -LiteralPath $initAnswersDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $initAnswersDirectory -Force | Out-Null
}
$initAnswersJson = $initAnswers | ConvertTo-Json -Depth 10
Set-Content -LiteralPath $initAnswersResolvedPath -Value $initAnswersJson

$coreRuleUpdated = Update-CoreRuleFile -Language $resolvedAssistantLanguage -Brevity $resolvedAssistantBrevity
$tokenEconomyUpdateResult = Update-TokenEconomyConfig -Enabled $resolvedTokenEconomyEnabled

$installParams = @{
    TargetRoot          = $TargetRoot
    PreserveExisting    = $true
    AlignExisting       = $true
    RunInit             = $false
    AnswerDependentOnly = $true
    SkipBackups         = $true
    AssistantLanguage   = $resolvedAssistantLanguage
    AssistantBrevity    = $resolvedAssistantBrevity
    SourceOfTruth       = $resolvedSourceOfTruth
    InitAnswersPath     = $initAnswersResolvedPath
}
& $installScriptPath @installParams | Out-Null

$verifyStatus = 'NOT_RUN'
$manifestStatus = 'NOT_RUN'
if ($SkipVerify) {
    $verifyStatus = 'SKIPPED'
} else {
    & $verifyScriptPath -TargetRoot $TargetRoot -SourceOfTruth $resolvedSourceOfTruth -InitAnswersPath $initAnswersResolvedPath
    $verifyStatus = 'PASS'
}

if ($SkipManifestValidation) {
    $manifestStatus = 'SKIPPED'
} else {
    if (-not (Test-Path -LiteralPath $manifestScriptPath -PathType Leaf)) {
        throw "Manifest validation script not found: $manifestScriptPath"
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Manifest file not found: $manifestPath"
    }

    & $manifestScriptPath -ManifestPath $manifestPath
    $manifestStatus = 'PASS'
}

$changePromptedCount = @($reinitChanges | Where-Object { $_.Action -eq 'prompted' }).Count
$changeOverrideCount = @($reinitChanges | Where-Object { $_.Action -eq 'overridden' }).Count
$changeRecommendedDefaultCount = @($reinitChanges | Where-Object { $_.Action -eq 'recommended_default' }).Count
$changeInferredCount = @($reinitChanges | Where-Object { $_.Action -eq 'inferred' }).Count
$changePreservedCount = @($reinitChanges | Where-Object { $_.Action -eq 'preserved' }).Count

$canonicalEntrypoint = (Get-SourceToEntrypointMap)[$resolvedSourceOfTruth.Trim().ToUpperInvariant().Replace(' ', '')]

Write-Output "TargetRoot: $TargetRoot"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "InteractivePrompting: $interactivePrompting"
Write-Output "InitAnswerChangeCount: $($reinitChanges.Count)"
Write-Output "InitAnswerPromptedCount: $changePromptedCount"
Write-Output "InitAnswerOverrideCount: $changeOverrideCount"
Write-Output "InitAnswerRecommendedDefaultCount: $changeRecommendedDefaultCount"
Write-Output "InitAnswerInferredCount: $changeInferredCount"
Write-Output "InitAnswerPreservedCount: $changePreservedCount"
foreach ($change in $reinitChanges) {
    Write-Output "InitAnswer[$($change.Key)]: action=$($change.Action); value=$($change.Value); source=$($change.Source); note=$($change.Note)"
}
Write-Output "AssistantLanguage: $resolvedAssistantLanguage"
Write-Output "AssistantBrevity: $resolvedAssistantBrevity"
Write-Output "SourceOfTruth: $resolvedSourceOfTruth"
Write-Output "CanonicalEntrypoint: $canonicalEntrypoint"
Write-Output "ActiveAgentFiles: $(if ([string]::IsNullOrWhiteSpace($resolvedActiveAgentFiles)) { 'n/a' } else { $resolvedActiveAgentFiles })"
Write-Output "EnforceNoAutoCommit: $resolvedEnforceNoAutoCommit"
Write-Output "ClaudeOrchestratorFullAccess: $resolvedClaudeOrchestratorFullAccess"
Write-Output "TokenEconomyEnabled: $resolvedTokenEconomyEnabled"
Write-Output "CoreRuleUpdated: $coreRuleUpdated"
Write-Output "TokenEconomyConfigUpdated: $($tokenEconomyUpdateResult.Updated)"
Write-Output "TokenEconomyConfigPath: $($tokenEconomyUpdateResult.Path)"
Write-Output "VerifyStatus: $verifyStatus"
Write-Output "ManifestValidationStatus: $manifestStatus"
Write-Output 'Reinit: PASS'
