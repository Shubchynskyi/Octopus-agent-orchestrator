function Get-ManagedConfigDefinitions {
    return @(
        [PSCustomObject]@{
            Name                 = 'review-capabilities'
            TemplateRelativePath = 'config/review-capabilities.json'
            LiveRelativePath     = 'config/review-capabilities.json'
        },
        [PSCustomObject]@{
            Name                 = 'paths'
            TemplateRelativePath = 'config/paths.json'
            LiveRelativePath     = 'config/paths.json'
        },
        [PSCustomObject]@{
            Name                 = 'token-economy'
            TemplateRelativePath = 'config/token-economy.json'
            LiveRelativePath     = 'config/token-economy.json'
        },
        [PSCustomObject]@{
            Name                 = 'output-filters'
            TemplateRelativePath = 'config/output-filters.json'
            LiveRelativePath     = 'config/output-filters.json'
        }
    )
}

function Get-ManagedConfigDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigName
    )

    foreach ($definition in Get-ManagedConfigDefinitions) {
        if ([string]::Equals([string]$definition.Name, $ConfigName, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $definition
        }
    }

    throw "Unsupported managed config '$ConfigName'."
}

function Convert-ToManagedConfigHashtable {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $copy = [ordered]@{}
        foreach ($key in $Value.Keys) {
            $copy[[string]$key] = Convert-ToManagedConfigHashtable -Value $Value[$key]
        }
        return $copy
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(Convert-ToManagedConfigHashtable -Value $item)
        }
        return $items
    }

    if ($Value.PSObject -and $Value.PSObject.Properties.Count -gt 0 -and $Value -isnot [string]) {
        $copy = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) {
            $copy[[string]$property.Name] = Convert-ToManagedConfigHashtable -Value $property.Value
        }
        return $copy
    }

    return $Value
}

function Get-ManagedConfigNormalizedKey {
    param(
        [AllowNull()]
        [string]$Key
    )

    if ([string]::IsNullOrWhiteSpace($Key)) {
        return ''
    }

    return (($Key.Trim()).ToLowerInvariant() -replace '[^a-z0-9]', '')
}

function Get-ManagedConfigEntries {
    param(
        [AllowNull()]
        [object]$Object
    )

    if ($null -eq $Object) {
        return @()
    }

    $entries = @()
    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($key in $Object.Keys) {
            $entries += [PSCustomObject]@{
                Name  = [string]$key
                Value = $Object[$key]
            }
        }
        return $entries
    }

    foreach ($property in $Object.PSObject.Properties) {
        $entries += [PSCustomObject]@{
            Name  = [string]$property.Name
            Value = $property.Value
        }
    }

    return $entries
}

function Get-ManagedConfigEntry {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if ($null -eq $Object) {
        return $null
    }

    $normalizedTargetKey = Get-ManagedConfigNormalizedKey -Key $Key
    foreach ($entry in @(Get-ManagedConfigEntries -Object $Object)) {
        if ([string]::Equals([string]$entry.Name, $Key, [System.StringComparison]::Ordinal)) {
            return $entry
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object $Object)) {
        if ((Get-ManagedConfigNormalizedKey -Key ([string]$entry.Name)) -eq $normalizedTargetKey) {
            return $entry
        }
    }

    return $null
}

function New-ManagedConfigChangeList {
    $changes = [System.Collections.Generic.List[object]]::new()
    Write-Output -NoEnumerate $changes
}

function Add-ManagedConfigChange {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Detail
    )

    $Changes.Add([PSCustomObject]@{
        Path   = $Path
        Detail = $Detail
    }) | Out-Null
}

function Format-ManagedConfigChange {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [object]$Change
    )

    $pathPrefix = if ([string]::IsNullOrWhiteSpace([string]$Change.Path)) {
        $RelativePath
    } else {
        "$RelativePath $($Change.Path)"
    }

    return "${pathPrefix}: $($Change.Detail)"
}

function ConvertTo-ManagedConfigBoolean {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return [PSCustomObject]@{
            Success = $false
            Value   = $null
            Coerced = $false
        }
    }

    if ($Value -is [bool]) {
        return [PSCustomObject]@{
            Success = $true
            Value   = [bool]$Value
            Coerced = $false
        }
    }

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [short] -or $Value -is [byte]) {
        $intValue = [int]$Value
        if ($intValue -in @(0, 1)) {
            return [PSCustomObject]@{
                Success = $true
                Value   = [bool]($intValue -eq 1)
                Coerced = $true
            }
        }
    }

    if ($Value -is [string]) {
        switch ($Value.Trim().ToLowerInvariant()) {
            '1' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            '0' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
            'true' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            'false' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
            'yes' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            'no' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
            'y' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            'n' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
            'on' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            'off' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
            'да' { return [PSCustomObject]@{ Success = $true; Value = $true; Coerced = $true } }
            'нет' { return [PSCustomObject]@{ Success = $true; Value = $false; Coerced = $true } }
        }
    }

    return [PSCustomObject]@{
        Success = $false
        Value   = $null
        Coerced = $false
    }
}

function ConvertTo-ManagedConfigInteger {
    param(
        [AllowNull()]
        [object]$Value,
        [int]$Minimum = [int]::MinValue,
        [int]$Maximum = [int]::MaxValue
    )

    $resolved = $null
    $coerced = $false

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [short] -or $Value -is [byte]) {
        $resolved = [int]$Value
    } elseif ($Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) {
        $numericValue = [double]$Value
        if ($numericValue -eq [Math]::Floor($numericValue)) {
            $resolved = [int]$numericValue
            $coerced = $true
        }
    } elseif ($Value -is [string]) {
        $parsedValue = 0
        if ([int]::TryParse($Value.Trim(), [ref]$parsedValue)) {
            $resolved = $parsedValue
            $coerced = $true
        }
    }

    if ($null -eq $resolved -or $resolved -lt $Minimum -or $resolved -gt $Maximum) {
        return [PSCustomObject]@{
            Success = $false
            Value   = $null
            Coerced = $false
        }
    }

    return [PSCustomObject]@{
        Success = $true
        Value   = [int]$resolved
        Coerced = $coerced
    }
}

function ConvertTo-ManagedConfigString {
    param(
        [AllowNull()]
        [object]$Value,
        [switch]$AllowEmpty
    )

    if ($Value -isnot [string]) {
        return [PSCustomObject]@{
            Success = $false
            Value   = $null
            Coerced = $false
        }
    }

    $trimmed = $Value.Trim()
    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($trimmed)) {
        return [PSCustomObject]@{
            Success = $false
            Value   = $null
            Coerced = $false
        }
    }

    return [PSCustomObject]@{
        Success = $true
        Value   = if ($AllowEmpty) { $trimmed } else { $trimmed }
        Coerced = -not [string]::Equals($Value, $trimmed, [System.StringComparison]::Ordinal)
    }
}

