<#
.SYNOPSIS
    Shared utility functions for Octopus Agent Orchestrator control-plane scripts.
.DESCRIPTION
    Dot-source this file at the top of each control-plane script to avoid
    duplicating path-resolution, boolean-parsing, and entrypoint-map logic.
#>

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    $fullPath = [System.IO.Path]::GetFullPath($PathValue)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    if (-not [string]::IsNullOrWhiteSpace($rootPath) -and [string]::Equals($fullPath, $rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }

    return $fullPath.TrimEnd('\', '/')
}

function Test-IsPathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath
    )

    $rootFull = Get-NormalizedPath -PathValue $RootPath
    $candidateFull = Get-NormalizedPath -PathValue $CandidatePath
    if ([string]::Equals($rootFull, $candidateFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    $rootWithSeparator = if ($rootFull.EndsWith('\') -or $rootFull.EndsWith('/')) {
        $rootFull
    } else {
        $rootFull + [System.IO.Path]::DirectorySeparatorChar
    }
    return $candidateFull.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-PathInsideRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [switch]$RequireFile
    )

    $candidatePath = $PathValue
    if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
        $candidatePath = Join-Path $RootPath $candidatePath
    }

    $candidatePath = [System.IO.Path]::GetFullPath($candidatePath)
    if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $candidatePath)) {
        throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $candidatePath"
    }

    if ($RequireFile -and -not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
        throw "$Label file not found: $candidatePath"
    }

    if ($RequireFile) {
        $resolvedCandidatePath = (Resolve-Path -LiteralPath $candidatePath).Path
        if (-not (Test-IsPathInsideRoot -RootPath $RootPath -CandidatePath $resolvedCandidatePath)) {
            throw "$Label must resolve inside TargetRoot '$RootPath'. Resolved path: $resolvedCandidatePath"
        }

        return $resolvedCandidatePath
    }

    return $candidatePath
}

function Get-InitAnswerValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$LogicalName
    )

    $targetKey = $LogicalName.ToLowerInvariant().Replace('_', '').Replace('-', '')
    foreach ($property in $Answers.PSObject.Properties) {
        $propertyKey = $property.Name.ToLowerInvariant().Replace('_', '').Replace('-', '')
        if ($propertyKey -eq $targetKey) {
            if ($null -eq $property.Value) {
                return $null
            }
            return [string]$property.Value
        }
    }

    return $null
}

function Convert-ToBooleanAnswer {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [AllowNull()]
        [object]$DefaultValue = $null
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        if ($null -eq $DefaultValue) {
            throw "$FieldName must not be empty."
        }
        return [bool]$DefaultValue
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    switch ($normalized) {
        '1' { return $true }
        '0' { return $false }
        'true' { return $true }
        'false' { return $false }
        'yes' { return $true }
        'no' { return $false }
        'y' { return $true }
        'n' { return $false }
        'да' { return $true }
        'нет' { return $false }
        default {
            throw "Init answers artifact has unsupported $FieldName '$Value'. Allowed values: true, false, yes, no, 1, 0."
        }
    }
}

function Get-SourceToEntrypointMap {
    return @{
        'CLAUDE'        = 'CLAUDE.md'
        'CODEX'         = 'AGENTS.md'
        'GEMINI'        = 'GEMINI.md'
        'GITHUBCOPILOT' = '.github/copilot-instructions.md'
        'WINDSURF'      = '.windsurf/rules/rules.md'
        'JUNIE'         = '.junie/guidelines.md'
        'ANTIGRAVITY'   = '.antigravity/rules.md'
    }
}
