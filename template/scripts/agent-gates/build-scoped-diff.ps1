[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('db', 'security')]
    [string]$ReviewType,
    [Parameter(Mandatory = $true)]
    [string]$PreflightPath,
    [string]$PathsConfigPath = 'Octopus-agent-orchestrator/live/config/paths.json',
    [string]$OutputPath = '',
    [string]$FullDiffPath = '',
    [switch]$UseStaged,
    [string]$RepoRoot
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

function Resolve-GitRootPath {
    param([string]$RepoRootPath)

    $resolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRootPath)
    if (Test-Path -LiteralPath (Join-Path $resolvedRepoRoot '.git')) {
        return $resolvedRepoRoot
    }

    $bundleCandidate = Join-Path $resolvedRepoRoot 'Octopus-agent-orchestrator'
    if (Test-Path -LiteralPath (Join-Path $bundleCandidate '.git')) {
        return [System.IO.Path]::GetFullPath($bundleCandidate)
    }

    return $resolvedRepoRoot
}

function Normalize-Path {
    param([string]$PathValue)

    return Convert-GatePathToUnix -PathValue $PathValue
}

function Resolve-PathInsideRepo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [switch]$AllowMissing
    )

    return Resolve-GatePathInsideRepo -PathValue $PathValue -RepoRootPath $RepoRootPath -AllowMissing:$AllowMissing
}

function Ensure-ParentDirectory {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return
    }

    $parentDirectory = Split-Path -Parent $PathValue
    if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
        New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
    }
}

function Convert-ToStringArray {
    param([object]$Value)

    return Convert-GateToStringArray -Value $Value -TrimValues
}

function Test-MatchAnyRegex {
    param(
        [string]$PathValue,
        [string[]]$Regexes
    )

    return Test-GateMatchAnyRegex -PathValue $PathValue -Regexes $Regexes -SkipInvalidRegex -InvalidRegexContext "review '$ReviewType'"
}

function Try-GetGitDiff {
    param(
        [string]$RepoRootPath,
        [bool]$UseStagedDiff,
        [string[]]$Pathspecs
    )

    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if ($null -eq $gitCommand) {
        return [ordered]@{
            success = $false
            text = ''
            error = 'git command not found.'
        }
    }

    $arguments = @('-C', $RepoRootPath, 'diff', '--no-color')
    if ($UseStagedDiff) {
        $arguments += '--staged'
    } else {
        $arguments += 'HEAD'
    }

    if ($null -ne $Pathspecs -and $Pathspecs.Count -gt 0) {
        $arguments += '--'
        $arguments += $Pathspecs
    }

    try {
        $output = & git @arguments 2>&1
        $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        $outputText = @($output | ForEach-Object { [string]$_ }) -join "`n"
        if ($exitCode -ne 0) {
            return [ordered]@{
                success = $false
                text = $outputText
                error = "git diff exited with code $exitCode."
            }
        }

        return [ordered]@{
            success = $true
            text = $outputText
            error = $null
        }
    }
    catch {
        return [ordered]@{
            success = $false
            text = ''
            error = $_.Exception.Message
        }
    }
}

function Resolve-OutputPath {
    param(
        [string]$ExplicitOutputPath,
        [string]$ResolvedPreflightPath,
        [string]$ReviewTypeValue,
        [string]$RepoRootPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitOutputPath)) {
        return Resolve-PathInsideRepo -PathValue $ExplicitOutputPath -RepoRootPath $RepoRootPath -AllowMissing
    }

    $preflightDirectory = Split-Path -Parent $ResolvedPreflightPath
    $preflightName = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedPreflightPath)
    $baseName = [regex]::Replace($preflightName, '-preflight$', '')
    return Join-Path $preflightDirectory "$baseName-$ReviewTypeValue-scoped.diff"
}

function Get-LineCount {
    param([string]$Text)

    if ([string]::IsNullOrEmpty($Text)) {
        return 0
    }

    return (@($Text -split "`r?`n")).Count
}