function ConvertTo-ManagedConfigStringArray {
    param(
        [AllowNull()]
        [object]$Value,
        [switch]$SplitScalarList,
        [switch]$AllowEmpty
    )

    if ($null -eq $Value) {
        return [PSCustomObject]@{
            Success         = $false
            Value           = @()
            Coerced         = $false
            HadInvalidItems = $false
        }
    }

    $items = @()
    $coerced = $false
    $hadInvalidItems = $false

    if ($Value -is [string]) {
        $text = $Value.Trim()
        $rawItems = if ($SplitScalarList) {
            @($text -split '\r?\n|;')
        } else {
            @($text)
        }

        foreach ($item in $rawItems) {
            $candidate = [string]$item
            $candidate = $candidate.Trim()
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                continue
            }
            $items += $candidate
        }
        $coerced = $SplitScalarList -or ($rawItems.Count -ne 1)
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        foreach ($item in $Value) {
            if ($item -isnot [string]) {
                $hadInvalidItems = $true
                continue
            }

            $candidate = $item.Trim()
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                continue
            }
            if (-not [string]::Equals($item, $candidate, [System.StringComparison]::Ordinal)) {
                $coerced = $true
            }
            $items += $candidate
        }
    } else {
        $hadInvalidItems = $true
    }

    if ($items.Count -eq 0 -and -not $AllowEmpty) {
        return [PSCustomObject]@{
            Success         = $false
            Value           = @()
            Coerced         = $coerced
            HadInvalidItems = $hadInvalidItems
        }
    }

    return [PSCustomObject]@{
        Success         = $true
        Value           = @($items)
        Coerced         = $coerced
        HadInvalidItems = $hadInvalidItems
    }
}

function ConvertTo-ManagedConfigIntegerArray {
    param(
        [AllowNull()]
        [object]$Value,
        [int]$Minimum = [int]::MinValue,
        [int]$Maximum = [int]::MaxValue,
        [switch]$SplitScalarList,
        [switch]$SortUnique,
        [switch]$AllowEmpty
    )

    if ($null -eq $Value) {
        return [PSCustomObject]@{
            Success         = $false
            Value           = @()
            Coerced         = $false
            HadInvalidItems = $false
        }
    }

    $items = @()
    $coerced = $false
    $hadInvalidItems = $false

    $sourceItems = @()
    if ($Value -is [string]) {
        $sourceItems = if ($SplitScalarList) {
            @($Value.Trim() -split '[,\s;]+')
        } else {
            @($Value.Trim())
        }
        $coerced = $true
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        $sourceItems = @($Value)
    } else {
        $sourceItems = @($Value)
    }

    foreach ($sourceItem in $sourceItems) {
        if ($null -eq $sourceItem) {
            continue
        }

        $intResult = ConvertTo-ManagedConfigInteger -Value $sourceItem -Minimum $Minimum -Maximum $Maximum
        if (-not $intResult.Success) {
            $hadInvalidItems = $true
            continue
        }
        if ($intResult.Coerced) {
            $coerced = $true
        }
        $items += [int]$intResult.Value
    }

    if ($SortUnique) {
        $items = @($items | Sort-Object -Unique)
    }

    if ($items.Count -eq 0 -and -not $AllowEmpty) {
        return [PSCustomObject]@{
            Success         = $false
            Value           = @()
            Coerced         = $coerced
            HadInvalidItems = $hadInvalidItems
        }
    }

    return [PSCustomObject]@{
        Success         = $true
        Value           = @($items)
        Coerced         = $coerced
        HadInvalidItems = $hadInvalidItems
    }
}

function Copy-ManagedConfigUnusedEntries {
    param(
        [AllowNull()]
        [object]$SourceObject,
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.HashSet[string]]$UsedKeys
    )

    $copy = [ordered]@{}
    foreach ($entry in @(Get-ManagedConfigEntries -Object $SourceObject)) {
        if ($UsedKeys.Contains([string]$entry.Name)) {
            continue
        }

        $copy[[string]$entry.Name] = Convert-ToManagedConfigHashtable -Value $entry.Value
    }

    return $copy
}

function Merge-ManagedConfigIntegerSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [AllowNull()]
        [object]$TemplateValue,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes,
        [int]$Minimum = 0
    )

    if ($Value -is [System.Collections.IDictionary] -or ($null -ne $Value -and $Value.PSObject -and $Value.PSObject.Properties.Count -gt 0 -and $Value -isnot [string])) {
        $contextEntry = Get-ManagedConfigEntry -Object $Value -Key 'context_key'
        if ($null -ne $contextEntry) {
            $contextResult = ConvertTo-ManagedConfigString -Value $contextEntry.Value
            if ($contextResult.Success) {
                if ([string]$contextEntry.Name -ne 'context_key') {
                    Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail "legacy key '$($contextEntry.Name)' renamed to canonical 'context_key'."
                }
                return [ordered]@{
                    context_key = [string]$contextResult.Value
                }
            }
        }

        if ($null -ne $TemplateValue) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid integer/context reference replaced with template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateValue
        }

        return Convert-ToManagedConfigHashtable -Value $Value
    }

    $intResult = ConvertTo-ManagedConfigInteger -Value $Value -Minimum $Minimum
    if ($intResult.Success) {
        if ($intResult.Coerced) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail "legacy scalar value normalized to integer '$($intResult.Value)'."
        }
        return [int]$intResult.Value
    }

    if ($null -ne $TemplateValue) {
        Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid integer/context reference replaced with template default.'
        return Convert-ToManagedConfigHashtable -Value $TemplateValue
    }

    return Convert-ToManagedConfigHashtable -Value $Value
}

function Merge-ManagedConfigStringSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [AllowNull()]
        [object]$TemplateValue,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes,
        [switch]$AllowEmpty
    )

    if ($Value -is [System.Collections.IDictionary] -or ($null -ne $Value -and $Value.PSObject -and $Value.PSObject.Properties.Count -gt 0 -and $Value -isnot [string])) {
        $contextEntry = Get-ManagedConfigEntry -Object $Value -Key 'context_key'
        if ($null -ne $contextEntry) {
            $contextResult = ConvertTo-ManagedConfigString -Value $contextEntry.Value
            if ($contextResult.Success) {
                if ([string]$contextEntry.Name -ne 'context_key') {
                    Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail "legacy key '$($contextEntry.Name)' renamed to canonical 'context_key'."
                }
                return [ordered]@{
                    context_key = [string]$contextResult.Value
                }
            }
        }

        if ($null -ne $TemplateValue) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid string/context reference replaced with template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateValue
        }

        return Convert-ToManagedConfigHashtable -Value $Value
    }

    $stringResult = ConvertTo-ManagedConfigString -Value $Value -AllowEmpty:$AllowEmpty
    if ($stringResult.Success) {
        if ($stringResult.Coerced) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'string value normalized by trimming whitespace.'
        }
        return [string]$stringResult.Value
    }

    if ($null -ne $TemplateValue) {
        Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid string/context reference replaced with template default.'
        return Convert-ToManagedConfigHashtable -Value $TemplateValue
    }

    return Convert-ToManagedConfigHashtable -Value $Value
}

