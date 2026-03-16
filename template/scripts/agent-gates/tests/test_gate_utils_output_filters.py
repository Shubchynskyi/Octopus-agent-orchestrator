"""Parity regression tests for the Python output-filter engine (gate_utils.py).

Uses the same fixture config and expected outcomes as
gate-utils-output-filters.Tests.ps1 to prove behavioral parity with
the PowerShell engine across all four gate profiles (compile, test,
lint, review), fallback handling, and edge cases.

Run:
    pytest template/scripts/agent-gates/tests/test_gate_utils_output_filters.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
from gate_utils import apply_output_filter_profile  # noqa: E402

FIXTURE_CONFIG = Path(__file__).parent / "fixtures" / "output-filters-parity.json"

# ---------------------------------------------------------------------------
# Shared input line sets (identical values used in the PowerShell tests)
# ---------------------------------------------------------------------------
MAVEN_FULL_LINES = [
    "\x1b[34m[INFO]\x1b[0m Scanning for projects...",
    "[ERROR] COMPILATION ERROR",
    "[ERROR] src/Main.java:5: error: cannot find symbol",
    "[ERROR] src/Main.java:12: error: method not found",
    "[INFO] BUILD FAILURE",
    "[INFO] tail line A",
    "[INFO] tail line B",
]

MAVEN_DEGRADED_LINES = [
    "[INFO] Scanning for projects...",
    "[WARNING] Deprecated API usage",
    "An error occurred during postprocessing",
    "[INFO] Done",
]

MAVEN_PASSTHROUGH_LINES = [
    "[INFO] Build started",
    "[INFO] Compilation successful",
    "[INFO] Done",
]

TEST_FULL_LINES = [
    "Running tests...",
    "--- FAIL: TestAddNumbers (0.002s)",
    "    got 2, want 3",
    "FAIL github.com/example/pkg",
    "tail line A",
    "tail line B",
]

TEST_PASSTHROUGH_LINES = [
    "Running tests...",
    "ok  github.com/example/pkg 0.001s",
    "All tests passed",
]

LINT_FULL_LINES = [
    "Linting sources...",
    "src/main.ts:5:10: error no-unused-vars",
    "src/main.ts:8:3: warning prefer-const",
    "Found 2 errors",
    "tail line A",
    "tail line B",
]

LINT_PASSTHROUGH_LINES = [
    "Linting sources...",
    "No issues found",
    "Done",
]

REVIEW_LINES = [
    "VERDICT: PASS",
    "Summary: All checks passed",
    "Details: Clean diff",
    "Extra line 1",
    "Extra line 2",
]

ANSI_LINES = [
    "\x1b[31mError message\x1b[0m",
    "\x1b[32mSuccess line\x1b[0m",
    "Plain line",
]

LARGE_PASSTHROUGH_LINES = [f"[INFO] Build step {i + 1}" for i in range(10)]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def run(profile: str, lines: list[str], context: dict | None = None) -> dict:
    return apply_output_filter_profile(lines, FIXTURE_CONFIG, profile, context=context)


# ---------------------------------------------------------------------------
# Compile gate — maven strategy
# ---------------------------------------------------------------------------
class TestCompileMaven:
    def test_full_mode_sets_filter_mode(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert result["filter_mode"] == "profile:p_compile_maven"

    def test_full_mode_sets_parser_mode(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert result["parser_mode"] == "FULL"

    def test_full_mode_sets_parser_name(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert result["parser_name"] == "compile_failure_summary"

    def test_full_mode_sets_parser_strategy(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert result["parser_strategy"] == "maven"

    def test_full_mode_sets_fallback_none(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert result["fallback_mode"] == "none"

    def test_full_mode_includes_compact_summary_header(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert any("CompactSummary: FULL | strategy=maven" in ln for ln in result["lines"])

    def test_full_mode_surfaces_error_lines(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert any("[ERROR]" in ln for ln in result["lines"])

    def test_full_mode_includes_tail_lines(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        assert any("tail line A" in ln for ln in result["lines"])
        assert any("tail line B" in ln for ln in result["lines"])

    def test_full_mode_strips_ansi(self):
        result = run("p_compile_maven", MAVEN_FULL_LINES)
        for ln in result["lines"]:
            assert "\x1b[" not in ln

    def test_degraded_mode_sets_parser_mode(self):
        result = run("p_compile_maven", MAVEN_DEGRADED_LINES)
        assert result["parser_mode"] == "DEGRADED"

    def test_degraded_mode_sets_parser_strategy(self):
        result = run("p_compile_maven", MAVEN_DEGRADED_LINES)
        assert result["parser_strategy"] == "maven"

    def test_degraded_mode_sets_fallback_none(self):
        result = run("p_compile_maven", MAVEN_DEGRADED_LINES)
        assert result["fallback_mode"] == "none"

    def test_degraded_mode_includes_compact_summary_header(self):
        result = run("p_compile_maven", MAVEN_DEGRADED_LINES)
        assert any("CompactSummary: DEGRADED | strategy=maven" in ln for ln in result["lines"])

    def test_passthrough_mode_on_clean_output(self):
        result = run("p_compile_maven", MAVEN_PASSTHROUGH_LINES)
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["fallback_mode"] == "parser_passthrough"

    def test_passthrough_mode_preserves_lines(self):
        result = run("p_compile_maven", MAVEN_PASSTHROUGH_LINES)
        assert result["lines"] == MAVEN_PASSTHROUGH_LINES

    def test_truncates_long_error_lines(self):
        long_input = ["[ERROR] " + "x" * 200]
        result = run("p_compile_maven", long_input)
        error_lines = [ln for ln in result["lines"] if "[ERROR]" in ln]
        assert error_lines, "expected [ERROR] line in output"
        for ln in error_lines:
            assert len(ln) <= 100

    def test_context_key_resolves_strategy_and_tail(self):
        ctx = {"command_filter_strategy": "maven", "fail_tail_lines": 1}
        result = run("p_compile_ctx", MAVEN_FULL_LINES, context=ctx)
        assert result["parser_mode"] == "FULL"
        assert result["parser_strategy"] == "maven"


# ---------------------------------------------------------------------------
# Test gate
# ---------------------------------------------------------------------------
class TestTestGate:
    def test_full_mode_sets_filter_mode(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert result["filter_mode"] == "profile:p_test_failure"

    def test_full_mode_sets_parser_mode(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert result["parser_mode"] == "FULL"

    def test_full_mode_sets_parser_name(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert result["parser_name"] == "test_failure_summary"

    def test_full_mode_sets_parser_strategy(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert result["parser_strategy"] == "test"

    def test_full_mode_sets_fallback_none(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert result["fallback_mode"] == "none"

    def test_full_mode_includes_compact_summary_header(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert any("CompactSummary: FULL | strategy=test" in ln for ln in result["lines"])

    def test_full_mode_surfaces_fail_line(self):
        result = run("p_test_failure", TEST_FULL_LINES)
        assert any("--- FAIL:" in ln for ln in result["lines"])

    def test_passthrough_on_success_output(self):
        result = run("p_test_failure", TEST_PASSTHROUGH_LINES)
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["fallback_mode"] == "parser_passthrough"


# ---------------------------------------------------------------------------
# Lint gate
# ---------------------------------------------------------------------------
class TestLintGate:
    def test_full_mode_sets_parser_mode(self):
        result = run("p_lint_failure", LINT_FULL_LINES)
        assert result["parser_mode"] == "FULL"

    def test_full_mode_sets_parser_name(self):
        result = run("p_lint_failure", LINT_FULL_LINES)
        assert result["parser_name"] == "lint_failure_summary"

    def test_full_mode_sets_parser_strategy(self):
        result = run("p_lint_failure", LINT_FULL_LINES)
        assert result["parser_strategy"] == "lint"

    def test_full_mode_sets_fallback_none(self):
        result = run("p_lint_failure", LINT_FULL_LINES)
        assert result["fallback_mode"] == "none"

    def test_full_mode_includes_compact_summary_header(self):
        result = run("p_lint_failure", LINT_FULL_LINES)
        assert any("CompactSummary: FULL | strategy=lint" in ln for ln in result["lines"])

    def test_passthrough_on_clean_lint(self):
        result = run("p_lint_failure", LINT_PASSTHROUGH_LINES)
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["fallback_mode"] == "parser_passthrough"


# ---------------------------------------------------------------------------
# Review gate
# ---------------------------------------------------------------------------
class TestReviewGate:
    def test_failure_profile_sets_filter_mode(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["filter_mode"] == "profile:p_review_fail"

    def test_failure_profile_sets_parser_mode(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["parser_mode"] == "FULL"

    def test_failure_profile_sets_parser_name(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["parser_name"] == "review_gate_summary"

    def test_failure_profile_sets_parser_strategy(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["parser_strategy"] == "review"

    def test_failure_profile_truncates_to_max_lines(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert len(result["lines"]) == 3  # max_lines=3

    def test_failure_profile_preserves_first_line(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["lines"][0] == "VERDICT: PASS"

    def test_failure_profile_preserves_second_line(self):
        result = run("p_review_fail", REVIEW_LINES)
        assert result["lines"][1] == "Summary: All checks passed"

    def test_success_profile_applies_max_total_lines_then_parser(self):
        # max_total_lines=2 (head) → 2 lines → parser max_lines=4 → 2 lines returned
        result = run("p_review_success", REVIEW_LINES)
        assert result["parser_mode"] == "FULL"
        assert len(result["lines"]) == 2
        assert result["lines"][0] == "VERDICT: PASS"

    def test_passthrough_on_empty_input(self):
        result = run("p_review_fail", [])
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["fallback_mode"] == "parser_passthrough"


# ---------------------------------------------------------------------------
# emit_when_empty
# ---------------------------------------------------------------------------
class TestEmitWhenEmpty:
    def test_returns_emit_string_when_all_lines_dropped(self):
        result = run("p_emit_empty", ["line 1", "line 2"])
        assert result["lines"] == ["PASS: output suppressed"]
        assert result["filter_mode"] == "profile:p_emit_empty"

    def test_returns_emit_string_on_empty_input(self):
        result = run("p_emit_empty", [])
        assert result["lines"] == ["PASS: output suppressed"]


# ---------------------------------------------------------------------------
# Fallback cases
# ---------------------------------------------------------------------------
class TestFallbacks:
    def test_empty_profile_name_returns_passthrough(self):
        result = run("", ["line"])
        assert result["filter_mode"] == "passthrough"
        assert result["fallback_mode"] == "none"

    def test_unknown_profile_returns_missing_profile_passthrough(self):
        result = run("nonexistent_profile", ["line"])
        assert result["filter_mode"] == "passthrough"
        assert result["fallback_mode"] == "missing_profile_passthrough"

    def test_missing_config_path_returns_missing_config_passthrough(self):
        result = apply_output_filter_profile(
            ["line"], Path("/nonexistent/path.json"), "p_compile_maven"
        )
        assert result["filter_mode"] == "passthrough"
        assert result["fallback_mode"] == "missing_config_passthrough"

    def test_legacy_single_object_ops_falls_back(self):
        """Python raises ValueError for non-list operations → invalid_profile_passthrough.

        PowerShell handles this tolerantly (iterates dict as single operation).
        This divergence is documented in gate-utils-output-filters.Tests.ps1 and
        is the parity bug targeted by T-001: needs object->array normalization in
        apply_output_filter_profile before the isinstance check.
        """
        result = run("p_legacy_ops", ["line with \x1b[31merror\x1b[0m"])
        assert result["fallback_mode"] == "invalid_profile_passthrough"
        assert result["filter_mode"] == "passthrough"


# ---------------------------------------------------------------------------
# Passthrough ceiling
# ---------------------------------------------------------------------------
class TestPassthroughCeiling:
    def test_parser_passthrough_ceiling_applied_when_over_limit(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["fallback_mode"] == "parser_passthrough"
        # ceiling=5 from fixture, so 1 header + 5 tail lines = 6
        assert len(result["lines"]) == 6

    def test_parser_passthrough_ceiling_header_is_first_line(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert result["lines"][0].startswith("[passthrough-ceiling]")

    def test_parser_passthrough_ceiling_header_contains_fallback(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert "fallback=parser_passthrough" in result["lines"][0]

    def test_parser_passthrough_ceiling_header_contains_total(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert "total=10" in result["lines"][0]

    def test_parser_passthrough_ceiling_header_contains_ceiling(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert "ceiling=5" in result["lines"][0]

    def test_parser_passthrough_ceiling_tail_strategy_keeps_last_lines(self):
        result = run("p_compile_maven", LARGE_PASSTHROUGH_LINES)
        assert result["lines"][1] == "[INFO] Build step 6"
        assert result["lines"][-1] == "[INFO] Build step 10"

    def test_parser_passthrough_no_ceiling_when_under_limit(self):
        result = run("p_compile_maven", MAVEN_PASSTHROUGH_LINES)
        assert result["parser_mode"] == "PASSTHROUGH"
        assert result["lines"] == MAVEN_PASSTHROUGH_LINES

    def test_profile_passthrough_ceiling_applied_for_unknown_profile(self):
        result = run("nonexistent_profile", LARGE_PASSTHROUGH_LINES)
        assert result["fallback_mode"] == "missing_profile_passthrough"
        assert len(result["lines"]) == 6
        assert result["lines"][0].startswith("[passthrough-ceiling]")
        assert "fallback=missing_profile_passthrough" in result["lines"][0]

    def test_missing_config_uses_hardcoded_default_ceiling(self):
        big_lines = [f"line {i}" for i in range(70)]
        result = apply_output_filter_profile(
            big_lines, Path("/nonexistent/path.json"), "p_compile_maven"
        )
        assert result["fallback_mode"] == "missing_config_passthrough"
        # hardcoded default is 60, so 1 header + 60 tail = 61 lines
        assert len(result["lines"]) == 61
        assert "ceiling=60" in result["lines"][0]


# ---------------------------------------------------------------------------
# ANSI stripping
# ---------------------------------------------------------------------------
class TestAnsiStripping:
    def test_ansi_stripped_from_review_output(self):
        result = run("p_review_fail", ANSI_LINES)
        for ln in result["lines"]:
            assert "\x1b[" not in ln

    def test_ansi_stripped_before_parser_matching(self):
        # ANSI-wrapped [ERROR] should still be found by maven parser after strip
        ansi_error_lines = [
            "\x1b[31m[ERROR] COMPILATION ERROR\x1b[0m",
            "BUILD FAILURE",
            "tail line A",
            "tail line B",
        ]
        result = run("p_compile_maven", ansi_error_lines)
        assert result["parser_mode"] == "FULL"
        assert result["parser_strategy"] == "maven"
