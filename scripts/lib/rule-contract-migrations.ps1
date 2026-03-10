$script:RuleContractMigrationDefinitions = @(
    @{
        Id = 'commands-required-review-gate-snippets'
        FilePattern = '(^|/)40-commands\.md$'
        TargetRelativePaths = @(
            'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md'
        )
        SectionTitle = '## Contract Compatibility Snippets (Auto-added by init/update)'
        IntroLine = '- Added by migration to satisfy required review-gate command contract during upgrade.'
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
                Match = 'required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"'
                Insert = 'pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -CodeReviewVerdict "<verdict>" -DbReviewVerdict "<verdict>" -SecurityReviewVerdict "<verdict>" -RefactorReviewVerdict "<verdict>" -ApiReviewVerdict "<verdict>" -TestReviewVerdict "<verdict>" -PerformanceReviewVerdict "<verdict>" -InfraReviewVerdict "<verdict>" -DependencyReviewVerdict "<verdict>"'
            },
            @{
                Match = 'required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"'
                Insert = 'bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"'
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
                Match = 'Compile gate script must pass before `IN_REVIEW`:'
                Insert = 'Compile gate script must pass before `IN_REVIEW`:'
            },
            @{
                Match = 'Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.'
                Insert = 'Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.'
            },
            @{
                Match = 'Do you want me to commit now? (yes/no)'
                Insert = 'Do you want me to commit now? (yes/no)'
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

    $matches = @()
    foreach ($migration in @($script:RuleContractMigrationDefinitions)) {
        $pattern = [string]$migration.FilePattern
        if ([string]::IsNullOrWhiteSpace($pattern)) {
            continue
        }

        if ($normalizedPath -match $pattern) {
            $matches += $migration
        }
    }

    return $matches
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
