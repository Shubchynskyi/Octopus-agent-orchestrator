#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:TempRoots = [System.Collections.Generic.List[string]]::new()

    function script:New-WorkspaceCopy {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("octopus-uninstall-test-" + [Guid]::NewGuid().ToString('N'))
        $workspaceRoot = Join-Path $tempRoot 'workspace'
        $bundleRoot = Join-Path $workspaceRoot 'Octopus-agent-orchestrator'
        New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

        $trackedFiles = & git -C $repoRoot --no-pager ls-files
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to enumerate tracked files with git ls-files.'
        }

        $trackedFiles = @($trackedFiles + @(
            'scripts/uninstall.ps1',
            'scripts/uninstall.sh'
        )) | Sort-Object -Unique

        foreach ($relativePath in @($trackedFiles)) {
            if ([string]::IsNullOrWhiteSpace([string]$relativePath)) {
                continue
            }

            $sourcePath = Join-Path $repoRoot $relativePath
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                continue
            }

            $destinationPath = Join-Path $bundleRoot $relativePath
            $destinationParent = Split-Path -Parent $destinationPath
            if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
                New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
            }

            Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
        }

        $script:TempRoots.Add($tempRoot) | Out-Null
        return [PSCustomObject]@{
            TempRoot      = $tempRoot
            WorkspaceRoot = $workspaceRoot
            BundleRoot    = $bundleRoot
        }
    }

    function script:Write-InitAnswers {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,
            [Parameter(Mandatory = $true)]
            [string]$AssistantLanguage,
            [Parameter(Mandatory = $true)]
            [ValidateSet('concise', 'detailed')]
            [string]$AssistantBrevity,
            [Parameter(Mandatory = $true)]
            [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
            [string]$SourceOfTruth,
            [bool]$EnforceNoAutoCommit = $false,
            [bool]$ClaudeOrchestratorFullAccess = $false,
            [bool]$TokenEconomyEnabled = $true
        )

        $parent = Split-Path -Parent $Path
        if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        $payload = [ordered]@{
            AssistantLanguage            = $AssistantLanguage
            AssistantBrevity             = $AssistantBrevity
            SourceOfTruth                = $SourceOfTruth
            EnforceNoAutoCommit          = if ($EnforceNoAutoCommit) { 'true' } else { 'false' }
            ClaudeOrchestratorFullAccess = if ($ClaudeOrchestratorFullAccess) { 'true' } else { 'false' }
            TokenEconomyEnabled          = if ($TokenEconomyEnabled) { 'true' } else { 'false' }
            CollectedVia                 = 'AGENT_INIT_PROMPT.md'
        }

        Set-Content -LiteralPath $Path -Value ($payload | ConvertTo-Json -Depth 10)
    }

    function script:Read-JsonHashtable {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path
        )

        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }

    function script:Get-OutputValue {
        param(
            [Parameter(Mandatory = $true)]
            [string[]]$Output,
            [Parameter(Mandatory = $true)]
            [string]$Label
        )

        $prefix = "${Label}:"
        $line = $Output | Where-Object { $_ -like "$prefix*" } | Select-Object -First 1
        if ($null -eq $line) {
            return $null
        }

        return $line.Substring($prefix.Length).Trim()
    }
}

