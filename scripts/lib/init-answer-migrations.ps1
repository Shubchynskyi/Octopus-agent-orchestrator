function Get-InitAnswerMigrationSchema {
    return @(
        [PSCustomObject]@{
            Key                  = 'AssistantLanguage'
            Type                 = 'string'
            DefaultValue         = 'English'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'AssistantLanguage'
            TokenConfigProperty  = $null
            Prompt               = 'Set communication language'
            ChangeHint           = "Defaulting to 'English'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'AssistantBrevity'
            Type                 = 'enum'
            AllowedValues        = @('concise', 'detailed')
            DefaultValue         = 'concise'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'AssistantBrevity'
            TokenConfigProperty  = $null
            Prompt               = 'Set default response brevity'
            ChangeHint           = "Defaulting to 'concise'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'SourceOfTruth'
            Type                 = 'enum'
            AllowedValues        = @('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')
            DefaultValue         = 'Claude'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'SourceOfTruth'
            TokenConfigProperty  = $null
            Prompt               = 'Set primary source-of-truth entrypoint'
            ChangeHint           = "Defaulting to 'Claude'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'EnforceNoAutoCommit'
            Type                 = 'boolean'
            DefaultValue         = 'true'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'EnforceNoAutoCommit'
            TokenConfigProperty  = $null
            Prompt               = 'Set no-auto-commit guard mode'
            ChangeHint           = "Defaulting to 'true'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'ClaudeOrchestratorFullAccess'
            Type                 = 'boolean'
            DefaultValue         = 'false'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'ClaudeOrchestratorFullAccess'
            TokenConfigProperty  = $null
            Prompt               = 'Set Claude access level for orchestrator files'
            ChangeHint           = "Defaulting to 'false'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'TokenEconomyEnabled'
            Type                 = 'boolean'
            DefaultValue         = 'true'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'TokenEconomyEnabled'
            TokenConfigProperty  = 'enabled'
            Prompt               = 'Set default token economy mode'
            ChangeHint           = "Defaulting to 'true'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'CollectedVia'
            Type                 = 'enum'
            AllowedValues        = @('AGENT_INIT_PROMPT.md', 'CLI_INTERACTIVE', 'CLI_NONINTERACTIVE')
            DefaultValue         = 'AGENT_INIT_PROMPT.md'
            PromptOnUpdate       = $false
            LiveVersionProperty  = $null
            TokenConfigProperty  = $null
            Prompt               = $null
            ChangeHint           = "Backfilling CollectedVia='AGENT_INIT_PROMPT.md' when the source of init answers cannot be determined."
        }
    )
}

function Test-UpdateInitAnswerPromptSupport {
    try {
        if (-not [Environment]::UserInteractive) {
            return $false
        }

        if ([Console]::IsInputRedirected) {
            return $false
        }

        return $true
    }
    catch {
        return $false
    }
}

function Get-InitAnswerMigrationValue {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$LogicalName
    )

    if ($null -eq $Answers) {
        return $null
    }

    $targetKey = $LogicalName.ToLowerInvariant().Replace('_', '').Replace('-', '')
    foreach ($property in $Answers.PSObject.Properties) {
        $propertyKey = $property.Name.ToLowerInvariant().Replace('_', '').Replace('-', '')
        if ($propertyKey -eq $targetKey) {
            return $property.Value
        }
    }

    return $null
}

function Set-InitAnswerMigrationValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$LogicalName,
        [AllowNull()]
        [object]$Value
    )

    $targetKey = $LogicalName.ToLowerInvariant().Replace('_', '').Replace('-', '')
    $matchingProperties = @()
    foreach ($property in $Answers.PSObject.Properties) {
        $propertyKey = $property.Name.ToLowerInvariant().Replace('_', '').Replace('-', '')
        if ($propertyKey -eq $targetKey) {
            $matchingProperties += $property.Name
        }
    }

    foreach ($propertyName in $matchingProperties) {
        if ($propertyName -ne $LogicalName) {
            [void]$Answers.PSObject.Properties.Remove($propertyName)
        }
    }

    $canonicalProperty = $Answers.PSObject.Properties[$LogicalName]
    if ($null -ne $canonicalProperty) {
        $canonicalProperty.Value = $Value
        return
    }

    Add-Member -InputObject $Answers -MemberType NoteProperty -Name $LogicalName -Value $Value
}

function Copy-InitAnswersForMigration {
    param(
        [AllowNull()]
        [object]$Answers
    )

    $copy = [ordered]@{}
    if ($null -ne $Answers) {
        foreach ($property in $Answers.PSObject.Properties) {
            $copy[$property.Name] = $property.Value
        }
    }

    return [PSCustomObject]$copy
}