function Merge-TokenEconomyManagedConfig {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TemplateConfig,
        [AllowNull()]
        [object]$ExistingConfig
    )

    $normalized = [ordered]@{}
    $changes = New-ManagedConfigChangeList
    if ($null -eq $ExistingConfig) {
        return [PSCustomObject]@{
            Value   = Convert-ToManagedConfigHashtable -Value $TemplateConfig
            Changes = @()
        }
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingConfig
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($key in @('enabled', 'enabled_depths', 'strip_examples', 'strip_code_blocks', 'scoped_diffs', 'compact_reviewer_output', 'fail_tail_lines')) {
        $templateValue = $TemplateConfig[$key]
        $entry = Get-ManagedConfigEntry -Object $existingMap -Key $key
        if ($null -eq $entry) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'missing key restored from template default.'
            $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
            continue
        }

        $usedKeys.Add([string]$entry.Name) | Out-Null
        if ([string]$entry.Name -ne $key) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy key '$($entry.Name)' renamed to canonical '$key'."
        }

        switch ($key) {
            'enabled_depths' {
                $result = ConvertTo-ManagedConfigIntegerArray -Value $entry.Value -Minimum 1 -Maximum 3 -SplitScalarList -SortUnique
                if ($result.Success) {
                    if ($result.Coerced -or $result.HadInvalidItems) {
                        Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'legacy depth list normalized to canonical integer array.'
                    }
                    $normalized[$key] = @($result.Value)
                } else {
                    Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'invalid depth list replaced with template default.'
                    $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
                }
            }
            'fail_tail_lines' {
                $result = ConvertTo-ManagedConfigInteger -Value $entry.Value -Minimum 1
                if ($result.Success) {
                    if ($result.Coerced) {
                        Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy scalar value normalized to integer '$($result.Value)'."
                    }
                    $normalized[$key] = [int]$result.Value
                } else {
                    Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'invalid fail tail value replaced with template default.'
                    $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
                }
            }
            default {
                $result = ConvertTo-ManagedConfigBoolean -Value $entry.Value
                if ($result.Success) {
                    if ($result.Coerced) {
                        Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy scalar value normalized to boolean '$($result.Value)'."
                    }
                    $normalized[$key] = [bool]$result.Value
                } else {
                    Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'invalid boolean replaced with template default.'
                    $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
                }
            }
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $normalized[[string]$entry.Name] = $entry.Value
    }

    return [PSCustomObject]@{
        Value   = $normalized
        Changes = @($changes.ToArray())
    }
}

function Merge-ReviewCapabilitiesManagedConfig {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TemplateConfig,
        [AllowNull()]
        [object]$ExistingConfig
    )

    $normalized = [ordered]@{}
    $changes = New-ManagedConfigChangeList
    if ($null -eq $ExistingConfig) {
        return [PSCustomObject]@{
            Value   = Convert-ToManagedConfigHashtable -Value $TemplateConfig
            Changes = @()
        }
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingConfig
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($key in $TemplateConfig.Keys) {
        $templateValue = $TemplateConfig[$key]
        $entry = Get-ManagedConfigEntry -Object $existingMap -Key $key
        if ($null -eq $entry) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'missing capability flag restored from template default.'
            $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
            continue
        }

        $usedKeys.Add([string]$entry.Name) | Out-Null
        if ([string]$entry.Name -ne $key) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy key '$($entry.Name)' renamed to canonical '$key'."
        }

        $boolResult = ConvertTo-ManagedConfigBoolean -Value $entry.Value
        if ($boolResult.Success) {
            if ($boolResult.Coerced) {
                Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy scalar value normalized to boolean '$($boolResult.Value)'."
            }
            $normalized[$key] = [bool]$boolResult.Value
        } else {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'invalid capability flag replaced with template default.'
            $normalized[$key] = Convert-ToManagedConfigHashtable -Value $templateValue
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $key = [string]$entry.Name
        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }

        $boolResult = ConvertTo-ManagedConfigBoolean -Value $entry.Value
        if ($boolResult.Success) {
            if ($boolResult.Coerced) {
                Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy scalar value normalized to boolean '$($boolResult.Value)'."
            }
            $normalized[$key] = [bool]$boolResult.Value
        } else {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'unknown non-boolean capability flag was dropped.'
        }
    }

    return [PSCustomObject]@{
        Value   = $normalized
        Changes = @($changes.ToArray())
    }
}

