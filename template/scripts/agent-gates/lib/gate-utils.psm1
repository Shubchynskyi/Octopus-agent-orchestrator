Set-StrictMode -Version Latest

function Get-GateProjectRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptRoot
    )

    $projectRootCandidate = Join-Path $ScriptRoot '..\..\..\..'
    if (Test-Path -LiteralPath $projectRootCandidate) {
        return (Resolve-Path -LiteralPath $projectRootCandidate).Path
    }

    return (Resolve-Path -LiteralPath (Join-Path $ScriptRoot '..\..')).Path
}

function Convert-GatePathToUnix {
    param(
        [string]$PathValue,
        [switch]$TrimValue,
        [switch]$StripLeadingRelative
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $normalized = $PathValue.Replace('\', '/')
    if ($TrimValue) {
        $normalized = $normalized.Trim()
    }

    if ($StripLeadingRelative) {
        while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
            $normalized = $normalized.Substring(2)
        }
        $normalized = $normalized.TrimStart('/')
    }

    return $normalized
}

function Assert-GateTaskId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'TaskId must not be empty.'
    }

    if ($Value.Length -gt 128) {
        throw 'TaskId must be 128 characters or fewer.'
    }

    if ($Value -notmatch '^[A-Za-z0-9._-]+$') {
        throw "TaskId '$Value' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$"
    }
}

function Resolve-GatePathInsideRepo {
    param(
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [switch]$AllowMissing,
        [switch]$AllowEmpty
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        if ($AllowEmpty) {
            return $null
        }
        throw 'Path value must not be empty.'
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) { $PathValue } else { Join-Path $RepoRootPath $PathValue }
    $fullPath = [System.IO.Path]::GetFullPath($candidate)
    $fullPathTrimmed = $fullPath.TrimEnd('\', '/')
    $repoNormalized = ([System.IO.Path]::GetFullPath($RepoRootPath)).TrimEnd('\', '/')
    $repoBoundary = $repoNormalized + [System.IO.Path]::DirectorySeparatorChar
    if (-not (
            [string]::Equals($fullPathTrimmed, $repoNormalized, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullPath.StartsWith($repoBoundary, [System.StringComparison]::OrdinalIgnoreCase)
        )) {
        throw "Path '$PathValue' must resolve inside repository root '$RepoRootPath'."
    }

    if (-not $AllowMissing -and -not (Test-Path -LiteralPath $fullPath)) {
        throw "Path not found: $fullPath"
    }

    if (Test-Path -LiteralPath $fullPath) {
        return (Resolve-Path -LiteralPath $fullPath).Path
    }

    return $fullPath
}

function Convert-GateToStringArray {
    param(
        [object]$Value,
        [switch]$TrimValues
    )

    if ($null -eq $Value) {
        return @()
    }

    $result = @()
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($entry in $Value) {
            if ($null -eq $entry) {
                continue
            }

            $stringValue = [string]$entry
            if ($TrimValues) {
                $stringValue = $stringValue.Trim()
            }

            if ([string]::IsNullOrWhiteSpace($stringValue)) {
                continue
            }

            $result += $stringValue
        }
        return $result
    }

    $singleValue = [string]$Value
    if ($TrimValues) {
        $singleValue = $singleValue.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($singleValue)) {
        return @()
    }

    return @($singleValue)
}

function Test-GateMatchAnyRegex {
    param(
        [string]$PathValue,
        [string[]]$Regexes,
        [switch]$SkipInvalidRegex,
        [string]$InvalidRegexContext = ''
    )

    foreach ($regex in @($Regexes)) {
        if ([string]::IsNullOrWhiteSpace($regex)) {
            continue
        }

        if (-not $SkipInvalidRegex) {
            if ($PathValue -match $regex) {
                return $true
            }
            continue
        }

        try {
            if ([regex]::IsMatch($PathValue, $regex)) {
                return $true
            }
        } catch {
            if ([string]::IsNullOrWhiteSpace($InvalidRegexContext)) {
                Write-Warning "Invalid regex '$regex': $($_.Exception.Message)"
            } else {
                Write-Warning "Invalid regex '$regex' for ${InvalidRegexContext}: $($_.Exception.Message)"
            }
        }
    }

    return $false
}

function Add-GateMetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject,
        [bool]$EmitMetrics = $true
    )

    if (-not $EmitMetrics) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    try {
        $metricsDir = Split-Path -Parent $Path
        if ($metricsDir -and -not (Test-Path -LiteralPath $metricsDir)) {
            New-Item -Path $metricsDir -ItemType Directory -Force | Out-Null
        }

        $line = $EventObject | ConvertTo-Json -Depth 12 -Compress
        Add-Content -LiteralPath $Path -Value $line
    } catch {
        Write-Warning "Metrics append failed: $($_.Exception.Message)"
    }
}