function Get-InitAnswerMigrationObjectProperty {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Convert-InitAnswerMigrationValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return $null
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    $trimmed = $text.Trim()
    switch ($Definition.Type) {
        'string' {
            return $trimmed
        }
        'enum' {
            foreach ($allowedValue in @($Definition.AllowedValues)) {
                if ([string]::Equals($trimmed, [string]$allowedValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return [string]$allowedValue
                }
            }

            $allowedText = (@($Definition.AllowedValues) -join ', ')
            throw "Unsupported value '$trimmed' for $($Definition.Key). Allowed values: $allowedText."
        }
        'boolean' {
            switch ($trimmed.ToLowerInvariant()) {
                '1' { return 'true' }
                '0' { return 'false' }
                'true' { return 'true' }
                'false' { return 'false' }
                'yes' { return 'true' }
                'no' { return 'false' }
                'y' { return 'true' }
                'n' { return 'false' }
                'да' { return 'true' }
                'нет' { return 'false' }
                default {
                    throw "Unsupported value '$trimmed' for $($Definition.Key). Allowed values: true, false, yes, no, 1, 0."
                }
            }
        }
        'literal' {
            return [string]$Definition.DefaultValue
        }
        default {
            throw "Unsupported migration definition type '$($Definition.Type)' for $($Definition.Key)."
        }
    }
}

function Get-InitAnswerMigrationInference {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [AllowNull()]
        [object]$LiveVersion,
        [AllowNull()]
        [hashtable]$TokenEconomyConfig
    )

    if (-not [string]::IsNullOrWhiteSpace([string]$Definition.LiveVersionProperty)) {
        $liveValue = Get-InitAnswerMigrationObjectProperty -Object $LiveVersion -PropertyName $Definition.LiveVersionProperty
        if ($null -ne $liveValue) {
            try {
                return [PSCustomObject]@{
                    Value  = Convert-InitAnswerMigrationValue -Definition $Definition -Value $liveValue
                    Source = 'live/version.json'
                }
            }
            catch {
                # Ignore invalid inference values and continue to the next source.
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace([string]$Definition.TokenConfigProperty) -and $null -ne $TokenEconomyConfig) {
        if ($TokenEconomyConfig.ContainsKey([string]$Definition.TokenConfigProperty)) {
            try {
                return [PSCustomObject]@{
                    Value  = Convert-InitAnswerMigrationValue -Definition $Definition -Value $TokenEconomyConfig[[string]$Definition.TokenConfigProperty]
                    Source = 'live/config/token-economy.json'
                }
            }
            catch {
                # Ignore invalid inference values and continue to defaults/prompt.
            }
        }
    }

    return $null
}

function Get-InitAnswerMigrationSelectionOptions {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition
    )

    switch ([string]$Definition.Type) {
        'boolean' {
            return @(
                [PSCustomObject]@{
                    Label = 'No'
                    Value = 'false'
                },
                [PSCustomObject]@{
                    Label = 'Yes'
                    Value = 'true'
                }
            )
        }
        'enum' {
            $options = @()
            foreach ($allowedValue in @($Definition.AllowedValues)) {
                $options += [PSCustomObject]@{
                    Label = [string]$allowedValue
                    Value = [string](Convert-InitAnswerMigrationValue -Definition $Definition -Value $allowedValue)
                }
            }

            return @($options)
        }
        default {
            return @()
        }
    }
}

function Get-InitAnswerMigrationSelectionIndex {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [AllowNull()]
        [string]$DefaultValue
    )

    if ($Options.Count -eq 0) {
        return 0
    }

    if (-not [string]::IsNullOrWhiteSpace($DefaultValue)) {
        for ($index = 0; $index -lt $Options.Count; $index++) {
            if ([string]::Equals([string]$Options[$index].Value, $DefaultValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $index
            }
        }
    }

    return 0
}

function Get-InitAnswerMigrationChoiceDescriptions {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [Parameter(Mandatory = $true)]
        [object[]]$Options
    )

    $choices = @()
    switch ([string]$Definition.Key) {
        'AssistantBrevity' {
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Concise', 'Shorter default responses.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Detailed', 'More detailed default responses.'
            return $choices
        }
        'SourceOfTruth' {
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Claude', 'Use CLAUDE.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription 'Co&dex', 'Use AGENTS.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Gemini', 'Use GEMINI.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription 'GitHub&Copilot', 'Use .github/copilot-instructions.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Windsurf', 'Use .windsurf/rules/rules.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Junie', 'Use .junie/guidelines.md as canonical.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Antigravity', 'Use .antigravity/rules.md as canonical.'
            return $choices
        }
        'EnforceNoAutoCommit' {
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&No', 'Do not enforce the stricter no-auto-commit guard.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Yes', 'Enforce the stricter no-auto-commit guard.'
            return $choices
        }
        'ClaudeOrchestratorFullAccess' {
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&No', 'Keep Claude access restricted.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Yes', 'Grant Claude full access to orchestrator files.'
            return $choices
        }
        'TokenEconomyEnabled' {
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&No', 'Disable token economy by default.'
            $choices += New-Object System.Management.Automation.Host.ChoiceDescription '&Yes', 'Enable token economy by default.'
            return $choices
        }
        default {
            foreach ($option in $Options) {
                $label = [string]$option.Label
                if ([string]::IsNullOrWhiteSpace($label)) {
                    continue
                }

                $hotkeyLabel = if ($label.Length -gt 1) {
                    '&' + $label.Substring(0, 1) + $label.Substring(1)
                } else {
                    '&' + $label
                }
                $choices += New-Object System.Management.Automation.Host.ChoiceDescription $hotkeyLabel, $label
            }

            return $choices
        }
    }
}