function Merge-PathsManagedConfig {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TemplateConfig,
        [AllowNull()]
        [object]$ExistingConfig
    )

    $normalized = [ordered]@{}
    $changes = New-ManagedConfigChangeList
    if ($null -eq $ExistingConfig) {
        return [PSCustomObject]@{
            Value   = Convert-ToManagedConfigHashtable -Value $TemplateConfig
            Changes = @()
        }
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingConfig
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $stringArrayKeys = @(
        'runtime_roots',
        'fast_path_roots',
        'fast_path_allowed_regexes',
        'fast_path_sensitive_regexes',
        'sql_or_migration_regexes',
        'code_like_regexes'
    )

    $metricsEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'metrics_path'
    if ($null -eq $metricsEntry) {
        Add-ManagedConfigChange -Changes $changes -Path 'metrics_path' -Detail 'missing key restored from template default.'
        $normalized['metrics_path'] = [string]$TemplateConfig['metrics_path']
    } else {
        $usedKeys.Add([string]$metricsEntry.Name) | Out-Null
        if ([string]$metricsEntry.Name -ne 'metrics_path') {
            Add-ManagedConfigChange -Changes $changes -Path 'metrics_path' -Detail "legacy key '$($metricsEntry.Name)' renamed to canonical 'metrics_path'."
        }
        $stringResult = ConvertTo-ManagedConfigString -Value $metricsEntry.Value
        if ($stringResult.Success) {
            if ($stringResult.Coerced) {
                Add-ManagedConfigChange -Changes $changes -Path 'metrics_path' -Detail 'string value normalized by trimming whitespace.'
            }
            $normalized['metrics_path'] = [string]$stringResult.Value
        } else {
            Add-ManagedConfigChange -Changes $changes -Path 'metrics_path' -Detail 'invalid metrics path replaced with template default.'
            $normalized['metrics_path'] = [string]$TemplateConfig['metrics_path']
        }
    }

    foreach ($key in $stringArrayKeys) {
        $entry = Get-ManagedConfigEntry -Object $existingMap -Key $key
        if ($null -eq $entry) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'missing key restored from template default.'
            $normalized[$key] = Convert-ToManagedConfigHashtable -Value $TemplateConfig[$key]
            continue
        }

        $usedKeys.Add([string]$entry.Name) | Out-Null
        if ([string]$entry.Name -ne $key) {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail "legacy key '$($entry.Name)' renamed to canonical '$key'."
        }

        $allowSplit = $key -in @('runtime_roots', 'fast_path_roots')
        $result = ConvertTo-ManagedConfigStringArray -Value $entry.Value -SplitScalarList:$allowSplit
        if ($result.Success) {
            if ($result.Coerced -or $result.HadInvalidItems) {
                Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'legacy list normalized to canonical string array.'
            }
            $normalized[$key] = @($result.Value)
        } else {
            Add-ManagedConfigChange -Changes $changes -Path $key -Detail 'invalid list replaced with template default.'
            $normalized[$key] = Convert-ToManagedConfigHashtable -Value $TemplateConfig[$key]
        }
    }

    $templateTriggers = Convert-ToManagedConfigHashtable -Value $TemplateConfig['triggers']
    $triggersEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'triggers'
    $triggerSource = $null
    if ($null -ne $triggersEntry -and ($triggersEntry.Value -is [System.Collections.IDictionary] -or ($null -ne $triggersEntry.Value -and $triggersEntry.Value.PSObject -and $triggersEntry.Value.PSObject.Properties.Count -gt 0 -and $triggersEntry.Value -isnot [string]))) {
        $usedKeys.Add([string]$triggersEntry.Name) | Out-Null
        if ([string]$triggersEntry.Name -ne 'triggers') {
            Add-ManagedConfigChange -Changes $changes -Path 'triggers' -Detail "legacy key '$($triggersEntry.Name)' renamed to canonical 'triggers'."
        }
        $triggerSource = Convert-ToManagedConfigHashtable -Value $triggersEntry.Value
    } else {
        $triggerSource = [ordered]@{}
    }

    $normalizedTriggers = [ordered]@{}
    $usedTriggerKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($triggerKey in $templateTriggers.Keys) {
        $triggerEntry = Get-ManagedConfigEntry -Object $triggerSource -Key ([string]$triggerKey)
        $legacyEntry = if ($null -eq $triggerEntry) { Get-ManagedConfigEntry -Object $existingMap -Key "$triggerKey`_trigger_regexes" } else { $null }
        if ($null -ne $legacyEntry) {
            $usedKeys.Add([string]$legacyEntry.Name) | Out-Null
            Add-ManagedConfigChange -Changes $changes -Path "triggers.$triggerKey" -Detail "legacy top-level key '$($legacyEntry.Name)' moved into canonical 'triggers.$triggerKey'."
            $triggerEntry = $legacyEntry
        }

        if ($null -eq $triggerEntry) {
            Add-ManagedConfigChange -Changes $changes -Path "triggers.$triggerKey" -Detail 'missing trigger list restored from template default.'
            $normalizedTriggers[[string]$triggerKey] = Convert-ToManagedConfigHashtable -Value $templateTriggers[$triggerKey]
            continue
        }

        if ($triggerEntry -ne $legacyEntry) {
            $usedTriggerKeys.Add([string]$triggerEntry.Name) | Out-Null
            if ([string]$triggerEntry.Name -ne [string]$triggerKey) {
                Add-ManagedConfigChange -Changes $changes -Path "triggers.$triggerKey" -Detail "legacy key '$($triggerEntry.Name)' renamed to canonical '$triggerKey'."
            }
        }

        $triggerResult = ConvertTo-ManagedConfigStringArray -Value $triggerEntry.Value
        if ($triggerResult.Success) {
            if ($triggerResult.Coerced -or $triggerResult.HadInvalidItems) {
                Add-ManagedConfigChange -Changes $changes -Path "triggers.$triggerKey" -Detail 'legacy trigger list normalized to canonical string array.'
            }
            $normalizedTriggers[[string]$triggerKey] = @($triggerResult.Value)
        } else {
            Add-ManagedConfigChange -Changes $changes -Path "triggers.$triggerKey" -Detail 'invalid trigger list replaced with template default.'
            $normalizedTriggers[[string]$triggerKey] = Convert-ToManagedConfigHashtable -Value $templateTriggers[$triggerKey]
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $triggerSource -UsedKeys $usedTriggerKeys))) {
        $key = [string]$entry.Name
        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }
        $triggerResult = ConvertTo-ManagedConfigStringArray -Value $entry.Value
        if ($triggerResult.Success) {
            if ($triggerResult.Coerced -or $triggerResult.HadInvalidItems) {
                Add-ManagedConfigChange -Changes $changes -Path "triggers.$key" -Detail 'legacy trigger list normalized to canonical string array.'
            }
            $normalizedTriggers[$key] = @($triggerResult.Value)
        } else {
            Add-ManagedConfigChange -Changes $changes -Path "triggers.$key" -Detail 'unknown invalid trigger list was dropped.'
        }
    }
    $normalized['triggers'] = $normalizedTriggers

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        if ((Get-ManagedConfigNormalizedKey -Key ([string]$entry.Name)).EndsWith('triggerregexes')) {
            continue
        }
        $normalized[[string]$entry.Name] = Convert-ToManagedConfigHashtable -Value $entry.Value
    }

    return [PSCustomObject]@{
        Value   = $normalized
        Changes = @($changes.ToArray())
    }
}

