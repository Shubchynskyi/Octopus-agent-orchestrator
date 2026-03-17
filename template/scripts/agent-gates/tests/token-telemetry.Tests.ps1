#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'lib' 'gate-utils.psm1'
    Import-Module $ModulePath -Force
}

Describe 'Gate token telemetry' {
    It 'adds hybrid estimator metadata while keeping chars_per_4 baseline for output telemetry' {
        $rawLines = @(
            'if ($value -eq $null) {',
            "    return `$valueMap['x']",
            '}'
        )

        $telemetry = Get-GateOutputTelemetry -RawLines $rawLines -FilteredLines @()

        $telemetry.token_estimator | Should -Be 'hybrid_text_v1'
        $telemetry.legacy_token_estimator | Should -Be 'chars_per_4'
        $telemetry.raw_token_count_estimate | Should -BeGreaterThan 0
        $telemetry.filtered_token_count_estimate | Should -Be 0
        $telemetry.estimated_saved_tokens | Should -BeGreaterOrEqual $telemetry.estimated_saved_tokens_chars_per_4
    }

    It 'records token estimator metadata in rule-context artifact summary' {
        $repoRoot = Join-Path $TestDrive 'repo'
        $ruleDir = Join-Path $repoRoot 'docs'
        $runtimeDir = Join-Path $repoRoot 'runtime'
        $rulePath = Join-Path $ruleDir 'rule.md'
        $artifactPath = Join-Path $runtimeDir 'rule-context.md'

        New-Item -ItemType Directory -Path $ruleDir -Force | Out-Null
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        Set-Content -Path $rulePath -Encoding UTF8 -Value @(
            '# Rule'
            ''
            '## Example'
            ''
            'Bad example:'
            ''
            '```powershell'
            "Write-Host 'debug'"
            '```'
            ''
            'Keep this sentence.'
        )

        $artifact = New-GateRuleContextArtifact `
            -RepoRootPath $repoRoot `
            -SelectedRulePaths @('docs/rule.md') `
            -ArtifactPath $artifactPath `
            -StripExamples:$true `
            -StripCodeBlocks:$true

        $artifact.summary.token_estimator | Should -Be 'hybrid_text_v1'
        $artifact.summary.legacy_token_estimator | Should -Be 'chars_per_4'
        $artifact.summary.original_token_count_estimate | Should -BeGreaterOrEqual $artifact.summary.output_token_count_estimate
        $artifact.summary.estimated_saved_tokens | Should -BeGreaterOrEqual 0
        $artifact.summary.Keys | Should -Contain 'estimated_saved_tokens_chars_per_4'
    }

    It 'formats a visible savings line when filtering removes lines' {
        $rawLines = 1..12 | ForEach-Object { "line $_" }
        $filteredLines = @('line 1', 'line 12')

        $telemetry = Get-GateOutputTelemetry -RawLines $rawLines -FilteredLines $filteredLines
        $line = Get-GateVisibleSavingsLine -Telemetry $telemetry

        $line | Should -Be ("[token-economy] saved ~{0} tokens ({1} lines -> {2} lines)" -f $telemetry.estimated_saved_tokens, $telemetry.raw_line_count, $telemetry.filtered_line_count)
    }

    It 'formats char-based visible savings when line counts stay the same' {
        $rawLines = @(('alpha beta gamma ' * 40).Trim())
        $filteredLines = @('alpha beta gamma')

        $telemetry = Get-GateOutputTelemetry -RawLines $rawLines -FilteredLines $filteredLines
        $line = Get-GateVisibleSavingsLine -Telemetry $telemetry

        $line | Should -Be ("[token-economy] saved ~{0} tokens ({1} chars -> {2} chars)" -f $telemetry.estimated_saved_tokens, $telemetry.raw_char_count, $telemetry.filtered_char_count)
    }

    It 'suppresses the visible savings line when output is unchanged' {
        $telemetry = Get-GateOutputTelemetry -RawLines @('same output') -FilteredLines @('same output')

        Get-GateVisibleSavingsLine -Telemetry $telemetry | Should -Be $null
    }
}
