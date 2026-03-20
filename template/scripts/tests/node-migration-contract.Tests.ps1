#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

<#
.SYNOPSIS
    Node Migration Contract Tests — M0 parity baseline.
.DESCRIPTION
    Validates the frozen runtime contracts captured in docs/node-migration-contract.md
    against the actual repository state. These assertions are the acceptance criteria
    for every later Node-migration milestone.

    Run:  Invoke-Pester -Path template/scripts/tests/node-migration-contract.Tests.ps1 -CI
#>

BeforeDiscovery {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))

    $script:EntrypointMapData = @(
        @{ Key = 'CLAUDE';        Value = 'CLAUDE.md' }
        @{ Key = 'CODEX';         Value = 'AGENTS.md' }
        @{ Key = 'GEMINI';        Value = 'GEMINI.md' }
        @{ Key = 'GITHUBCOPILOT'; Value = '.github/copilot-instructions.md' }
        @{ Key = 'WINDSURF';      Value = '.windsurf/rules/rules.md' }
        @{ Key = 'JUNIE';         Value = '.junie/guidelines.md' }
        @{ Key = 'ANTIGRAVITY';   Value = '.antigravity/rules.md' }
    )

    $script:DeployItemData = @(
        '.gitattributes', 'bin', 'scripts', 'template',
        'AGENT_INIT_PROMPT.md', 'CHANGELOG.md', 'HOW_TO.md',
        'LICENSE', 'MANIFEST.md', 'README.md', 'VERSION', 'package.json'
    ) | ForEach-Object { @{ Item = $_ } }

    $script:ControlPlaneScriptData = @(
        'setup', 'install', 'init', 'reinit',
        'verify', 'update', 'check-update', 'uninstall'
    ) | ForEach-Object { @{ ScriptName = $_ } }

    $script:GateScriptData = @(
        'classify-change', 'compile-gate', 'completion-gate',
        'build-scoped-diff', 'build-review-context',
        'doc-impact-gate', 'required-reviews-check',
        'log-task-event', 'task-events-summary',
        'validate-manifest', 'human-commit'
    ) | ForEach-Object { @{ GateName = $_ } }

    $script:ConfigFileData = @(
        'review-capabilities.json', 'paths.json',
        'token-economy.json', 'output-filters.json'
    ) | ForEach-Object { @{ ConfigFile = $_ } }

    $script:BrevityData = @('concise', 'detailed') | ForEach-Object { @{ Value = $_ } }
    $script:CollectedViaData = @(
        'AGENT_INIT_PROMPT.md', 'CLI_INTERACTIVE', 'CLI_NONINTERACTIVE'
    ) | ForEach-Object { @{ Value = $_ } }
}

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:CliPath = Join-Path $repoRoot 'bin\octopus.js'
    $script:PackageJsonPath = Join-Path $repoRoot 'package.json'
    $script:VersionPath = Join-Path $repoRoot 'VERSION'
    $script:ManifestPath = Join-Path $repoRoot 'MANIFEST.md'
    $script:LiveRoot = Join-Path $repoRoot 'live'
    $script:ScriptsRoot = Join-Path $repoRoot 'scripts'
    $script:GatesRoot = Join-Path $repoRoot 'live\scripts\agent-gates'
    $script:ContractDocPath = Join-Path $repoRoot 'docs\node-migration-contract.md'

    $script:PackageJson = Get-Content -LiteralPath $script:PackageJsonPath -Raw | ConvertFrom-Json
    $script:CliSource = Get-Content -LiteralPath $script:CliPath -Raw

    $script:ExpectedLifecycleCommands = @(
        'setup', 'status', 'doctor', 'bootstrap',
        'install', 'init', 'reinit', 'update', 'uninstall'
    )

    $script:ExpectedSourceOfTruthValues = @(
        'Claude', 'Codex', 'Gemini', 'GitHubCopilot',
        'Windsurf', 'Junie', 'Antigravity'
    )

    $script:ExpectedEntrypointMap = @{
        'CLAUDE'        = 'CLAUDE.md'
        'CODEX'         = 'AGENTS.md'
        'GEMINI'        = 'GEMINI.md'
        'GITHUBCOPILOT' = '.github/copilot-instructions.md'
        'WINDSURF'      = '.windsurf/rules/rules.md'
        'JUNIE'         = '.junie/guidelines.md'
        'ANTIGRAVITY'   = '.antigravity/rules.md'
    }
}