function Convert-ToGitPathspecs {
    param(
        [string[]]$Pathspecs,
        [string]$RepoRootPath,
        [string]$GitRootPath
    )

    if ($null -eq $Pathspecs -or $Pathspecs.Count -eq 0) {
        return @()
    }

    $repoRootNormalized = ([System.IO.Path]::GetFullPath($RepoRootPath)).TrimEnd('\', '/')
    $gitRootNormalized = ([System.IO.Path]::GetFullPath($GitRootPath)).TrimEnd('\', '/')
    if ([string]::Equals($repoRootNormalized, $gitRootNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
        return @($Pathspecs)
    }

    $gitRootName = [System.IO.Path]::GetFileName($gitRootNormalized)
    $prefix = "$gitRootName/"
    $normalizedPathspecs = @()
    foreach ($pathspec in $Pathspecs) {
        $normalized = [string]$pathspec
        $normalized = $normalized.Replace('\', '/')
        if ($normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $normalized = $normalized.Substring($prefix.Length)
        }
        $normalizedPathspecs += $normalized
    }

    return $normalizedPathspecs
}

function Get-FullDiffText {
    param(
        [string]$ResolvedFullDiffPath,
        [string]$RepoRootPath,
        [bool]$UseStagedDiff
    )

    if (-not [string]::IsNullOrWhiteSpace($ResolvedFullDiffPath) -and (Test-Path -LiteralPath $ResolvedFullDiffPath -PathType Leaf)) {
        return [ordered]@{
            text = (Get-Content -LiteralPath $ResolvedFullDiffPath -Raw)
            source = 'artifact'
        }
    }

    $fullDiffResult = Try-GetGitDiff -RepoRootPath $RepoRootPath -UseStagedDiff $UseStagedDiff -Pathspecs @()
    if (-not $fullDiffResult.success) {
        throw "Unable to generate full diff fallback: $($fullDiffResult.error)"
    }

    return [ordered]@{
        text = $fullDiffResult.text
        source = 'git'
    }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-ProjectRoot
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
$gitRepoRoot = Resolve-GitRootPath -RepoRootPath $RepoRoot

$resolvedPreflightPath = Resolve-PathInsideRepo -PathValue $PreflightPath -RepoRootPath $RepoRoot
$resolvedPathsConfigPath = Resolve-PathInsideRepo -PathValue $PathsConfigPath -RepoRootPath $RepoRoot
$resolvedOutputPath = Resolve-OutputPath -ExplicitOutputPath $OutputPath -ResolvedPreflightPath $resolvedPreflightPath -ReviewTypeValue $ReviewType -RepoRootPath $RepoRoot
$resolvedFullDiffPath = if ([string]::IsNullOrWhiteSpace($FullDiffPath)) { $null } else { Resolve-PathInsideRepo -PathValue $FullDiffPath -RepoRootPath $RepoRoot -AllowMissing }

$preflight = Get-Content -LiteralPath $resolvedPreflightPath -Raw | ConvertFrom-Json
$changedFiles = @()
if ($null -ne $preflight.PSObject.Properties['changed_files']) {
    $changedFiles = Convert-ToStringArray $preflight.changed_files
}
$normalizedChangedFiles = @($changedFiles | ForEach-Object { $_.Replace('\', '/') } | Sort-Object -Unique)

$pathsConfig = Get-Content -LiteralPath $resolvedPathsConfigPath -Raw | ConvertFrom-Json
$triggerRegexes = @()
if ($null -ne $pathsConfig.PSObject.Properties['triggers']) {
    $triggerContainer = $pathsConfig.triggers
    if ($null -ne $triggerContainer.PSObject.Properties[$ReviewType]) {
        $triggerRegexes = Convert-ToStringArray $triggerContainer.$ReviewType
    }
}
if ($triggerRegexes.Count -eq 0) {
    throw "No trigger regexes found for review type '$ReviewType' in $resolvedPathsConfigPath"
}

$matchedFilesList = New-Object System.Collections.Generic.List[string]
foreach ($filePath in $normalizedChangedFiles) {
    if (Test-MatchAnyRegex -PathValue $filePath -Regexes $triggerRegexes) {
        $matchedFilesList.Add($filePath)
    }
}
$matchedFiles = @($matchedFilesList | Sort-Object -Unique)

$scopedDiffText = ''
$fallbackToFullDiff = $false
$fullDiffSource = 'none'

if ($matchedFiles.Count -gt 0) {
    $gitPathspecs = Convert-ToGitPathspecs -Pathspecs $matchedFiles -RepoRootPath $RepoRoot -GitRootPath $gitRepoRoot
    $scopedDiffResult = Try-GetGitDiff -RepoRootPath $gitRepoRoot -UseStagedDiff $UseStaged.IsPresent -Pathspecs $gitPathspecs
    if ($scopedDiffResult.success -and -not [string]::IsNullOrWhiteSpace($scopedDiffResult.text)) {
        $scopedDiffText = $scopedDiffResult.text
    } else {
        Write-Warning "Scoped diff generation failed for review '$ReviewType'. Falling back to full diff. Error: $($scopedDiffResult.error)"
        $fallbackToFullDiff = $true
    }
} else {
    $fallbackToFullDiff = $true
}

$outputDiffText = $scopedDiffText
if ($fallbackToFullDiff) {
    $fullDiff = Get-FullDiffText -ResolvedFullDiffPath $resolvedFullDiffPath -RepoRootPath $gitRepoRoot -UseStagedDiff $UseStaged.IsPresent
    $outputDiffText = [string]$fullDiff.text
    $fullDiffSource = [string]$fullDiff.source
}

Ensure-ParentDirectory -PathValue $resolvedOutputPath
Set-Content -LiteralPath $resolvedOutputPath -Value ([string]$outputDiffText)

$result = [ordered]@{
    review_type = $ReviewType
    preflight_path = Normalize-Path $resolvedPreflightPath
    paths_config_path = Normalize-Path $resolvedPathsConfigPath
    output_path = Normalize-Path $resolvedOutputPath
    git_repo_root = Normalize-Path $gitRepoRoot
    full_diff_path = Normalize-Path $resolvedFullDiffPath
    full_diff_source = $fullDiffSource
    use_staged = [bool]$UseStaged
    matched_files_count = $matchedFiles.Count
    matched_files = $matchedFiles
    fallback_to_full_diff = $fallbackToFullDiff
    scoped_diff_line_count = Get-LineCount -Text $scopedDiffText
    output_diff_line_count = Get-LineCount -Text $outputDiffText
}

Write-Output 'SCOPED_DIFF_READY'
Write-Output "ReviewType: $ReviewType"
Write-Output "MatchedFilesCount: $($matchedFiles.Count)"
Write-Output "FallbackToFullDiff: $($fallbackToFullDiff.ToString().ToLowerInvariant())"
Write-Output "OutputPath: $(Normalize-Path $resolvedOutputPath)"
Write-Output ($result | ConvertTo-Json -Depth 10)
