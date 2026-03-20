"""Regression tests for T-015 findings-resolution enforcement in completion-gate.sh.

Run:
    pytest template/scripts/agent-gates/tests/test_completion_gate_findings.py -v
"""

from __future__ import annotations

import os
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest


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
BASH_TEST_ENV = {**os.environ, "OCTOPUS_COMPAT_SHIM": "0"}


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: dict) -> None:
    write_text(path, json.dumps(payload, indent=2) + "\n")


def write_jsonl(path: Path, payloads: list[dict]) -> None:
    write_text(path, "\n".join(json.dumps(item, separators=(",", ":")) for item in payloads) + "\n")


def to_posix(path: Path) -> str:
    return str(path).replace("\\", "/")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().lower()


def build_code_review_artifact(
    *,
    low_findings: list[str] | None = None,
    residual_risks: list[str] | None = None,
    deferred_findings: list[str] | None = None,
) -> str:
    low_findings = low_findings or []
    residual_risks = residual_risks or []
    deferred_findings = deferred_findings or []

    low_lines = ["- Low:"] + [f"  - {entry}" for entry in low_findings] if low_findings else ["- Low: `none`"]
    deferred_lines = [f"- {entry}" for entry in deferred_findings] if deferred_findings else ["- `none`"]
    residual_lines = [f"- {entry}" for entry in residual_risks] if residual_risks else ["- `none`"]

    lines = [
        "# Review Artifact",
        "",
        "## Metadata",
        "- Task ID: T-015",
        "- Review Type: CODE_REVIEW",
        "",
        "## Findings by Severity",
        "- Critical: `none`",
        "- High: `none`",
        "- Medium: `none`",
        *low_lines,
        "",
        "## Deferred Findings",
        *deferred_lines,
        "",
        "## Rule Checklist",
        "| rule_id | status | evidence |",
        "|---|---|---|",
        "| core | PASS | fixture |",
        "",
        "## Rule Coverage",
        "- applicable_rule_ids: core",
        "- not_applicable_rule_ids: none",
        "- skipped_rule_reasons: none",
        "",
        "## Residual Risks",
        *residual_lines,
        "",
        "## Verdict",
        "- `REVIEW PASSED`",
        "",
    ]
    return "\n".join(lines)


def create_completion_gate_workspace(tmp_path: Path) -> tuple[Path, Path]:
    workspace_root = tmp_path / "workspace"
    bundle_root = workspace_root / "Octopus-agent-orchestrator"
    (bundle_root / "live" / "scripts" / "agent-gates" / "lib").mkdir(parents=True, exist_ok=True)
    (bundle_root / "live" / "config").mkdir(parents=True, exist_ok=True)

    shutil.copy2(
        REPO_ROOT / "template" / "scripts" / "agent-gates" / "completion-gate.sh",
        bundle_root / "live" / "scripts" / "agent-gates" / "completion-gate.sh",
    )
    shutil.copy2(
        REPO_ROOT / "template" / "scripts" / "agent-gates" / "lib" / "gate_utils.py",
        bundle_root / "live" / "scripts" / "agent-gates" / "lib" / "gate_utils.py",
    )
    return workspace_root, bundle_root


def initialize_completion_gate_fixture(workspace_root: Path, review_artifact_content: str, task_id: str = "T-015") -> None:
    bundle_root = workspace_root / "Octopus-agent-orchestrator"
    preflight_path = bundle_root / "runtime" / "reviews" / f"{task_id}-preflight.json"
    compile_evidence_path = bundle_root / "runtime" / "reviews" / f"{task_id}-compile-gate.json"
    review_evidence_path = bundle_root / "runtime" / "reviews" / f"{task_id}-review-gate.json"
    doc_impact_path = bundle_root / "runtime" / "reviews" / f"{task_id}-doc-impact.json"
    timeline_path = bundle_root / "runtime" / "task-events" / f"{task_id}.jsonl"
    review_artifact_path = bundle_root / "runtime" / "reviews" / f"{task_id}-code.md"

    required_reviews = {
        "code": True,
        "db": False,
        "security": False,
        "refactor": False,
        "api": False,
        "test": False,
        "performance": False,
        "infra": False,
        "dependency": False,
    }
    write_json(preflight_path, {"task_id": task_id, "required_reviews": required_reviews})
    preflight_hash = sha256(preflight_path)
    preflight_posix = to_posix(preflight_path.resolve())

    write_json(
        compile_evidence_path,
        {
            "task_id": task_id,
            "event_source": "compile-gate",
            "status": "PASSED",
            "outcome": "PASS",
            "preflight_path": preflight_posix,
            "preflight_hash_sha256": preflight_hash,
        },
    )
    compile_hash = sha256(compile_evidence_path)

    write_json(
        review_evidence_path,
        {
            "task_id": task_id,
            "event_source": "required-reviews-check",
            "status": "PASSED",
            "outcome": "PASS",
            "preflight_path": preflight_posix,
            "preflight_hash_sha256": preflight_hash,
            "compile_evidence_path": to_posix(compile_evidence_path.resolve()),
            "compile_evidence_hash_sha256": compile_hash,
        },
    )

    write_json(
        doc_impact_path,
        {
            "task_id": task_id,
            "event_source": "doc-impact-gate",
            "status": "PASSED",
            "outcome": "PASS",
            "preflight_path": preflight_posix,
            "preflight_hash_sha256": preflight_hash,
            "decision": "NO_DOC_UPDATES",
            "rationale": "No behavior changes for this fixture.",
            "behavior_changed": False,
            "changelog_updated": False,
            "docs_updated": [],
        },
    )

    write_jsonl(
        timeline_path,
        [
            {
                "task_id": task_id,
                "event_type": "COMPILE_GATE_PASSED",
                "outcome": "PASS",
                "message": "Compile gate passed.",
            },
            {
                "task_id": task_id,
                "event_type": "REVIEW_GATE_PASSED",
                "outcome": "PASS",
                "message": "Review gate passed.",
            },
        ],
    )

    write_text(review_artifact_path, review_artifact_content)