function Write-InitAnswerPromptText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    Write-Host $Text -ForegroundColor Yellow
}

function Write-InitAnswerSelectionState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    Write-Host $Text -ForegroundColor Green
}

function Read-InitAnswerConsoleLine {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PromptText
    )

    try {
        Write-Host $PromptText -ForegroundColor Yellow -NoNewline
        Write-Host ' ' -NoNewline

        $originalForegroundColor = [Console]::ForegroundColor
        try {
            [Console]::ForegroundColor = [System.ConsoleColor]::Green
            return [Console]::ReadLine()
        }
        finally {
            [Console]::ForegroundColor = $originalForegroundColor
        }
    }
    catch {
        return Read-Host $PromptText
    }
}

function Read-InitAnswerInteractiveKey {
    try {
        if ($null -ne $Host -and $null -ne $Host.UI -and $null -ne $Host.UI.RawUI) {
            return $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        }
    }
    catch {
        # Fall back to .NET console key reading below.
    }

    try {
        return [Console]::ReadKey($true)
    }
    catch {
        throw 'Interactive key input is unavailable.'
    }
}

function Get-InitAnswerInteractiveKeyName {
    param(
        [AllowNull()]
        [object]$KeyInfo
    )

    if ($null -eq $KeyInfo) {
        return $null
    }

    $consoleKeyProperty = $KeyInfo.PSObject.Properties['Key']
    if ($null -ne $consoleKeyProperty -and $null -ne $consoleKeyProperty.Value) {
        return [string]$consoleKeyProperty.Value
    }

    $virtualKeyCodeProperty = $KeyInfo.PSObject.Properties['VirtualKeyCode']
    if ($null -ne $virtualKeyCodeProperty -and $null -ne $virtualKeyCodeProperty.Value) {
        switch ([int]$virtualKeyCodeProperty.Value) {
            13 { return 'Enter' }
            32 { return 'Spacebar' }
            37 { return 'LeftArrow' }
            38 { return 'UpArrow' }
            39 { return 'RightArrow' }
            40 { return 'DownArrow' }
            default { return $null }
        }
    }

    return $null
}

function Get-InitAnswerInteractiveKeyChar {
    param(
        [AllowNull()]
        [object]$KeyInfo
    )

    if ($null -eq $KeyInfo) {
        return [char]0
    }

    $characterProperty = $KeyInfo.PSObject.Properties['Character']
    if ($null -ne $characterProperty -and $null -ne $characterProperty.Value) {
        return [char]$characterProperty.Value
    }

    $keyCharProperty = $KeyInfo.PSObject.Properties['KeyChar']
    if ($null -ne $keyCharProperty -and $null -ne $keyCharProperty.Value) {
        return [char]$keyCharProperty.Value
    }

    return [char]0
}

function Test-InitAnswerRenderSupport {
    try {
        if ([Console]::IsOutputRedirected) {
            return $false
        }
    }
    catch {
        # Ignore and continue with RawUI checks.
    }

    try {
        if ($null -eq $Host -or $null -eq $Host.UI -or $null -eq $Host.UI.RawUI) {
            return $false
        }

        $null = $Host.UI.RawUI.CursorPosition
        $null = $Host.UI.RawUI.WindowSize
        return $true
    }
    catch {
        return $false
    }
}

function Get-InitAnswerRenderStateStore {
    if ($null -eq $script:InitAnswerRenderStates) {
        $script:InitAnswerRenderStates = @{}
    }

    return $script:InitAnswerRenderStates
}