function Merge-OutputFilterParser {
    param(
        [AllowNull()]
        [object]$ExistingParser,
        [AllowNull()]
        [object]$TemplateParser,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes
    )

    if ($null -eq $ExistingParser) {
        return Convert-ToManagedConfigHashtable -Value $TemplateParser
    }

    if ($ExistingParser -isnot [System.Collections.IDictionary] -and ($null -eq $ExistingParser.PSObject -or $ExistingParser.PSObject.Properties.Count -eq 0 -or $ExistingParser -is [string])) {
        if ($null -ne $TemplateParser) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid parser object replaced with template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateParser
        }
        return Convert-ToManagedConfigHashtable -Value $ExistingParser
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingParser
    $normalized = [ordered]@{}
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $typeEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'type'
    $templateType = $null
    if ($null -ne $TemplateParser) {
        $templateType = [string]$TemplateParser['type']
    }

    $resolvedType = $templateType
    if ($null -ne $typeEntry) {
        $usedKeys.Add([string]$typeEntry.Name) | Out-Null
        $typeResult = ConvertTo-ManagedConfigString -Value $typeEntry.Value
        if ($typeResult.Success) {
            $resolvedType = [string]$typeResult.Value
            if ([string]$typeEntry.Name -ne 'type') {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail "legacy key '$($typeEntry.Name)' renamed to canonical 'type'."
            }
            if ($typeResult.Coerced) {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail 'string value normalized by trimming whitespace.'
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($resolvedType)) {
        if ($null -ne $TemplateParser) {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail 'missing parser type restored from template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateParser
        }
        return Convert-ToManagedConfigHashtable -Value $existingMap
    }

    $normalized['type'] = $resolvedType.Trim().ToLowerInvariant()

    switch ($normalized['type']) {
        'compile_failure_summary' {
            $strategyEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'strategy'
            if ($null -ne $strategyEntry) {
                $usedKeys.Add([string]$strategyEntry.Name) | Out-Null
                if ([string]$strategyEntry.Name -ne 'strategy') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.strategy" -Detail "legacy key '$($strategyEntry.Name)' renamed to canonical 'strategy'."
                }
                $normalized['strategy'] = Merge-ManagedConfigStringSpec -Value $strategyEntry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser['strategy'] } else { $null }) -Path "$Path.strategy" -Changes $Changes -AllowEmpty
            } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains('strategy')) {
                $normalized['strategy'] = Convert-ToManagedConfigHashtable -Value $TemplateParser['strategy']
            }

            $maxMatchesEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'max_matches'
            if ($null -ne $maxMatchesEntry) {
                $usedKeys.Add([string]$maxMatchesEntry.Name) | Out-Null
                if ([string]$maxMatchesEntry.Name -ne 'max_matches') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.max_matches" -Detail "legacy key '$($maxMatchesEntry.Name)' renamed to canonical 'max_matches'."
                }
                $normalized['max_matches'] = Merge-ManagedConfigIntegerSpec -Value $maxMatchesEntry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser['max_matches'] } else { 12 }) -Path "$Path.max_matches" -Changes $Changes -Minimum 1
            } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains('max_matches')) {
                $normalized['max_matches'] = Convert-ToManagedConfigHashtable -Value $TemplateParser['max_matches']
            }

            $tailCountEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'tail_count'
            if ($null -ne $tailCountEntry) {
                $usedKeys.Add([string]$tailCountEntry.Name) | Out-Null
                if ([string]$tailCountEntry.Name -ne 'tail_count') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.tail_count" -Detail "legacy key '$($tailCountEntry.Name)' renamed to canonical 'tail_count'."
                }
                $normalized['tail_count'] = Merge-ManagedConfigIntegerSpec -Value $tailCountEntry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser['tail_count'] } else { $null }) -Path "$Path.tail_count" -Changes $Changes -Minimum 0
            } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains('tail_count')) {
                $normalized['tail_count'] = Convert-ToManagedConfigHashtable -Value $TemplateParser['tail_count']
            }
        }
        'test_failure_summary' {
            foreach ($field in @('max_matches', 'tail_count')) {
                $entry = Get-ManagedConfigEntry -Object $existingMap -Key $field
                if ($null -ne $entry) {
                    $usedKeys.Add([string]$entry.Name) | Out-Null
                    if ([string]$entry.Name -ne $field) {
                        Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail "legacy key '$($entry.Name)' renamed to canonical '$field'."
                    }
                    $minimum = if ($field -eq 'max_matches') { 1 } else { 0 }
                    $normalized[$field] = Merge-ManagedConfigIntegerSpec -Value $entry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser[$field] } else { $null }) -Path "$Path.$field" -Changes $Changes -Minimum $minimum
                } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains($field)) {
                    $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateParser[$field]
                }
            }
        }
        'lint_failure_summary' {
            foreach ($field in @('max_matches', 'tail_count')) {
                $entry = Get-ManagedConfigEntry -Object $existingMap -Key $field
                if ($null -ne $entry) {
                    $usedKeys.Add([string]$entry.Name) | Out-Null
                    if ([string]$entry.Name -ne $field) {
                        Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail "legacy key '$($entry.Name)' renamed to canonical '$field'."
                    }
                    $minimum = if ($field -eq 'max_matches') { 1 } else { 0 }
                    $normalized[$field] = Merge-ManagedConfigIntegerSpec -Value $entry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser[$field] } else { $null }) -Path "$Path.$field" -Changes $Changes -Minimum $minimum
                } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains($field)) {
                    $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateParser[$field]
                }
            }
        }
        'review_gate_summary' {
            $maxLinesEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'max_lines'
            if ($null -ne $maxLinesEntry) {
                $usedKeys.Add([string]$maxLinesEntry.Name) | Out-Null
                if ([string]$maxLinesEntry.Name -ne 'max_lines') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.max_lines" -Detail "legacy key '$($maxLinesEntry.Name)' renamed to canonical 'max_lines'."
                }
                $normalized['max_lines'] = Merge-ManagedConfigIntegerSpec -Value $maxLinesEntry.Value -TemplateValue $(if ($null -ne $TemplateParser) { $TemplateParser['max_lines'] } else { $null }) -Path "$Path.max_lines" -Changes $Changes -Minimum 1
            } elseif ($null -ne $TemplateParser -and $TemplateParser.Contains('max_lines')) {
                $normalized['max_lines'] = Convert-ToManagedConfigHashtable -Value $TemplateParser['max_lines']
            }
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $normalized[[string]$entry.Name] = $entry.Value
    }

    return $normalized
}