function Get-GateTextCharCount {
    param(
        [object]$Lines
    )

    $normalizedLines = @(Convert-GateToStringArray -Value $Lines)
    if ($normalizedLines.Count -eq 0) {
        return 0
    }

    $charCount = 0
    foreach ($line in $normalizedLines) {
        $charCount += $line.Length
    }

    if ($normalizedLines.Count -gt 1) {
        $charCount += ($normalizedLines.Count - 1)
    }

    return [int]$charCount
}

function Get-GateOutputTelemetry {
    param(
        [object]$RawLines,
        [object]$FilteredLines,
        [string]$FilterMode = 'passthrough',
        [string]$FallbackMode = 'none'
    )

    $rawLineArray = @(Convert-GateToStringArray -Value $RawLines)
    $filteredLineArray = @(Convert-GateToStringArray -Value $FilteredLines)
    $rawCharCount = Get-GateTextCharCount -Lines $rawLineArray
    $filteredCharCount = Get-GateTextCharCount -Lines $filteredLineArray
    $estimatedSavedChars = [Math]::Max(0, $rawCharCount - $filteredCharCount)
    $estimatedSavedTokens = if ($estimatedSavedChars -le 0) { 0 } else { [int][Math]::Ceiling($estimatedSavedChars / 4.0) }

    return [ordered]@{
        raw_line_count = [int]$rawLineArray.Count
        raw_char_count = [int]$rawCharCount
        filtered_line_count = [int]$filteredLineArray.Count
        filtered_char_count = [int]$filteredCharCount
        estimated_saved_chars = [int]$estimatedSavedChars
        estimated_saved_tokens = [int]$estimatedSavedTokens
        filter_mode = $(if ([string]::IsNullOrWhiteSpace($FilterMode)) { 'passthrough' } else { $FilterMode })
        fallback_mode = $(if ([string]::IsNullOrWhiteSpace($FallbackMode)) { 'none' } else { $FallbackMode })
    }
}

function Get-GateFilterConfigValue {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Key)) {
            return $Object[$Key]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$Key]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Resolve-GateFilterIntegerSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [hashtable]$ContextData = @{},
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [int]$Minimum = 0
    )

    $resolvedValue = $Value
    $contextKey = Get-GateFilterConfigValue -Object $Value -Key 'context_key'
    if (-not [string]::IsNullOrWhiteSpace([string]$contextKey)) {
        if (-not $ContextData.ContainsKey([string]$contextKey)) {
            throw "$FieldName references missing context key '$contextKey'."
        }
        $resolvedValue = $ContextData[[string]$contextKey]
    }

    $resolvedInt = $null
    if ($resolvedValue -is [int] -or $resolvedValue -is [long] -or $resolvedValue -is [short] -or $resolvedValue -is [byte]) {
        $resolvedInt = [int]$resolvedValue
    } elseif ($resolvedValue -is [double] -or $resolvedValue -is [decimal] -or $resolvedValue -is [single]) {
        $numericValue = [double]$resolvedValue
        if ($numericValue -eq [Math]::Floor($numericValue)) {
            $resolvedInt = [int]$numericValue
        }
    } elseif ($resolvedValue -is [string]) {
        $parsedInt = 0
        if ([int]::TryParse($resolvedValue.Trim(), [ref]$parsedInt)) {
            $resolvedInt = $parsedInt
        }
    }

    if ($null -eq $resolvedInt -or $resolvedInt -lt $Minimum) {
        throw "$FieldName must resolve to integer >= $Minimum."
    }

    return [int]$resolvedInt
}

function Get-GateFilterPatterns {
    param(
        [AllowNull()]
        [object]$Operation
    )

    $patternsValue = Get-GateFilterConfigValue -Object $Operation -Key 'patterns'
    if ($null -eq $patternsValue) {
        $patternsValue = Get-GateFilterConfigValue -Object $Operation -Key 'pattern'
    }

    $patterns = @(Convert-GateToStringArray -Value $patternsValue -TrimValues)
    if ($patterns.Count -eq 0) {
        throw 'Filter operation requires non-empty `pattern` or `patterns`.'
    }

    foreach ($pattern in $patterns) {
        [void][regex]::new($pattern)
    }

    return @($patterns)
}

function Select-GateHeadLines {
    param(
        [string[]]$Lines,
        [int]$Count
    )

    $allLines = @($Lines)
    if ($Count -le 0 -or $allLines.Count -eq 0) {
        return @()
    }

    if ($allLines.Count -le $Count) {
        return $allLines
    }

    return $allLines[0..($Count - 1)]
}

