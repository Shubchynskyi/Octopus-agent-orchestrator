from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from gate_utils import build_output_telemetry, build_rule_context_artifact  # noqa: E402


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