function Merge-OutputFilterOperation {
    param(
        [AllowNull()]
        [object]$ExistingOperation,
        [AllowNull()]
        [object]$TemplateOperation,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes
    )

    if ($null -eq $ExistingOperation) {
        return Convert-ToManagedConfigHashtable -Value $TemplateOperation
    }

    if ($ExistingOperation -isnot [System.Collections.IDictionary] -and ($null -eq $ExistingOperation.PSObject -or $ExistingOperation.PSObject.Properties.Count -eq 0 -or $ExistingOperation -is [string])) {
        if ($null -ne $TemplateOperation) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid operation object replaced with template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateOperation
        }
        return Convert-ToManagedConfigHashtable -Value $ExistingOperation
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingOperation
    $normalized = [ordered]@{}
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $typeEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'type'
    $templateType = $null
    if ($null -ne $TemplateOperation) {
        $templateType = [string]$TemplateOperation['type']
    }

    $resolvedType = $templateType
    if ($null -ne $typeEntry) {
        $usedKeys.Add([string]$typeEntry.Name) | Out-Null
        $typeResult = ConvertTo-ManagedConfigString -Value $typeEntry.Value
        if ($typeResult.Success) {
            $resolvedType = [string]$typeResult.Value
            if ([string]$typeEntry.Name -ne 'type') {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail "legacy key '$($typeEntry.Name)' renamed to canonical 'type'."
            }
            if ($typeResult.Coerced) {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail 'string value normalized by trimming whitespace.'
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($resolvedType)) {
        if ($null -ne $TemplateOperation) {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.type" -Detail 'missing operation type restored from template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateOperation
        }
        return Convert-ToManagedConfigHashtable -Value $existingMap
    }

    $normalized['type'] = $resolvedType.Trim().ToLowerInvariant()

    switch ($normalized['type']) {
        'regex_replace' {
            $patternEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'pattern'
            if ($null -ne $patternEntry) {
                $usedKeys.Add([string]$patternEntry.Name) | Out-Null
                if ([string]$patternEntry.Name -ne 'pattern') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.pattern" -Detail "legacy key '$($patternEntry.Name)' renamed to canonical 'pattern'."
                }
                $normalized['pattern'] = Merge-ManagedConfigStringSpec -Value $patternEntry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation['pattern'] } else { $null }) -Path "$Path.pattern" -Changes $Changes
            } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains('pattern')) {
                $normalized['pattern'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['pattern']
            }

            $replacementEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'replacement'
            if ($null -ne $replacementEntry) {
                $usedKeys.Add([string]$replacementEntry.Name) | Out-Null
                if ([string]$replacementEntry.Name -ne 'replacement') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.replacement" -Detail "legacy key '$($replacementEntry.Name)' renamed to canonical 'replacement'."
                }
                $replacementResult = ConvertTo-ManagedConfigString -Value $replacementEntry.Value -AllowEmpty
                if ($replacementResult.Success) {
                    if ($replacementResult.Coerced) {
                        Add-ManagedConfigChange -Changes $Changes -Path "$Path.replacement" -Detail 'string value normalized by trimming whitespace.'
                    }
                    $normalized['replacement'] = [string]$replacementResult.Value
                } else {
                    $normalized['replacement'] = ''
                }
            } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains('replacement')) {
                $normalized['replacement'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['replacement']
            }
        }
        'drop_lines_matching' {
            $patternsEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'patterns'
            $patternEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'pattern'
            if ($null -ne $patternsEntry) {
                $usedKeys.Add([string]$patternsEntry.Name) | Out-Null
                if ([string]$patternsEntry.Name -ne 'patterns') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.patterns" -Detail "legacy key '$($patternsEntry.Name)' renamed to canonical 'patterns'."
                }
                $patternsResult = ConvertTo-ManagedConfigStringArray -Value $patternsEntry.Value
                if ($patternsResult.Success) {
                    if ($patternsResult.Coerced -or $patternsResult.HadInvalidItems) {
                        Add-ManagedConfigChange -Changes $Changes -Path "$Path.patterns" -Detail 'legacy pattern list normalized to canonical string array.'
                    }
                    $normalized['patterns'] = @($patternsResult.Value)
                }
            } elseif ($null -ne $patternEntry) {
                $usedKeys.Add([string]$patternEntry.Name) | Out-Null
                if ([string]$patternEntry.Name -ne 'pattern') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.pattern" -Detail "legacy key '$($patternEntry.Name)' renamed to canonical 'pattern'."
                }
                $normalized['pattern'] = Merge-ManagedConfigStringSpec -Value $patternEntry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation['pattern'] } else { $null }) -Path "$Path.pattern" -Changes $Changes
            } elseif ($null -ne $TemplateOperation) {
                if ($TemplateOperation.Contains('patterns')) {
                    $normalized['patterns'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['patterns']
                } elseif ($TemplateOperation.Contains('pattern')) {
                    $normalized['pattern'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['pattern']
                }
            }
        }
        'keep_lines_matching' {
            $patternsEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'patterns'
            $patternEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'pattern'
            if ($null -ne $patternsEntry) {
                $usedKeys.Add([string]$patternsEntry.Name) | Out-Null
                if ([string]$patternsEntry.Name -ne 'patterns') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.patterns" -Detail "legacy key '$($patternsEntry.Name)' renamed to canonical 'patterns'."
                }
                $patternsResult = ConvertTo-ManagedConfigStringArray -Value $patternsEntry.Value
                if ($patternsResult.Success) {
                    if ($patternsResult.Coerced -or $patternsResult.HadInvalidItems) {
                        Add-ManagedConfigChange -Changes $Changes -Path "$Path.patterns" -Detail 'legacy pattern list normalized to canonical string array.'
                    }
                    $normalized['patterns'] = @($patternsResult.Value)
                }
            } elseif ($null -ne $patternEntry) {
                $usedKeys.Add([string]$patternEntry.Name) | Out-Null
                if ([string]$patternEntry.Name -ne 'pattern') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.pattern" -Detail "legacy key '$($patternEntry.Name)' renamed to canonical 'pattern'."
                }
                $normalized['pattern'] = Merge-ManagedConfigStringSpec -Value $patternEntry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation['pattern'] } else { $null }) -Path "$Path.pattern" -Changes $Changes
            } elseif ($null -ne $TemplateOperation) {
                if ($TemplateOperation.Contains('patterns')) {
                    $normalized['patterns'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['patterns']
                } elseif ($TemplateOperation.Contains('pattern')) {
                    $normalized['pattern'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['pattern']
                }
            }
        }
        'truncate_line_length' {
            foreach ($field in @('max_chars', 'suffix')) {
                $entry = Get-ManagedConfigEntry -Object $existingMap -Key $field
                if ($null -eq $entry) {
                    if ($null -ne $TemplateOperation -and $TemplateOperation.Contains($field)) {
                        $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateOperation[$field]
                    }
                    continue
                }

                $usedKeys.Add([string]$entry.Name) | Out-Null
                if ([string]$entry.Name -ne $field) {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail "legacy key '$($entry.Name)' renamed to canonical '$field'."
                }

                if ($field -eq 'max_chars') {
                    $normalized[$field] = Merge-ManagedConfigIntegerSpec -Value $entry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation[$field] } else { $null }) -Path "$Path.$field" -Changes $Changes -Minimum 1
                } else {
                    $stringResult = ConvertTo-ManagedConfigString -Value $entry.Value -AllowEmpty
                    if ($stringResult.Success) {
                        if ($stringResult.Coerced) {
                            Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail 'string value normalized by trimming whitespace.'
                        }
                        $normalized[$field] = [string]$stringResult.Value
                    } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains($field)) {
                        $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateOperation[$field]
                    }
                }
            }
        }
        'head' {
            $countEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'count'
            if ($null -ne $countEntry) {
                $usedKeys.Add([string]$countEntry.Name) | Out-Null
                if ([string]$countEntry.Name -ne 'count') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.count" -Detail "legacy key '$($countEntry.Name)' renamed to canonical 'count'."
                }
                $normalized['count'] = Merge-ManagedConfigIntegerSpec -Value $countEntry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation['count'] } else { $null }) -Path "$Path.count" -Changes $Changes -Minimum 1
            } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains('count')) {
                $normalized['count'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['count']
            }
        }
        'tail' {
            $countEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'count'
            if ($null -ne $countEntry) {
                $usedKeys.Add([string]$countEntry.Name) | Out-Null
                if ([string]$countEntry.Name -ne 'count') {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.count" -Detail "legacy key '$($countEntry.Name)' renamed to canonical 'count'."
                }
                $normalized['count'] = Merge-ManagedConfigIntegerSpec -Value $countEntry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation['count'] } else { $null }) -Path "$Path.count" -Changes $Changes -Minimum 1
            } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains('count')) {
                $normalized['count'] = Convert-ToManagedConfigHashtable -Value $TemplateOperation['count']
            }
        }
        'max_total_lines' {
            foreach ($field in @('max_lines', 'strategy')) {
                $entry = Get-ManagedConfigEntry -Object $existingMap -Key $field
                if ($null -eq $entry) {
                    if ($null -ne $TemplateOperation -and $TemplateOperation.Contains($field)) {
                        $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateOperation[$field]
                    }
                    continue
                }

                $usedKeys.Add([string]$entry.Name) | Out-Null
                if ([string]$entry.Name -ne $field) {
                    Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail "legacy key '$($entry.Name)' renamed to canonical '$field'."
                }

                if ($field -eq 'max_lines') {
                    $normalized[$field] = Merge-ManagedConfigIntegerSpec -Value $entry.Value -TemplateValue $(if ($null -ne $TemplateOperation) { $TemplateOperation[$field] } else { $null }) -Path "$Path.$field" -Changes $Changes -Minimum 0
                } else {
                    $strategyResult = ConvertTo-ManagedConfigString -Value $entry.Value
                    if ($strategyResult.Success) {
                        if ($strategyResult.Coerced) {
                            Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail 'string value normalized by trimming whitespace.'
                        }
                        $normalized[$field] = [string]$strategyResult.Value
                    } elseif ($null -ne $TemplateOperation -and $TemplateOperation.Contains($field)) {
                        $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateOperation[$field]
                    }
                }
            }
        }
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $normalized[[string]$entry.Name] = $entry.Value
    }

    return $normalized
}

