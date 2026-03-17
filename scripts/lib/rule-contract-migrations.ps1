$script:RuleContractMigrationDefinitions = @(
    @{
        Id = 'commands-required-review-gate-snippets'
        FilePattern = '(^|/)40-commands\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy required review/completion gate command contract during upgrade.'
        Entries = @(
            @{
                Match = '### Compile Gate (Mandatory)'
                Insert = @'
### Compile Gate (Mandatory)
```bash
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1 -TaskId "<task-id>" -CommandsPath "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
```
'@
                InsertMode = 'block'
            },
            @{
                Match = 'compile-gate.ps1'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1 -TaskId "<task-id>" -CommandsPath "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"'
            },
            @{
                Match = 'compile-gate.sh'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"'
            },
            @{
                Match = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "<task-id>"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "<task-id>"'
                InsertMode = 'line'
            },
            @{
                Match = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"'
                InsertMode = 'line'
            },
            @{
                Match = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1 -ReviewType "<db|security|refactor>" -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" -MetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1 -ReviewType "<db|security|refactor>" -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" -MetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"'
                InsertMode = 'line'
            },
            @{
                Match = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh --review-type "<db|security|refactor>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh --review-type "<db|security|refactor>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"'
                InsertMode = 'line'
            },
            @{
                Match = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1 -ReviewType "<code|db|security|refactor|api|test|performance|infra|dependency>" -Depth <1|2|3> -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -ScopedDiffMetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1 -ReviewType "<code|db|security|refactor|api|test|performance|infra|dependency>" -Depth <1|2|3> -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -ScopedDiffMetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"'
                InsertMode = 'line'
            },
            @{
                Match = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh --review-type "<code|db|security|refactor|api|test|performance|infra|dependency>" --depth <1|2|3> --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh --review-type "<code|db|security|refactor|api|test|performance|infra|dependency>" --depth <1|2|3> --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"'
                InsertMode = 'line'
            },
            @{
                Match = 'required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -CodeReviewVerdict "<verdict>" -DbReviewVerdict "<verdict>" -SecurityReviewVerdict "<verdict>" -RefactorReviewVerdict "<verdict>" -ApiReviewVerdict "<verdict>" -TestReviewVerdict "<verdict>" -PerformanceReviewVerdict "<verdict>" -InfraReviewVerdict "<verdict>" -DependencyReviewVerdict "<verdict>"'
            },
            @{
                Match = 'required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"'
            },
            @{
                Match = 'doc-impact-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -Decision "NO_DOC_UPDATES" -BehaviorChanged $false -ChangelogUpdated $false -Rationale "No behavior/contract/ops-doc impact."'
                InsertMode = 'line'
            },
            @{
                Match = 'doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --rationale "No behavior/contract/ops-doc impact."'
                InsertMode = 'line'
            },
            @{
                Match = 'completion-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"'
                InsertMode = 'line'
            },
            @{
                Match = 'completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'task-workflow-reviewer-linkage-snippets'
        FilePattern = '(^|/)80-task-workflow\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy reviewer execution linkage contract during upgrade.'
        Entries = @(
            @{
                Match = 'Reviewer-agent execution mechanics are defined in `orchestration/SKILL.md` section `Reviewer Agent Execution (Claude Code)`.'
                Insert = 'Reviewer-agent execution mechanics are defined in `orchestration/SKILL.md` section `Reviewer Agent Execution (Claude Code)`.'
            },
            @{
                Match = '## Task Resume Protocol'
                Insert = '## Task Resume Protocol'
                InsertMode = 'line'
            },
            @{
                Match = 'Compile gate script must pass before `IN_REVIEW`:'
                Insert = 'Compile gate script must pass before `IN_REVIEW`:'
            },
            @{
                Match = 'Completion gate script must pass before `DONE`:'
                Insert = 'Completion gate script must pass before `DONE`:'
                InsertMode = 'line'
            },
            @{
                Match = 'Documentation impact gate script must pass before `DONE`:'
                Insert = 'Documentation impact gate script must pass before `DONE`:'
                InsertMode = 'line'
            },
            @{
                Match = 'Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.'
                Insert = 'Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.'
            },
            @{
                Match = 'Do you want me to commit now? (yes/no)'
                Insert = 'Do you want me to commit now? (yes/no)'
            },
            @{
                Match = 'HARD STOP: do not set `DONE` until completion gate is `COMPLETION_GATE_PASSED` and final user report is delivered in mandatory order.'
                Insert = 'HARD STOP: do not set `DONE` until completion gate is `COMPLETION_GATE_PASSED` and final user report is delivered in mandatory order.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'strict-coding-orchestrator-git-boundary-snippets'
        FilePattern = '(^|/)35-strict-coding-rules\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy ignored orchestrator git-boundary contract during upgrade.'
        Entries = @(
            @{
                Match = 'this internal changelog is local orchestration evidence and may stay gitignored; update it on disk, but do not use `git add -f` unless the user explicitly asks to version orchestrator internals.'
                Insert = 'In normal deployed workspaces, this internal changelog is local orchestration evidence and may stay gitignored; update it on disk, but do not use `git add -f` unless the user explicitly asks to version orchestrator internals.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'commands-orchestrator-git-boundary-snippets'
        FilePattern = '(^|/)40-commands\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy ignored orchestrator git-boundary command contract during upgrade.'
        Entries = @(
            @{
                Match = 'Do not use `git add -f` for ignored orchestration control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`); their absence from staged diff is expected.'
                Insert = 'Do not use `git add -f` for ignored orchestration control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`); their absence from staged diff is expected.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'structure-docs-orchestrator-git-boundary-snippets'
        FilePattern = '(^|/)50-structure-and-docs\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy ignored orchestrator git-boundary documentation contract during upgrade.'
        Entries = @(
            @{
                Match = '## Orchestrator Git Boundary'
                Insert = '## Orchestrator Git Boundary'
                InsertMode = 'line'
            },
            @{
                Match = 'Their absence from `git status`, staged diff, or PR scope is normal and must not be treated as a workflow failure.'
                Insert = 'Their absence from `git status`, staged diff, or PR scope is normal and must not be treated as a workflow failure.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'operating-rules-orchestrator-git-boundary-snippets'
        FilePattern = '(^|/)60-operating-rules\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy ignored orchestrator git-boundary operating contract during upgrade.'
        Entries = @(
            @{
                Match = 'Never use `git add -f` / `git add --force` to stage ignored orchestration files just to satisfy gates or documentation bookkeeping.'
                Insert = 'Never use `git add -f` / `git add --force` to stage ignored orchestration files just to satisfy gates or documentation bookkeeping.'
                InsertMode = 'line'
            },
            @{
                Match = 'If doc-impact or audit trail requires updates to ignored orchestrator files, write them on disk and continue without expanding the project commit scope unless the user explicitly asks for it.'
                Insert = 'If doc-impact or audit trail requires updates to ignored orchestrator files, write them on disk and continue without expanding the project commit scope unless the user explicitly asks for it.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'task-workflow-orchestrator-git-boundary-snippets'
        FilePattern = '(^|/)80-task-workflow\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy ignored orchestrator git-boundary workflow contract during upgrade.'
        Entries = @(
            @{
                Match = 'Required changelog or evidence updates to ignored orchestrator paths must stay local on disk; do not use `git add -f` unless the user explicitly requests versioning orchestrator internals.'
                Insert = 'Required changelog or evidence updates to ignored orchestrator paths must stay local on disk; do not use `git add -f` unless the user explicitly requests versioning orchestrator internals.'
                InsertMode = 'line'
            },
            @{
                Match = 'HARD STOP: do not force-stage ignored orchestration control-plane files just because gates, changelog, or reviews reference them.'
                Insert = 'HARD STOP: do not force-stage ignored orchestration control-plane files just because gates, changelog, or reviews reference them.'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'task-workflow-token-savings-summary-snippets'
        FilePattern = '(^|/)80-task-workflow\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy token-savings summary formatting contract during upgrade.'
        Entries = @(
            @{
                Match = 'If the implementation summary mentions token-economy savings, include approximate percentage when baseline is known and keep spaced breakdown formatting: `Saved tokens: ~882 (~67%) (824 code review context + 25 DB review context + 33 compile gate output).`'
                Insert = 'If the implementation summary mentions token-economy savings, include approximate percentage when baseline is known and keep spaced breakdown formatting: `Saved tokens: ~882 (~67%) (824 code review context + 25 DB review context + 33 compile gate output).`'
                InsertMode = 'line'
            }
        )
    },
    @{
        Id = 'core-finalization-reminder-snippets'
        FilePattern = '(^|/)00-core\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy finalization reminder contract during upgrade.'
        Entries = @(
            @{
                Match = 'Task completion always ends with: implementation summary, suggested `git commit -m "<message>"`, and explicit `Do you want me to commit now? (yes/no)` question (see `80-task-workflow.md`, Mandatory Gate Contract).'
                Insert = 'Task completion always ends with: implementation summary, suggested `git commit -m "<message>"`, and explicit `Do you want me to commit now? (yes/no)` question (see `80-task-workflow.md`, Mandatory Gate Contract).'
                InsertMode = 'line'
            }
        )
    }
)

function ConvertTo-NormalizedRelativePath {
    param(
        [AllowNull()]
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $normalized = $PathValue.Replace('\', '/').Trim()
    while ($normalized.StartsWith('./')) {
        $normalized = $normalized.Substring(2)
    }

    return $normalized.TrimStart('/')
}

function Get-RuleContractMigrationDefinitions {
    return @($script:RuleContractMigrationDefinitions)
}

function Get-RuleContractMigrationsForPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalizedPath = ConvertTo-NormalizedRelativePath -PathValue $RelativePath
    if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
        return @()
    }

    $matchingMigrations = New-Object System.Collections.ArrayList
    foreach ($migration in @($script:RuleContractMigrationDefinitions)) {
        $pattern = [string]$migration.FilePattern
        if ([string]::IsNullOrWhiteSpace($pattern)) {
            continue
        }

        if ($normalizedPath -match $pattern) {
            [void]$matchingMigrations.Add([object]$migration)
        }
    }

    return $matchingMigrations.ToArray()
}

function Invoke-RuleContractMigrationsForContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalizedPath = ConvertTo-NormalizedRelativePath -PathValue $RelativePath
    if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
        return [PSCustomObject]@{
            Content = $Content
            AppliedCount = 0
            AppliedEntries = @()
            FilePath = $RelativePath
        }
    }

    $migrations = @(Get-RuleContractMigrationsForPath -RelativePath $normalizedPath)
    if ($migrations.Count -eq 0) {
        return [PSCustomObject]@{
            Content = $Content
            AppliedCount = 0
            AppliedEntries = @()
            FilePath = $normalizedPath
        }
    }

    $updated = [string]$Content
    $appliedEntries = @()

    foreach ($migration in $migrations) {
        $entries = @($migration.Entries)
        if ($entries.Count -eq 0) {
            continue
        }

        $missingEntries = @()
        foreach ($entry in $entries) {
            $matchSnippet = [string]$entry.Match
            if ([string]::IsNullOrWhiteSpace($matchSnippet)) {
                continue
            }

            if ($updated -notmatch [regex]::Escape($matchSnippet)) {
                $missingEntries += $entry
            }
        }

        if ($missingEntries.Count -eq 0) {
            continue
        }

        $sectionTitle = [string]$migration.SectionTitle
        if ([string]::IsNullOrWhiteSpace($sectionTitle)) {
            $sectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        }

        $introLine = [string]$migration.IntroLine
        $updated = $updated.TrimEnd()

        if ($updated -notmatch [regex]::Escape($sectionTitle)) {
            if ([string]::IsNullOrWhiteSpace($updated)) {
                $updated = $sectionTitle
            } else {
                $updated += "`r`n`r`n$sectionTitle"
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($introLine) -and $updated -notmatch [regex]::Escape($introLine)) {
            $updated += "`r`n$introLine"
        }

        foreach ($entry in $missingEntries) {
            $matchSnippet = [string]$entry.Match
            $insertSnippet = [string]$entry.Insert
            if ([string]::IsNullOrWhiteSpace($insertSnippet)) {
                $insertSnippet = $matchSnippet
            }
            if ([string]::IsNullOrWhiteSpace($insertSnippet)) {
                continue
            }

            $insertMode = [string]$entry.InsertMode
            if ([string]::IsNullOrWhiteSpace($insertMode)) {
                $insertMode = 'bullet'
            }
            $insertMode = $insertMode.Trim().ToLowerInvariant()

            if ($updated -notmatch [regex]::Escape($insertSnippet)) {
                switch ($insertMode) {
                    'block' {
                        $blockText = $insertSnippet.Trim()
                        if ([string]::IsNullOrWhiteSpace($blockText)) {
                            break
                        }

                        if ([string]::IsNullOrWhiteSpace($updated)) {
                            $updated = $blockText
                        } else {
                            $updated += "`r`n`r`n$blockText"
                        }
                    }
                    'line' {
                        $updated += "`r`n$insertSnippet"
                    }
                    default {
                        $updated += "`r`n- $insertSnippet"
                    }
                }
            }

            $appliedEntries += [PSCustomObject]@{
                FilePath = $normalizedPath
                MigrationId = [string]$migration.Id
                Match = $matchSnippet
                Insert = $insertSnippet
            }
        }
    }

    if ($appliedEntries.Count -eq 0) {
        return [PSCustomObject]@{
            Content = $Content
            AppliedCount = 0
            AppliedEntries = @()
            FilePath = $normalizedPath
        }
    }

    return [PSCustomObject]@{
        Content = ($updated + "`r`n")
        AppliedCount = $appliedEntries.Count
        AppliedEntries = $appliedEntries
        FilePath = $normalizedPath
    }
}

function Invoke-RuleContractMigrationsOnDisk {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [string[]]$RelativePaths,
        [switch]$DryRun
    )

    $candidatePaths = @()
    if ($null -ne $RelativePaths -and $RelativePaths.Count -gt 0) {
        foreach ($pathValue in $RelativePaths) {
            $normalized = ConvertTo-NormalizedRelativePath -PathValue $pathValue
            if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                $candidatePaths += $normalized
            }
        }
    } else {
        foreach ($migration in @($script:RuleContractMigrationDefinitions)) {
            foreach ($pathValue in @($migration.TargetRelativePaths)) {
                $normalized = ConvertTo-NormalizedRelativePath -PathValue ([string]$pathValue)
                if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                    $candidatePaths += $normalized
                }
            }
        }
    }
    $candidatePaths = @($candidatePaths | Sort-Object -Unique)

    $appliedEntries = @()
    foreach ($relativePath in $candidatePaths) {
        $fullPath = Join-Path $RootPath $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            continue
        }

        $content = Get-Content -LiteralPath $fullPath -Raw
        $migrationResult = Invoke-RuleContractMigrationsForContent -Content $content -RelativePath $relativePath
        if ($migrationResult.AppliedCount -eq 0) {
            continue
        }

        if (-not $DryRun) {
            Set-Content -LiteralPath $fullPath -Value $migrationResult.Content
        }

        foreach ($entry in @($migrationResult.AppliedEntries)) {
            $appliedEntries += $entry
        }
    }

    $appliedFiles = @()
    if ($appliedEntries.Count -gt 0) {
        $appliedFiles = @($appliedEntries | Select-Object -ExpandProperty FilePath -Unique | Sort-Object)
    }

    return [PSCustomObject]@{
        AppliedCount = $appliedEntries.Count
        AppliedEntries = $appliedEntries
        AppliedFiles = $appliedFiles
    }
}