Describe 'Contract: CLI entry point' {
    It 'bin/octopus.js exists and starts with node shebang' {
        Test-Path -LiteralPath $script:CliPath -PathType Leaf | Should -BeTrue
        $firstLine = (Get-Content -LiteralPath $script:CliPath -TotalCount 1)
        $firstLine | Should -Match '#!/usr/bin/env node'
    }

    It 'node can parse octopus.js without syntax errors' {
        $result = & node --check $script:CliPath 2>&1
        $LASTEXITCODE | Should -Be 0
    }
}

Describe 'Contract: package.json aliases' {
    It 'exposes octopus, oao, and octopus-agent-orchestrator bin aliases' {
        $script:PackageJson.bin | Should -Not -BeNullOrEmpty
        $script:PackageJson.bin.octopus | Should -Be 'bin/octopus.js'
        $script:PackageJson.bin.oao | Should -Be 'bin/octopus.js'
        $script:PackageJson.bin.'octopus-agent-orchestrator' | Should -Be 'bin/octopus.js'
    }
}

Describe 'Contract: LIFECYCLE_COMMANDS set' {
    It 'recognises all expected lifecycle commands' {
        foreach ($cmd in $script:ExpectedLifecycleCommands) {
            $script:CliSource | Should -Match "['`"]$cmd['`"]" -Because "LIFECYCLE_COMMANDS must include '$cmd'"
        }
    }
}

Describe 'Contract: source-of-truth values' {
    It 'SOURCE_OF_TRUTH_VALUES contains all expected values' {
        foreach ($sot in $script:ExpectedSourceOfTruthValues) {
            $script:CliSource | Should -Match "['`"]$sot['`"]" -Because "SOURCE_OF_TRUTH_VALUES must include '$sot'"
        }
    }
}

Describe 'Contract: entrypoint map parity' {
    It 'SOURCE_TO_ENTRYPOINT_MAP maps <Key> to <Value>' -ForEach $script:EntrypointMapData {
        $pattern = [regex]::Escape("['$Key', '$Value']")
        $script:CliSource | Should -Match $pattern -Because "Entrypoint map must contain $Key -> $Value"
    }

    It 'PowerShell common.ps1 maps match JS entrypoint map' {
        $commonPath = Join-Path $script:ScriptsRoot 'lib\common.ps1'
        if (Test-Path -LiteralPath $commonPath -PathType Leaf) {
            $commonSource = Get-Content -LiteralPath $commonPath -Raw
            foreach ($kv in $script:ExpectedEntrypointMap.GetEnumerator()) {
                $commonSource | Should -Match ([regex]::Escape("'$($kv.Key)'")) -Because "PS common.ps1 must map $($kv.Key)"
                $commonSource | Should -Match ([regex]::Escape("'$($kv.Value)'")) -Because "PS common.ps1 must map to $($kv.Value)"
            }
        }
    }
}

Describe 'Contract: deploy items exist' {
    It '<Item> exists in repo root' -ForEach $script:DeployItemData {
        $itemPath = Join-Path $repoRoot $Item
        Test-Path -LiteralPath $itemPath | Should -BeTrue -Because "Deploy item '$Item' must exist"
    }
}

Describe 'Contract: control-plane script parity (.ps1 ↔ .sh)' {
    It '<ScriptName>.ps1 and <ScriptName>.sh both exist' -ForEach $script:ControlPlaneScriptData {
        $ps1Path = Join-Path $script:ScriptsRoot "$ScriptName.ps1"
        $shPath  = Join-Path $script:ScriptsRoot "$ScriptName.sh"
        Test-Path -LiteralPath $ps1Path -PathType Leaf | Should -BeTrue -Because "$ScriptName.ps1 must exist"
        Test-Path -LiteralPath $shPath  -PathType Leaf | Should -BeTrue -Because "$ScriptName.sh must exist"
    }
}