function Select-GateTailLines {
    param(
        [string[]]$Lines,
        [int]$Count
    )

    $allLines = @($Lines)
    if ($Count -le 0 -or $allLines.Count -eq 0) {
        return @()
    }

    if ($allLines.Count -le $Count) {
        return $allLines
    }

    $startIndex = $allLines.Count - $Count
    return $allLines[$startIndex..($allLines.Count - 1)]
}

function Invoke-GateOutputFilterOperation {
    param(
        [string[]]$Lines,
        [Parameter(Mandatory = $true)]
        [object]$Operation,
        [hashtable]$ContextData = @{}
    )

    if ($Operation -isnot [System.Collections.IDictionary] -and $Operation.PSObject.Properties.Count -eq 0) {
        throw 'Filter operation must be an object.'
    }

    $typeValue = [string](Get-GateFilterConfigValue -Object $Operation -Key 'type')
    if ([string]::IsNullOrWhiteSpace($typeValue)) {
        throw 'Filter operation requires non-empty `type`.'
    }

    $operationType = $typeValue.Trim().ToLowerInvariant()
    $currentLines = @($Lines)
    switch ($operationType) {
        'strip_ansi' {
            $ansiPattern = '\x1B\[[0-9;?]*[ -/]*[@-~]'
            return @($currentLines | ForEach-Object { [regex]::Replace(([string]$_), $ansiPattern, '') })
        }
        'regex_replace' {
            $pattern = [string](Get-GateFilterConfigValue -Object $Operation -Key 'pattern')
            if ([string]::IsNullOrWhiteSpace($pattern)) {
                throw 'regex_replace requires non-empty `pattern`.'
            }
            [void][regex]::new($pattern)
            $replacement = [string](Get-GateFilterConfigValue -Object $Operation -Key 'replacement')
            return @($currentLines | ForEach-Object { [regex]::Replace(([string]$_), $pattern, $replacement) })
        }
        'drop_lines_matching' {
            $patterns = Get-GateFilterPatterns -Operation $Operation
            return @($currentLines | Where-Object { -not (Test-GateMatchAnyRegex -PathValue ([string]$_) -Regexes $patterns) })
        }
        'keep_lines_matching' {
            $patterns = Get-GateFilterPatterns -Operation $Operation
            return @($currentLines | Where-Object { Test-GateMatchAnyRegex -PathValue ([string]$_) -Regexes $patterns })
        }
        'truncate_line_length' {
            $maxChars = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'max_chars') -ContextData $ContextData -FieldName 'truncate_line_length.max_chars' -Minimum 1
            $suffix = [string](Get-GateFilterConfigValue -Object $Operation -Key 'suffix')
            if ($null -eq $suffix) {
                $suffix = '...'
            }

            return @($currentLines | ForEach-Object {
                    $line = [string]$_
                    if ($line.Length -le $maxChars) {
                        return $line
                    }

                    if ($suffix.Length -ge $maxChars) {
                        return $suffix.Substring(0, $maxChars)
                    }

                    return $line.Substring(0, $maxChars - $suffix.Length) + $suffix
                })
        }
        'head' {
            $count = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'count') -ContextData $ContextData -FieldName 'head.count' -Minimum 1
            return @(Select-GateHeadLines -Lines $currentLines -Count $count)
        }
        'tail' {
            $count = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'count') -ContextData $ContextData -FieldName 'tail.count' -Minimum 1
            return @(Select-GateTailLines -Lines $currentLines -Count $count)
        }
        'max_total_lines' {
            $maxLines = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'max_lines') -ContextData $ContextData -FieldName 'max_total_lines.max_lines' -Minimum 0
            $strategy = [string](Get-GateFilterConfigValue -Object $Operation -Key 'strategy')
            if ([string]::IsNullOrWhiteSpace($strategy)) {
                $strategy = 'tail'
            }
            $strategy = $strategy.Trim().ToLowerInvariant()
            if ($maxLines -eq 0) {
                return @()
            }

            if ($strategy -eq 'head') {
                return @(Select-GateHeadLines -Lines $currentLines -Count $maxLines)
            }
            if ($strategy -eq 'tail') {
                return @(Select-GateTailLines -Lines $currentLines -Count $maxLines)
            }

            throw "max_total_lines.strategy must be 'head' or 'tail'."
        }
        default {
            throw "Unsupported filter operation type '$operationType'."
        }
    }
}

