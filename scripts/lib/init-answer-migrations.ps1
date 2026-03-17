function Get-InitAnswerMigrationSchema {
    return @(
        [PSCustomObject]@{
            Key                  = 'AssistantLanguage'
            Type                 = 'string'
            DefaultValue         = 'English'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'AssistantLanguage'
            TokenConfigProperty  = $null
            Prompt               = 'Missing init answer AssistantLanguage. Which language should be used for assistant explanations and help in this project?'
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
            Prompt               = 'Missing init answer AssistantBrevity. What response brevity should be default: concise or detailed?'
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
            Prompt               = 'Missing init answer SourceOfTruth. Which source-of-truth entrypoint should be canonical: Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, or Antigravity?'
            ChangeHint           = "Defaulting to 'Claude'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'EnforceNoAutoCommit'
            Type                 = 'boolean'
            DefaultValue         = 'false'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'EnforceNoAutoCommit'
            TokenConfigProperty  = $null
            Prompt               = 'Missing init answer EnforceNoAutoCommit. Strengthen the no-auto-commit guard? (yes/no)'
            ChangeHint           = "Defaulting to 'false'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'ClaudeOrchestratorFullAccess'
            Type                 = 'boolean'
            DefaultValue         = 'false'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'ClaudeOrchestratorFullAccess'
            TokenConfigProperty  = $null
            Prompt               = 'Missing init answer ClaudeOrchestratorFullAccess. Give Claude full access to orchestrator files? (yes/no)'
            ChangeHint           = "Defaulting to 'false'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'TokenEconomyEnabled'
            Type                 = 'boolean'
            DefaultValue         = 'false'
            PromptOnUpdate       = $true
            LiveVersionProperty  = 'TokenEconomyEnabled'
            TokenConfigProperty  = 'enabled'
            Prompt               = 'Missing init answer TokenEconomyEnabled. Enable token-economy mode by default? (yes/no)'
            ChangeHint           = "Defaulting to 'false'. You can change it later in runtime/init-answers.json and rerun update."
        },
        [PSCustomObject]@{
            Key                  = 'CollectedVia'
            Type                 = 'literal'
            DefaultValue         = 'AGENT_INIT_PROMPT.md'
            PromptOnUpdate       = $false
            LiveVersionProperty  = $null
            TokenConfigProperty  = $null
            Prompt               = $null
            ChangeHint           = "Backfilling CollectedVia='AGENT_INIT_PROMPT.md' for compatibility with current install/verify contracts."
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

    if (-not [string]::IsNullOrWhiteSpace($RecommendationSource) -and -not [string]::IsNullOrWhiteSpace($defaultValue)) {
        Write-Host "Recommended default for $($Definition.Key): $defaultValue (inferred from $RecommendationSource). Press Enter to accept it or enter a different value."
    }

    $promptText = if ([string]::IsNullOrWhiteSpace($defaultValue)) {
        [string]$Definition.Prompt
    } else {
        "$($Definition.Prompt) [$defaultValue]"
    }

    while ($true) {
        $response = Read-Host $promptText
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

        if ($definition.Type -eq 'literal' -or -not $definition.PromptOnUpdate -or [string]::IsNullOrWhiteSpace([string]$definition.Prompt)) {
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
