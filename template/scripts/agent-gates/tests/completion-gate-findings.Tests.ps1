#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
<#
.SYNOPSIS
Regression tests for T-015 findings-resolution enforcement in completion-gate.ps1.

.DESCRIPTION
Validates that completion-gate.ps1 refuses to pass when a PASS review artifact still
contains active findings or residual risks, and only allows completion when those
items are cleared or explicitly deferred with a usable Justification entry.

.RUN
    Invoke-Pester template/scripts/agent-gates/tests/completion-gate-findings.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
    $script:TempRoots = [System.Collections.Generic.List[string]]::new()

    function script:Write-Utf8File {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,
            [Parameter(Mandatory = $true)]
            [string]$Content
        )

        $parentDirectory = Split-Path -Parent $Path
        if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory -PathType Container)) {
            New-Item -Path $parentDirectory -ItemType Directory -Force | Out-Null
        }

        $encoding = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($Path, $Content, $encoding)
    }

    function script:Write-JsonFile {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,
            [Parameter(Mandatory = $true)]
            [object]$Value
        )

        Write-Utf8File -Path $Path -Content (($Value | ConvertTo-Json -Depth 20) + "`n")
    }

    function script:Write-JsonLinesFile {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,
            [Parameter(Mandatory = $true)]
            [object[]]$Objects
        )

        $lines = @($Objects | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 20 })
        Write-Utf8File -Path $Path -Content (($lines -join "`n") + "`n")
    }

    function script:Convert-ToUnixPath {
        param([Parameter(Mandatory = $true)][string]$Path)

        return $Path.Replace('\', '/')
    }

    function script:New-CompletionGateWorkspace {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("oa-completion-gate-" + [System.Guid]::NewGuid().ToString('N'))
        $workspaceRoot = Join-Path $tempRoot 'workspace'
        $bundleRoot = Join-Path $workspaceRoot 'Octopus-agent-orchestrator'

        New-Item -Path (Join-Path $bundleRoot 'live\scripts\agent-gates\lib') -ItemType Directory -Force | Out-Null
        New-Item -Path (Join-Path $bundleRoot 'live\config') -ItemType Directory -Force | Out-Null

        Copy-Item -LiteralPath (Join-Path $script:RepoRoot 'template\scripts\agent-gates\completion-gate.ps1') -Destination (Join-Path $bundleRoot 'live\scripts\agent-gates\completion-gate.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $script:RepoRoot 'template\scripts\agent-gates\lib\gate-utils.psm1') -Destination (Join-Path $bundleRoot 'live\scripts\agent-gates\lib\gate-utils.psm1') -Force

        $script:TempRoots.Add($tempRoot) | Out-Null
        return [PSCustomObject]@{
            TempRoot      = $tempRoot
            WorkspaceRoot = $workspaceRoot
            BundleRoot    = $bundleRoot
        }
    }

    function script:New-CodeReviewArtifact {
        param(
            [string[]]$LowFindings = @(),
            [string[]]$ResidualRisks = @(),
            [string[]]$DeferredFindings = @()
        )

        $lowLines = if (@($LowFindings).Count -gt 0) {
            @('- Low:') + @($LowFindings | ForEach-Object { "  - $_" })
        } else {
            @('- Low: `none`')
        }

        $deferredLines = if (@($DeferredFindings).Count -gt 0) {
            @($DeferredFindings | ForEach-Object { "- $_" })
        } else {
            @('- `none`')
        }

        $residualLines = if (@($ResidualRisks).Count -gt 0) {
            @($ResidualRisks | ForEach-Object { "- $_" })
        } else {
            @('- `none`')
        }

        $lines = @(
            '# Review Artifact',
            '',
            '## Metadata',
            '- Task ID: T-015',
            '- Review Type: CODE_REVIEW',
            '',
            '## Findings by Severity',
            '- Critical: `none`',
            '- High: `none`',
            '- Medium: `none`'
        ) + $lowLines + @(
            '',
            '## Deferred Findings'
        ) + $deferredLines + @(
            '',
            '## Rule Checklist',
            '| rule_id | status | evidence |',
            '|---|---|---|',
            '| core | PASS | fixture |',
            '',
            '## Rule Coverage',
            '- applicable_rule_ids: core',
            '- not_applicable_rule_ids: none',
            '- skipped_rule_reasons: none',
            '',
            '## Residual Risks'
        ) + $residualLines + @(
            '',
            '## Verdict',
            '- `REVIEW PASSED`',
            ''
        )

        return ($lines -join "`n")
    }

    function script:Initialize-CompletionGateFixture {
        param(
            [Parameter(Mandatory = $true)]
            [string]$WorkspaceRoot,
            [Parameter(Mandatory = $true)]
            [string]$ReviewArtifactContent,
            [string]$TaskId = 'T-015'
        )

        $bundleRoot = Join-Path $WorkspaceRoot 'Octopus-agent-orchestrator'
        $preflightPath = Join-Path $bundleRoot "runtime\reviews\$TaskId-preflight.json"
        $compileEvidencePath = Join-Path $bundleRoot "runtime\reviews\$TaskId-compile-gate.json"
        $reviewEvidencePath = Join-Path $bundleRoot "runtime\reviews\$TaskId-review-gate.json"
        $docImpactPath = Join-Path $bundleRoot "runtime\reviews\$TaskId-doc-impact.json"
        $timelinePath = Join-Path $bundleRoot "runtime\task-events\$TaskId.jsonl"
        $reviewArtifactPath = Join-Path $bundleRoot "runtime\reviews\$TaskId-code.md"

        $requiredReviews = [ordered]@{
            code = $true
            db = $false
            security = $false
            refactor = $false
            api = $false
            test = $false
            performance = $false
            infra = $false
            dependency = $false
        }
        Write-JsonFile -Path $preflightPath -Value ([ordered]@{
                task_id = $TaskId
                required_reviews = $requiredReviews
            })

        $preflightHash = (Get-FileHash -LiteralPath $preflightPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $preflightUnix = Convert-ToUnixPath -Path $preflightPath

        Write-JsonFile -Path $compileEvidencePath -Value ([ordered]@{
                task_id = $TaskId
                event_source = 'compile-gate'
                status = 'PASSED'
                outcome = 'PASS'
                preflight_path = $preflightUnix
                preflight_hash_sha256 = $preflightHash
            })
        $compileHash = (Get-FileHash -LiteralPath $compileEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $compileUnix = Convert-ToUnixPath -Path $compileEvidencePath

        Write-JsonFile -Path $reviewEvidencePath -Value ([ordered]@{
                task_id = $TaskId
                event_source = 'required-reviews-check'
                status = 'PASSED'
                outcome = 'PASS'
                preflight_path = $preflightUnix
                preflight_hash_sha256 = $preflightHash
                compile_evidence_path = $compileUnix
                compile_evidence_hash_sha256 = $compileHash
            })

        Write-JsonFile -Path $docImpactPath -Value ([ordered]@{
                task_id = $TaskId
                event_source = 'doc-impact-gate'
                status = 'PASSED'
                outcome = 'PASS'
                preflight_path = $preflightUnix
                preflight_hash_sha256 = $preflightHash
                decision = 'NO_DOC_UPDATES'
                rationale = 'No behavior changes for this fixture.'
                behavior_changed = $false
                changelog_updated = $false
                docs_updated = @()
            })

        Write-JsonLinesFile -Path $timelinePath -Objects @(
            [ordered]@{
                task_id = $TaskId
                event_type = 'COMPILE_GATE_PASSED'
                outcome = 'PASS'
                message = 'Compile gate passed.'
            },
            [ordered]@{
                task_id = $TaskId
                event_type = 'REVIEW_GATE_PASSED'
                outcome = 'PASS'
                message = 'Review gate passed.'
            }
        )

        Write-Utf8File -Path $reviewArtifactPath -Content $ReviewArtifactContent
    }

    function script:Invoke-CompletionGate {
        param(
            [Parameter(Mandatory = $true)]
            [string]$WorkspaceRoot,
            [string]$TaskId = 'T-015'
        )

        $scriptPath = Join-Path $WorkspaceRoot 'Octopus-agent-orchestrator\live\scripts\agent-gates\completion-gate.ps1'
        $preflightPath = Join-Path $WorkspaceRoot "Octopus-agent-orchestrator\runtime\reviews\$TaskId-preflight.json"
        $output = & pwsh -NoProfile -File $scriptPath -PreflightPath $preflightPath -TaskId $TaskId 2>&1

        return [PSCustomObject]@{
            ExitCode = $LASTEXITCODE
            Output   = @($output | ForEach-Object { [string]$_ })
        }
    }
}

AfterAll {
    foreach ($tempRoot in $script:TempRoots) {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

Describe 'completion-gate.ps1 findings resolution enforcement' {
    It 'fails when a PASS artifact still contains active low findings' {
        $workspace = New-CompletionGateWorkspace
        Initialize-CompletionGateFixture -WorkspaceRoot $workspace.WorkspaceRoot -ReviewArtifactContent (New-CodeReviewArtifact -LowFindings @(
                'Docs follow-up remains open in src/example.ts:14'
            ))

        $result = Invoke-CompletionGate -WorkspaceRoot $workspace.WorkspaceRoot

        $result.ExitCode | Should -Be 1
        ($result.Output -join "`n") | Should -Match 'COMPLETION_GATE_FAILED'
        ($result.Output -join "`n") | Should -Match 'active Low findings'
    }

    It 'fails when a PASS artifact still contains residual risks' {
        $workspace = New-CompletionGateWorkspace
        Initialize-CompletionGateFixture -WorkspaceRoot $workspace.WorkspaceRoot -ReviewArtifactContent (New-CodeReviewArtifact -ResidualRisks @(
                'Follow-up validation is still pending for src/example.ts:14'
            ))

        $result = Invoke-CompletionGate -WorkspaceRoot $workspace.WorkspaceRoot

        $result.ExitCode | Should -Be 1
        ($result.Output -join "`n") | Should -Match 'COMPLETION_GATE_FAILED'
        ($result.Output -join "`n") | Should -Match 'active residual risks'
    }

    It 'fails when deferred findings omit a usable justification' {
        $workspace = New-CompletionGateWorkspace
        Initialize-CompletionGateFixture -WorkspaceRoot $workspace.WorkspaceRoot -ReviewArtifactContent (New-CodeReviewArtifact -DeferredFindings @(
                '[Low] Docs follow-up for src/example.ts:14'
            ))

        $result = Invoke-CompletionGate -WorkspaceRoot $workspace.WorkspaceRoot

        $result.ExitCode | Should -Be 1
        ($result.Output -join "`n") | Should -Match 'COMPLETION_GATE_FAILED'
        ($result.Output -join "`n") | Should -Match "usable 'Justification:'"
    }

    It 'passes when active findings are cleared and deferred findings are justified' {
        $workspace = New-CompletionGateWorkspace
        Initialize-CompletionGateFixture -WorkspaceRoot $workspace.WorkspaceRoot -ReviewArtifactContent (New-CodeReviewArtifact -DeferredFindings @(
                '[Low] Docs follow-up for src/example.ts:14 | Justification: Safe to defer because behavior is unchanged and the follow-up is tracked separately.'
            ))

        $result = Invoke-CompletionGate -WorkspaceRoot $workspace.WorkspaceRoot

        $result.ExitCode | Should -Be 0
        ($result.Output -join "`n") | Should -Match 'COMPLETION_GATE_PASSED'
    }

    It 'passes when the PASS artifact has no active findings or deferred items' {
        $workspace = New-CompletionGateWorkspace
        Initialize-CompletionGateFixture -WorkspaceRoot $workspace.WorkspaceRoot -ReviewArtifactContent (New-CodeReviewArtifact)

        $result = Invoke-CompletionGate -WorkspaceRoot $workspace.WorkspaceRoot

        $result.ExitCode | Should -Be 0
        ($result.Output -join "`n") | Should -Match 'COMPLETION_GATE_PASSED'
    }
}
