#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
<#
.SYNOPSIS
Parity regression tests for the PowerShell output-filter engine (gate-utils.psm1).

Uses the same fixture config and expected outcomes as
test_gate_utils_output_filters.py to prove behavioral parity with the Python
engine across all four gate profiles (compile, test, lint, review), fallback
handling, and edge cases.

Run:
    Invoke-Pester template/scripts/agent-gates/tests/gate-utils-output-filters.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'lib' 'gate-utils.psm1'
    Import-Module $ModulePath -Force

    $script:FixtureConfig = Join-Path $PSScriptRoot 'fixtures' 'output-filters-parity.json'

    # Shared input line sets (identical values used in the Python tests)
    $script:LargePassthroughLines = 1..10 | ForEach-Object { "[INFO] Build step $_" }
    $script:MavenFullLines = @(
        "`e[34m[INFO]`e[0m Scanning for projects...",
        '[ERROR] COMPILATION ERROR',
        '[ERROR] src/Main.java:5: error: cannot find symbol',
        '[ERROR] src/Main.java:12: error: method not found',
        '[INFO] BUILD FAILURE',
        '[INFO] tail line A',
        '[INFO] tail line B'
    )
    $script:MavenDegradedLines = @(
        '[INFO] Scanning for projects...',
        '[WARNING] Deprecated API usage',
        'An error occurred during postprocessing',
        '[INFO] Done'
    )
    $script:MavenPassthroughLines = @(
        '[INFO] Build started',
        '[INFO] Compilation successful',
        '[INFO] Done'
    )
    $script:TestFullLines = @(
        'Running tests...',
        '--- FAIL: TestAddNumbers (0.002s)',
        '    got 2, want 3',
        'FAIL github.com/example/pkg',
        'tail line A',
        'tail line B'
    )
    $script:TestPassthroughLines = @(
        'Running tests...',
        'ok  github.com/example/pkg 0.001s',
        'All tests passed'
    )
    $script:LintFullLines = @(
        'Linting sources...',
        'src/main.ts:5:10: error no-unused-vars',
        'src/main.ts:8:3: warning prefer-const',
        'Found 2 errors',
        'tail line A',
        'tail line B'
    )
    $script:LintPassthroughLines = @(
        'Linting sources...',
        'No issues found',
        'Done'
    )
    $script:ReviewLines = @(
        'VERDICT: PASS',
        'Summary: All checks passed',
        'Details: Clean diff',
        'Extra line 1',
        'Extra line 2'
    )
    $script:AnsiLines = @(
        "`e[31mError message`e[0m",
        "`e[32mSuccess line`e[0m",
        'Plain line'
    )

    function script:Invoke-Filter {
        param([string]$Profile, [string[]]$Lines, [hashtable]$Context = @{})
        return Invoke-GateOutputFilter -Lines $Lines -ConfigPath $script:FixtureConfig -ProfileName $Profile -ContextData $Context
    }
}