function Reset-InitAnswerRenderState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $store = Get-InitAnswerRenderStateStore
    if ($store.ContainsKey($Key)) {
        [void]$store.Remove($Key)
    }
}

function Write-InitAnswerRenderedLines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [Parameter(Mandatory = $true)]
        [object[]]$Lines
    )

    if (-not (Test-InitAnswerRenderSupport)) {
        foreach ($line in $Lines) {
            $lineText = [string]$line.Text
            $lineColorProperty = $line.PSObject.Properties['Color']
            if ($null -ne $lineColorProperty -and $null -ne $lineColorProperty.Value) {
                Write-Host $lineText -ForegroundColor ([System.ConsoleColor]$lineColorProperty.Value)
            }
            else {
                Write-Host $lineText
            }
        }
        return
    }

    $rawUi = $Host.UI.RawUI
    $store = Get-InitAnswerRenderStateStore
    $windowWidth = [Math]::Max(1, [int]$rawUi.WindowSize.Width)

    if (-not $store.ContainsKey($Key)) {
        $anchorPosition = $rawUi.CursorPosition
        $store[$Key] = [PSCustomObject]@{
            X         = [int]$anchorPosition.X
            Y         = [int]$anchorPosition.Y
            LineCount = 0
        }
    }

    $state = $store[$Key]
    $anchor = New-Object System.Management.Automation.Host.Coordinates($state.X, $state.Y)
    $renderLineCount = [Math]::Max([int]$state.LineCount, [int]$Lines.Count)

    for ($index = 0; $index -lt $renderLineCount; $index++) {
        $rawUi.CursorPosition = New-Object System.Management.Automation.Host.Coordinates($anchor.X, ($anchor.Y + $index))

        if ($index -lt $Lines.Count) {
            $lineText = [string]$Lines[$index].Text
            $lineColorProperty = $Lines[$index].PSObject.Properties['Color']
            $lineColor = if ($null -ne $lineColorProperty) { $lineColorProperty.Value } else { $null }
        }
        else {
            $lineText = ''
            $lineColor = $null
        }

        $paddedLine = if ($windowWidth -le 1) {
            ''
        }
        elseif ($lineText.Length -ge ($windowWidth - 1)) {
            $lineText.Substring(0, $windowWidth - 1)
        }
        else {
            $lineText.PadRight($windowWidth - 1)
        }

        if ($null -ne $lineColor) {
            Write-Host $paddedLine -ForegroundColor ([System.ConsoleColor]$lineColor)
        }
        else {
            Write-Host $paddedLine
        }
    }

    $rawUi.CursorPosition = New-Object System.Management.Automation.Host.Coordinates($anchor.X, ($anchor.Y + $Lines.Count))
    $store[$Key] = [PSCustomObject]@{
        X         = $anchor.X
        Y         = $anchor.Y
        LineCount = $Lines.Count
    }
}

function Write-InitAnswerSelectionOptions {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [Parameter(Mandatory = $true)]
        [int]$SelectedIndex
    )

    $lines = @()
    for ($index = 0; $index -lt $Options.Count; $index++) {
        $pointer = if ($index -eq $SelectedIndex) { '>' } else { ' ' }
        $line = ("{0} {1}. {2}" -f $pointer, ($index + 1), [string]$Options[$index].Label)
        $lines += [PSCustomObject]@{
            Text  = $line
            Color = if ($index -eq $SelectedIndex) { [System.ConsoleColor]::Green } else { $null }
        }
    }

    return ,$lines
}

function Get-InitAnswerSelectionStateText {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [Parameter(Mandatory = $true)]
        [int]$SelectedIndex
    )

    if ($SelectedIndex -lt 0 -or $SelectedIndex -ge $Options.Count) {
        return $null
    }

    return [string]$Options[$SelectedIndex].Label
}

function Write-InitAnswerSelectionSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [Parameter(Mandatory = $true)]
        [int]$SelectedIndex,
        [string]$RenderKey = 'InitAnswerSelection'
    )

    $lines = @(
        @(Write-InitAnswerSelectionOptions -Options $Options -SelectedIndex $SelectedIndex)
        [PSCustomObject]@{
            Text  = ("Current selection: {0}" -f (Get-InitAnswerSelectionStateText -Options $Options -SelectedIndex $SelectedIndex))
            Color = $null
        }
    )

    Write-InitAnswerRenderedLines -Key $RenderKey -Lines $lines
}

function Read-InitAnswerFallbackSelectionPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [Parameter(Mandatory = $true)]
        [int]$SelectedIndex,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    Write-InitAnswerPromptText -Text ([string]$Definition.Prompt)
    Write-InitAnswerPromptText -Text $Message
    for ($index = 0; $index -lt $Options.Count; $index++) {
        $suffix = if ($index -eq $SelectedIndex) { ' [default]' } else { '' }
        Write-Host ("  {0}. {1}{2}" -f ($index + 1), [string]$Options[$index].Label, $suffix) -ForegroundColor Yellow
    }

    while ($true) {
        $response = Read-InitAnswerConsoleLine -PromptText 'Select option number:'
        if ([string]::IsNullOrWhiteSpace($response)) {
            return $SelectedIndex
        }

        [int]$numericSelection = 0
        if ([int]::TryParse($response.Trim(), [ref]$numericSelection)) {
            $resolvedIndex = $numericSelection - 1
            if ($resolvedIndex -ge 0 -and $resolvedIndex -lt $Options.Count) {
                return $resolvedIndex
            }
        }

        foreach ($index in 0..($Options.Count - 1)) {
            if ([string]::Equals($response.Trim(), [string]$Options[$index].Label, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $index
            }
        }

        Write-Warning ("Unsupported selection '{0}'. Choose a number from 1 to {1}." -f $response, $Options.Count)
    }
}

function Read-InitAnswerConsoleSelectionPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [Parameter(Mandatory = $true)]
        [object[]]$Options,
        [Parameter(Mandatory = $true)]
        [int]$SelectedIndex,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    Write-InitAnswerPromptText -Text ([string]$Definition.Prompt)
    Write-Host $Message
    Write-Host 'Use Up/Down to change focus. Press Enter to confirm.'
    $renderKey = "InitAnswerSelection:$($Definition.Key)"
    Reset-InitAnswerRenderState -Key $renderKey
    Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey

    while ($true) {
        $keyInfo = Read-InitAnswerInteractiveKey
        $keyName = Get-InitAnswerInteractiveKeyName -KeyInfo $keyInfo

        switch ($keyName) {
            'LeftArrow' {
                $SelectedIndex = if ($SelectedIndex -le 0) { $Options.Count - 1 } else { $SelectedIndex - 1 }
                Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                continue
            }
            'RightArrow' {
                $SelectedIndex = if ($SelectedIndex -ge ($Options.Count - 1)) { 0 } else { $SelectedIndex + 1 }
                Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                continue
            }
            'UpArrow' {
                $SelectedIndex = if ($SelectedIndex -le 0) { $Options.Count - 1 } else { $SelectedIndex - 1 }
                Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                continue
            }
            'DownArrow' {
                $SelectedIndex = if ($SelectedIndex -ge ($Options.Count - 1)) { 0 } else { $SelectedIndex + 1 }
                Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                continue
            }
            'Enter' {
                Reset-InitAnswerRenderState -Key $renderKey
                Write-InitAnswerSelectionState -Text ("Selected: {0}" -f (Get-InitAnswerSelectionStateText -Options $Options -SelectedIndex $SelectedIndex))
                return $SelectedIndex
            }
            'Spacebar' {
                Reset-InitAnswerRenderState -Key $renderKey
                Write-InitAnswerSelectionState -Text ("Selected: {0}" -f (Get-InitAnswerSelectionStateText -Options $Options -SelectedIndex $SelectedIndex))
                return $SelectedIndex
            }
            default {
                $char = Get-InitAnswerInteractiveKeyChar -KeyInfo $keyInfo
                if ($char -and [char]::IsDigit($char)) {
                    $numericIndex = [int]([string]$char) - 1
                    if ($numericIndex -ge 0 -and $numericIndex -lt $Options.Count) {
                        $SelectedIndex = $numericIndex
                        Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                    }
                    continue
                }

                if ($char) {
                    $normalizedChar = [char]::ToUpperInvariant($char)
                    for ($index = 0; $index -lt $Options.Count; $index++) {
                        $label = [string]$Options[$index].Label
                        if (-not [string]::IsNullOrWhiteSpace($label) -and [char]::ToUpperInvariant($label[0]) -eq $normalizedChar) {
                            $SelectedIndex = $index
                            Write-InitAnswerSelectionSnapshot -Options $Options -SelectedIndex $SelectedIndex -RenderKey $renderKey
                            break
                        }
                    }
                }
                continue
            }
        }
    }
}

function Read-InitAnswerMigrationSelectionPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [AllowNull()]
        [string]$PromptDefaultValue,
        [AllowNull()]
        [string]$RecommendationSource
    )

    $defaultValue = if ([string]::IsNullOrWhiteSpace($PromptDefaultValue)) {
        [string](Convert-InitAnswerMigrationValue -Definition $Definition -Value $Definition.DefaultValue)
    } else {
        [string](Convert-InitAnswerMigrationValue -Definition $Definition -Value $PromptDefaultValue)
    }
    $options = @(Get-InitAnswerMigrationSelectionOptions -Definition $Definition)
    if ($options.Count -eq 0) {
        throw "Interactive selector is not available for definition type '$($Definition.Type)'."
    }

    $selectedIndex = Get-InitAnswerMigrationSelectionIndex -Options $options -DefaultValue $defaultValue
    $initialIndex = $selectedIndex
    $selectionChanged = $false

    $caption = [string]$Definition.Prompt
    $message = if (-not [string]::IsNullOrWhiteSpace($RecommendationSource)) {
        "Default: $defaultValue (from $RecommendationSource)."
    } else {
        "Default: $defaultValue."
    }

    try {
        $selectedIndex = Read-InitAnswerConsoleSelectionPrompt `
            -Definition $Definition `
            -Options $options `
            -SelectedIndex $selectedIndex `
            -Message $message
    }
    catch {
        $selectedIndex = Read-InitAnswerFallbackSelectionPrompt `
            -Definition $Definition `
            -Options $options `
            -SelectedIndex $selectedIndex `
            -Message $message
    }

    $selectionChanged = $selectedIndex -ne $initialIndex
    $selectedValue = [string]$options[$selectedIndex].Value
    $usedDefault = (-not $selectionChanged) -and [string]::Equals($selectedValue, $defaultValue, [System.StringComparison]::OrdinalIgnoreCase)
    return [PSCustomObject]@{
        Value          = $selectedValue
        UsedDefault    = $usedDefault
        PromptResponse = [string]$options[$selectedIndex].Label
        DefaultSource  = if ($usedDefault -and -not [string]::IsNullOrWhiteSpace($RecommendationSource)) { 'recommended_inference' } elseif ($usedDefault) { 'definition_default' } else { $null }
    }
}

