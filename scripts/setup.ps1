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

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir

$initAnswerMigrationModulePath = Join-Path $scriptDir 'lib/init-answer-migrations.ps1'
if (-not (Test-Path -LiteralPath $initAnswerMigrationModulePath -PathType Leaf)) {
    throw "Init answer migrations module not found: $initAnswerMigrationModulePath"
}
. $initAnswerMigrationModulePath

. (Join-Path $scriptDir 'lib' 'common.ps1')

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$normalizedTargetRoot = $TargetRoot.TrimEnd('\', '/')
$normalizedBundleRoot = $bundleRoot.TrimEnd('\', '/')
if ([string]::Equals($normalizedTargetRoot, $normalizedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetRoot points to orchestrator bundle directory '$bundleRoot'. Use the project root parent directory instead."
}

function Read-OptionalJsonObject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    try {
        return $raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Write-Warning "Ignoring invalid JSON file during setup: $Path"
        return $null
    }
}

function Get-RequiredAnswerString {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $definition = Get-InitAnswerMigrationSchema | Where-Object { [string]::Equals([string]$_.Key, $Key, [System.StringComparison]::Ordinal) } | Select-Object -First 1
    if ($null -eq $definition) {
        throw "Unsupported init answer key '$Key'."
    }

    $value = Get-InitAnswerMigrationValue -Answers $Answers -LogicalName $Key
    $normalized = Convert-InitAnswerMigrationValue -Definition $definition -Value $value
    if ([string]::IsNullOrWhiteSpace([string]$normalized)) {
        throw "Setup answer '$Key' must not be empty."
    }

    return [string]$normalized
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

    $value = Get-InitAnswerMigrationValue -Answers $Answers -LogicalName $Key
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

function Get-AllowedAgentEntrypointFiles {
    return @(Get-AllAgentEntrypointFiles)
}

function Normalize-AgentEntrypointToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Token
    )

    $trimmed = $Token.Trim()
    $trimmed = [regex]::Replace($trimmed, '^(?i:or)\s+', '')
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $null
    }

    [int]$selectionNumber = 0
    if ([int]::TryParse($trimmed, [ref]$selectionNumber)) {
        $allowedValues = @(Get-AllowedAgentEntrypointFiles)
        if ($selectionNumber -lt 1 -or $selectionNumber -gt $allowedValues.Count) {
            throw "Unsupported ActiveAgentFiles selection '$Token'. Choose a number from 1 to $($allowedValues.Count), or use one of: $($allowedValues -join ', ')."
        }

        return $allowedValues[$selectionNumber - 1]
    }

    $normalizedToken = $trimmed.ToLowerInvariant().Replace('\', '/')
    switch ($normalizedToken) {
        'claude' { return 'CLAUDE.md' }
        'claude.md' { return 'CLAUDE.md' }
        'codex' { return 'AGENTS.md' }
        'agents' { return 'AGENTS.md' }
        'agents.md' { return 'AGENTS.md' }
        'gemini' { return 'GEMINI.md' }
        'gemini.md' { return 'GEMINI.md' }
        'githubcopilot' { return '.github/copilot-instructions.md' }
        'copilot' { return '.github/copilot-instructions.md' }
        '.github/copilot-instructions.md' { return '.github/copilot-instructions.md' }
        'windsurf' { return '.windsurf/rules/rules.md' }
        '.windsurf/rules/rules.md' { return '.windsurf/rules/rules.md' }
        'junie' { return '.junie/guidelines.md' }
        '.junie/guidelines.md' { return '.junie/guidelines.md' }
        'antigravity' { return '.antigravity/rules.md' }
        '.antigravity/rules.md' { return '.antigravity/rules.md' }
        default {
            foreach ($allowedValue in Get-AllowedAgentEntrypointFiles) {
                if ([string]::Equals($trimmed, $allowedValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return $allowedValue
                }
            }
        }
    }

    throw "Unsupported ActiveAgentFiles entry '$Token'. Allowed values: $((Get-AllowedAgentEntrypointFiles) -join ', '). You may also use provider aliases such as Claude, Codex, Gemini, Copilot, Windsurf, Junie, or Antigravity."
}

function Convert-ActiveAgentFilesValueToSelectionLabel {
    param(
        [AllowNull()]
        [string[]]$AllowedValues = $(Get-AllowedAgentEntrypointFiles),
        [AllowNull()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $selectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($token in ($Value -split '[,;]')) {
        $normalizedToken = Normalize-AgentEntrypointToken -Token $token
        if (-not [string]::IsNullOrWhiteSpace($normalizedToken)) {
            [void]$selectedFiles.Add($normalizedToken)
        }
    }

    if ($selectedFiles.Count -eq 0) {
        return $null
    }

    $labels = @()
    $orderedAllowedValues = @($AllowedValues)
    for ($index = 0; $index -lt $orderedAllowedValues.Count; $index++) {
        if ($selectedFiles.Contains($orderedAllowedValues[$index])) {
            $labels += [string]($index + 1)
        }
    }

    if ($labels.Count -eq 0) {
        return $null
    }

    return ($labels -join ', ')
}

function Convert-ActiveAgentFilesValueToSelectionSet {
    param(
        [AllowNull()]
        [string]$Value
    )

    $selectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $selectedFiles
    }

    foreach ($token in ($Value -split '[,;]')) {
        $normalizedToken = Normalize-AgentEntrypointToken -Token $token
        if (-not [string]::IsNullOrWhiteSpace($normalizedToken)) {
            [void]$selectedFiles.Add($normalizedToken)
        }
    }

    return $selectedFiles
}

function Convert-SelectionSetToActiveAgentFilesValue {
    param(
        [AllowNull()]
        [string[]]$AllowedValues = $(Get-AllowedAgentEntrypointFiles),
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.HashSet[string]]$SelectedFiles
    )

    if ($SelectedFiles.Count -eq 0) {
        return $null
    }

    $ordered = @()
    foreach ($allowedValue in @($AllowedValues)) {
        if ($SelectedFiles.Contains($allowedValue)) {
            $ordered += $allowedValue
        }
    }

    if ($ordered.Count -eq 0) {
        return $null
    }

    return ($ordered -join ', ')
}

function Write-ActiveAgentFilesSelectionMenu {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$AllowedValues,
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.HashSet[string]]$SelectedFiles,
        [Parameter(Mandatory = $true)]
        [int]$CursorIndex
    )

    $lines = @()
    for ($index = 0; $index -lt $AllowedValues.Count; $index++) {
        $pointer = if ($index -eq $CursorIndex) { '>' } else { ' ' }
        $checked = if ($SelectedFiles.Contains($AllowedValues[$index])) { '[x]' } else { '[ ]' }
        $line = ("{0} {1} {2}. {3}" -f $pointer, $checked, ($index + 1), $AllowedValues[$index])
        $lines += [PSCustomObject]@{
            Text  = $line
            Color = if ($index -eq $CursorIndex) { [System.ConsoleColor]::Green } else { $null }
        }
    }

    return ,$lines
}

function Write-ActiveAgentFilesSelectionSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$AllowedValues,
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.HashSet[string]]$SelectedFiles,
        [Parameter(Mandatory = $true)]
        [int]$CursorIndex,
        [string]$RenderKey = 'ActiveAgentFilesSelection'
    )

    $lines = @(
        @(Write-ActiveAgentFilesSelectionMenu -AllowedValues $AllowedValues -SelectedFiles $SelectedFiles -CursorIndex $CursorIndex)
        [PSCustomObject]@{
            Text  = ("Current focus: {0}" -f $AllowedValues[$CursorIndex])
            Color = $null
        }
        [PSCustomObject]@{
            Text  = if ($SelectedFiles.Count -eq 0) { 'Current selection: none' } else { "Current selection: $(Convert-SelectionSetToActiveAgentFilesValue -AllowedValues $AllowedValues -SelectedFiles $SelectedFiles)" }
            Color = $null
        }
    )

    Write-InitAnswerRenderedLines -Key $RenderKey -Lines $lines
}

function Normalize-ActiveAgentFiles {
    param(
        [AllowNull()]
        [string]$Value,
        [AllowNull()]
        [string]$SourceOfTruthValue
    )

    $ordered = @(Get-ActiveAgentEntrypointFiles -Value $Value -SourceOfTruthValue $SourceOfTruthValue)
    if ($ordered.Count -eq 0) {
        return $null
    }

    return ($ordered -join ', ')
}