# ---------------------------------------------------------------------------
# Compile gate — maven strategy
# ---------------------------------------------------------------------------
Describe 'Compile gate — maven strategy' {
    Context 'FULL mode on error lines' {
        BeforeAll { $script:r = Invoke-Filter 'p_compile_maven' $script:MavenFullLines }

        It 'sets filter_mode to profile:p_compile_maven' {
            $script:r.filter_mode | Should -Be 'profile:p_compile_maven'
        }
        It 'sets parser_mode to FULL' {
            $script:r.parser_mode | Should -Be 'FULL'
        }
        It 'sets parser_name to compile_failure_summary' {
            $script:r.parser_name | Should -Be 'compile_failure_summary'
        }
        It 'sets parser_strategy to maven' {
            $script:r.parser_strategy | Should -Be 'maven'
        }
        It 'sets fallback_mode to none' {
            $script:r.fallback_mode | Should -Be 'none'
        }
        It 'includes CompactSummary FULL header line' {
            $script:r.lines | Should -Contain 'CompactSummary: FULL | strategy=maven'
        }
        It 'surfaces at least one [ERROR] line' {
            ($script:r.lines | Where-Object { $_ -like '*[ERROR]*' }).Count | Should -BeGreaterThan 0
        }
        It 'includes tail line A' {
            $script:r.lines | Should -Contain '[INFO] tail line A'
        }
        It 'includes tail line B' {
            $script:r.lines | Should -Contain '[INFO] tail line B'
        }
        It 'strips ANSI codes from all output lines' {
            foreach ($ln in $script:r.lines) {
                $ln | Should -Not -Match '\x1b\['
            }
        }
    }

    Context 'DEGRADED mode on warning-only lines' {
        BeforeAll { $script:r = Invoke-Filter 'p_compile_maven' $script:MavenDegradedLines }

        It 'sets parser_mode to DEGRADED' {
            $script:r.parser_mode | Should -Be 'DEGRADED'
        }
        It 'sets parser_strategy to maven' {
            $script:r.parser_strategy | Should -Be 'maven'
        }
        It 'sets fallback_mode to none' {
            $script:r.fallback_mode | Should -Be 'none'
        }
        It 'includes CompactSummary DEGRADED header' {
            $script:r.lines | Should -Contain 'CompactSummary: DEGRADED | strategy=maven'
        }
    }

    Context 'PASSTHROUGH mode on clean output' {
        BeforeAll { $script:r = Invoke-Filter 'p_compile_maven' $script:MavenPassthroughLines }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'sets fallback_mode to parser_passthrough' {
            $script:r.fallback_mode | Should -Be 'parser_passthrough'
        }
        It 'preserves lines unchanged' {
            $script:r.lines | Should -Be $script:MavenPassthroughLines
        }
    }

    Context 'truncate_line_length' {
        It 'truncates lines exceeding max_chars=100' {
            $longInput = @('[ERROR] ' + ('x' * 200))
            $result = Invoke-Filter 'p_compile_maven' $longInput
            $errorLines = @($result.lines | Where-Object { $_ -like '*[ERROR]*' })
            $errorLines.Count | Should -BeGreaterThan 0
            foreach ($ln in $errorLines) {
                $ln.Length | Should -BeLessOrEqual 100
            }
        }
    }

    Context 'context key resolution' {
        It 'resolves strategy and tail_count from context data' {
            $ctx = @{ command_filter_strategy = 'maven'; fail_tail_lines = 1 }
            $result = Invoke-Filter 'p_compile_ctx' $script:MavenFullLines -Context $ctx
            $result.parser_mode | Should -Be 'FULL'
            $result.parser_strategy | Should -Be 'maven'
        }
    }
}

# ---------------------------------------------------------------------------
# Test gate
# ---------------------------------------------------------------------------
Describe 'Test gate' {
    Context 'FULL mode on fail lines' {
        BeforeAll { $script:r = Invoke-Filter 'p_test_failure' $script:TestFullLines }

        It 'sets filter_mode to profile:p_test_failure' {
            $script:r.filter_mode | Should -Be 'profile:p_test_failure'
        }
        It 'sets parser_mode to FULL' {
            $script:r.parser_mode | Should -Be 'FULL'
        }
        It 'sets parser_name to test_failure_summary' {
            $script:r.parser_name | Should -Be 'test_failure_summary'
        }
        It 'sets parser_strategy to test' {
            $script:r.parser_strategy | Should -Be 'test'
        }
        It 'sets fallback_mode to none' {
            $script:r.fallback_mode | Should -Be 'none'
        }
        It 'includes CompactSummary FULL header' {
            $script:r.lines | Should -Contain 'CompactSummary: FULL | strategy=test'
        }
        It 'surfaces the --- FAIL: line' {
            ($script:r.lines | Where-Object { $_ -like '*--- FAIL:*' }).Count | Should -BeGreaterThan 0
        }
    }

    Context 'PASSTHROUGH on success output' {
        BeforeAll { $script:r = Invoke-Filter 'p_test_failure' $script:TestPassthroughLines }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'sets fallback_mode to parser_passthrough' {
            $script:r.fallback_mode | Should -Be 'parser_passthrough'
        }
    }
}

# ---------------------------------------------------------------------------
# Lint gate
# ---------------------------------------------------------------------------
Describe 'Lint gate' {
    Context 'FULL mode on lint errors' {
        BeforeAll { $script:r = Invoke-Filter 'p_lint_failure' $script:LintFullLines }

        It 'sets parser_mode to FULL' {
            $script:r.parser_mode | Should -Be 'FULL'
        }
        It 'sets parser_name to lint_failure_summary' {
            $script:r.parser_name | Should -Be 'lint_failure_summary'
        }
        It 'sets parser_strategy to lint' {
            $script:r.parser_strategy | Should -Be 'lint'
        }
        It 'sets fallback_mode to none' {
            $script:r.fallback_mode | Should -Be 'none'
        }
        It 'includes CompactSummary FULL header' {
            $script:r.lines | Should -Contain 'CompactSummary: FULL | strategy=lint'
        }
    }

    Context 'PASSTHROUGH on clean lint' {
        BeforeAll { $script:r = Invoke-Filter 'p_lint_failure' $script:LintPassthroughLines }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'sets fallback_mode to parser_passthrough' {
            $script:r.fallback_mode | Should -Be 'parser_passthrough'
        }
    }
}

