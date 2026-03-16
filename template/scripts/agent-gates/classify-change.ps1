[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string[]]$ChangedFiles,
    [switch]$UseStaged,
    [bool]$IncludeUntracked = $true,
    [string]$TaskId = '',
    [string]$TaskIntent = '',
    [int]$FastPathMaxFiles = 2,
    [int]$FastPathMaxChangedLines = 40,
    [int]$PerformanceHeuristicMinLines = 120,
    [string]$OutputPath,
    [string]$MetricsPath,
    [bool]$EmitMetrics = $true
)

$ErrorActionPreference = 'Stop'

$gateUtilsModulePath = Join-Path $PSScriptRoot 'lib/gate-utils.psm1'
if (-not (Test-Path -LiteralPath $gateUtilsModulePath)) {
    throw "Missing gate utils module: $gateUtilsModulePath"
}
Import-Module -Name $gateUtilsModulePath -Force -DisableNameChecking

function Resolve-ProjectRoot {
    return Get-GateProjectRoot -ScriptRoot $PSScriptRoot
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

function Normalize-Path {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue -TrimValue -StripLeadingRelative
}

function Expand-ChangedFilesInput {
    param([string[]]$Values)

    $expanded = @()
    foreach ($value in @($Values)) {
        if ($null -eq $value) {
            continue
        }

        $text = [string]$value
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        foreach ($part in ($text -split "[`r`n,;]+")) {
            if ([string]::IsNullOrWhiteSpace($part)) {
                continue
            }

            $expanded += $part.Trim()
        }
    }

    return @($expanded | Sort-Object -Unique)
}

function Assert-ValidTaskId {
    param([string]$Value)

    Assert-GateTaskId -Value $Value
}

function Invoke-GitLines {
    param(
        [string]$RepoRootPath,
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    $output = & git -C $RepoRootPath @Arguments 2>$null
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($exitCode -ne 0) {
        throw $FailureMessage
    }

    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Test-PathPrefix {
    param(
        [string]$PathValue,
        [string[]]$Prefixes
    )

    foreach ($prefix in $Prefixes) {
        if ($PathValue.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Test-MatchAnyRegex {
    param(
        [string]$PathValue,
        [string[]]$Regexes
    )

    return Test-GateMatchAnyRegex -PathValue $PathValue -Regexes $Regexes
}

function Append-MetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject
    )

    Add-GateMetricsEvent -Path $Path -EventObject $EventObject -EmitMetrics $EmitMetrics
}

function Resolve-TaskId {
    param(
        [string]$ExplicitTaskId,
        [string]$OutputPathHint
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitTaskId)) {
        return $ExplicitTaskId.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($OutputPathHint)) {
        return $null
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($OutputPathHint)
    if ([string]::IsNullOrWhiteSpace($baseName)) {
        return $null
    }

    $candidate = $baseName -replace '-preflight$', ''
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        return $null
    }

    return $candidate.Trim()
}

function Append-TaskEvent {
    param(
        [string]$RepoRootPath,
        [string]$TaskId,
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null
    )

    Add-GateTaskEvent -RepoRootPath $RepoRootPath -TaskId $TaskId -EventType $EventType -Outcome $Outcome -Message $Message -Details $Details
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value
}

function Normalize-RootPrefixes {
    param([string[]]$Prefixes)

    $normalized = @()
    foreach ($prefix in $Prefixes) {
        $value = Normalize-Path $prefix
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        if (-not $value.EndsWith('/')) {
            $value += '/'
        }
        $normalized += $value
    }

    return @($normalized | Sort-Object -Unique)
}

function Get-ClassificationConfig {
    param(
        [string]$RepoRootPath
    )

    $defaults = [ordered]@{
        metrics_path = Get-GateOrchestratorRelativePath -RepoRootPath $RepoRootPath -PathValue 'runtime/metrics.jsonl'
        runtime_roots = @(
            'src/',
            'app/',
            'apps/',
            'backend/',
            'frontend/',
            'web/',
            'api/',
            'services/',
            'packages/'
        )
        fast_path_roots = @(
            'frontend/',
            'web/',
            'ui/',
            'mobile/',
            'apps/'
        )
        fast_path_allowed_regexes = @(
            '^.+\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$',
            '^.+\.(svg|png|jpg|jpeg|webp|ico)$'
        )
        fast_path_sensitive_regexes = @(
            '(^|/)(auth|security|payment|checkout|webhook|token|jwt|guard|middleware|service|repository|query|migration|sql|datasource)(/|\.|$)'
        )
        sql_or_migration_regexes = @(
            '\.sql$',
            '(^|/)(db|database|migrations?|schema)(/|$)'
        )
        triggers = [ordered]@{
            db = @(
                '(^|/)(db|database|migrations?|schema)(/|$)',
                '\.sql$',
                '(Repository|Dao|Specification|Query|Migration)[^/]*\.(java|kt|ts|js|py|go|cs|rb|php)$',
                '(?i)(typeorm|prisma|flyway|liquibase|alembic|knex|sequelize)'
            )
            security = @(
                '(^|/)(auth|security|oauth|jwt|token|rbac|acl|keycloak|okta|saml|openid|mfa|crypt|encryption|certificate|secret|vault|webhook|payment|checkout|billing)(/|\.|$)'
            )
            api = @(
                '(^|/)(controllers?|routes?|handlers?|endpoints?|graphql)(/|\.|$)',
                '(Request|Response|Dto|DTO|Contract|Schema)[^/]*\.(java|kt|ts|tsx|js|jsx|py|go|cs|rb|php)$',
                '(^|/)(openapi|swagger)\.(ya?ml|json)$'
            )
            dependency = @(
                '(^|/)pom\.xml$',
                '(^|/)build\.gradle(\.kts)?$',
                '(^|/)settings\.gradle(\.kts)?$',
                '(^|/)package\.json$',
                '(^|/)package-lock\.json$',
                '(^|/)pnpm-lock\.yaml$',
                '(^|/)yarn\.lock$',
                '(^|/)requirements(\.txt|-dev\.txt)?$',
                '(^|/)poetry\.lock$',
                '(^|/)pyproject\.toml$',
                '(^|/)go\.mod$',
                '(^|/)go\.sum$',
                '(^|/)Cargo\.toml$',
                '(^|/)Cargo\.lock$',
                '(^|/)composer\.json$',
                '(^|/)Gemfile(\.lock)?$'
            )
            infra = @(
                '(^|/)Dockerfile(\..+)?$',
                '(^|/)docker-compose(\.[^/]+)?\.ya?ml$',
                '(^|/)(terraform|infra|infrastructure|helm|k8s|kubernetes)(/|$)',
                '(^|/)\.github/workflows/'
            )
            test = @(
                '/src/test/',
                '(^|/)(__tests__|tests?)/',
                '\.(spec|test)\.(ts|tsx|js|jsx|java|kt|go|py|rb|php)$'
            )
            performance = @(
                '(Cache|Redis|Elasticsearch|Search|Query|Benchmark|Profil(e|ing))[^/]*\.(java|kt|ts|js|py|go|cs|rb|php)$',
                '(^|/)(performance|perf|benchmark)/'
            )
        }
        code_like_regexes = @(
            '\.(java|kt|kts|groovy|ts|tsx|js|jsx|cjs|mjs|cs|go|py|rb|php|rs)$'
        )
    }

    $configPath = Join-GateOrchestratorPath -RepoRootPath $RepoRootPath -RelativePath 'live/config/paths.json'
    $source = 'defaults'
    if (Test-Path $configPath) {
        try {
            $raw = Get-Content -Path $configPath -Raw | ConvertFrom-Json

            if ($null -ne $raw.PSObject.Properties['metrics_path']) {
                $defaults.metrics_path = [string]$raw.metrics_path
            }
            if ($null -ne $raw.PSObject.Properties['runtime_roots']) {
                $defaults.runtime_roots = Convert-ToStringArray $raw.runtime_roots
            }
            if ($null -ne $raw.PSObject.Properties['fast_path_roots']) {
                $defaults.fast_path_roots = Convert-ToStringArray $raw.fast_path_roots
            }
            if ($null -ne $raw.PSObject.Properties['fast_path_allowed_regexes']) {
                $defaults.fast_path_allowed_regexes = Convert-ToStringArray $raw.fast_path_allowed_regexes
            }
            if ($null -ne $raw.PSObject.Properties['fast_path_sensitive_regexes']) {
                $defaults.fast_path_sensitive_regexes = Convert-ToStringArray $raw.fast_path_sensitive_regexes
            }
            if ($null -ne $raw.PSObject.Properties['sql_or_migration_regexes']) {
                $defaults.sql_or_migration_regexes = Convert-ToStringArray $raw.sql_or_migration_regexes
            }
            if ($null -ne $raw.PSObject.Properties['code_like_regexes']) {
                $defaults.code_like_regexes = Convert-ToStringArray $raw.code_like_regexes
            }

            if ($null -ne $raw.PSObject.Properties['triggers']) {
                $triggerObject = $raw.triggers
                foreach ($triggerKey in @('db', 'security', 'api', 'dependency', 'infra', 'test', 'performance')) {
                    if ($null -ne $triggerObject.PSObject.Properties[$triggerKey]) {
                        $defaults.triggers[$triggerKey] = Convert-ToStringArray $triggerObject.$triggerKey
                    }
                }
            }

            $source = 'paths_json'
        } catch {
            Write-Warning "Failed to parse classification config at ${configPath}: $($_.Exception.Message)"
            $source = 'defaults_with_config_parse_error'
        }
    }

    return [ordered]@{
        source = $source
        config_path = $configPath
        metrics_path = [string]$defaults.metrics_path
        runtime_roots = Normalize-RootPrefixes (Convert-ToStringArray $defaults.runtime_roots)
        fast_path_roots = Normalize-RootPrefixes (Convert-ToStringArray $defaults.fast_path_roots)
        fast_path_allowed_regexes = Convert-ToStringArray $defaults.fast_path_allowed_regexes
        fast_path_sensitive_regexes = Convert-ToStringArray $defaults.fast_path_sensitive_regexes
        sql_or_migration_regexes = Convert-ToStringArray $defaults.sql_or_migration_regexes
        db_trigger_regexes = Convert-ToStringArray $defaults.triggers.db
        security_trigger_regexes = Convert-ToStringArray $defaults.triggers.security
        api_trigger_regexes = Convert-ToStringArray $defaults.triggers.api
        dependency_trigger_regexes = Convert-ToStringArray $defaults.triggers.dependency
        infra_trigger_regexes = Convert-ToStringArray $defaults.triggers.infra
        test_trigger_regexes = Convert-ToStringArray $defaults.triggers.test
        performance_trigger_regexes = Convert-ToStringArray $defaults.triggers.performance
        code_like_regexes = Convert-ToStringArray $defaults.code_like_regexes
    }
}

function Get-ReviewCapabilities {
    param(
        [string]$RepoRootPath
    )

    $capabilities = [ordered]@{
        code = $true
        db = $true
        security = $true
        refactor = $true
        api = $false
        test = $false
        performance = $false
        infra = $false
        dependency = $false
    }

    $configPath = Join-GateOrchestratorPath -RepoRootPath $RepoRootPath -RelativePath 'live/config/review-capabilities.json'
    if (-not (Test-Path $configPath)) {
        return $capabilities
    }

    try {
        $raw = Get-Content -Path $configPath -Raw | ConvertFrom-Json
        foreach ($key in @($capabilities.Keys)) {
            if ($null -ne $raw.PSObject.Properties[$key]) {
                $capabilities[$key] = [bool]$raw.$key
            }
        }
    } catch {
        Write-Warning "Failed to parse review capabilities config at ${configPath}: $($_.Exception.Message)"
    }

    return $capabilities
}

$classificationConfig = Get-ClassificationConfig -RepoRootPath $RepoRoot
if ([string]::IsNullOrWhiteSpace($MetricsPath)) {
    $configuredMetricsPath = $classificationConfig.metrics_path
    if ([System.IO.Path]::IsPathRooted($configuredMetricsPath)) {
        $MetricsPath = $configuredMetricsPath
    } else {
        $MetricsPath = Join-Path $RepoRoot $configuredMetricsPath
    }
}

$runtimeRoots = @($classificationConfig.runtime_roots)
$fastPathRoots = @($classificationConfig.fast_path_roots)
$fastPathAllowedRegexes = @($classificationConfig.fast_path_allowed_regexes)
$fastPathSensitiveRegexes = @($classificationConfig.fast_path_sensitive_regexes)
$sqlOrMigrationRegexes = @($classificationConfig.sql_or_migration_regexes)
$dbTriggerRegexes = @($classificationConfig.db_trigger_regexes)
$securityTriggerRegexes = @($classificationConfig.security_trigger_regexes)
$apiTriggerRegexes = @($classificationConfig.api_trigger_regexes)
$dependencyTriggerRegexes = @($classificationConfig.dependency_trigger_regexes)
$infraTriggerRegexes = @($classificationConfig.infra_trigger_regexes)
$testTriggerRegexes = @($classificationConfig.test_trigger_regexes)
$performanceTriggerRegexes = @($classificationConfig.performance_trigger_regexes)
$codeLikeRegexes = @($classificationConfig.code_like_regexes)

$isExplicitChangedFiles = $PSBoundParameters.ContainsKey('ChangedFiles')
if ($isExplicitChangedFiles) {
    $ChangedFiles = Expand-ChangedFilesInput -Values $ChangedFiles
}
if ($isExplicitChangedFiles -and $UseStaged) {
    throw 'Use either -ChangedFiles or -UseStaged, but not both.'
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand -and -not $isExplicitChangedFiles) {
    throw 'Git is not available and -ChangedFiles was not provided.'
}

$canUseGitDiff = $false
if ($gitCommand) {
    & git -C $RepoRoot rev-parse --is-inside-work-tree 2>$null | Out-Null
    $gitCheckExit = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    $canUseGitDiff = $gitCheckExit -eq 0
}
if (-not $isExplicitChangedFiles -and -not $canUseGitDiff) {
    throw "Git diff operations failed for RepoRoot '$RepoRoot'. Provide -ChangedFiles explicitly or run inside a valid git worktree."
}

$detectionSource = 'explicit_changed_files'
$detectedFromGit = @()
$untrackedFromGit = @()
if (-not $isExplicitChangedFiles -and $canUseGitDiff) {
    if ($UseStaged) {
        $detectionSource = $(if ($IncludeUntracked) { 'git_staged_plus_untracked' } else { 'git_staged_only' })
        $detectedFromGit = Invoke-GitLines -RepoRootPath $RepoRoot -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB') -FailureMessage "Failed to detect staged changed files via git diff --cached."
    } else {
        $detectionSource = 'git_auto'
        $detectedFromGit = Invoke-GitLines -RepoRootPath $RepoRoot -Arguments @('diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD') -FailureMessage "Failed to detect changed files via git diff HEAD."
    }

    if ($IncludeUntracked) {
        $untrackedFromGit = Invoke-GitLines -RepoRootPath $RepoRoot -Arguments @('ls-files', '--others', '--exclude-standard') -FailureMessage "Failed to detect untracked files via git ls-files."
    }

    $ChangedFiles = @($detectedFromGit + $untrackedFromGit | Sort-Object -Unique)
}

$normalizedFiles = @($ChangedFiles | ForEach-Object { Normalize-Path $_ } | Where-Object { $_ } | Sort-Object -Unique)

$changedLinesTotal = 0
$additionsTotal = 0
$deletionsTotal = 0
$renameCount = 0

if ($canUseGitDiff) {
    $numstatRows = @{}
    $numstatArgs = @('diff', '--numstat', '--diff-filter=ACMRTUXB')
    if (-not $isExplicitChangedFiles -and $UseStaged) {
        $numstatArgs += '--cached'
    } else {
        $numstatArgs += 'HEAD'
    }
    $numstat = Invoke-GitLines -RepoRootPath $RepoRoot -Arguments $numstatArgs -FailureMessage 'Failed to collect git numstat metrics.'
    foreach ($line in $numstat) {
        $parts = $line -split "`t"
        if ($parts.Count -ge 3) {
            $path = Normalize-Path $parts[2]
            if ($path) {
                $numstatRows[$path] = @{
                    additions = $parts[0]
                    deletions = $parts[1]
                }
            }
        }
    }

    $nameStatusArgs = @('diff', '--name-status', '--diff-filter=ACMRTUXB')
    if (-not $isExplicitChangedFiles -and $UseStaged) {
        $nameStatusArgs += '--cached'
    } else {
        $nameStatusArgs += 'HEAD'
    }
    $nameStatusRows = Invoke-GitLines -RepoRootPath $RepoRoot -Arguments $nameStatusArgs -FailureMessage 'Failed to collect git name-status metrics.'
    foreach ($line in $nameStatusRows) {
        $parts = $line -split "`t"
        if ($parts.Count -ge 1 -and $parts[0] -match '^R\d*$') {
            $renameCount++
        }
    }

    if ($isExplicitChangedFiles) {
        foreach ($file in $normalizedFiles) {
            if ($numstatRows.ContainsKey($file)) {
                $row = $numstatRows[$file]
                if ($row.additions -match '^\d+$') {
                    $additionsTotal += [int]$row.additions
                    $changedLinesTotal += [int]$row.additions
                }
                if ($row.deletions -match '^\d+$') {
                    $deletionsTotal += [int]$row.deletions
                    $changedLinesTotal += [int]$row.deletions
                }
                continue
            }

            $fullPath = Join-Path $RepoRoot $file
            if (Test-Path $fullPath) {
                try {
                    $lineCount = (Get-Content -Path $fullPath -ErrorAction Stop | Measure-Object -Line).Lines
                    $additionsTotal += [int]$lineCount
                    $changedLinesTotal += [int]$lineCount
                } catch {
                    # Ignore binary and unreadable files in line metrics.
                }
            }
        }
    } else {
        foreach ($key in $numstatRows.Keys) {
            $row = $numstatRows[$key]
            if ($row.additions -match '^\d+$') {
                $additionsTotal += [int]$row.additions
                $changedLinesTotal += [int]$row.additions
            }
            if ($row.deletions -match '^\d+$') {
                $deletionsTotal += [int]$row.deletions
                $changedLinesTotal += [int]$row.deletions
            }
        }

        foreach ($file in $untrackedFromGit) {
            $normalized = Normalize-Path $file
            if (-not $normalized) {
                continue
            }
            $fullPath = Join-Path $RepoRoot $normalized
            if (Test-Path $fullPath) {
                try {
                    $lineCount = (Get-Content -Path $fullPath -ErrorAction Stop | Measure-Object -Line).Lines
                    $additionsTotal += [int]$lineCount
                    $changedLinesTotal += [int]$lineCount
                } catch {
                    # Ignore binary and unreadable files in line metrics.
                }
            }
        }
    }
} elseif ($isExplicitChangedFiles) {
    foreach ($file in $normalizedFiles) {
        $fullPath = Join-Path $RepoRoot $file
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            continue
        }
        try {
            $lineCount = (Get-Content -Path $fullPath -ErrorAction Stop | Measure-Object -Line).Lines
            $additionsTotal += [int]$lineCount
            $changedLinesTotal += [int]$lineCount
        } catch {
            # Ignore binary and unreadable files in line metrics.
        }
    }
}

$runtimeChanged = ($normalizedFiles | Where-Object { Test-PathPrefix -PathValue $_ -Prefixes $runtimeRoots }).Count -gt 0
$dbTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $dbTriggerRegexes }).Count -gt 0
$securityTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $securityTriggerRegexes }).Count -gt 0
$apiTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $apiTriggerRegexes }).Count -gt 0
$dependencyTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $dependencyTriggerRegexes }).Count -gt 0
$infraTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $infraTriggerRegexes }).Count -gt 0
$testTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $testTriggerRegexes }).Count -gt 0
$performancePathTriggered = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $performanceTriggerRegexes }).Count -gt 0
$sqlOrMigrationChangedCount = ($normalizedFiles | Where-Object {
    Test-MatchAnyRegex -PathValue $_ -Regexes $sqlOrMigrationRegexes
}).Count
$onlySqlOrMigrationChanges = $normalizedFiles.Count -gt 0 -and $sqlOrMigrationChangedCount -eq $normalizedFiles.Count

