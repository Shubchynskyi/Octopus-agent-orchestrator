"""Regression tests for T-009 review-context compaction helpers.

Run:
    pytest template/scripts/agent-gates/tests/test_review_context_compaction.py -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
from gate_utils import audit_review_artifact_compaction  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[4]
BASH_CANDIDATES = [
    shutil.which("bash"),
    r"C:\Program Files\Git\bin\bash.exe",
    r"C:\Program Files\Git\usr\bin\bash.exe",
]


def resolve_bash() -> str | None:
    for candidate in BASH_CANDIDATES:
        if not candidate:
            continue
        candidate_path = Path(candidate)
        if not candidate_path.exists():
            continue
        completed = subprocess.run(
            [str(candidate_path), "-lc", "true"],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode == 0:
            return str(candidate_path)
    return None


BASH_PATH = resolve_bash()


def run_checked(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    assert completed.returncode == 0, (
        f"Command failed ({completed.returncode}): {' '.join(command)}\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )
    return completed


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for build-review-context.sh tests")
def test_build_review_context_shell_writes_sanitized_markdown(tmp_path: Path) -> None:
    repo_path = tmp_path / "repo"
    repo_path.mkdir(parents=True, exist_ok=True)

    write_text(
        repo_path / "runtime" / "reviews" / "T-009-preflight.json",
        json.dumps({"required_reviews": {"code": True}}, indent=2) + "\n",
    )
    write_text(
        repo_path / "config" / "token-economy.json",
        json.dumps(
            {
                "enabled": True,
                "enabled_depths": [1],
                "strip_examples": True,
                "strip_code_blocks": True,
                "scoped_diffs": True,
                "compact_reviewer_output": True,
                "fail_tail_lines": 20,
            },
            indent=2,
        )
        + "\n",
    )
    write_text(
        repo_path / "live" / "docs" / "agent-rules" / "00-core.md",
        "# Core Rule\n\nAlways keep these instructions.\n\nExamples:\n```text\nbad example payload\n```\n\nKeep this paragraph.\n",
    )
    write_text(
        repo_path / "live" / "docs" / "agent-rules" / "80-task-workflow.md",
        "# Workflow\n\nStay deterministic.\n",
    )

    output_path = repo_path / "runtime" / "reviews" / "T-009-code-review-context.json"
    script_path = REPO_ROOT / "template" / "scripts" / "agent-gates" / "build-review-context.sh"
    run_checked(
        [
            BASH_PATH,
            str(script_path),
            "--review-type",
            "code",
            "--depth",
            "1",
            "--preflight-path",
            "runtime/reviews/T-009-preflight.json",
            "--token-economy-config-path",
            "config/token-economy.json",
            "--output-path",
            str(output_path),
            "--repo-root",
            str(repo_path),
        ],
        REPO_ROOT,
    )

    context = json.loads(output_path.read_text(encoding="utf-8"))
    assert context["rule_context"]["artifact_path"]
    assert context["rule_context"]["strip_examples_applied"] is True
    assert context["rule_context"]["strip_code_blocks_applied"] is True
    assert context["rule_context"]["source_files"][0]["removed_example_labels"] > 0
    assert context["rule_context"]["source_files"][0]["removed_code_blocks"] > 0

    markdown_path = Path(context["rule_context"]["artifact_path"].replace("/", "\\"))
    markdown = markdown_path.read_text(encoding="utf-8")
    assert "Example content omitted due to token economy" in markdown
    assert "Code block omitted due to token economy" in markdown
    assert "bad example payload" not in markdown


def test_audit_review_artifact_compaction_warns_for_verbose_artifact(tmp_path: Path) -> None:
    artifact_path = tmp_path / "T-009-code.md"
    content = "\n".join([*(f"Line {index}" for index in range(1, 141)), "Examples:", "```text", "payload", "```"])
    artifact_path.write_text(content, encoding="utf-8")

    review_context = {
        "token_economy_active": True,
        "token_economy": {
            "active": True,
            "flags": {
                "compact_reviewer_output": True,
                "strip_examples": True,
                "fail_tail_lines": 10,
            },
        },
    }

    result = audit_review_artifact_compaction(
        artifact_path=artifact_path,
        content=content,
        review_context=review_context,
    )

    assert result["expected"] is True
    assert result["warning_count"] > 0
    assert any("compact line budget" in warning for warning in result["warnings"])
    assert any("example markers" in warning for warning in result["warnings"])
