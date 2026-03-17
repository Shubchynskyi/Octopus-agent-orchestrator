#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $migrationModulePath = Join-Path $repoRoot 'scripts\lib\rule-contract-migrations.ps1'

    if (-not (Test-Path -LiteralPath $migrationModulePath -PathType Leaf)) {
        throw "Rule contract migrations module not found: $migrationModulePath"
    }

    . $migrationModulePath
}

Describe 'rule-contract-migrations.ps1' {
    It 'backfills the percent-aware token savings summary guidance into existing live 80-task-workflow content' {
        $legacyContent = @'
# 80. Task Workflow

- Final user report order is mandatory: implementation summary -> `git commit -m "<message>"` suggestion -> `Do you want me to commit now? (yes/no)`.
- Required changelog or evidence updates to ignored orchestrator paths must stay local on disk; do not use `git add -f` unless the user explicitly requests versioning orchestrator internals.
- HARD STOP: do not force-stage ignored orchestration control-plane files just because gates, changelog, or reviews reference them.
'@

        $result = Invoke-RuleContractMigrationsForContent `
            -Content $legacyContent `
            -RelativePath 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md'
        $tokenSavingsLine = [regex]::Escape('At `depth=1` and `depth=2`, the implementation summary must include a token-economy savings line; at `depth=3` it is optional. Include approximate percentage when baseline is known and keep spaced breakdown formatting: `Saved tokens: ~882 (~67%) (824 code review context + 25 DB review context + 33 compile gate output).`')
        $commitPromptLine = [regex]::Escape('Do you want me to commit now? (yes/no)')

        $result.AppliedCount | Should -BeGreaterThan 0
        $result.Content | Should -Match $tokenSavingsLine
        $result.Content | Should -Match $commitPromptLine
    }
}