function Merge-OutputFilterProfile {
    param(
        [AllowNull()]
        [object]$ExistingProfile,
        [AllowNull()]
        [object]$TemplateProfile,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Changes
    )

    if ($null -eq $ExistingProfile) {
        return Convert-ToManagedConfigHashtable -Value $TemplateProfile
    }

    if ($ExistingProfile -isnot [System.Collections.IDictionary] -and ($null -eq $ExistingProfile.PSObject -or $ExistingProfile.PSObject.Properties.Count -eq 0 -or $ExistingProfile -is [string])) {
        if ($null -ne $TemplateProfile) {
            Add-ManagedConfigChange -Changes $Changes -Path $Path -Detail 'invalid profile object replaced with template default.'
            return Convert-ToManagedConfigHashtable -Value $TemplateProfile
        }
        return Convert-ToManagedConfigHashtable -Value $ExistingProfile
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingProfile
    $normalized = [ordered]@{}
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($field in @('description', 'emit_when_empty')) {
        $entry = Get-ManagedConfigEntry -Object $existingMap -Key $field
        if ($null -eq $entry) {
            if ($null -ne $TemplateProfile -and $TemplateProfile.Contains($field)) {
                $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateProfile[$field]
            }
            continue
        }

        $usedKeys.Add([string]$entry.Name) | Out-Null
        if ([string]$entry.Name -ne $field) {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail "legacy key '$($entry.Name)' renamed to canonical '$field'."
        }

        $stringResult = ConvertTo-ManagedConfigString -Value $entry.Value -AllowEmpty:($field -eq 'emit_when_empty')
        if ($stringResult.Success) {
            if ($stringResult.Coerced) {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail 'string value normalized by trimming whitespace.'
            }
            $normalized[$field] = [string]$stringResult.Value
        } elseif ($null -ne $TemplateProfile -and $TemplateProfile.Contains($field)) {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.$field" -Detail 'invalid string replaced with template default.'
            $normalized[$field] = Convert-ToManagedConfigHashtable -Value $TemplateProfile[$field]
        }
    }

    $parserEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'parser'
    if ($null -ne $parserEntry) {
        $usedKeys.Add([string]$parserEntry.Name) | Out-Null
        if ([string]$parserEntry.Name -ne 'parser') {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.parser" -Detail "legacy key '$($parserEntry.Name)' renamed to canonical 'parser'."
        }
        $normalized['parser'] = Merge-OutputFilterParser -ExistingParser $parserEntry.Value -TemplateParser $(if ($null -ne $TemplateProfile) { $TemplateProfile['parser'] } else { $null }) -Path "$Path.parser" -Changes $Changes
    } elseif ($null -ne $TemplateProfile -and $TemplateProfile.Contains('parser')) {
        $normalized['parser'] = Convert-ToManagedConfigHashtable -Value $TemplateProfile['parser']
    }

    $operationsEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'operations'
    $templateOperations = if ($null -ne $TemplateProfile -and $TemplateProfile.Contains('operations')) {
        @($TemplateProfile['operations'])
    } else {
        @()
    }
    if ($null -ne $operationsEntry) {
        $usedKeys.Add([string]$operationsEntry.Name) | Out-Null
        if ([string]$operationsEntry.Name -ne 'operations') {
            Add-ManagedConfigChange -Changes $Changes -Path "$Path.operations" -Detail "legacy key '$($operationsEntry.Name)' renamed to canonical 'operations'."
        }

        if ($operationsEntry.Value -is [string]) {
            if ($templateOperations.Count -gt 0) {
                Add-ManagedConfigChange -Changes $Changes -Path "$Path.operations" -Detail 'invalid operations list replaced with template default.'
                $normalized['operations'] = Convert-ToManagedConfigHashtable -Value $templateOperations
            } else {
                $normalized['operations'] = @()
            }
        } else {
            $existingOperations = @($operationsEntry.Value)
            $normalizedOperations = @()
            $maxCount = [Math]::Max($existingOperations.Count, $templateOperations.Count)
            for ($index = 0; $index -lt $maxCount; $index++) {
                $existingOperation = if ($index -lt $existingOperations.Count) { $existingOperations[$index] } else { $null }
                $templateOperation = if ($index -lt $templateOperations.Count) { $templateOperations[$index] } else { $null }
                $normalizedOperations += ,(Merge-OutputFilterOperation -ExistingOperation $existingOperation -TemplateOperation $templateOperation -Path "$Path.operations[$index]" -Changes $Changes)
            }
            $normalized['operations'] = @($normalizedOperations)
        }
    } elseif ($templateOperations.Count -gt 0) {
        $normalized['operations'] = Convert-ToManagedConfigHashtable -Value $templateOperations
    } else {
        $normalized['operations'] = @()
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $normalized[[string]$entry.Name] = $entry.Value
    }

    return $normalized
}

function Merge-OutputFiltersManagedConfig {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$TemplateConfig,
        [AllowNull()]
        [object]$ExistingConfig
    )

    $changes = New-ManagedConfigChangeList
    if ($null -eq $ExistingConfig) {
        return [PSCustomObject]@{
            Value   = Convert-ToManagedConfigHashtable -Value $TemplateConfig
            Changes = @()
        }
    }

    $existingMap = Convert-ToManagedConfigHashtable -Value $ExistingConfig
    $normalized = [ordered]@{}
    $usedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $versionEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'version'
    if ($null -eq $versionEntry) {
        Add-ManagedConfigChange -Changes $changes -Path 'version' -Detail 'missing key restored from template default.'
        $normalized['version'] = [int]$TemplateConfig['version']
    } else {
        $usedKeys.Add([string]$versionEntry.Name) | Out-Null
        if ([string]$versionEntry.Name -ne 'version') {
            Add-ManagedConfigChange -Changes $changes -Path 'version' -Detail "legacy key '$($versionEntry.Name)' renamed to canonical 'version'."
        }
        $versionResult = ConvertTo-ManagedConfigInteger -Value $versionEntry.Value -Minimum 1
        if ($versionResult.Success) {
            if ($versionResult.Coerced) {
                Add-ManagedConfigChange -Changes $changes -Path 'version' -Detail "legacy scalar value normalized to integer '$($versionResult.Value)'."
            }
            $normalized['version'] = [int]$versionResult.Value
        } else {
            Add-ManagedConfigChange -Changes $changes -Path 'version' -Detail 'invalid version replaced with template default.'
            $normalized['version'] = [int]$TemplateConfig['version']
        }
    }

    $passthroughEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'passthrough_ceiling'
    if ($null -eq $passthroughEntry) {
        Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling' -Detail 'missing key restored from template default.'
        $normalized['passthrough_ceiling'] = Convert-ToManagedConfigHashtable -Value $TemplateConfig['passthrough_ceiling']
    } else {
        $usedKeys.Add([string]$passthroughEntry.Name) | Out-Null
        if ([string]$passthroughEntry.Name -ne 'passthrough_ceiling') {
            Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling' -Detail "legacy key '$($passthroughEntry.Name)' renamed to canonical 'passthrough_ceiling'."
        }

        if ($passthroughEntry.Value -is [System.Collections.IDictionary] -or ($null -ne $passthroughEntry.Value -and $passthroughEntry.Value.PSObject -and $passthroughEntry.Value.PSObject.Properties.Count -gt 0 -and $passthroughEntry.Value -isnot [string])) {
            $ceilingMap = Convert-ToManagedConfigHashtable -Value $passthroughEntry.Value
            $normalizedCeiling = [ordered]@{}
            $maxLinesEntry = Get-ManagedConfigEntry -Object $ceilingMap -Key 'max_lines'
            if ($null -ne $maxLinesEntry) {
                if ([string]$maxLinesEntry.Name -ne 'max_lines') {
                    Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.max_lines' -Detail "legacy key '$($maxLinesEntry.Name)' renamed to canonical 'max_lines'."
                }
                $normalizedCeiling['max_lines'] = Merge-ManagedConfigIntegerSpec -Value $maxLinesEntry.Value -TemplateValue $TemplateConfig['passthrough_ceiling']['max_lines'] -Path 'passthrough_ceiling.max_lines' -Changes $changes -Minimum 0
            } else {
                Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.max_lines' -Detail 'missing key restored from template default.'
                $normalizedCeiling['max_lines'] = Convert-ToManagedConfigHashtable -Value $TemplateConfig['passthrough_ceiling']['max_lines']
            }

            $strategyEntry = Get-ManagedConfigEntry -Object $ceilingMap -Key 'strategy'
            if ($null -ne $strategyEntry) {
                if ([string]$strategyEntry.Name -ne 'strategy') {
                    Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.strategy' -Detail "legacy key '$($strategyEntry.Name)' renamed to canonical 'strategy'."
                }
                $strategyResult = ConvertTo-ManagedConfigString -Value $strategyEntry.Value
                if ($strategyResult.Success) {
                    if ($strategyResult.Coerced) {
                        Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.strategy' -Detail 'string value normalized by trimming whitespace.'
                    }
                    $normalizedCeiling['strategy'] = [string]$strategyResult.Value
                } else {
                    Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.strategy' -Detail 'invalid strategy replaced with template default.'
                    $normalizedCeiling['strategy'] = [string]$TemplateConfig['passthrough_ceiling']['strategy']
                }
            } else {
                Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling.strategy' -Detail 'missing key restored from template default.'
                $normalizedCeiling['strategy'] = [string]$TemplateConfig['passthrough_ceiling']['strategy']
            }

            $normalized['passthrough_ceiling'] = $normalizedCeiling
        } else {
            Add-ManagedConfigChange -Changes $changes -Path 'passthrough_ceiling' -Detail 'invalid object replaced with template default.'
            $normalized['passthrough_ceiling'] = Convert-ToManagedConfigHashtable -Value $TemplateConfig['passthrough_ceiling']
        }
    }

    $templateProfiles = Convert-ToManagedConfigHashtable -Value $TemplateConfig['profiles']
    $profilesEntry = Get-ManagedConfigEntry -Object $existingMap -Key 'profiles'
    if ($null -eq $profilesEntry -or ($profilesEntry.Value -isnot [System.Collections.IDictionary] -and ($null -eq $profilesEntry.Value.PSObject -or $profilesEntry.Value.PSObject.Properties.Count -eq 0 -or $profilesEntry.Value -is [string]))) {
        Add-ManagedConfigChange -Changes $changes -Path 'profiles' -Detail 'missing or invalid profiles object replaced with template default.'
        $normalized['profiles'] = Convert-ToManagedConfigHashtable -Value $templateProfiles
    } else {
        $usedKeys.Add([string]$profilesEntry.Name) | Out-Null
        if ([string]$profilesEntry.Name -ne 'profiles') {
            Add-ManagedConfigChange -Changes $changes -Path 'profiles' -Detail "legacy key '$($profilesEntry.Name)' renamed to canonical 'profiles'."
        }

        $existingProfiles = Convert-ToManagedConfigHashtable -Value $profilesEntry.Value
        $normalizedProfiles = [ordered]@{}
        $usedProfileKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($profileName in $templateProfiles.Keys) {
            $profileEntry = Get-ManagedConfigEntry -Object $existingProfiles -Key ([string]$profileName)
            if ($null -eq $profileEntry) {
                Add-ManagedConfigChange -Changes $changes -Path "profiles.$profileName" -Detail 'missing profile restored from template default.'
            } else {
                $usedProfileKeys.Add([string]$profileEntry.Name) | Out-Null
            }
            $normalizedProfiles[[string]$profileName] = Merge-OutputFilterProfile -ExistingProfile $(if ($null -ne $profileEntry) { $profileEntry.Value } else { $null }) -TemplateProfile $templateProfiles[$profileName] -Path "profiles.$profileName" -Changes $changes
        }

        foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingProfiles -UsedKeys $usedProfileKeys))) {
            $profileName = [string]$entry.Name
            if ([string]::IsNullOrWhiteSpace($profileName)) {
                continue
            }
            $normalizedProfiles[$profileName] = Merge-OutputFilterProfile -ExistingProfile $entry.Value -TemplateProfile $null -Path "profiles.$profileName" -Changes $changes
        }

        $normalized['profiles'] = $normalizedProfiles
    }

    foreach ($entry in @(Get-ManagedConfigEntries -Object (Copy-ManagedConfigUnusedEntries -SourceObject $existingMap -UsedKeys $usedKeys))) {
        $normalized[[string]$entry.Name] = $entry.Value
    }

    return [PSCustomObject]@{
        Value   = $normalized
        Changes = @($changes.ToArray())
    }
}

function Merge-ManagedConfigWithTemplate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigName,
        [Parameter(Mandatory = $true)]
        [hashtable]$TemplateConfig,
        [AllowNull()]
        [object]$ExistingConfig
    )

    switch ($ConfigName.ToLowerInvariant()) {
        'token-economy' {
            return Merge-TokenEconomyManagedConfig -TemplateConfig $TemplateConfig -ExistingConfig $ExistingConfig
        }
        'review-capabilities' {
            return Merge-ReviewCapabilitiesManagedConfig -TemplateConfig $TemplateConfig -ExistingConfig $ExistingConfig
        }
        'paths' {
            return Merge-PathsManagedConfig -TemplateConfig $TemplateConfig -ExistingConfig $ExistingConfig
        }
        'output-filters' {
            return Merge-OutputFiltersManagedConfig -TemplateConfig $TemplateConfig -ExistingConfig $ExistingConfig
        }
        default {
            throw "Unsupported managed config '$ConfigName'."
        }
    }
}