AfterAll {
    foreach ($tempRoot in $script:TempRoots) {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

Describe 'scripts/uninstall.ps1' {
    It 'removes deployed orchestrator files while preserving requested primary entrypoint, TASK.md, and runtime backup' {
        $workspace = New-WorkspaceCopy
        $workspaceRoot = $workspace.WorkspaceRoot
        $bundleRoot = $workspace.BundleRoot
        $initAnswersRelativePath = 'Octopus-agent-orchestrator/runtime/init-answers.json'
        $initAnswersPath = Join-Path $workspaceRoot $initAnswersRelativePath

        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.git') -Force | Out-Null
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'GitHubCopilot' `
            -EnforceNoAutoCommit:$true `
            -ClaudeOrchestratorFullAccess:$true `
            -TokenEconomyEnabled:$false

        & (Join-Path $bundleRoot 'scripts\install.ps1') `
            -TargetRoot $workspaceRoot `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'GitHubCopilot' `
            -InitAnswersPath $initAnswersRelativePath | Out-Null

        $output = & (Join-Path $bundleRoot 'scripts\uninstall.ps1') `
            -TargetRoot $workspaceRoot `
            -NoPrompt `
            -KeepPrimaryEntrypoint 'true' `
            -KeepTaskFile 'true' `
            -KeepRuntimeArtifacts 'true'

        $backupRoot = Get-OutputValue -Output $output -Label 'BackupRoot'
        $preservedRuntimePath = Get-OutputValue -Output $output -Label 'PreservedRuntimePath'

        Test-Path -LiteralPath (Join-Path $workspaceRoot 'Octopus-agent-orchestrator') -PathType Container | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.github\copilot-instructions.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'TASK.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'CLAUDE.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'AGENTS.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'GEMINI.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.github\agents\orchestrator.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.qwen\settings.json') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.claude\settings.local.json') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.git\hooks\pre-commit') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath $backupRoot -PathType Container | Should -BeTrue
        Test-Path -LiteralPath $preservedRuntimePath -PathType Container | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $preservedRuntimePath 'init-answers.json') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.gitignore') -PathType Leaf | Should -BeFalse
        ($output | Where-Object { $_ -eq 'Result: SUCCESS' }).Count | Should -Be 1
    }

    It 'removes only managed orchestrator content from mixed user files' {
        $workspace = New-WorkspaceCopy
        $workspaceRoot = $workspace.WorkspaceRoot
        $bundleRoot = $workspace.BundleRoot
        $initAnswersRelativePath = 'Octopus-agent-orchestrator/runtime/init-answers.json'
        $initAnswersPath = Join-Path $workspaceRoot $initAnswersRelativePath

        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.git\hooks') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.github') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.qwen') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.claude') -Force | Out-Null

        Set-Content -LiteralPath (Join-Path $workspaceRoot '.gitignore') -Value @(
            'AGENTS.md',
            'custom.log'
        )
        Set-Content -LiteralPath (Join-Path $workspaceRoot '.github\copilot-instructions.md') -Value @(
            '# Custom Copilot Notes',
            '',
            'Keep this note.'
        )
        Set-Content -LiteralPath (Join-Path $workspaceRoot '.git\hooks\pre-commit') -Value @(
            '#!/usr/bin/env bash',
            'echo "custom hook"'
        )

        $qwenPayload = [ordered]@{
            context = [ordered]@{
                fileName = @('README.md')
            }
        }
        Set-Content -LiteralPath (Join-Path $workspaceRoot '.qwen\settings.json') -Value ($qwenPayload | ConvertTo-Json -Depth 10)

        $claudePayload = [ordered]@{
            permissions = [ordered]@{
                allow = @('Bash(echo custom:*)')
            }
        }
        Set-Content -LiteralPath (Join-Path $workspaceRoot '.claude\settings.local.json') -Value ($claudePayload | ConvertTo-Json -Depth 10)

        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -EnforceNoAutoCommit:$true `
            -ClaudeOrchestratorFullAccess:$true `
            -TokenEconomyEnabled:$false

        & (Join-Path $bundleRoot 'scripts\install.ps1') `
            -TargetRoot $workspaceRoot `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -InitAnswersPath $initAnswersRelativePath | Out-Null

        & (Join-Path $bundleRoot 'scripts\uninstall.ps1') `
            -TargetRoot $workspaceRoot `
            -NoPrompt `
            -KeepPrimaryEntrypoint 'false' `
            -KeepTaskFile 'false' `
            -KeepRuntimeArtifacts 'false' | Out-Null

        $copilotContent = Get-Content -LiteralPath (Join-Path $workspaceRoot '.github\copilot-instructions.md') -Raw
        $hookContent = Get-Content -LiteralPath (Join-Path $workspaceRoot '.git\hooks\pre-commit') -Raw
        $gitignoreLines = @(Get-Content -LiteralPath (Join-Path $workspaceRoot '.gitignore'))
        $qwenSettings = Read-JsonHashtable -Path (Join-Path $workspaceRoot '.qwen\settings.json')
        $claudeSettings = Read-JsonHashtable -Path (Join-Path $workspaceRoot '.claude\settings.local.json')

        Test-Path -LiteralPath (Join-Path $workspaceRoot 'Octopus-agent-orchestrator') -PathType Container | Should -BeFalse
        $copilotContent | Should -Match ([regex]::Escape('# Custom Copilot Notes'))
        $copilotContent | Should -Not -Match ([regex]::Escape('Octopus-agent-orchestrator:managed-start'))
        $hookContent | Should -Match ([regex]::Escape('echo "custom hook"'))
        $hookContent | Should -Not -Match ([regex]::Escape('Octopus-agent-orchestrator:commit-guard-start'))
        $gitignoreLines | Should -Contain 'AGENTS.md'
        $gitignoreLines | Should -Contain 'custom.log'
        $gitignoreLines | Should -Not -Contain '# Octopus-agent-orchestrator managed ignores'
        @($qwenSettings['context']['fileName']) | Should -Contain 'README.md'
        @($qwenSettings['context']['fileName']) | Should -Not -Contain 'AGENTS.md'
        @($qwenSettings['context']['fileName']) | Should -Not -Contain 'TASK.md'
        @($claudeSettings['permissions']['allow']) | Should -Contain 'Bash(echo custom:*)'
        @($claudeSettings['permissions']['allow']) | Should -Not -Contain 'Bash(pwsh -File Octopus-agent-orchestrator/scripts/*:*)'
    }

    It 'supports dry run without deleting installed files' {
        $workspace = New-WorkspaceCopy
        $workspaceRoot = $workspace.WorkspaceRoot
        $bundleRoot = $workspace.BundleRoot
        $initAnswersRelativePath = 'Octopus-agent-orchestrator/runtime/init-answers.json'
        $initAnswersPath = Join-Path $workspaceRoot $initAnswersRelativePath

        New-Item -ItemType Directory -Path (Join-Path $workspaceRoot '.git') -Force | Out-Null
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -EnforceNoAutoCommit:$false `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$false

        & (Join-Path $bundleRoot 'scripts\install.ps1') `
            -TargetRoot $workspaceRoot `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -InitAnswersPath $initAnswersRelativePath | Out-Null

        $output = & (Join-Path $bundleRoot 'scripts\uninstall.ps1') `
            -TargetRoot $workspaceRoot `
            -DryRun `
            -NoPrompt `
            -KeepPrimaryEntrypoint 'false' `
            -KeepTaskFile 'false' `
            -KeepRuntimeArtifacts 'false'

        Test-Path -LiteralPath (Join-Path $workspaceRoot 'Octopus-agent-orchestrator') -PathType Container | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'CLAUDE.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot 'TASK.md') -PathType Leaf | Should -BeTrue
        ($output | Where-Object { $_ -eq 'Result: DRY_RUN' }).Count | Should -Be 1
    }
}
