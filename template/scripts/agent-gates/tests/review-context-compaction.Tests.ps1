#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
<#
.SYNOPSIS
Regression tests for T-009 review-context compaction helpers.

.DESCRIPTION
Validates that the PowerShell review-context builder writes a sanitized markdown
snapshot when token economy compaction is active and that compact reviewer
artifact auditing emits non-blocking warnings for oversized reviewer output.

Run:
    Invoke-Pester template/scripts/agent-gates/tests/review-context-compaction.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
    $script:GateUtilsModulePath = Join-Path $PSScriptRoot '..' 'lib' 'gate-utils.psm1'
    Import-Module $script:GateUtilsModulePath -Force

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

    function script:New-TempRepo {
        $repoPath = Join-Path ([System.IO.Path]::GetTempPath()) ("oa-review-context-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -Path $repoPath -ItemType Directory -Force | Out-Null
        return $repoPath
    }
}

Describe 'build-review-context PowerShell helper' {
    It 'writes sanitized markdown rule-context artifact when token economy compaction is active' {
        $repoPath = New-TempRepo
        try {
            Write-Utf8File -Path (Join-Path $repoPath 'runtime\reviews\T-009-preflight.json') -Content (@{
                    required_reviews = @{
                        code = $true
                    }
                } | ConvertTo-Json -Depth 5)
            Write-Utf8File -Path (Join-Path $repoPath 'config\token-economy.json') -Content (@{
                    enabled = $true
                    enabled_depths = @(1)
                    strip_examples = $true
                    strip_code_blocks = $true
                    scoped_diffs = $true
                    compact_reviewer_output = $true
                    fail_tail_lines = 20
                } | ConvertTo-Json -Depth 5)
            Write-Utf8File -Path (Join-Path $repoPath 'live\docs\agent-rules\00-core.md') -Content @'
# Core Rule

Always keep these instructions.

Examples:
```text
bad example payload
```

Keep this paragraph.
'@
            Write-Utf8File -Path (Join-Path $repoPath 'live\docs\agent-rules\80-task-workflow.md') -Content @'
# Workflow

Stay deterministic.
'@

            $outputPath = Join-Path $repoPath 'runtime\reviews\T-009-code-review-context.json'
            $scriptPath = Join-Path $script:RepoRoot 'template\scripts\agent-gates\build-review-context.ps1'
            $null = & pwsh -File $scriptPath `
                -ReviewType 'code' `
                -Depth 1 `
                -PreflightPath 'runtime\reviews\T-009-preflight.json' `
                -TokenEconomyConfigPath 'config\token-economy.json' `
                -OutputPath $outputPath `
                -RepoRoot $repoPath 2>&1

            if ($LASTEXITCODE -ne 0) {
                throw 'build-review-context.ps1 failed.'
            }

            $context = Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
            $context.rule_context.artifact_path | Should -Not -BeNullOrEmpty
            $context.rule_context.strip_examples_applied | Should -BeTrue
            $context.rule_context.strip_code_blocks_applied | Should -BeTrue
            $context.rule_context.source_files[0].removed_example_labels | Should -BeGreaterThan 0
            $context.rule_context.source_files[0].removed_code_blocks | Should -BeGreaterThan 0

            $markdownPath = $context.rule_context.artifact_path -replace '/', '\'
            Test-Path -LiteralPath $markdownPath | Should -BeTrue

            $markdown = Get-Content -LiteralPath $markdownPath -Raw -Encoding UTF8
            $markdown | Should -Match 'Example content omitted due to token economy'
            $markdown | Should -Match 'Code block omitted due to token economy'
            $markdown | Should -Not -Match 'bad example payload'
        }
        finally {
            if (Test-Path -LiteralPath $repoPath) {
                Remove-Item -LiteralPath $repoPath -Recurse -Force
            }
        }
    }
}

Describe 'Test-GateReviewArtifactCompaction' {
    It 'warns when compact reviewer output exceeds token-economy budgets' {
        $lines = 1..140 | ForEach-Object { "Line $_" }
        $content = (@($lines) + 'Examples:' + '```text' + 'payload' + '```') -join "`n"
        $reviewContext = @{
            token_economy_active = $true
            token_economy = @{
                active = $true
                flags = @{
                    compact_reviewer_output = $true
                    strip_examples = $true
                    fail_tail_lines = 10
                }
            }
        }

        $result = Test-GateReviewArtifactCompaction -ArtifactPath 'runtime/reviews/T-009-code.md' -Content $content -ReviewContext $reviewContext

        $result.expected | Should -BeTrue
        $result.warning_count | Should -BeGreaterThan 0
        ($result.warnings -join "`n") | Should -Match 'compact line budget'
        ($result.warnings -join "`n") | Should -Match 'example markers'
    }
}
