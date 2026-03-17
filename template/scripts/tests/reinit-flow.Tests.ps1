#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    . (Join-Path $repoRoot 'scripts\lib\init-answer-migrations.ps1')

    $script:TempRoots = [System.Collections.Generic.List[string]]::new()

    function script:New-WorkspaceCopy {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("octopus-reinit-test-" + [Guid]::NewGuid().ToString('N'))
        $workspaceRoot = Join-Path $tempRoot 'workspace'
        $bundleRoot = Join-Path $workspaceRoot 'Octopus-agent-orchestrator'
        New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

        $trackedFiles = & git -C $repoRoot --no-pager ls-files
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to enumerate tracked files with git ls-files.'
        }

        $trackedFiles = @($trackedFiles + @(
            'scripts/reinit.ps1',
            'scripts/reinit.sh'
        )) | Sort-Object -Unique

        foreach ($relativePath in @($trackedFiles)) {
            if ([string]::IsNullOrWhiteSpace([string]$relativePath)) {
                continue
            }

            $sourcePath = Join-Path $repoRoot $relativePath
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
            [bool]$TokenEconomyEnabled = $false
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

    function script:Read-JsonObject {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path
        )

        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }

    function script:Read-JsonHashtable {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path
        )

        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
}

AfterAll {
    foreach ($tempRoot in $script:TempRoots) {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

Describe 'Invoke-RecollectInitAnswers' {
    It 'applies explicit overrides without prompting and keeps literal contract fields normalized' {
        $existingAnswers = [PSCustomObject]@{
            AssistantLanguage            = 'English'
            AssistantBrevity             = 'concise'
            SourceOfTruth                = 'Claude'
            EnforceNoAutoCommit          = 'false'
            ClaudeOrchestratorFullAccess = 'false'
            TokenEconomyEnabled          = 'false'
            CollectedVia                 = 'legacy'
        }

        $overrideAnswers = [PSCustomObject]@{
            AssistantLanguage   = 'Ukrainian'
            SourceOfTruth       = 'Codex'
            TokenEconomyEnabled = 'true'
        }

        $result = Invoke-RecollectInitAnswers `
            -Answers $existingAnswers `
            -LiveVersion $null `
            -TokenEconomyConfig $null `
            -InteractivePrompting:$false `
            -Overrides $overrideAnswers

        $result.Answers.AssistantLanguage | Should -Be 'Ukrainian'
        $result.Answers.SourceOfTruth | Should -Be 'Codex'
        $result.Answers.TokenEconomyEnabled | Should -Be 'true'
        $result.Answers.CollectedVia | Should -Be 'AGENT_INIT_PROMPT.md'
        (($result.Changes | Where-Object { $_.Key -eq 'AssistantLanguage' }).Action | Select-Object -First 1) | Should -Be 'overridden'
        (($result.Changes | Where-Object { $_.Key -eq 'CollectedVia' }).Action | Select-Object -First 1) | Should -Be 'normalized'
    }
}

Describe 'scripts/reinit.ps1' {
    It 'rewrites init answers and reapplies answer-dependent files without runtime backups' {
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

        $usagePath = Join-Path $bundleRoot 'live\USAGE.md'
        $usageBefore = Get-Content -LiteralPath $usagePath -Raw
        $backupsRoot = Join-Path $bundleRoot 'runtime\backups'
        $backupCountBefore = if (Test-Path -LiteralPath $backupsRoot -PathType Container) {
            @(Get-ChildItem -LiteralPath $backupsRoot -Directory).Count
        } else {
            0
        }

        & (Join-Path $bundleRoot 'scripts\reinit.ps1') `
            -TargetRoot $workspaceRoot `
            -InitAnswersPath $initAnswersRelativePath `
            -SkipVerify `
            -NoPrompt `
            -AssistantLanguage 'Ukrainian' `
            -AssistantBrevity 'detailed' `
            -SourceOfTruth 'Codex' `
            -EnforceNoAutoCommit 'true' `
            -ClaudeOrchestratorFullAccess 'true' `
            -TokenEconomyEnabled 'true' | Out-Null

        $initAnswers = Read-JsonObject -Path $initAnswersPath
        [string]$initAnswers.AssistantLanguage | Should -Be 'Ukrainian'
        [string]$initAnswers.AssistantBrevity | Should -Be 'detailed'
        [string]$initAnswers.SourceOfTruth | Should -Be 'Codex'
        [string]$initAnswers.EnforceNoAutoCommit | Should -Be 'true'
        [string]$initAnswers.ClaudeOrchestratorFullAccess | Should -Be 'true'
        [string]$initAnswers.TokenEconomyEnabled | Should -Be 'true'

        $coreRulePath = Join-Path $bundleRoot 'live\docs\agent-rules\00-core.md'
        $coreRuleContent = Get-Content -LiteralPath $coreRulePath -Raw
        $coreRuleContent | Should -Match 'Respond in Ukrainian for explanations and assistance\.'
        $coreRuleContent | Should -Match 'Default response brevity: detailed\.'

        $taskPath = Join-Path $workspaceRoot 'TASK.md'
        $taskContent = Get-Content -LiteralPath $taskPath -Raw
        $taskContent | Should -Match ([regex]::Escape('Canonical instructions entrypoint for orchestration: `AGENTS.md`.'))

        $claudeEntrypointPath = Join-Path $workspaceRoot 'CLAUDE.md'
        $claudeEntrypointContent = Get-Content -LiteralPath $claudeEntrypointPath -Raw
        $claudeEntrypointContent | Should -Match ([regex]::Escape('Canonical source of truth for agent workflow rules: `AGENTS.md`.'))

        $liveVersionPath = Join-Path $bundleRoot 'live\version.json'
        $liveVersion = Read-JsonObject -Path $liveVersionPath
        $liveVersion.SourceOfTruth | Should -Be 'Codex'
        $liveVersion.CanonicalEntrypoint | Should -Be 'AGENTS.md'
        $liveVersion.AssistantLanguage | Should -Be 'Ukrainian'
        $liveVersion.AssistantBrevity | Should -Be 'detailed'
        $liveVersion.EnforceNoAutoCommit | Should -BeTrue
        $liveVersion.ClaudeOrchestratorFullAccess | Should -BeTrue
        $liveVersion.TokenEconomyEnabled | Should -BeTrue

        $tokenEconomyConfig = Read-JsonHashtable -Path (Join-Path $bundleRoot 'live\config\token-economy.json')
        $tokenEconomyConfig['enabled'] | Should -BeTrue

        Test-Path -LiteralPath (Join-Path $workspaceRoot '.git\hooks\pre-commit') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspaceRoot '.claude\settings.local.json') -PathType Leaf | Should -BeTrue
        @(Get-Content -LiteralPath (Join-Path $workspaceRoot '.gitignore')) | Should -Contain '.claude/'

        $usageAfter = Get-Content -LiteralPath $usagePath -Raw
        $usageAfter | Should -Be $usageBefore

        $backupCountAfter = if (Test-Path -LiteralPath $backupsRoot -PathType Container) {
            @(Get-ChildItem -LiteralPath $backupsRoot -Directory).Count
        } else {
            0
        }
        $backupCountAfter | Should -Be $backupCountBefore
    }
}