# ---------------------------------------------------------------------------
# Review gate
# ---------------------------------------------------------------------------
Describe 'Review gate' {
    Context 'failure profile — truncates to max_lines' {
        BeforeAll { $script:r = Invoke-Filter 'p_review_fail' $script:ReviewLines }

        It 'sets filter_mode to profile:p_review_fail' {
            $script:r.filter_mode | Should -Be 'profile:p_review_fail'
        }
        It 'sets parser_mode to FULL' {
            $script:r.parser_mode | Should -Be 'FULL'
        }
        It 'sets parser_name to review_gate_summary' {
            $script:r.parser_name | Should -Be 'review_gate_summary'
        }
        It 'sets parser_strategy to review' {
            $script:r.parser_strategy | Should -Be 'review'
        }
        It 'returns exactly max_lines=3 lines' {
            $script:r.lines.Count | Should -Be 3
        }
        It 'preserves first line as VERDICT: PASS' {
            $script:r.lines[0] | Should -Be 'VERDICT: PASS'
        }
        It 'preserves second line as Summary' {
            $script:r.lines[1] | Should -Be 'Summary: All checks passed'
        }
    }

    Context 'success profile — max_total_lines then parser' {
        BeforeAll { $script:r = Invoke-Filter 'p_review_success' $script:ReviewLines }

        It 'sets parser_mode to FULL' {
            $script:r.parser_mode | Should -Be 'FULL'
        }
        It 'returns 2 lines after max_total_lines=2 pre-truncation' {
            $script:r.lines.Count | Should -Be 2
        }
        It 'first line is VERDICT: PASS' {
            $script:r.lines[0] | Should -Be 'VERDICT: PASS'
        }
    }

    Context 'PASSTHROUGH on empty input' {
        BeforeAll { $script:r = Invoke-Filter 'p_review_fail' @() }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'sets fallback_mode to parser_passthrough' {
            $script:r.fallback_mode | Should -Be 'parser_passthrough'
        }
    }
}

# ---------------------------------------------------------------------------
# emit_when_empty
# ---------------------------------------------------------------------------
Describe 'emit_when_empty' {
    It 'returns emit string when all lines are dropped' {
        $result = Invoke-Filter 'p_emit_empty' @('line 1', 'line 2')
        $result.lines | Should -Be @('PASS: output suppressed')
        $result.filter_mode | Should -Be 'profile:p_emit_empty'
    }

    It 'returns emit string when input is empty' {
        $result = Invoke-Filter 'p_emit_empty' @()
        $result.lines | Should -Be @('PASS: output suppressed')
    }
}

# ---------------------------------------------------------------------------
# Fallback cases
# ---------------------------------------------------------------------------
Describe 'Fallback cases' {
    It 'empty profile name returns passthrough with fallback_mode=none' {
        $result = Invoke-Filter '' @('line')
        $result.filter_mode | Should -Be 'passthrough'
        $result.fallback_mode | Should -Be 'none'
    }

    It 'unknown profile name returns missing_profile_passthrough' {
        $result = Invoke-Filter 'nonexistent_profile' @('line')
        $result.filter_mode | Should -Be 'passthrough'
        $result.fallback_mode | Should -Be 'missing_profile_passthrough'
    }

    It 'missing config path returns missing_config_passthrough' {
        $result = Invoke-GateOutputFilter -Lines @('line') -ConfigPath 'C:\nonexistent\path.json' -ProfileName 'p_compile_maven'
        $result.filter_mode | Should -Be 'passthrough'
        $result.fallback_mode | Should -Be 'missing_config_passthrough'
    }

    It 'legacy single-object operations are processed tolerantly (PowerShell-specific behavior)' {
        <#
        PowerShell iterates a dict as a single operation element and processes it
        without error, so filter_mode is set to the profile name.
        Python raises ValueError and falls back to invalid_profile_passthrough.
        This divergence is documented in test_legacy_single_object_ops_falls_back
        in test_gate_utils_output_filters.py and is the parity bug targeted by T-001.
        #>
        $result = Invoke-Filter 'p_legacy_ops' @("line with `e[31merror`e[0m")
        $result.filter_mode | Should -Be 'profile:p_legacy_ops'
    }
}