$reviewCapabilities = Get-ReviewCapabilities -RepoRootPath $RepoRoot

$refactorIntentTriggered = $false
if ($TaskIntent -match '(?i)\b(refactor|cleanup|restructure|extract|rename|modularization|simplify)\b') {
    $refactorIntentTriggered = $true
}

$codeLikeChangedCount = @($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $codeLikeRegexes }).Count
$runtimeCodeLikeChangedCount = @($normalizedFiles | Where-Object {
    (Test-PathPrefix -PathValue $_ -Prefixes $runtimeRoots) -and (Test-MatchAnyRegex -PathValue $_ -Regexes $codeLikeRegexes)
}).Count
$runtimeCodeChanged = $runtimeCodeLikeChangedCount -gt 0
$refactorHeuristicReasons = @()
if ($runtimeChanged -and $normalizedFiles.Count -gt 0) {
    $renameRatio = 0.0
    if ($normalizedFiles.Count -gt 0) {
        $renameRatio = [math]::Round(($renameCount / [double]$normalizedFiles.Count), 4)
    }
    if ($normalizedFiles.Count -ge 2 -and $renameRatio -ge 0.4) {
        $refactorHeuristicReasons += 'rename_ratio_high'
    }

    $totalChurn = $additionsTotal + $deletionsTotal
    $deltaBalanceThreshold = [Math]::Max(20, [int]($totalChurn * 0.15))
    $balancedChurn = [Math]::Abs($additionsTotal - $deletionsTotal) -le $deltaBalanceThreshold
    $structuralChurn = $codeLikeChangedCount -ge 3 -and $totalChurn -ge 80 -and $balancedChurn -and -not $dbTriggered -and -not $securityTriggered
    if ($structuralChurn) {
        $refactorHeuristicReasons += 'balanced_structural_churn'
    }
}
$refactorHeuristicTriggered = $refactorHeuristicReasons.Count -gt 0
$refactorTriggered = $refactorIntentTriggered -or $refactorHeuristicTriggered
$performanceHeuristicTriggered = $false
if (
    -not $performancePathTriggered `
    -and ($apiTriggered -or ($dbTriggered -and $runtimeCodeChanged)) `
    -and -not $onlySqlOrMigrationChanges `
    -and ($changedLinesTotal -ge $PerformanceHeuristicMinLines)
) {
    $performanceHeuristicTriggered = $true
}
$performanceTriggered = $performancePathTriggered -or $performanceHeuristicTriggered

$allUnderFastRoots = $normalizedFiles.Count -gt 0 -and ($normalizedFiles | Where-Object { -not (Test-PathPrefix -PathValue $_ -Prefixes $fastPathRoots) }).Count -eq 0
$allFastAllowedTypes = $normalizedFiles.Count -gt 0 -and ($normalizedFiles | Where-Object { -not (Test-MatchAnyRegex -PathValue $_ -Regexes $fastPathAllowedRegexes) }).Count -eq 0
$hasFastSensitiveMatch = ($normalizedFiles | Where-Object { Test-MatchAnyRegex -PathValue $_ -Regexes $fastPathSensitiveRegexes }).Count -gt 0

$fastPathEligible = $runtimeChanged `
    -and $allUnderFastRoots `
    -and $allFastAllowedTypes `
    -and -not $hasFastSensitiveMatch `
    -and ($normalizedFiles.Count -le $FastPathMaxFiles) `
    -and ($changedLinesTotal -le $FastPathMaxChangedLines)

$mode = 'FULL_PATH'
if ($fastPathEligible `
    -and -not $dbTriggered `
    -and -not $securityTriggered `
    -and -not $refactorTriggered `
    -and -not $apiTriggered `
    -and -not $dependencyTriggered `
    -and -not $infraTriggered `
    -and -not $performanceTriggered) {
    $mode = 'FAST_PATH'
}

$requiredCodeReview = $runtimeCodeChanged -and $mode -eq 'FULL_PATH'
$requiredDbReview = $dbTriggered
$requiredSecurityReview = $securityTriggered
$requiredRefactorReview = $refactorTriggered
$requiredApiReview = $apiTriggered -and [bool]$reviewCapabilities.api
$requiredTestReview = $testTriggered -and [bool]$reviewCapabilities.test
$requiredPerformanceReview = $performanceTriggered -and [bool]$reviewCapabilities.performance
$requiredInfraReview = $infraTriggered -and [bool]$reviewCapabilities.infra
$requiredDependencyReview = $dependencyTriggered -and [bool]$reviewCapabilities.dependency
$resolvedTaskId = Resolve-TaskId -ExplicitTaskId $TaskId -OutputPathHint $OutputPath
if (-not [string]::IsNullOrWhiteSpace($resolvedTaskId)) {
    Assert-ValidTaskId -Value $resolvedTaskId
}
$normalizedOutputPath = $(if ([string]::IsNullOrWhiteSpace($OutputPath)) { $null } else { $OutputPath.Replace('\', '/') })

$result = [ordered]@{
    detection_source = $detectionSource
    mode = $mode
    metrics = [ordered]@{
        classification_config_source = $classificationConfig.source
        classification_config_path = $classificationConfig.config_path.Replace('\', '/')
        changed_files_count = $normalizedFiles.Count
        changed_lines_total = $changedLinesTotal
        additions_total = $additionsTotal
        deletions_total = $deletionsTotal
        rename_count = $renameCount
        code_like_changed_count = $codeLikeChangedCount
        runtime_code_like_changed_count = $runtimeCodeLikeChangedCount
        review_capabilities = $reviewCapabilities
        fast_path_max_files = $FastPathMaxFiles
        fast_path_max_changed_lines = $FastPathMaxChangedLines
        performance_heuristic_min_lines = $PerformanceHeuristicMinLines
    }
    triggers = [ordered]@{
        runtime_changed = $runtimeChanged
        runtime_code_changed = $runtimeCodeChanged
        db = $dbTriggered
        security = $securityTriggered
        api = $apiTriggered
        test = $testTriggered
        performance = $performanceTriggered
        infra = $infraTriggered
        dependency = $dependencyTriggered
        refactor = $refactorTriggered
        refactor_intent = $refactorIntentTriggered
        refactor_heuristic = $refactorHeuristicTriggered
        refactor_heuristic_reasons = $refactorHeuristicReasons
        performance_heuristic = $performanceHeuristicTriggered
        fast_path_eligible = $fastPathEligible
        fast_path_sensitive_match = $hasFastSensitiveMatch
    }
    required_reviews = [ordered]@{
        code = $requiredCodeReview
        db = $requiredDbReview
        security = $requiredSecurityReview
        refactor = $requiredRefactorReview
        api = $requiredApiReview
        test = $requiredTestReview
        performance = $requiredPerformanceReview
        infra = $requiredInfraReview
        dependency = $requiredDependencyReview
    }
    changed_files = $normalizedFiles
}

if (-not [string]::IsNullOrWhiteSpace($resolvedTaskId)) {
    $result.task_id = $resolvedTaskId
}

$json = $result | ConvertTo-Json -Depth 8

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $outputDirectory = Split-Path -Parent $OutputPath
    if ($outputDirectory -and -not (Test-Path $outputDirectory)) {
        New-Item -Path $outputDirectory -ItemType Directory -Force | Out-Null
    }
    Set-Content -Path $OutputPath -Value $json
}

$metricsEvent = [ordered]@{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    event_type = 'preflight_classification'
    repo_root = $RepoRoot.Replace('\', '/')
    task_id = $resolvedTaskId
    output_path = $normalizedOutputPath
    result = $result
}
Append-MetricsEvent -Path $MetricsPath -EventObject $metricsEvent

$taskEventDetails = [ordered]@{
    mode = $mode
    output_path = $normalizedOutputPath
    changed_files_count = $normalizedFiles.Count
    changed_lines_total = $changedLinesTotal
    required_reviews = $result.required_reviews
}
Append-TaskEvent -RepoRootPath $RepoRoot -TaskId $resolvedTaskId -EventType 'PREFLIGHT_CLASSIFIED' -Outcome 'INFO' -Message "Preflight completed with mode $mode." -Details $taskEventDetails

Write-Output $json