function Read-InitAnswerMigrationPrompt {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Definition,
        [AllowNull()]
        [string]$PromptDefaultValue,
        [AllowNull()]
        [string]$RecommendationSource
    )

    $defaultValue = if ([string]::IsNullOrWhiteSpace($PromptDefaultValue)) {
        [string]$Definition.DefaultValue
    } else {
        [string]$PromptDefaultValue
    }

    if ($Definition.Type -ne 'string') {
        return Read-InitAnswerMigrationSelectionPrompt `
            -Definition $Definition `
            -PromptDefaultValue $defaultValue `
            -RecommendationSource $RecommendationSource
    }

    if (-not [string]::IsNullOrWhiteSpace($RecommendationSource) -and -not [string]::IsNullOrWhiteSpace($defaultValue)) {
        Write-InitAnswerPromptText -Text "Suggested: $defaultValue (from $RecommendationSource)"
    }

    $promptText = if ([string]::IsNullOrWhiteSpace($defaultValue)) {
        [string]$Definition.Prompt
    } else {
        "$($Definition.Prompt) [default: $defaultValue]"
    }

    while ($true) {
        $response = Read-InitAnswerConsoleLine -PromptText ($promptText + ':')
        if ([string]::IsNullOrWhiteSpace($response)) {
            return [PSCustomObject]@{
                Value          = $defaultValue
                UsedDefault    = $true
                PromptResponse = $null
                DefaultSource  = if ([string]::IsNullOrWhiteSpace($RecommendationSource)) { 'definition_default' } else { 'recommended_inference' }
            }
        }

        try {
            $normalized = Convert-InitAnswerMigrationValue -Definition $Definition -Value $response
            return [PSCustomObject]@{
                Value          = $normalized
                UsedDefault    = $false
                PromptResponse = $response
                DefaultSource  = $null
            }
        }
        catch {
            Write-Warning $_.Exception.Message
        }
    }
}

function Invoke-UpdateInitAnswerMigration {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [AllowNull()]
        [object]$LiveVersion,
        [AllowNull()]
        [hashtable]$TokenEconomyConfig,
        [Parameter(Mandatory = $true)]
        [string]$InitAnswersPath,
        [bool]$InteractivePrompting = $false
    )

    $workingAnswers = Copy-InitAnswersForMigration -Answers $Answers
    $changes = @()

    foreach ($definition in Get-InitAnswerMigrationSchema) {
        $existingValue = Get-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key
        $normalizedExistingValue = $null
        try {
            $normalizedExistingValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $existingValue
        }
        catch {
            # Keep invalid existing values untouched; the caller's validation stage will fail later.
            continue
        }

        if (-not [string]::IsNullOrWhiteSpace([string]$normalizedExistingValue)) {
            continue
        }

        $inference = Get-InitAnswerMigrationInference -Definition $definition -LiveVersion $LiveVersion -TokenEconomyConfig $TokenEconomyConfig

        if ($InteractivePrompting -and $definition.PromptOnUpdate -and -not [string]::IsNullOrWhiteSpace([string]$definition.Prompt)) {
            $promptDefaultValue = if ($null -ne $inference -and -not [string]::IsNullOrWhiteSpace([string]$inference.Value)) {
                [string]$inference.Value
            } else {
                [string]$definition.DefaultValue
            }
            $recommendationSource = if ($null -ne $inference -and -not [string]::IsNullOrWhiteSpace([string]$inference.Value)) {
                [string]$inference.Source
            } else {
                $null
            }

            $promptResult = Read-InitAnswerMigrationPrompt `
                -Definition $definition `
                -PromptDefaultValue $promptDefaultValue `
                -RecommendationSource $recommendationSource
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $promptResult.Value
            $changeAction = if ($promptResult.UsedDefault) {
                if ($promptResult.DefaultSource -eq 'recommended_inference') { 'recommended_default' } else { 'defaulted' }
            } else {
                'prompted'
            }
            $changeSource = if ($promptResult.UsedDefault) {
                if ($promptResult.DefaultSource -eq 'recommended_inference') {
                    "interactive_prompt_default:$recommendationSource"
                } else {
                    'default'
                }
            } else {
                'interactive_prompt'
            }
            $changeNote = if ($promptResult.UsedDefault) {
                if ($promptResult.DefaultSource -eq 'recommended_inference') {
                    "Recommended value from $recommendationSource was shown during interactive update migration and accepted."
                } else {
                    [string]$definition.ChangeHint
                }
            } else {
                if ([string]::IsNullOrWhiteSpace($recommendationSource)) {
                    'Collected during interactive update migration.'
                } else {
                    "Collected during interactive update migration. Recommended default from $recommendationSource was offered."
                }
            }
            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = $changeAction
                Value  = [string]$promptResult.Value
                Source = $changeSource
                Note   = $changeNote
            }
            continue
        }

        if (-not $definition.PromptOnUpdate -or [string]::IsNullOrWhiteSpace([string]$definition.Prompt)) {
            $defaultValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $definition.DefaultValue
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $defaultValue
            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = 'defaulted'
                Value  = [string]$defaultValue
                Source = 'default'
                Note   = [string]$definition.ChangeHint
            }
            continue
        }

        if ($null -ne $inference -and -not [string]::IsNullOrWhiteSpace([string]$inference.Value)) {
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $inference.Value
            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = 'inferred'
                Value  = [string]$inference.Value
                Source = [string]$inference.Source
                Note   = "Backfilled from $($inference.Source)."
            }
            continue
        }

        $defaultValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $definition.DefaultValue
        Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $defaultValue
        $changes += [PSCustomObject]@{
            Key    = $definition.Key
            Action = 'defaulted'
            Value  = [string]$defaultValue
            Source = 'default'
            Note   = [string]$definition.ChangeHint
        }
    }

    return [PSCustomObject]@{
        Answers  = $workingAnswers
        Changes  = @($changes)
    }
}

