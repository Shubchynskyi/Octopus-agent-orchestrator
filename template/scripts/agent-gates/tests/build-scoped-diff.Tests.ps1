#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
<#
.SYNOPSIS
Regression tests for refactor scoped-diff support in the PowerShell helper.

.DESCRIPTION
Validates that both live and template build-scoped-diff.ps1 variants:
- scope refactor reviews to relevant code/config files when triggers match;
- deterministically fall back to the full diff when no refactor trigger matches.

Run:
    Invoke-Pester template/scripts/agent-gates/tests/build-scoped-diff.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path

    function script:Write-Utf8File {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,
            [Parameter(Mandatory = $true)]
            [string]$Content
        )

        $parentDirectory = Split-Path -Parent $Path
        if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
            New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
        }

        $encoding = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($Path, $Content, $encoding)
    }

    function script:Invoke-Git {
        param(
            [Parameter(Mandatory = $true)]
            [string]$RepoPath,
            [Parameter(Mandatory = $true)]
            [string[]]$Arguments
        )

        $output = & git -C $RepoPath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "git $($Arguments -join ' ') failed: $(@($output) -join [Environment]::NewLine)"
        }

        return @($output)
    }

    function script:New-TempGitRepo {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Variant
        )

        $repoPath = Join-Path ([System.IO.Path]::GetTempPath()) ("oa-scoped-diff-$Variant-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -Path $repoPath -ItemType Directory -Force | Out-Null

        Invoke-Git -RepoPath $repoPath -Arguments @('init') | Out-Null
        Invoke-Git -RepoPath $repoPath -Arguments @('config', 'user.name', 'Copilot Tests') | Out-Null
        Invoke-Git -RepoPath $repoPath -Arguments @('config', 'user.email', 'copilot-tests@example.com') | Out-Null

        $sourceConfigPath = Join-Path $script:RepoRoot "$Variant\config\paths.json"
        $targetConfigPath = Join-Path $repoPath 'config\paths.json'
        Write-Utf8File -Path $targetConfigPath -Content ([System.IO.File]::ReadAllText($sourceConfigPath))

        return $repoPath
    }

    function script:Commit-Baseline {
        param([string]$RepoPath)

        Invoke-Git -RepoPath $RepoPath -Arguments @('add', '.') | Out-Null
        Invoke-Git -RepoPath $RepoPath -Arguments @('commit', '-m', 'baseline') | Out-Null
    }

    function script:Invoke-ScopedDiff {
        param(
            [Parameter(Mandatory = $true)]
            [string]$RepoPath,
            [Parameter(Mandatory = $true)]
            [string]$Variant,
            [Parameter(Mandatory = $true)]
            [string[]]$ChangedFiles
        )

        $preflightPath = Join-Path $RepoPath 'runtime\reviews\T-008-preflight.json'
        $outputPath = Join-Path $RepoPath 'runtime\reviews\T-008-refactor-scoped.diff'
        $metadataPath = Join-Path $RepoPath 'runtime\reviews\T-008-refactor-scoped.json'
        $preflight = @{
            changed_files = $ChangedFiles
        } | ConvertTo-Json -Depth 10
        Write-Utf8File -Path $preflightPath -Content ($preflight + [Environment]::NewLine)

        $scriptPath = Join-Path $script:RepoRoot "$Variant\scripts\agent-gates\build-scoped-diff.ps1"
        $output = & pwsh -File $scriptPath `
            -ReviewType 'refactor' `
            -PreflightPath $preflightPath `
            -PathsConfigPath 'config\paths.json' `
            -OutputPath $outputPath `
            -MetadataPath $metadataPath `
            -RepoRoot $RepoPath 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "build-scoped-diff.ps1 failed for ${Variant}: $(@($output) -join [Environment]::NewLine)"
        }

        return [pscustomobject]@{
            Metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
            DiffText = Get-Content -LiteralPath $outputPath -Raw
        }
    }
}

Describe 'build-scoped-diff PowerShell helper' {
    It 'scopes refactor diffs to code and config files in <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoPath = New-TempGitRepo -Variant $Variant
        try {
            Write-Utf8File -Path (Join-Path $repoPath 'src\feature.py') -Content "def run():`n    return 'v1'`n"
            Write-Utf8File -Path (Join-Path $repoPath 'config\app-settings.json') -Content "{`n  `"mode`": `"v1`"`n}`n"
            Write-Utf8File -Path (Join-Path $repoPath 'docs\notes.md') -Content "# Notes`n`nBaseline.`n"
            Commit-Baseline -RepoPath $repoPath

            Write-Utf8File -Path (Join-Path $repoPath 'src\feature.py') -Content "def run():`n    return 'v2'`n"
            Write-Utf8File -Path (Join-Path $repoPath 'config\app-settings.json') -Content "{`n  `"mode`": `"v2`"`n}`n"
            Write-Utf8File -Path (Join-Path $repoPath 'docs\notes.md') -Content "# Notes`n`nUpdated doc only.`n"

            $result = Invoke-ScopedDiff -RepoPath $repoPath -Variant $Variant -ChangedFiles @(
                'src/feature.py',
                'config/app-settings.json',
                'docs/notes.md'
            )

            $result.Metadata.review_type | Should -Be 'refactor'
            $result.Metadata.fallback_to_full_diff | Should -BeFalse
            $result.Metadata.matched_files_count | Should -Be 2
            $result.Metadata.matched_files | Should -Contain 'src/feature.py'
            $result.Metadata.matched_files | Should -Contain 'config/app-settings.json'
            $result.Metadata.matched_files | Should -Not -Contain 'docs/notes.md'
            $result.DiffText | Should -Match 'diff --git a/src/feature.py b/src/feature.py'
            $result.DiffText | Should -Match 'diff --git a/config/app-settings.json b/config/app-settings.json'
            $result.DiffText | Should -Not -Match 'diff --git a/docs/notes.md b/docs/notes.md'
        }
        finally {
            if (Test-Path -LiteralPath $repoPath) {
                Remove-Item -LiteralPath $repoPath -Recurse -Force
            }
        }
    }

    It 'falls back to full diff when no refactor triggers match in <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoPath = New-TempGitRepo -Variant $Variant
        try {
            Write-Utf8File -Path (Join-Path $repoPath 'docs\notes.md') -Content "# Notes`n`nBaseline.`n"
            Commit-Baseline -RepoPath $repoPath

            Write-Utf8File -Path (Join-Path $repoPath 'docs\notes.md') -Content "# Notes`n`nFallback proof.`n"

            $result = Invoke-ScopedDiff -RepoPath $repoPath -Variant $Variant -ChangedFiles @('docs/notes.md')

            $result.Metadata.review_type | Should -Be 'refactor'
            $result.Metadata.fallback_to_full_diff | Should -BeTrue
            $result.Metadata.matched_files_count | Should -Be 0
            $result.DiffText | Should -Match 'diff --git a/docs/notes.md b/docs/notes.md'
        }
        finally {
            if (Test-Path -LiteralPath $repoPath) {
                Remove-Item -LiteralPath $repoPath -Recurse -Force
            }
        }
    }
}
