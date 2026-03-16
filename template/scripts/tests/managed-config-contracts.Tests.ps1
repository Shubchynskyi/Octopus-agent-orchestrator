#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    . (Join-Path $repoRoot 'scripts\lib\managed-config-contracts.ps1')

    function script:Read-JsonHashtable {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path
        )

        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }

    $script:TokenEconomyTemplate = Read-JsonHashtable -Path (Join-Path $repoRoot 'template\config\token-economy.json')
    $script:ReviewCapabilitiesTemplate = Read-JsonHashtable -Path (Join-Path $repoRoot 'template\config\review-capabilities.json')
    $script:PathsTemplate = Read-JsonHashtable -Path (Join-Path $repoRoot 'template\config\paths.json')
    $script:OutputFiltersTemplate = Read-JsonHashtable -Path (Join-Path $repoRoot 'template\config\output-filters.json')
}

Describe 'Merge-ManagedConfigWithTemplate' {
    It 'normalizes token-economy legacy keys and scalar values' {
        $existingConfig = [ordered]@{
            Enabled               = 'yes'
            enabledDepths         = '3, 1; 2; 2'
            stripExamples         = 'no'
            stripCodeBlocks       = '1'
            scopedDiffs           = '0'
            compactReviewerOutput = 'true'
            failTailLines         = '25'
            custom_note           = 'keep-me'
        }

        $result = Merge-ManagedConfigWithTemplate -ConfigName 'token-economy' -TemplateConfig $script:TokenEconomyTemplate -ExistingConfig $existingConfig

        $result.Value['enabled'] | Should -BeTrue
        ($result.Value['enabled_depths'] -join ',') | Should -Be '1,2,3'
        $result.Value['strip_examples'] | Should -BeFalse
        $result.Value['strip_code_blocks'] | Should -BeTrue
        $result.Value['scoped_diffs'] | Should -BeFalse
        $result.Value['compact_reviewer_output'] | Should -BeTrue
        $result.Value['fail_tail_lines'] | Should -Be 25
        $result.Value['custom_note'] | Should -Be 'keep-me'
        (($result.Changes | Select-Object -ExpandProperty Path) -join ',') | Should -Match 'enabled_depths'
    }

    It 'coerces review capabilities and drops invalid unknown flags' {
        $existingConfig = [ordered]@{
            Code             = 1
            Security         = 0
            Api              = ' yes '
            customCapability = 'true'
            badCapability    = 'maybe'
        }

        $result = Merge-ManagedConfigWithTemplate -ConfigName 'review-capabilities' -TemplateConfig $script:ReviewCapabilitiesTemplate -ExistingConfig $existingConfig

        $result.Value['code'] | Should -BeTrue
        $result.Value['security'] | Should -BeFalse
        $result.Value['api'] | Should -BeTrue
        $result.Value['customCapability'] | Should -BeTrue
        $result.Value.Contains('badCapability') | Should -BeFalse
        ($result.Changes | Where-Object { $_.Path -eq 'badCapability' }).Count | Should -Be 1
    }

    It 'moves legacy path trigger keys into canonical triggers and normalizes arrays' {
        $existingConfig = [ordered]@{
            metricsPath                 = '  Octopus-agent-orchestrator/runtime/custom-metrics.jsonl  '
            runtimeRoots                = "src/; app/"
            'fast-path-roots'           = @(' frontend/ ', 'web/')
            fast_path_allowed_regexes   = '^src/.+$'
            fast_path_sensitive_regexes = @('(^|/)(auth)(/|\\.|$)')
            sql_or_migration_regexes    = @('\.sql$')
            code_like_regexes           = @('\.ps1$')
            db_trigger_regexes          = @('^db/.+$', 42)
            triggers                    = @{
                security = @('^secure/.+$')
                release  = '^release/.+$'
            }
        }

        $result = Merge-ManagedConfigWithTemplate -ConfigName 'paths' -TemplateConfig $script:PathsTemplate -ExistingConfig $existingConfig

        $result.Value['metrics_path'] | Should -Be 'Octopus-agent-orchestrator/runtime/custom-metrics.jsonl'
        ($result.Value['runtime_roots'] -join ',') | Should -Be 'src/,app/'
        ($result.Value['fast_path_roots'] -join ',') | Should -Be 'frontend/,web/'
        ($result.Value['triggers']['db'] -join ',') | Should -Be '^db/.+$'
        ($result.Value['triggers']['security'] -join ',') | Should -Be '^secure/.+$'
        ($result.Value['triggers']['release'] -join ',') | Should -Be '^release/.+$'
        $result.Value['triggers'].Contains('api') | Should -BeTrue
        (($result.Changes | Select-Object -ExpandProperty Detail) -join ' ') | Should -Match 'moved into canonical'
    }

    It 'canonicalizes output-filter key aliases and restores missing managed profiles' {
        $existingConfig = [ordered]@{
            Version            = '3'
            passthroughCeiling = @{
                maxLines = '12'
                strategy = ' head '
            }
            profiles           = @{
                compileFailureConsole = @{
                    description   = '  custom desc  '
                    emitWhenEmpty = ' '
                    parser        = @{
                        type       = 'compile_failure_summary'
                        strategy   = ' generic '
                        maxMatches = '9'
                        tailCount  = '7'
                    }
                    operations    = @(
                        @{
                            type        = 'regex_replace'
                            pattern     = 'a+'
                            replacement = ' x '
                        },
                        @{
                            type     = 'truncate_line_length'
                            maxChars = '120'
                            suffix   = ' .. '
                        }
                    )
                }
            }
        }

        $result = Merge-ManagedConfigWithTemplate -ConfigName 'output-filters' -TemplateConfig $script:OutputFiltersTemplate -ExistingConfig $existingConfig
        $profiles = $result.Value['profiles']
        $compileProfile = $profiles['compile_failure_console']

        $result.Value['version'] | Should -Be 3
        $result.Value['passthrough_ceiling']['max_lines'] | Should -Be 12
        $result.Value['passthrough_ceiling']['strategy'] | Should -Be 'head'
        $compileProfile['description'] | Should -Be 'custom desc'
        $compileProfile['emit_when_empty'] | Should -Be ''
        $compileProfile['parser']['max_matches'] | Should -Be 9
        $compileProfile['parser']['tail_count'] | Should -Be 7
        $compileProfile['operations'][0]['replacement'] | Should -Be 'x'
        $compileProfile['operations'][1]['max_chars'] | Should -Be 120
        $compileProfile['operations'][1]['suffix'] | Should -Be '..'
        $profiles.Contains('test_failure_console') | Should -BeTrue
        (($result.Changes | Select-Object -ExpandProperty Path) -join ',') | Should -Match 'passthrough_ceiling.max_lines'
    }
}