function Convert-AdditionalAgentFilesInputToValue {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$AllowedValues,
        [AllowNull()]
        [string]$InputValue
    )

    if ([string]::IsNullOrWhiteSpace($InputValue)) {
        return $null
    }

    $selectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($token in ($InputValue -split '[,;\s]+')) {
        $trimmedToken = $token.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmedToken)) {
            continue
        }

        [int]$selectionNumber = 0
        if ([int]::TryParse($trimmedToken, [ref]$selectionNumber)) {
            if ($selectionNumber -lt 1 -or $selectionNumber -gt $AllowedValues.Count) {
                throw "Unsupported additional agent file selection '$trimmedToken'. Choose a number from 1 to $($AllowedValues.Count)."
            }

            [void]$selectedFiles.Add($AllowedValues[$selectionNumber - 1])
            continue
        }

        $normalizedToken = Normalize-AgentEntrypointToken -Token $trimmedToken
        if ($AllowedValues -notcontains $normalizedToken) {
            throw "Unsupported additional agent file '$trimmedToken'. Allowed values: $($AllowedValues -join ', ')."
        }

        [void]$selectedFiles.Add($normalizedToken)
    }

    return Convert-SelectionSetToActiveAgentFilesValue -AllowedValues $AllowedValues -SelectedFiles $selectedFiles
}

function Read-OptionalActiveAgentFilesPromptFallback {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile,
        [AllowNull()]
        [string]$DefaultValue
    )

    $allowedValues = @((Get-AllowedAgentEntrypointFiles) | Where-Object { $_ -ne $CanonicalFile })
    if ($allowedValues.Count -eq 0) {
        return $null
    }

    Write-Host 'Select additional agent entrypoint files to create.' -ForegroundColor Yellow
    Write-Host "Primary file '$CanonicalFile' will be created automatically." -ForegroundColor Yellow
    Write-Host 'Recommendation: select only the extra agent files you actually use in this project.' -ForegroundColor Yellow
    for ($index = 0; $index -lt $allowedValues.Count; $index++) {
        Write-Host ("  {0}. {1}" -f ($index + 1), $allowedValues[$index]) -ForegroundColor Yellow
    }

    $defaultSelection = Convert-ActiveAgentFilesValueToSelectionLabel -AllowedValues $allowedValues -Value $DefaultValue
    if ([string]::IsNullOrWhiteSpace($defaultSelection)) {
        Write-Host 'Press Enter to keep only the primary file.' -ForegroundColor Yellow
    } else {
        Write-Host "Press Enter to keep the current extra selection: $defaultSelection" -ForegroundColor Yellow
    }

    $prompt = if ([string]::IsNullOrWhiteSpace($defaultSelection)) {
        'Additional agent files (choose numbers separated by spaces or commas; optional)'
    } else {
        "Additional agent files (choose numbers separated by spaces or commas) [$defaultSelection]"
    }

    $response = Read-Host $prompt
    if ([string]::IsNullOrWhiteSpace($response)) {
        return $DefaultValue
    }

    return Convert-AdditionalAgentFilesInputToValue -AllowedValues $allowedValues -InputValue $response.Trim()
}

function Read-OptionalActiveAgentFilesPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile,
        [AllowNull()]
        [string]$DefaultValue
    )

    try {
        $allowedValues = @((Get-AllowedAgentEntrypointFiles) | Where-Object { $_ -ne $CanonicalFile })
        if ($allowedValues.Count -eq 0) {
            return $null
        }

        $selectedFiles = Convert-ActiveAgentFilesValueToSelectionSet -Value $DefaultValue
        foreach ($entry in @($selectedFiles)) {
            if ($entry -eq $CanonicalFile -or $allowedValues -notcontains $entry) {
                [void]$selectedFiles.Remove($entry)
            }
        }
        $cursorIndex = 0

        Write-Host 'Select additional agent entrypoint files to create.' -ForegroundColor Yellow
        Write-Host "Primary file '$CanonicalFile' will be created automatically." -ForegroundColor Yellow
        Write-Host 'Recommendation: select only the extra agent files you actually use in this project.' -ForegroundColor Yellow
        Write-Host ("Use Up/Down to move, Space to toggle, number keys 1-{0} to toggle directly, C to clear, A to toggle all, Enter to confirm." -f $allowedValues.Count)
        if ($selectedFiles.Count -eq 0) {
            Write-Host 'No extra files selected yet. Press Enter to keep only the primary file.'
        } else {
            Write-Host ("Current selection: {0}" -f (Convert-SelectionSetToActiveAgentFilesValue -AllowedValues $allowedValues -SelectedFiles $selectedFiles))
        }
        $renderKey = 'ActiveAgentFilesSelection:Setup'
        Reset-InitAnswerRenderState -Key $renderKey
        Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey

        while ($true) {
            $keyInfo = Read-InitAnswerInteractiveKey
            $keyName = Get-InitAnswerInteractiveKeyName -KeyInfo $keyInfo

            switch ($keyName) {
                'UpArrow' {
                    if ($cursorIndex -gt 0) {
                        $cursorIndex--
                    } else {
                        $cursorIndex = $allowedValues.Count - 1
                    }
                    Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                    continue
                }
                'DownArrow' {
                    if ($cursorIndex -lt ($allowedValues.Count - 1)) {
                        $cursorIndex++
                    } else {
                        $cursorIndex = 0
                    }
                    Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                    continue
                }
                'Spacebar' {
                    $selectedValue = $allowedValues[$cursorIndex]
                    if ($selectedFiles.Contains($selectedValue)) {
                        [void]$selectedFiles.Remove($selectedValue)
                    } else {
                        [void]$selectedFiles.Add($selectedValue)
                    }
                    Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                    continue
                }
                'A' {
                    if ($selectedFiles.Count -eq $allowedValues.Count) {
                        $selectedFiles.Clear()
                    } else {
                        $selectedFiles.Clear()
                        foreach ($allowedValue in $allowedValues) {
                            [void]$selectedFiles.Add($allowedValue)
                        }
                    }
                    Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                    continue
                }
                'C' {
                    $selectedFiles.Clear()
                    Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                    continue
                }
                'Enter' {
                    Reset-InitAnswerRenderState -Key $renderKey
                    Write-Host ("Selected additional files: {0}" -f $(if ($selectedFiles.Count -eq 0) { 'none' } else { Convert-SelectionSetToActiveAgentFilesValue -AllowedValues $allowedValues -SelectedFiles $selectedFiles })) -ForegroundColor Green
                    return Convert-SelectionSetToActiveAgentFilesValue -AllowedValues $allowedValues -SelectedFiles $selectedFiles
                }
                default {
                    $char = Get-InitAnswerInteractiveKeyChar -KeyInfo $keyInfo
                    if ($char -and [char]::IsDigit($char)) {
                        $selectedIndex = [int]([string]$char) - 1
                        if ($selectedIndex -ge 0 -and $selectedIndex -lt $allowedValues.Count) {
                            $selectedValue = $allowedValues[$selectedIndex]
                            if ($selectedFiles.Contains($selectedValue)) {
                                [void]$selectedFiles.Remove($selectedValue)
                            } else {
                                [void]$selectedFiles.Add($selectedValue)
                            }
                            $cursorIndex = $selectedIndex
                            Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                        }
                        continue
                    }

                    if ($char) {
                        switch ([char]::ToUpperInvariant($char)) {
                            'A' {
                                if ($selectedFiles.Count -eq $allowedValues.Count) {
                                    $selectedFiles.Clear()
                                } else {
                                    $selectedFiles.Clear()
                                    foreach ($allowedValue in $allowedValues) {
                                        [void]$selectedFiles.Add($allowedValue)
                                    }
                                }
                                Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                            }
                            'C' {
                                $selectedFiles.Clear()
                                Write-ActiveAgentFilesSelectionSnapshot -AllowedValues $allowedValues -SelectedFiles $selectedFiles -CursorIndex $cursorIndex -RenderKey $renderKey
                            }
                        }
                    }
                    continue
                }
            }
        }
    }
    catch {
        return Read-OptionalActiveAgentFilesPromptFallback -CanonicalFile $CanonicalFile -DefaultValue $DefaultValue
    }
}

$initAnswersResolvedPath = Resolve-PathInsideRoot -RootPath $TargetRoot -PathValue $InitAnswersPath -Label 'InitAnswersPath'
$existingAnswers = Read-OptionalJsonObject -Path $initAnswersResolvedPath
$existingLiveVersion = Read-OptionalJsonObject -Path (Join-Path $bundleRoot 'live/version.json')

$existingTokenEconomyConfig = $null
$tokenEconomyConfigPath = Join-Path $bundleRoot 'live/config/token-economy.json'
if (Test-Path -LiteralPath $tokenEconomyConfigPath -PathType Leaf) {
    try {
        $existingTokenEconomyConfig = Get-Content -LiteralPath $tokenEconomyConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        Write-Warning "Ignoring invalid token-economy config during setup: $tokenEconomyConfigPath"
        $existingTokenEconomyConfig = $null
    }
}

$interactivePrompting = (Test-UpdateInitAnswerPromptSupport) -and (-not $NoPrompt)
$collectedVia = if ($interactivePrompting) { 'CLI_INTERACTIVE' } else { 'CLI_NONINTERACTIVE' }

$overrideMap = [ordered]@{
    CollectedVia = $collectedVia
}
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
$overrideAnswers = [PSCustomObject]$overrideMap

