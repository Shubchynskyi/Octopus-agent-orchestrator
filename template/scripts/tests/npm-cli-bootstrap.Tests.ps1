#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:CliPath = Join-Path $repoRoot 'bin\octopus.js'
    $script:VersionPath = Join-Path $repoRoot 'VERSION'
    $script:PackageJsonPath = Join-Path $repoRoot 'package.json'
    $script:TempRoots = [System.Collections.Generic.List[string]]::new()

    foreach ($commandName in @('node', 'pwsh', 'git')) {
        if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
            throw "$commandName is required to run npm CLI tests."
        }
    }

    function script:New-TempRoot {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("octopus-npm-cli-test-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        $script:TempRoots.Add($tempRoot) | Out-Null
        return $tempRoot
    }

    function script:Invoke-Cli {
        param(
            [Parameter(Mandatory = $true)]
            [string]$WorkingDirectory,
            [string[]]$Arguments = @()
        )

        Push-Location $WorkingDirectory
        try {
            $output = & node $script:CliPath @Arguments 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            Pop-Location
        }

        return [PSCustomObject]@{
            Output   = @($output)
            ExitCode = $exitCode
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

    function script:Get-CurrentGitBranch {
        $branchOutput = & git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }

        $branchName = [string](@($branchOutput) | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($branchName)) {
            return $null
        }

        $branchName = $branchName.Trim()
        if ($branchName -eq 'HEAD') {
            return $null
        }

        return $branchName
    }
}

AfterAll {
    foreach ($tempRoot in $script:TempRoots) {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'bin/octopus.js' {
    It 'keeps package version aligned with VERSION' {
        $bundleVersion = (Get-Content -LiteralPath $script:VersionPath -Raw).Trim()
        $packageVersion = (Get-Content -LiteralPath $script:PackageJsonPath -Raw | ConvertFrom-Json -ErrorAction Stop).version

        $packageVersion | Should -Be $bundleVersion
    }

    It 'prints lifecycle commands in help output' {
        $workspace = New-TempRoot
        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @('--help')
        $outputText = ($result.Output -join [Environment]::NewLine)

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'install'
        $outputText | Should -Match 'reinit'
        $outputText | Should -Match 'uninstall'
        $outputText | Should -Match 'update'
        $outputText | Should -Match 'agent-produced init answers'
    }

    It 'deploys the bundle to the default destination and prints next steps' {
        $workspace = New-TempRoot
        $result = Invoke-Cli -WorkingDirectory $workspace
        $outputText = ($result.Output -join [Environment]::NewLine)
        $bundleRoot = Join-Path $workspace 'Octopus-agent-orchestrator'
        $escapedInitPromptPath = [regex]::Escape((Join-Path $bundleRoot 'AGENT_INIT_PROMPT.md'))

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'OCTOPUS_BOOTSTRAP_OK'
        $outputText | Should -Match $escapedInitPromptPath
        $outputText | Should -Match 'npx octopus-agent-orchestrator install'

        Test-Path -LiteralPath $bundleRoot | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot '.gitattributes') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'package.json') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'bin\octopus.js') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'scripts\install.ps1') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'template\AGENTS.md') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'template\scripts\agent-gates\lib\__pycache__') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $bundleRoot 'runtime') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $bundleRoot 'live') | Should -BeFalse
    }

    It 'supports an explicit destination path' {
        $workspace = New-TempRoot
        $destinationPath = Join-Path $workspace 'custom-bootstrap'
        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @($destinationPath)

        $result.ExitCode | Should -Be 0
        Test-Path -LiteralPath (Join-Path $destinationPath 'package.json') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $destinationPath 'bin\octopus.js') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $destinationPath 'scripts\install.sh') | Should -BeTrue
    }

    It 'refuses to overwrite an existing non-empty destination' {
        $workspace = New-TempRoot
        $destinationPath = Join-Path $workspace 'Octopus-agent-orchestrator'
        New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $destinationPath 'marker.txt') -Value 'preexisting'

        $result = Invoke-Cli -WorkingDirectory $workspace
        $outputText = ($result.Output -join [Environment]::NewLine)

        $result.ExitCode | Should -Be 1
        $outputText | Should -Match 'OCTOPUS_BOOTSTRAP_FAILED'
        $outputText | Should -Match 'Destination already exists and is not empty'
    }

    It 'runs install after reading agent-produced init answers from workspace' {
        $workspace = New-TempRoot
        $initAnswersRelativePath = 'answers\init-answers.json'
        $initAnswersPath = Join-Path $workspace $initAnswersRelativePath
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Codex' `
            -EnforceNoAutoCommit:$false `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$false

        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'install',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath
        )
        $outputText = ($result.Output -join [Environment]::NewLine)
        $bundleRoot = Join-Path $workspace 'Octopus-agent-orchestrator'

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'InitInvoked: True'
        Test-Path -LiteralPath (Join-Path $workspace 'TASK.md') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $workspace 'AGENTS.md') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'live\USAGE.md') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'package.json') | Should -BeTrue
    }

    It 'fails install with a clear agent-setup instruction when init answers are missing' {
        $workspace = New-TempRoot
        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'install',
            '--target-root', $workspace
        )
        $outputText = ($result.Output -join [Environment]::NewLine)

        $result.ExitCode | Should -Be 1
        $outputText | Should -Match 'only works after an agent has prepared init answers'
        $outputText | Should -Match 'AGENT_INIT_PROMPT\.md'
    }

    It 'runs init against an existing deployed bundle using agent-produced init answers' {
        $workspace = New-TempRoot
        $bundleRoot = Join-Path $workspace 'Octopus-agent-orchestrator'
        $bootstrapResult = Invoke-Cli -WorkingDirectory $workspace
        $bootstrapResult.ExitCode | Should -Be 0

        $initAnswersPath = Join-Path $bundleRoot 'runtime\init-answers.json'
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -EnforceNoAutoCommit:$true `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$true

        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'init',
            '--target-root', $workspace
        )
        $outputText = ($result.Output -join [Environment]::NewLine)

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'Init: PASS'
        Test-Path -LiteralPath (Join-Path $bundleRoot 'live\USAGE.md') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $bundleRoot 'live\project-discovery.md') | Should -BeTrue
    }

    It 'runs reinit through the CLI wrapper' {
        $workspace = New-TempRoot
        $initAnswersRelativePath = 'answers\init-answers.json'
        $initAnswersPath = Join-Path $workspace $initAnswersRelativePath
        New-Item -ItemType Directory -Path (Join-Path $workspace '.git') -Force | Out-Null
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -EnforceNoAutoCommit:$false `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$false

        $installResult = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'install',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath
        )
        $installResult.ExitCode | Should -Be 0

        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'reinit',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath,
            '--no-prompt',
            '--skip-verify',
            '--assistant-language', 'Ukrainian',
            '--assistant-brevity', 'detailed',
            '--source-of-truth', 'Codex',
            '--enforce-no-auto-commit', 'true',
            '--claude-orchestrator-full-access', 'true',
            '--token-economy-enabled', 'true'
        )
        $outputText = ($result.Output -join [Environment]::NewLine)
        $bundleRoot = Join-Path $workspace 'Octopus-agent-orchestrator'
        $initAnswers = Read-JsonObject -Path $initAnswersPath
        $liveVersion = Read-JsonObject -Path (Join-Path $bundleRoot 'live\version.json')
        $coreRuleContent = Get-Content -LiteralPath (Join-Path $bundleRoot 'live\docs\agent-rules\00-core.md') -Raw

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'Reinit: PASS'
        [string]$initAnswers.AssistantLanguage | Should -Be 'Ukrainian'
        [string]$initAnswers.AssistantBrevity | Should -Be 'detailed'
        [string]$initAnswers.SourceOfTruth | Should -Be 'Codex'
        $liveVersion.SourceOfTruth | Should -Be 'Codex'
        $liveVersion.TokenEconomyEnabled | Should -BeTrue
        $coreRuleContent | Should -Match 'Respond in Ukrainian for explanations and assistance\.'
    }

    It 'runs update through check-update and accepts repo or branch overrides' {
        $workspace = New-TempRoot
        $initAnswersRelativePath = 'answers\init-answers.json'
        $initAnswersPath = Join-Path $workspace $initAnswersRelativePath
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Claude' `
            -EnforceNoAutoCommit:$false `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$false

        $installResult = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'install',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath
        )
        $installResult.ExitCode | Should -Be 0

        $arguments = @(
            'update',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath,
            '--repo-url', $repoRoot,
            '--no-prompt'
        )
        $branchName = Get-CurrentGitBranch
        if (-not [string]::IsNullOrWhiteSpace($branchName)) {
            $arguments += @('--branch', $branchName)
        }

        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments $arguments
        $outputText = ($result.Output -join [Environment]::NewLine)
        $escapedRepoUrl = [regex]::Escape("RepoUrl: $repoRoot")
        $escapedBranch = if (-not [string]::IsNullOrWhiteSpace($branchName)) { [regex]::Escape("Branch: $branchName") } else { $null }

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'CheckUpdateResult: UP_TO_DATE'
        $outputText | Should -Match $escapedRepoUrl
        if (-not [string]::IsNullOrWhiteSpace($branchName)) {
            $outputText | Should -Match $escapedBranch
        }
    }

    It 'runs uninstall through the CLI wrapper' {
        $workspace = New-TempRoot
        $initAnswersRelativePath = 'answers\init-answers.json'
        $initAnswersPath = Join-Path $workspace $initAnswersRelativePath
        Write-InitAnswers `
            -Path $initAnswersPath `
            -AssistantLanguage 'English' `
            -AssistantBrevity 'concise' `
            -SourceOfTruth 'Codex' `
            -EnforceNoAutoCommit:$false `
            -ClaudeOrchestratorFullAccess:$false `
            -TokenEconomyEnabled:$false

        $installResult = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'install',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath
        )
        $installResult.ExitCode | Should -Be 0

        $result = Invoke-Cli -WorkingDirectory $workspace -Arguments @(
            'uninstall',
            '--target-root', $workspace,
            '--init-answers-path', $initAnswersRelativePath,
            '--no-prompt',
            '--keep-primary-entrypoint', 'no',
            '--keep-task-file', 'no',
            '--keep-runtime-artifacts', 'no'
        )
        $outputText = ($result.Output -join [Environment]::NewLine)

        $result.ExitCode | Should -Be 0
        $outputText | Should -Match 'KeepPrimaryEntrypoint: False'
        Test-Path -LiteralPath (Join-Path $workspace 'Octopus-agent-orchestrator') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspace 'TASK.md') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $workspace 'AGENTS.md') | Should -BeFalse
    }
}