function Invoke-GateOutputFilter {
    param(
        [object]$Lines,
        [string]$ConfigPath,
        [string]$ProfileName,
        [hashtable]$ContextData = @{}
    )

    $originalLines = @(Convert-GateToStringArray -Value $Lines)
    $passthroughResult = [ordered]@{
        lines = $originalLines
        filter_mode = 'passthrough'
        fallback_mode = 'none'
    }

    if ([string]::IsNullOrWhiteSpace($ProfileName)) {
        return $passthroughResult
    }

    if ([string]::IsNullOrWhiteSpace($ConfigPath) -or -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        Write-Warning "Output filter config missing for profile '$ProfileName': $ConfigPath"
        $passthroughResult['fallback_mode'] = 'missing_config_passthrough'
        return $passthroughResult
    }

    $config = $null
    try {
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    } catch {
        Write-Warning "Output filter config is invalid JSON for profile '$ProfileName': $($_.Exception.Message)"
        $passthroughResult['fallback_mode'] = 'invalid_config_passthrough'
        return $passthroughResult
    }

    $profiles = Get-GateFilterConfigValue -Object $config -Key 'profiles'
    if ($profiles -isnot [System.Collections.IDictionary]) {
        Write-Warning "Output filter config must contain object 'profiles'."
        $passthroughResult['fallback_mode'] = 'invalid_config_passthrough'
        return $passthroughResult
    }

    if (-not $profiles.Contains($ProfileName)) {
        Write-Warning "Output filter profile '$ProfileName' not found in $ConfigPath."
        $passthroughResult['fallback_mode'] = 'missing_profile_passthrough'
        return $passthroughResult
    }

    $profile = $profiles[$ProfileName]
    if ($profile -isnot [System.Collections.IDictionary]) {
        Write-Warning "Output filter profile '$ProfileName' must be an object."
        $passthroughResult['fallback_mode'] = 'invalid_profile_passthrough'
        return $passthroughResult
    }

    try {
        $filteredLines = @($originalLines)
        $operations = Get-GateFilterConfigValue -Object $profile -Key 'operations'
        if ($null -eq $operations) {
            $operations = @()
        } elseif ($operations -is [string]) {
            throw "Profile '$ProfileName' field 'operations' must be an array."
        }

        foreach ($operation in @($operations)) {
            $filteredLines = @($(Invoke-GateOutputFilterOperation -Lines $filteredLines -Operation $operation -ContextData $ContextData))
        }

        $filteredLines = @($filteredLines)
        $emitWhenEmpty = Get-GateFilterConfigValue -Object $profile -Key 'emit_when_empty'
        if ($filteredLines.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$emitWhenEmpty)) {
            $filteredLines = @([string]$emitWhenEmpty)
        }

        return [ordered]@{
            lines = @($filteredLines)
            filter_mode = "profile:$ProfileName"
            fallback_mode = 'none'
        }
    } catch {
        Write-Warning "Output filter profile '$ProfileName' is invalid: $($_.Exception.Message)"
        $passthroughResult['fallback_mode'] = 'invalid_profile_passthrough'
        return $passthroughResult
    }
}

function Add-GateTaskEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null
    )

    if ([string]::IsNullOrWhiteSpace($TaskId)) {
        return
    }

    Assert-GateTaskId -Value $TaskId

    try {
        $eventsDir = Join-Path $RepoRootPath 'Octopus-agent-orchestrator/runtime/task-events'
        if (-not (Test-Path -LiteralPath $eventsDir)) {
            New-Item -Path $eventsDir -ItemType Directory -Force | Out-Null
        }

        $event = [ordered]@{
            timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
            task_id = $TaskId
            event_type = $EventType
            outcome = $Outcome
            message = $Message
            details = $Details
        }

        $line = $event | ConvertTo-Json -Depth 12 -Compress
        $taskFilePath = Join-Path $eventsDir "$TaskId.jsonl"
        $allTasksPath = Join-Path $eventsDir 'all-tasks.jsonl'

        Add-Content -LiteralPath $taskFilePath -Value $line
        Add-Content -LiteralPath $allTasksPath -Value $line
    } catch {
        Write-Warning "Task-event append failed: $($_.Exception.Message)"
    }
}

Export-ModuleMember -Function @(
    'Get-GateProjectRoot',
    'Convert-GatePathToUnix',
    'Assert-GateTaskId',
    'Resolve-GatePathInsideRepo',
    'Convert-GateToStringArray',
    'Test-GateMatchAnyRegex',
    'Add-GateMetricsEvent',
    'Get-GateOutputTelemetry',
    'Invoke-GateOutputFilter',
    'Add-GateTaskEvent'
)