# ---------------------------------------------------------------------------
# Passthrough ceiling
# ---------------------------------------------------------------------------
Describe 'Passthrough ceiling' {
    Context 'parser PASSTHROUGH with >ceiling lines applies ceiling' {
        BeforeAll { $script:r = Invoke-Filter 'p_compile_maven' $script:LargePassthroughLines }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'sets fallback_mode to parser_passthrough' {
            $script:r.fallback_mode | Should -Be 'parser_passthrough'
        }
        It 'returns ceiling+1 lines (header + 5 tail)' {
            $script:r.lines.Count | Should -Be 6
        }
        It 'first line is passthrough-ceiling header' {
            $script:r.lines[0] | Should -Match '^\[passthrough-ceiling\]'
        }
        It 'header contains fallback=parser_passthrough' {
            $script:r.lines[0] | Should -Match 'fallback=parser_passthrough'
        }
        It 'header contains total=10' {
            $script:r.lines[0] | Should -Match 'total=10'
        }
        It 'header contains ceiling=5' {
            $script:r.lines[0] | Should -Match 'ceiling=5'
        }
        It 'last line is the final input line (tail strategy)' {
            $script:r.lines[-1] | Should -Be '[INFO] Build step 10'
        }
        It 'second line is the 6th input line (tail of 5 from 10)' {
            $script:r.lines[1] | Should -Be '[INFO] Build step 6'
        }
    }

    Context 'parser PASSTHROUGH with <=ceiling lines passes through unchanged' {
        BeforeAll { $script:r = Invoke-Filter 'p_compile_maven' $script:MavenPassthroughLines }

        It 'sets parser_mode to PASSTHROUGH' {
            $script:r.parser_mode | Should -Be 'PASSTHROUGH'
        }
        It 'preserves lines unchanged (no header added)' {
            $script:r.lines | Should -Be $script:MavenPassthroughLines
        }
    }

    Context 'profile-level passthrough (unknown profile) with >ceiling lines applies ceiling' {
        BeforeAll { $script:r = Invoke-Filter 'nonexistent_profile' $script:LargePassthroughLines }

        It 'sets fallback_mode to missing_profile_passthrough' {
            $script:r.fallback_mode | Should -Be 'missing_profile_passthrough'
        }
        It 'returns ceiling+1 lines' {
            $script:r.lines.Count | Should -Be 6
        }
        It 'first line is passthrough-ceiling header' {
            $script:r.lines[0] | Should -Match '^\[passthrough-ceiling\]'
        }
        It 'header contains fallback=missing_profile_passthrough' {
            $script:r.lines[0] | Should -Match 'fallback=missing_profile_passthrough'
        }
    }

    Context 'missing config (no ceiling config) uses hardcoded default and applies ceiling' {
        BeforeAll {
            $bigLines = 1..70 | ForEach-Object { "line $_" }
            $script:r = Invoke-GateOutputFilter -Lines $bigLines -ConfigPath 'C:\nonexistent\path.json' -ProfileName 'p_compile_maven'
        }

        It 'sets fallback_mode to missing_config_passthrough' {
            $script:r.fallback_mode | Should -Be 'missing_config_passthrough'
        }
        It 'returns hardcoded-ceiling+1 lines (61 = header + 60)' {
            $script:r.lines.Count | Should -Be 61
        }
        It 'first line is passthrough-ceiling header' {
            $script:r.lines[0] | Should -Match '^\[passthrough-ceiling\]'
        }
        It 'header contains ceiling=60' {
            $script:r.lines[0] | Should -Match 'ceiling=60'
        }
    }
}

# ---------------------------------------------------------------------------
# ANSI stripping
# ---------------------------------------------------------------------------
Describe 'ANSI stripping' {
    It 'strips ANSI codes from review gate output' {
        $result = Invoke-Filter 'p_review_fail' $script:AnsiLines
        foreach ($ln in $result.lines) {
            $ln | Should -Not -Match '\x1b\['
        }
    }

    It 'strips ANSI codes before parser matching so patterns still apply' {
        $ansiErrorLines = @(
            "`e[31m[ERROR] COMPILATION ERROR`e[0m",
            'BUILD FAILURE',
            'tail line A',
            'tail line B'
        )
        $result = Invoke-Filter 'p_compile_maven' $ansiErrorLines
        $result.parser_mode | Should -Be 'FULL'
        $result.parser_strategy | Should -Be 'maven'
    }
}