Describe 'Contract: gate script parity (.ps1 ↔ .sh)' {
    It '<GateName>.ps1 and <GateName>.sh both exist' -ForEach $script:GateScriptData {
        $ps1Path = Join-Path $script:GatesRoot "$GateName.ps1"
        $shPath  = Join-Path $script:GatesRoot "$GateName.sh"
        Test-Path -LiteralPath $ps1Path -PathType Leaf | Should -BeTrue -Because "Gate $GateName.ps1 must exist"
        Test-Path -LiteralPath $shPath  -PathType Leaf | Should -BeTrue -Because "Gate $GateName.sh must exist"
    }
}

Describe 'Contract: config artifact shapes' {
    It '<ConfigFile> exists in live/config and is valid JSON' -ForEach $script:ConfigFileData {
        $configPath = Join-Path $script:LiveRoot 'config' $ConfigFile
        Test-Path -LiteralPath $configPath -PathType Leaf | Should -BeTrue
        { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } | Should -Not -Throw
    }

    It 'review-capabilities.json has all required keys' {
        $rc = Get-Content -LiteralPath (Join-Path $script:LiveRoot 'config\review-capabilities.json') -Raw | ConvertFrom-Json
        foreach ($key in @('code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency')) {
            $rc.PSObject.Properties.Name | Should -Contain $key
        }
    }

    It 'token-economy.json has all required keys' {
        $te = Get-Content -LiteralPath (Join-Path $script:LiveRoot 'config\token-economy.json') -Raw | ConvertFrom-Json
        foreach ($key in @('enabled', 'enabled_depths', 'strip_examples', 'strip_code_blocks', 'scoped_diffs', 'compact_reviewer_output', 'fail_tail_lines')) {
            $te.PSObject.Properties.Name | Should -Contain $key
        }
    }

    It 'paths.json has required top-level keys' {
        $pj = Get-Content -LiteralPath (Join-Path $script:LiveRoot 'config\paths.json') -Raw | ConvertFrom-Json
        foreach ($key in @('metrics_path', 'runtime_roots', 'fast_path_roots', 'triggers')) {
            $pj.PSObject.Properties.Name | Should -Contain $key
        }
    }

    It 'paths.json triggers has all expected review type sub-keys' {
        $pj = Get-Content -LiteralPath (Join-Path $script:LiveRoot 'config\paths.json') -Raw | ConvertFrom-Json
        foreach ($key in @('db', 'security', 'refactor', 'api', 'dependency', 'infra', 'test', 'performance')) {
            $pj.triggers.PSObject.Properties.Name | Should -Contain $key
        }
    }

    It 'output-filters.json is version 2 with all expected profiles' {
        $of = Get-Content -LiteralPath (Join-Path $script:LiveRoot 'config\output-filters.json') -Raw | ConvertFrom-Json
        $of.version | Should -Be 2
        $expectedProfiles = @(
            'compile_failure_console', 'compile_failure_console_generic',
            'compile_failure_console_maven', 'compile_failure_console_gradle',
            'compile_failure_console_node', 'compile_failure_console_cargo',
            'compile_failure_console_dotnet', 'compile_failure_console_go',
            'compile_success_console',
            'test_failure_console', 'test_success_console',
            'lint_failure_console', 'lint_success_console',
            'review_gate_failure_console', 'review_gate_success_console',
            'review_gate_console'
        )
        foreach ($profile in $expectedProfiles) {
            $of.profiles.PSObject.Properties.Name | Should -Contain $profile
        }
    }
}

Describe 'Contract: MANIFEST.md references' {
    BeforeAll {
        $script:ManifestContent = Get-Content -LiteralPath $script:ManifestPath -Raw
    }

    It 'MANIFEST lists all control-plane scripts' {
        foreach ($item in $script:ControlPlaneScriptData) {
            $scriptName = $item.ScriptName
            $script:ManifestContent | Should -Match ([regex]::Escape("scripts/$scriptName.ps1")) -Because "MANIFEST must reference $scriptName.ps1"
            $script:ManifestContent | Should -Match ([regex]::Escape("scripts/$scriptName.sh"))  -Because "MANIFEST must reference $scriptName.sh"
        }
    }

    It 'MANIFEST lists shared libraries' {
        foreach ($lib in @('init-answer-migrations.ps1', 'rule-contract-migrations.ps1', 'managed-config-contracts.ps1')) {
            $script:ManifestContent | Should -Match ([regex]::Escape("scripts/lib/$lib")) -Because "MANIFEST must reference lib/$lib"
        }
    }

    It 'MANIFEST references bin/octopus.js' {
        $script:ManifestContent | Should -Match ([regex]::Escape('bin/octopus.js'))
    }

    It 'MANIFEST references package.json' {
        $script:ManifestContent | Should -Match ([regex]::Escape('package.json'))
    }
}