function Invoke-RecollectInitAnswers {
    param(
        [AllowNull()]
        [object]$Answers,
        [AllowNull()]
        [object]$LiveVersion,
        [AllowNull()]
        [hashtable]$TokenEconomyConfig,
        [bool]$InteractivePrompting = $false,
        [AllowNull()]
        [object]$Overrides
    )

    $workingAnswers = Copy-InitAnswersForMigration -Answers $Answers
    $changes = @()

    foreach ($definition in Get-InitAnswerMigrationSchema) {
        $existingValue = Get-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key
        $normalizedExistingValue = $null
        try {
            $normalizedExistingValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $existingValue
        }
        catch {
            $normalizedExistingValue = $null
        }

        $overrideValue = $null
        $overrideProvided = $false
        if ($null -ne $Overrides) {
            $overrideRaw = Get-InitAnswerMigrationValue -Answers $Overrides -LogicalName $definition.Key
            if ($null -ne $overrideRaw) {
                try {
                    $overrideValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $overrideRaw
                    $overrideProvided = $true
                }
                catch {
                    throw "Invalid reinit override for $($definition.Key): $($_.Exception.Message)"
                }
            }
        }

        if ($overrideProvided) {
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $overrideValue
            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = 'overridden'
                Value  = [string]$overrideValue
                Source = 'explicit_override'
                Note   = 'Applied from explicit reinit parameter override.'
            }
            continue
        }

        if ($definition.Type -eq 'literal') {
            $literalValue = Convert-InitAnswerMigrationValue -Definition $definition -Value $definition.DefaultValue
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $literalValue
            $existingLiteralText = if ($null -eq $existingValue) { '' } else { ([string]$existingValue).Trim() }
            if (-not [string]::Equals($existingLiteralText, [string]$literalValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                $changes += [PSCustomObject]@{
                    Key    = $definition.Key
                    Action = 'normalized'
                    Value  = [string]$literalValue
                    Source = 'definition_literal'
                    Note   = "Reset to literal contract value '$literalValue'."
                }
            }
            continue
        }

        if (-not $definition.PromptOnUpdate -or [string]::IsNullOrWhiteSpace([string]$definition.Prompt)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$normalizedExistingValue)) {
                Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $normalizedExistingValue
                continue
            }

            $defaultValue = [string](Convert-InitAnswerMigrationValue -Definition $definition -Value $definition.DefaultValue)
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $defaultValue
            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = 'defaulted'
                Value  = [string]$defaultValue
                Source = 'default'
                Note   = [string]$definition.ChangeHint
            }
            continue
        }

        $preferredValue = $null
        $preferredSource = $null
        if (-not [string]::IsNullOrWhiteSpace([string]$normalizedExistingValue)) {
            $preferredValue = [string]$normalizedExistingValue
            $preferredSource = 'runtime/init-answers.json'
        } else {
            $inference = Get-InitAnswerMigrationInference -Definition $definition -LiveVersion $LiveVersion -TokenEconomyConfig $TokenEconomyConfig
            if ($null -ne $inference -and -not [string]::IsNullOrWhiteSpace([string]$inference.Value)) {
                $preferredValue = [string]$inference.Value
                $preferredSource = [string]$inference.Source
            } else {
                $preferredValue = [string](Convert-InitAnswerMigrationValue -Definition $definition -Value $definition.DefaultValue)
                $preferredSource = 'default'
            }
        }

        if ($InteractivePrompting) {
            $recommendationSource = if ($preferredSource -eq 'default') { $null } else { [string]$preferredSource }
            $promptResult = Read-InitAnswerMigrationPrompt `
                -Definition $definition `
                -PromptDefaultValue $preferredValue `
                -RecommendationSource $recommendationSource
            Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $promptResult.Value

            $changeAction = if ($promptResult.UsedDefault) {
                if ([string]::IsNullOrWhiteSpace($recommendationSource)) { 'defaulted' } else { 'recommended_default' }
            } else {
                'prompted'
            }
            $changeSource = if ($promptResult.UsedDefault) {
                if ([string]::IsNullOrWhiteSpace($recommendationSource)) {
                    'default'
                } else {
                    "interactive_prompt_default:$recommendationSource"
                }
            } else {
                'interactive_prompt'
            }
            $changeNote = if ($promptResult.UsedDefault) {
                if ([string]::IsNullOrWhiteSpace($recommendationSource)) {
                    [string]$definition.ChangeHint
                } elseif ($recommendationSource -eq 'runtime/init-answers.json') {
                    'Current init answer was shown as the recommended default during interactive reinit and accepted.'
                } else {
                    "Recommended value from $recommendationSource was shown during interactive reinit and accepted."
                }
            } else {
                if ([string]::IsNullOrWhiteSpace($recommendationSource)) {
                    'Collected during interactive reinit.'
                } else {
                    "Collected during interactive reinit. Recommended default from $recommendationSource was offered."
                }
            }

            $changes += [PSCustomObject]@{
                Key    = $definition.Key
                Action = $changeAction
                Value  = [string]$promptResult.Value
                Source = $changeSource
                Note   = $changeNote
            }
            continue
        }

        Set-InitAnswerMigrationValue -Answers $workingAnswers -LogicalName $definition.Key -Value $preferredValue
        $changeAction = switch ($preferredSource) {
            'runtime/init-answers.json' { 'preserved'; break }
            'default' { 'defaulted'; break }
            default { 'inferred'; break }
        }
        $changeNote = switch ($preferredSource) {
            'runtime/init-answers.json' { 'Preserved existing init answer without prompting.'; break }
            'default' { [string]$definition.ChangeHint; break }
            default { "Backfilled from $preferredSource without prompting."; break }
        }

        $changes += [PSCustomObject]@{
            Key    = $definition.Key
            Action = $changeAction
            Value  = [string]$preferredValue
            Source = [string]$preferredSource
            Note   = $changeNote
        }
    }

    return [PSCustomObject]@{
        Answers  = $workingAnswers
        Changes  = @($changes)
    }
}
