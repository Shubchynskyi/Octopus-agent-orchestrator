from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from gate_utils import build_output_telemetry, build_rule_context_artifact, format_visible_savings_line  # noqa: E402


def _expected_saved_percent(saved_tokens: int, raw_token_count_estimate: int) -> int:
    return int(((saved_tokens * 100.0) / raw_token_count_estimate) + 0.5)


def test_output_telemetry_uses_hybrid_estimator_and_keeps_legacy_baseline() -> None:
    raw_lines = [
        "if (value == null) {",
        "    return value_map['x'];",
        "}",
    ]

    telemetry = build_output_telemetry(raw_lines, [])

    assert telemetry["token_estimator"] == "hybrid_text_v1"
    assert telemetry["legacy_token_estimator"] == "chars_per_4"
    assert telemetry["raw_token_count_estimate"] > 0
    assert telemetry["filtered_token_count_estimate"] == 0
    assert telemetry["estimated_saved_tokens"] >= telemetry["estimated_saved_tokens_chars_per_4"]


def test_rule_context_artifact_summary_records_token_estimator_metadata(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    rule_dir = repo_root / "docs"
    out_dir = repo_root / "runtime"
    rule_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    rule_path = rule_dir / "rule.md"
    rule_path.write_text(
        "# Rule\n\n"
        "## Example\n\n"
        "Bad example:\n\n"
        "```powershell\n"
        "Write-Host 'debug'\n"
        "```\n\n"
        "Keep this sentence.\n",
        encoding="utf-8",
    )

    artifact = build_rule_context_artifact(
        repo_root,
        selected_rule_paths=["docs/rule.md"],
        artifact_path=out_dir / "rule-context.md",
        strip_examples=True,
        strip_code_blocks=True,
    )

    summary = artifact["summary"]
    assert summary["token_estimator"] == "hybrid_text_v1"
    assert summary["legacy_token_estimator"] == "chars_per_4"
    assert summary["original_token_count_estimate"] >= summary["output_token_count_estimate"]
    assert summary["estimated_saved_tokens"] >= 0
    assert "estimated_saved_tokens_chars_per_4" in summary


def test_visible_savings_line_formats_approximate_token_percent_for_line_compaction() -> None:
    telemetry = build_output_telemetry(
        [f"line {index}" for index in range(1, 13)],
        ["line 1", "line 12"],
    )

    assert format_visible_savings_line(telemetry) == (
        f"[token-economy] saved ~{telemetry['estimated_saved_tokens']} tokens "
        f"(~{_expected_saved_percent(telemetry['estimated_saved_tokens'], telemetry['raw_token_count_estimate'])}%)"
    )


def test_visible_savings_line_formats_approximate_token_percent_for_char_only_compaction() -> None:
    telemetry = build_output_telemetry(
        [("alpha beta gamma " * 40).strip()],
        ["alpha beta gamma"],
    )

    assert format_visible_savings_line(telemetry) == (
        f"[token-economy] saved ~{telemetry['estimated_saved_tokens']} tokens "
        f"(~{_expected_saved_percent(telemetry['estimated_saved_tokens'], telemetry['raw_token_count_estimate'])}%)"
    )


def test_visible_savings_line_falls_back_to_absolute_saved_tokens_when_baseline_is_unavailable() -> None:
    telemetry = {
        "estimated_saved_tokens": 42,
        "raw_line_count": 12,
        "filtered_line_count": 2,
        "raw_char_count": 120,
        "filtered_char_count": 20,
        "raw_token_count_estimate": 0,
    }

    assert format_visible_savings_line(telemetry) == "[token-economy] saved ~42 tokens"


def test_visible_savings_line_is_suppressed_when_output_is_unchanged() -> None:
    telemetry = build_output_telemetry(["same output"], ["same output"])

    assert format_visible_savings_line(telemetry) is None