Describe 'Contract: VERSION consistency' {
    It 'VERSION file and package.json version match' {
        $versionFileContent = (Get-Content -LiteralPath $script:VersionPath -Raw).Trim()
        $script:PackageJson.version | Should -Be $versionFileContent
    }
}

Describe 'Contract: brevity and collected-via allowed values' {
    It 'BREVITY_VALUES contains <Value>' -ForEach $script:BrevityData {
        $script:CliSource | Should -Match "['`"]$Value['`"]"
    }

    It 'COLLECTED_VIA_VALUES contains <Value>' -ForEach $script:CollectedViaData {
        $script:CliSource | Should -Match ([regex]::Escape("'$Value'"))
    }
}

Describe 'Contract: key CLI constants' {
    It 'DEFAULT_BUNDLE_NAME is Octopus-agent-orchestrator' {
        $script:CliSource | Should -Match ([regex]::Escape("'Octopus-agent-orchestrator'"))
    }

    It 'COMMAND_SUMMARY covers advertised commands' {
        foreach ($cmd in @('setup', 'status', 'doctor', 'bootstrap', 'reinit', 'update', 'uninstall')) {
            $script:CliSource | Should -Match "['`"]$cmd['`"].*['`"]" -Because "COMMAND_SUMMARY must include '$cmd'"
        }
    }
}

Describe 'Contract: contract doc exists' {
    It 'docs/node-migration-contract.md exists' {
        Test-Path -LiteralPath $script:ContractDocPath -PathType Leaf | Should -BeTrue
    }

    It 'contract doc references current version' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $currentVersion = (Get-Content -LiteralPath $script:VersionPath -Raw).Trim()
        $contractContent | Should -Match ([regex]::Escape($currentVersion))
    }

    It 'contract doc preserves the shipped M0 Node floor' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match 'Node\.js .+16\.14'
    }

    It 'contract doc covers required lifecycle scenarios including verify' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        foreach ($scenario in @('Overview', 'Bootstrap', 'Setup', 'Install', 'Init', 'Reinit', 'Doctor', 'Verify', 'Update', 'Uninstall')) {
            $contractContent | Should -Match "### .*${scenario}" -Because "contract doc must capture the $scenario lifecycle baseline"
        }
    }

    It 'verify scenario documents success and failure markers' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match ([regex]::Escape('Verification: PASS'))
        $contractContent | Should -Match ([regex]::Escape('Verification failed. Resolve listed issues and rerun.'))
    }
}

Describe 'Contract: overview and help golden markers' {
    BeforeAll {
        $script:HasNode = [bool](Get-Command 'node' -ErrorAction SilentlyContinue)
    }

    It 'overview (no args) outputs OCTOPUS_OVERVIEW marker' -Skip:(-not $script:HasNode) {
        $output = & node $script:CliPath 2>&1
        $joined = ($output | Out-String)
        $joined | Should -Match 'OCTOPUS_OVERVIEW'
    }

    It 'help outputs Commands section' -Skip:(-not $script:HasNode) {
        $output = & node $script:CliPath help 2>&1
        $joined = ($output | Out-String)
        $joined | Should -Match 'Commands:'
        $joined | Should -Match 'Global options:'
    }

    It '--version outputs version string' -Skip:(-not $script:HasNode) {
        $output = & node $script:CliPath --version 2>&1
        $versionText = ($output | Out-String).Trim()
        $expectedVersion = (Get-Content -LiteralPath $script:VersionPath -Raw).Trim()
        $versionText | Should -Match ([regex]::Escape($expectedVersion))
    }
}