def run_completion_gate(workspace_root: Path, task_id: str = "T-015") -> subprocess.CompletedProcess[str]:
    script_path = workspace_root / "Octopus-agent-orchestrator" / "live" / "scripts" / "agent-gates" / "completion-gate.sh"
    return subprocess.run(
        [
            BASH_PATH,
            str(script_path),
            "--preflight-path",
            f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-preflight.json",
            "--task-id",
            task_id,
        ],
        cwd=REPO_ROOT,
        env=BASH_TEST_ENV,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for completion-gate.sh tests")
def test_completion_gate_shell_fails_when_pass_artifact_still_contains_low_findings(tmp_path: Path) -> None:
    workspace_root, _ = create_completion_gate_workspace(tmp_path)
    initialize_completion_gate_fixture(
        workspace_root,
        build_code_review_artifact(low_findings=["Docs follow-up remains open in src/example.ts:14"]),
    )

    completed = run_completion_gate(workspace_root)

    assert completed.returncode == 1, completed.stdout + completed.stderr
    assert "COMPLETION_GATE_FAILED" in completed.stdout
    assert "active Low findings" in completed.stdout


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for completion-gate.sh tests")
def test_completion_gate_shell_fails_when_pass_artifact_still_contains_residual_risks(tmp_path: Path) -> None:
    workspace_root, _ = create_completion_gate_workspace(tmp_path)
    initialize_completion_gate_fixture(
        workspace_root,
        build_code_review_artifact(residual_risks=["Follow-up validation is still pending for src/example.ts:14"]),
    )

    completed = run_completion_gate(workspace_root)

    assert completed.returncode == 1, completed.stdout + completed.stderr
    assert "COMPLETION_GATE_FAILED" in completed.stdout
    assert "active residual risks" in completed.stdout


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for completion-gate.sh tests")
def test_completion_gate_shell_fails_when_deferred_findings_lack_justification(tmp_path: Path) -> None:
    workspace_root, _ = create_completion_gate_workspace(tmp_path)
    initialize_completion_gate_fixture(
        workspace_root,
        build_code_review_artifact(deferred_findings=["[Low] Docs follow-up for src/example.ts:14"]),
    )

    completed = run_completion_gate(workspace_root)

    assert completed.returncode == 1, completed.stdout + completed.stderr
    assert "COMPLETION_GATE_FAILED" in completed.stdout
    assert "usable 'Justification:'" in completed.stdout


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for completion-gate.sh tests")
def test_completion_gate_shell_passes_when_deferred_findings_are_justified(tmp_path: Path) -> None:
    workspace_root, _ = create_completion_gate_workspace(tmp_path)
    initialize_completion_gate_fixture(
        workspace_root,
        build_code_review_artifact(
            deferred_findings=[
                "[Low] Docs follow-up for src/example.ts:14 | Justification: Safe to defer because behavior is unchanged and the follow-up is tracked separately."
            ]
        ),
    )

    completed = run_completion_gate(workspace_root)

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "COMPLETION_GATE_PASSED" in completed.stdout


@pytest.mark.skipif(BASH_PATH is None, reason="bash is required for completion-gate.sh tests")
def test_completion_gate_shell_passes_when_pass_artifact_has_no_active_findings(tmp_path: Path) -> None:
    workspace_root, _ = create_completion_gate_workspace(tmp_path)
    initialize_completion_gate_fixture(workspace_root, build_code_review_artifact())

    completed = run_completion_gate(workspace_root)

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "COMPLETION_GATE_PASSED" in completed.stdout
