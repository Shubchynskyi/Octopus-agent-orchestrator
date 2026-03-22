#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

<#
.SYNOPSIS
    Node runtime contract tests.
.DESCRIPTION
    Validates the current Node-only runtime contract captured in
    docs/node-migration-contract.md against the actual repository state.

    Run: Invoke-Pester -Path template/scripts/tests/node-migration-contract.Tests.ps1 -CI
#>

BeforeDiscovery {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:HasNode = [bool](Get-Command 'node' -ErrorAction SilentlyContinue)

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
        '.gitattributes', 'bin', 'src', 'template',
        'AGENT_INIT_PROMPT.md', 'CHANGELOG.md', 'HOW_TO.md',
        'LICENSE', 'MANIFEST.md', 'README.md', 'VERSION', 'package.json'
    ) | ForEach-Object { @{ Item = $_ } }

    $script:GateNameData = @(
        'classify-change', 'compile-gate', 'required-reviews-check',
        'doc-impact-gate', 'completion-gate', 'build-scoped-diff',
        'build-review-context', 'log-task-event', 'task-events-summary',
        'validate-manifest', 'human-commit'
    ) | ForEach-Object { @{ GateName = $_ } }

    $script:ConfigFileData = @(
        'review-capabilities.json', 'paths.json',
        'token-economy.json', 'output-filters.json'
    ) | ForEach-Object { @{ ConfigFile = $_ } }
}

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:CliPath = Join-Path $repoRoot 'bin\octopus.js'
    $script:PackageJsonPath = Join-Path $repoRoot 'package.json'
    $script:VersionPath = Join-Path $repoRoot 'VERSION'
    $script:ManifestPath = Join-Path $repoRoot 'MANIFEST.md'
    $script:LiveRoot = Join-Path $repoRoot 'live'
    $script:ContractDocPath = Join-Path $repoRoot 'docs\node-migration-contract.md'

    $script:PackageJson = Get-Content -LiteralPath $script:PackageJsonPath -Raw | ConvertFrom-Json
    $script:CliSource = Get-Content -LiteralPath $script:CliPath -Raw

    $script:ExpectedLifecycleCommands = @(
        'setup', 'status', 'doctor', 'bootstrap',
        'install', 'init', 'reinit', 'verify',
        'check-update', 'update', 'uninstall'
    )

    $script:ExpectedSourceOfTruthValues = @(
        'Claude', 'Codex', 'Gemini', 'GitHubCopilot',
        'Windsurf', 'Junie', 'Antigravity'
    )
}

Describe 'Contract: CLI entry point' {
    It 'bin/octopus.js exists and starts with node shebang' {
        Test-Path -LiteralPath $script:CliPath -PathType Leaf | Should -BeTrue
        (Get-Content -LiteralPath $script:CliPath -TotalCount 1) | Should -Match '#!/usr/bin/env node'
    }

    It 'node can parse octopus.js without syntax errors' {
        & node --check $script:CliPath *> $null
        $LASTEXITCODE | Should -Be 0
    }
}

Describe 'Contract: package.json aliases' {
    It 'exposes octopus, oao, and octopus-agent-orchestrator bin aliases' {
        $script:PackageJson.bin.octopus | Should -Be 'bin/octopus.js'
        $script:PackageJson.bin.oao | Should -Be 'bin/octopus.js'
        $script:PackageJson.bin.'octopus-agent-orchestrator' | Should -Be 'bin/octopus.js'
    }

    It 'requires Node 20 or newer' {
        $script:PackageJson.engines.node | Should -Be '>=20.0.0'
    }
}

Describe 'Contract: public commands' {
    It 'recognises all expected lifecycle commands' {
        foreach ($cmd in $script:ExpectedLifecycleCommands) {
            $script:CliSource | Should -Match "['`"]$cmd['`"]" -Because "CLI must include '$cmd'"
        }
    }

    It 'supports gate command family' {
        $script:CliSource | Should -Match "['`"]gate['`"]"
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
}

Describe 'Contract: deploy items exist' {
    It '<Item> exists in repo root' -ForEach $script:DeployItemData {
        Test-Path -LiteralPath (Join-Path $repoRoot $Item) | Should -BeTrue
    }
}

Describe 'Contract: gate inventory' {
    It 'contract doc lists <GateName>' -ForEach $script:GateNameData {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match ([regex]::Escape($GateName))
    }
}

Describe 'Contract: config artifact shapes' {
    It '<ConfigFile> exists in live/config and is valid JSON' -ForEach $script:ConfigFileData {
        $configPath = Join-Path $script:LiveRoot 'config' $ConfigFile
        Test-Path -LiteralPath $configPath -PathType Leaf | Should -BeTrue
        { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } | Should -Not -Throw
    }
}

Describe 'Contract: MANIFEST.md references' {
    BeforeAll {
        $script:ManifestContent = Get-Content -LiteralPath $script:ManifestPath -Raw
    }

    It 'references bin/octopus.js, src, and package.json' {
        $script:ManifestContent | Should -Match ([regex]::Escape('bin/octopus.js'))
        $script:ManifestContent | Should -Match ([regex]::Escape('src/**'))
        $script:ManifestContent | Should -Match ([regex]::Escape('package.json'))
    }

}

Describe 'Contract: VERSION consistency' {
    It 'VERSION file and package.json version match' {
        ((Get-Content -LiteralPath $script:VersionPath -Raw).Trim()) | Should -Be $script:PackageJson.version
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

    It 'contract doc preserves the Node 20 baseline' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match 'Node\.js >=20\.0\.0'
    }

    It 'verify markers are documented' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match ([regex]::Escape('Verification: PASS'))
        $contractContent | Should -Match ([regex]::Escape('Verification failed. Resolve listed issues and rerun.'))
    }
}

Describe 'Contract: overview and help golden markers' {
    It 'overview (no args) outputs OCTOPUS_OVERVIEW marker' -Skip:(-not $script:HasNode) {
        $joined = (& node $script:CliPath 2>&1 | Out-String)
        $joined | Should -Match 'OCTOPUS_OVERVIEW'
    }

    It 'help outputs Commands section' -Skip:(-not $script:HasNode) {
        $joined = (& node $script:CliPath help 2>&1 | Out-String)
        $joined | Should -Match 'Commands:'
        $joined | Should -Match 'Global options:'
    }

    It '--version outputs version string' -Skip:(-not $script:HasNode) {
        $versionText = ((& node $script:CliPath --version 2>&1 | Out-String).Trim())
        $expectedVersion = (Get-Content -LiteralPath $script:VersionPath -Raw).Trim()
        $versionText | Should -Match ([regex]::Escape($expectedVersion))
    }
}