$recollectResult = Invoke-RecollectInitAnswers `
    -Answers $existingAnswers `
    -LiveVersion $existingLiveVersion `
    -TokenEconomyConfig $existingTokenEconomyConfig `
    -InteractivePrompting $interactivePrompting `
    -Overrides $overrideAnswers
$initAnswers = $recollectResult.Answers
$setupChanges = @($recollectResult.Changes)

$resolvedAssistantLanguage = Get-RequiredAnswerString -Answers $initAnswers -Key 'AssistantLanguage'
$resolvedAssistantBrevity = Get-RequiredAnswerString -Answers $initAnswers -Key 'AssistantBrevity'
$resolvedSourceOfTruth = Get-RequiredAnswerString -Answers $initAnswers -Key 'SourceOfTruth'
$resolvedCollectedVia = Get-RequiredAnswerString -Answers $initAnswers -Key 'CollectedVia'
$existingActiveAgentFiles = Get-OptionalAnswerString -Answers $existingAnswers -Key 'ActiveAgentFiles'
$canonicalEntryFile = Convert-ToCanonicalEntrypointFile -SourceOfTruth $resolvedSourceOfTruth
$activeAgentFilesInput = if ($PSBoundParameters.ContainsKey('ActiveAgentFiles')) {
    $ActiveAgentFiles
} elseif (-not [string]::IsNullOrWhiteSpace($existingActiveAgentFiles)) {
    $existingActiveAgentFiles
} else {
    $canonicalEntryFile
}
$resolvedActiveAgentFiles = Normalize-ActiveAgentFiles -Value $activeAgentFilesInput -SourceOfTruthValue $resolvedSourceOfTruth
Set-OptionalAnswerString -Answers $initAnswers -Key 'ActiveAgentFiles' -Value $resolvedActiveAgentFiles

$verifyStatus = 'NOT_RUN'
$manifestStatus = 'NOT_RUN'

if (-not $DryRun) {
    $initAnswersDirectory = Split-Path -Parent $initAnswersResolvedPath
    if ($initAnswersDirectory -and -not (Test-Path -LiteralPath $initAnswersDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $initAnswersDirectory -Force | Out-Null
    }

    $initAnswersJson = $initAnswers | ConvertTo-Json -Depth 10
    Set-Content -LiteralPath $initAnswersResolvedPath -Value $initAnswersJson

    $installScriptPath = Join-Path $scriptDir 'install.ps1'
    & $installScriptPath `
        -TargetRoot $TargetRoot `
        -AssistantLanguage $resolvedAssistantLanguage `
        -AssistantBrevity $resolvedAssistantBrevity `
        -SourceOfTruth $resolvedSourceOfTruth `
        -InitAnswersPath $initAnswersResolvedPath | Out-Null

    if ($SkipVerify) {
        $verifyStatus = 'SKIPPED'
    } elseif (-not $RunVerify) {
        $verifyStatus = 'PENDING_AGENT_CONTEXT'
    } else {
        $verifyScriptPath = Join-Path $scriptDir 'verify.ps1'
        & $verifyScriptPath -TargetRoot $TargetRoot -SourceOfTruth $resolvedSourceOfTruth -InitAnswersPath $initAnswersResolvedPath
        $verifyStatus = 'PASS'
    }

    if ($SkipManifestValidation) {
        $manifestStatus = 'SKIPPED'
    } else {
        $manifestScriptPath = Join-Path $bundleRoot 'live/scripts/agent-gates/validate-manifest.ps1'
        $manifestPath = Join-Path $bundleRoot 'MANIFEST.md'
        & $manifestScriptPath -ManifestPath $manifestPath
        $manifestStatus = 'PASS'
    }
} else {
    $verifyStatus = 'DRY_RUN'
    $manifestStatus = 'DRY_RUN'
}

Write-Output "Setup: PASS"
Write-Output "TargetRoot: $TargetRoot"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "InteractivePrompting: $interactivePrompting"
Write-Output "CollectedVia: $resolvedCollectedVia"
Write-Output "AssistantLanguage: $resolvedAssistantLanguage"
Write-Output "AssistantBrevity: $resolvedAssistantBrevity"
Write-Output "ActiveAgentFiles: $(if ([string]::IsNullOrWhiteSpace($resolvedActiveAgentFiles)) { 'n/a' } else { $resolvedActiveAgentFiles })"
Write-Output "SourceOfTruth: $resolvedSourceOfTruth"
Write-Output "InitAnswerChangeCount: $($setupChanges.Count)"
Write-Output "Verify: $verifyStatus"
Write-Output "ManifestValidation: $manifestStatus"
