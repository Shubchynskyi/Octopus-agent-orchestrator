#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:TempRoots = [System.Collections.Generic.List[string]]::new()

    function script:New-WorkspaceCopy {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("octopus-e2e-test-" + [Guid]::NewGuid().ToString('N'))
        $workspaceRoot = Join-Path $tempRoot 'workspace'
        $bundleRoot = Join-Path $workspaceRoot 'Octopus-agent-orchestrator'
        New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

        $trackedFiles = & git -C $repoRoot --no-pager ls-files
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to enumerate tracked files with git ls-files.'
        }

        $untrackedScripts = @(
            'scripts/lib/common.ps1'
        )
        $trackedFiles = @($trackedFiles + $untrackedScripts) | Sort-Object -Unique

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
            [string]$AssistantLanguage = 'English',
            [string]$AssistantBrevity = 'concise',
            [string]$SourceOfTruth = 'Claude',
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

    function script:Resolve-CommandPlaceholders {
        param(
            [Parameter(Mandatory = $true)]
            [string]$BundleRoot
        )

        $commandsFile = Join-Path $BundleRoot 'live\docs\agent-rules\40-commands.md'
        if (Test-Path -LiteralPath $commandsFile -PathType Leaf) {
            $content = Get-Content -LiteralPath $commandsFile -Raw
            $content = $content -replace '<install dependencies command>', 'npm install'
            $content = $content -replace '<local environment bootstrap command>', 'npm run setup'
            $content = $content -replace '<start backend command>', 'npm run start:backend'
            $content = $content -replace '<start frontend command>', 'npm run start:frontend'
            $content = $content -replace '<start worker or background job command>', 'npm run worker'
            $content = $content -replace '<unit test command>', 'npm test'
            $content = $content -replace '<integration test command>', 'npm run test:integration'
            $content = $content -replace '<e2e test command>', 'npm run test:e2e'
            $content = $content -replace '<lint command>', 'npm run lint'
            $content = $content -replace '<type-check command>', 'npx tsc --noEmit'
            $content = $content -replace '<format check command>', 'npm run format:check'
            $content = $content -replace '<compile command>', 'npx tsc'
            $content = $content -replace '<build command>', 'npm run build'
            $content = $content -replace '<container or artifact packaging command>', 'docker build .'
            Set-Content -LiteralPath $commandsFile -Value $content -NoNewline
        }
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

    function script:Invoke-Install {
        param(
            [string]$BundleRoot,
            [string]$WorkspaceRoot,
            [string]$InitAnswersRelativePath,
            [string]$AssistantLanguage = 'English',
            [string]$AssistantBrevity = 'concise',
            [string]$SourceOfTruth = 'Claude'
        )

        $output = & (Join-Path $BundleRoot 'scripts\install.ps1') `
            -TargetRoot $WorkspaceRoot `
            -AssistantLanguage $AssistantLanguage `
            -AssistantBrevity $AssistantBrevity `
            -SourceOfTruth $SourceOfTruth `
            -InitAnswersPath $InitAnswersRelativePath

        Resolve-CommandPlaceholders -BundleRoot $BundleRoot

        return $output
    }

    function script:Invoke-Verify {
        param(
            [string]$BundleRoot,
            [string]$WorkspaceRoot,
            [string]$InitAnswersRelativePath,
            [string]$SourceOfTruth = 'Claude'
        )

        $output = $null
        try {
            $output = & (Join-Path $BundleRoot 'scripts\verify.ps1') `
                -TargetRoot $WorkspaceRoot `
                -SourceOfTruth $SourceOfTruth `
                -InitAnswersPath $InitAnswersRelativePath 2>&1
        }
        catch {
            if ($null -eq $output) { $output = @() }
        }

        return $output
    }

    function script:Invoke-Reinit {
        param(
            [string]$BundleRoot,
            [string]$WorkspaceRoot,
            [string]$InitAnswersRelativePath,
            [hashtable]$Overrides = @{}
        )

        $args = @{
            TargetRoot      = $WorkspaceRoot
            InitAnswersPath = $InitAnswersRelativePath
            SkipVerify      = $true
            NoPrompt        = $true
        }

        foreach ($key in $Overrides.Keys) {
            $args[$key] = $Overrides[$key]
        }

        return & (Join-Path $BundleRoot 'scripts\reinit.ps1') @args
    }

    function script:Invoke-Uninstall {
        param(
            [string]$BundleRoot,
            [string]$WorkspaceRoot,
            [string]$KeepPrimaryEntrypoint = 'false',
            [string]$KeepTaskFile = 'false',
            [string]$KeepRuntimeArtifacts = 'false'
        )

        return & (Join-Path $BundleRoot 'scripts\uninstall.ps1') `
            -TargetRoot $WorkspaceRoot `
            -NoPrompt `
            -KeepPrimaryEntrypoint $KeepPrimaryEntrypoint `
            -KeepTaskFile $KeepTaskFile `
            -KeepRuntimeArtifacts $KeepRuntimeArtifacts
    }
}

AfterAll {
    foreach ($tempRoot in $script:TempRoots) {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

Describe 'E2E Lifecycle: Clean Install' {
    It 'installs from scratch with Claude as source-of-truth and passes verify' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'

        $installOutput = Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'

        Test-Path -LiteralPath (Join-Path $wr 'CLAUDE.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $wr 'TASK.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $br 'live\version.json') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $br 'live\docs\agent-rules\00-core.md') -PathType Leaf | Should -BeTrue

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }

    It 'installs with GitHubCopilot as source-of-truth and passes verify' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'GitHubCopilot'

        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'GitHubCopilot' | Out-Null

        Test-Path -LiteralPath (Join-Path $wr '.github\copilot-instructions.md') -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $wr 'CLAUDE.md') -PathType Leaf | Should -BeTrue -Because 'bridge files are deployed for all providers'

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'GitHubCopilot'
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }

    It 'installs with Codex as source-of-truth and passes verify' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Codex'

        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Codex' | Out-Null

        Test-Path -LiteralPath (Join-Path $wr 'AGENTS.md') -PathType Leaf | Should -BeTrue

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Codex'
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }
}

Describe 'E2E Lifecycle: Install → Reinit → Verify' {
    It 'switches source-of-truth from Claude to Codex via reinit and verify still passes' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        Invoke-Reinit -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel `
            -Overrides @{ SourceOfTruth = 'Codex'; AssistantLanguage = 'Ukrainian' } | Out-Null

        $answers = Read-JsonObject -Path (Join-Path $wr $iaRel)
        [string]$answers.SourceOfTruth | Should -Be 'Codex'
        [string]$answers.AssistantLanguage | Should -Be 'Ukrainian'

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Codex'
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }

    It 'changes assistant language and brevity via reinit without breaking verify' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        Invoke-Reinit -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel `
            -Overrides @{ AssistantLanguage = 'Japanese'; AssistantBrevity = 'detailed' } | Out-Null

        $coreRule = Get-Content -LiteralPath (Join-Path $br 'live\docs\agent-rules\00-core.md') -Raw
        $coreRule | Should -Match 'Japanese'
        $coreRule | Should -Match 'detailed'

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }
}

Describe 'E2E Lifecycle: Install → Uninstall → Clean State' {
    It 'full lifecycle: install → verify → uninstall leaves clean workspace' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'
        (Get-OutputValue -Output $verifyOutput -Label 'Verification') | Should -Be 'PASS'

        $uninstallOutput = Invoke-Uninstall -BundleRoot $br -WorkspaceRoot $wr `
            -KeepPrimaryEntrypoint 'false' -KeepTaskFile 'false' -KeepRuntimeArtifacts 'false'

        Test-Path -LiteralPath (Join-Path $wr 'Octopus-agent-orchestrator') -PathType Container | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr 'CLAUDE.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr 'TASK.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr 'AGENTS.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr 'GEMINI.md') -PathType Leaf | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr '.github\copilot-instructions.md') -PathType Leaf | Should -BeFalse

        ($uninstallOutput | Where-Object { $_ -eq 'Result: SUCCESS' }).Count | Should -Be 1
    }

    It 'uninstall preserves artifacts when requested' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $uninstallOutput = Invoke-Uninstall -BundleRoot $br -WorkspaceRoot $wr `
            -KeepPrimaryEntrypoint 'true' -KeepTaskFile 'true' -KeepRuntimeArtifacts 'true'

        Test-Path -LiteralPath (Join-Path $wr 'Octopus-agent-orchestrator') -PathType Container | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $wr 'CLAUDE.md') -PathType Leaf | Should -BeTrue -Because 'primary entrypoint was kept'
        Test-Path -LiteralPath (Join-Path $wr 'TASK.md') -PathType Leaf | Should -BeTrue -Because 'TASK.md was kept'

        $preservedRuntime = Get-OutputValue -Output $uninstallOutput -Label 'PreservedRuntimePath'
        Test-Path -LiteralPath $preservedRuntime -PathType Container | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $preservedRuntime 'init-answers.json') -PathType Leaf | Should -BeTrue
    }
}

Describe 'E2E Lifecycle: Conflicting Managed Blocks' {
    It 'install merges with pre-existing user content in gitignore, hook, and settings' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git\hooks') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $wr '.github') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $wr '.qwen') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $wr '.claude') -Force | Out-Null

        Set-Content -LiteralPath (Join-Path $wr '.gitignore') -Value @(
            'node_modules/',
            'dist/'
        )
        Set-Content -LiteralPath (Join-Path $wr '.git\hooks\pre-commit') -Value @(
            '#!/usr/bin/env bash',
            'echo "user hook"'
        )
        $qwenPayload = [ordered]@{
            context = [ordered]@{
                fileName = @('README.md')
            }
        }
        Set-Content -LiteralPath (Join-Path $wr '.qwen\settings.json') -Value ($qwenPayload | ConvertTo-Json -Depth 10)

        $claudePayload = [ordered]@{
            permissions = [ordered]@{
                allow = @('Bash(echo user:*)')
            }
        }
        Set-Content -LiteralPath (Join-Path $wr '.claude\settings.local.json') -Value ($claudePayload | ConvertTo-Json -Depth 10)

        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -EnforceNoAutoCommit $true -ClaudeOrchestratorFullAccess $true
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $gitignoreLines = @(Get-Content -LiteralPath (Join-Path $wr '.gitignore'))
        $gitignoreLines | Should -Contain 'node_modules/'
        $gitignoreLines | Should -Contain 'dist/'

        $hookContent = Get-Content -LiteralPath (Join-Path $wr '.git\hooks\pre-commit') -Raw
        $hookContent | Should -Match ([regex]::Escape('echo "user hook"'))
        $hookContent | Should -Match 'Octopus-agent-orchestrator'

        $qwenSettings = Read-JsonHashtable -Path (Join-Path $wr '.qwen\settings.json')
        @($qwenSettings['context']['fileName']) | Should -Contain 'README.md'

        $claudeSettings = Read-JsonHashtable -Path (Join-Path $wr '.claude\settings.local.json')
        @($claudeSettings['permissions']['allow']) | Should -Contain 'Bash(echo user:*)'

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'
        (Get-OutputValue -Output $verifyOutput -Label 'Verification') | Should -Be 'PASS'
    }

    It 'uninstall removes managed content but preserves user content' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git\hooks') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $wr '.qwen') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $wr '.claude') -Force | Out-Null

        Set-Content -LiteralPath (Join-Path $wr '.gitignore') -Value @('custom.log')
        Set-Content -LiteralPath (Join-Path $wr '.git\hooks\pre-commit') -Value @(
            '#!/usr/bin/env bash',
            'echo "user hook"'
        )
        $qwenPayload = [ordered]@{ context = [ordered]@{ fileName = @('README.md') } }
        Set-Content -LiteralPath (Join-Path $wr '.qwen\settings.json') -Value ($qwenPayload | ConvertTo-Json -Depth 10)
        $claudePayload = [ordered]@{ permissions = [ordered]@{ allow = @('Bash(echo user:*)') } }
        Set-Content -LiteralPath (Join-Path $wr '.claude\settings.local.json') -Value ($claudePayload | ConvertTo-Json -Depth 10)

        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -EnforceNoAutoCommit $true -ClaudeOrchestratorFullAccess $true
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null
        Invoke-Uninstall -BundleRoot $br -WorkspaceRoot $wr | Out-Null

        $gitignoreLines = @(Get-Content -LiteralPath (Join-Path $wr '.gitignore'))
        $gitignoreLines | Should -Contain 'custom.log'
        $gitignoreLines | Should -Not -Contain '# Octopus-agent-orchestrator managed ignores'

        $hookContent = Get-Content -LiteralPath (Join-Path $wr '.git\hooks\pre-commit') -Raw
        $hookContent | Should -Match ([regex]::Escape('echo "user hook"'))
        $hookContent | Should -Not -Match 'Octopus-agent-orchestrator'

        $qwenSettings = Read-JsonHashtable -Path (Join-Path $wr '.qwen\settings.json')
        @($qwenSettings['context']['fileName']) | Should -Contain 'README.md'
        @($qwenSettings['context']['fileName']) | Should -Not -Contain 'AGENTS.md'

        $claudeSettings = Read-JsonHashtable -Path (Join-Path $wr '.claude\settings.local.json')
        @($claudeSettings['permissions']['allow']) | Should -Contain 'Bash(echo user:*)'
    }
}

Describe 'E2E Lifecycle: Install → Reinstall (Idempotency)' {
    It 'running install twice produces same result and verify still passes' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude'
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $claudeContentBefore = Get-Content -LiteralPath (Join-Path $wr 'CLAUDE.md') -Raw
        $versionBefore = Read-JsonObject -Path (Join-Path $br 'live\version.json')

        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $claudeContentAfter = Get-Content -LiteralPath (Join-Path $wr 'CLAUDE.md') -Raw
        $claudeContentAfter | Should -Be $claudeContentBefore

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude'
        (Get-OutputValue -Output $verifyOutput -Label 'Verification') | Should -Be 'PASS'
    }
}

Describe 'E2E Lifecycle: Pre-Commit Hook Line Endings' {
    It 'pre-commit hook uses LF line endings for Unix compatibility' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git\hooks') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -EnforceNoAutoCommit $true
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $hookPath = Join-Path $wr '.git\hooks\pre-commit'
        Test-Path -LiteralPath $hookPath -PathType Leaf | Should -BeTrue

        $rawBytes = [System.IO.File]::ReadAllBytes($hookPath)
        $rawText = [System.Text.Encoding]::UTF8.GetString($rawBytes)

        $rawText | Should -Match '#!/usr/bin/env bash'
        $rawText | Should -Not -Match "`r`n" -Because 'hook must use LF-only line endings for Unix'
    }

    It 'pre-commit hook with pre-existing user content preserves LF endings' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git\hooks') -Force | Out-Null

        $userHookContent = "#!/usr/bin/env bash`necho `"user hook`"`n"
        [System.IO.File]::WriteAllText((Join-Path $wr '.git\hooks\pre-commit'), $userHookContent)

        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -EnforceNoAutoCommit $true
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $hookPath = Join-Path $wr '.git\hooks\pre-commit'
        $rawBytes = [System.IO.File]::ReadAllBytes($hookPath)
        $rawText = [System.Text.Encoding]::UTF8.GetString($rawBytes)

        $rawText | Should -Match ([regex]::Escape('echo "user hook"'))
        $rawText | Should -Match 'Octopus-agent-orchestrator'
        $rawText | Should -Not -Match "`r`n" -Because 'hook must use LF-only line endings'
    }
}

Describe 'E2E Lifecycle: Token Economy Config' {
    It 'install with TokenEconomyEnabled=true creates enabled config' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -TokenEconomyEnabled $true
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $teConfig = Read-JsonHashtable -Path (Join-Path $br 'live\config\token-economy.json')
        $teConfig['enabled'] | Should -BeTrue
    }

    It 'install with TokenEconomyEnabled=false creates disabled config' {
        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth 'Claude' -TokenEconomyEnabled $false
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth 'Claude' | Out-Null

        $teConfig = Read-JsonHashtable -Path (Join-Path $br 'live\config\token-economy.json')
        $teConfig['enabled'] | Should -BeFalse
    }
}

Describe 'E2E Lifecycle: Multiple Provider Matrix' {
    $providerTestCases = @(
        @{ Provider = 'Claude'; EntrypointFile = 'CLAUDE.md' }
        @{ Provider = 'Codex'; EntrypointFile = 'AGENTS.md' }
        @{ Provider = 'Gemini'; EntrypointFile = 'GEMINI.md' }
        @{ Provider = 'GitHubCopilot'; EntrypointFile = '.github\copilot-instructions.md' }
        @{ Provider = 'Windsurf'; EntrypointFile = '.windsurf\rules\rules.md' }
        @{ Provider = 'Junie'; EntrypointFile = '.junie\guidelines.md' }
        @{ Provider = 'Antigravity'; EntrypointFile = '.antigravity\rules.md' }
    )

    It 'install + verify passes for <Provider>' -TestCases $providerTestCases {
        param($Provider, $EntrypointFile)

        $workspace = New-WorkspaceCopy
        $wr = $workspace.WorkspaceRoot
        $br = $workspace.BundleRoot
        $iaRel = 'Octopus-agent-orchestrator/runtime/init-answers.json'

        New-Item -ItemType Directory -Path (Join-Path $wr '.git') -Force | Out-Null
        Write-InitAnswers -Path (Join-Path $wr $iaRel) -SourceOfTruth $Provider
        Invoke-Install -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth $Provider | Out-Null

        Test-Path -LiteralPath (Join-Path $wr $EntrypointFile) -PathType Leaf | Should -BeTrue

        $verifyOutput = Invoke-Verify -BundleRoot $br -WorkspaceRoot $wr -InitAnswersRelativePath $iaRel -SourceOfTruth $Provider
        $verifyResult = Get-OutputValue -Output $verifyOutput -Label 'Verification'
        $verifyResult | Should -Be 'PASS'
    }
}
