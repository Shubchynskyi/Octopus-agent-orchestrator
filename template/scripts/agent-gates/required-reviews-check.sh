#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OA_GATE_SCRIPT_DIR="$SCRIPT_DIR"

PYTHON_CMD=()
if command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(python3)
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(python)
elif command -v py >/dev/null 2>&1 && py -3 -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(py -3)
else
  echo "Python runtime not found. Install python3 (or python/py launcher)." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$@" <<'PY'
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import (
    apply_output_filter_profile,
    append_metrics_event,
    append_task_event,
    assert_valid_task_id,
    build_output_telemetry,
    file_sha256,
    normalize_path,
    parse_bool,
    resolve_path_inside_repo,
    resolve_project_root,
)

def parse_skip_reviews(value: str):
    if not value or not value.strip():
        return []
    parts = [item.strip().lower() for item in re.split(r"[,; ]+", value) if item and item.strip()]
    return sorted(set(parts))


def test_expected_verdict(errors, label, required, skipped_by_override, actual_verdict, pass_verdict):
    if required and not skipped_by_override:
        if actual_verdict != pass_verdict:
            errors.append(f"{label} is required. Expected '{pass_verdict}', got '{actual_verdict}'.")
        return

    if skipped_by_override:
        allowed = {"NOT_REQUIRED", "SKIPPED_BY_OVERRIDE", pass_verdict}
        if actual_verdict not in allowed:
            allowed_text = "', '".join(sorted(allowed))
            errors.append(f"{label} override is active. Expected one of '{allowed_text}', got '{actual_verdict}'.")
        return

    if actual_verdict in ("NOT_REQUIRED", pass_verdict):
        return
    errors.append(f"{label} is not required. Expected 'NOT_REQUIRED' or '{pass_verdict}', got '{actual_verdict}'.")


def get_non_negative_int(metrics: dict, key: str):
    value = metrics.get(key)
    if isinstance(value, bool):
        raise ValueError
    if isinstance(value, int):
        if value < 0:
            raise ValueError
        return value
    if isinstance(value, float):
        if value < 0 or int(value) != value:
            raise ValueError
        return int(value)
    raise ValueError


def string_sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest().lower()


def count_file_lines(path: Path) -> int:
    if not path.exists() or not path.is_file():
        return 0
    try:
        line_count = 0
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for _ in handle:
                line_count += 1
        return line_count
    except OSError:
        return 0


def git_lines(repo_root: Path, args, failure_message: str):
    completed = subprocess.run(
        ["git", "-C", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(failure_message)
    return [line for line in completed.stdout.splitlines() if line.strip()]


def get_workspace_snapshot(repo_root: Path, detection_source: str, include_untracked: bool, explicit_changed_files=None):
    source = (detection_source or "git_auto").strip().lower()
    use_staged = source in {"git_staged_only", "git_staged_plus_untracked"}
    if source == "git_staged_only":
        include_untracked = False

    normalized_explicit_changed_files = sorted(
        {
            normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True)
            for item in (explicit_changed_files or [])
            if normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True)
        }
    )
    if source == "explicit_changed_files" and normalized_explicit_changed_files:
        numstat_rows = git_lines(
            repo_root,
            ["diff", "--numstat", "--diff-filter=ACMRTUXB", "HEAD", "--", *normalized_explicit_changed_files],
            "Failed to collect explicit changed lines snapshot.",
        )
        numstat_rows_by_path = {}
        for row in numstat_rows:
            parts = row.split("\t")
            if len(parts) < 3:
                continue
            normalized = normalize_path(parts[2], trim=True, strip_dot_slash=True, strip_leading_slash=True)
            if not normalized:
                continue
            numstat_rows_by_path[normalized] = (parts[0], parts[1])

        additions_total = 0
        deletions_total = 0
        for item in normalized_explicit_changed_files:
            if item in numstat_rows_by_path:
                additions, deletions = numstat_rows_by_path[item]
                if additions.isdigit():
                    additions_total += int(additions)
                if deletions.isdigit():
                    deletions_total += int(deletions)
                continue

            candidate = repo_root / item
            if candidate.is_file():
                additions_total += count_file_lines(candidate)

        changed_lines_total = additions_total + deletions_total
        changed_files_sha256 = string_sha256("\n".join(normalized_explicit_changed_files))
        scope_sha256 = string_sha256(
            f"{source}|{False}|{include_untracked}|{len(normalized_explicit_changed_files)}|{changed_lines_total}|{changed_files_sha256}"
        )
        return {
            "detection_source": source,
            "use_staged": False,
            "include_untracked": bool(include_untracked),
            "changed_files": normalized_explicit_changed_files,
            "changed_files_count": len(normalized_explicit_changed_files),
            "additions_total": additions_total,
            "deletions_total": deletions_total,
            "changed_lines_total": changed_lines_total,
            "changed_files_sha256": changed_files_sha256,
            "scope_sha256": scope_sha256,
        }

    diff_args = ["diff", "--name-only", "--diff-filter=ACMRTUXB"]
    diff_args.extend(["--cached"] if use_staged else ["HEAD"])
    changed_from_diff = git_lines(repo_root, diff_args, "Failed to collect changed files snapshot.")

    untracked = []
    if include_untracked:
        untracked = git_lines(repo_root, ["ls-files", "--others", "--exclude-standard"], "Failed to collect untracked files snapshot.")

    normalized_changed_files = sorted({normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True) for item in (changed_from_diff + untracked) if normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True)})

    numstat_args = ["diff", "--numstat", "--diff-filter=ACMRTUXB"]
    numstat_args.extend(["--cached"] if use_staged else ["HEAD"])
    numstat_rows = git_lines(repo_root, numstat_args, "Failed to collect changed lines snapshot.")

    additions_total = 0
    deletions_total = 0
    for row in numstat_rows:
        parts = row.split("\t")
        if len(parts) < 3:
            continue
        if parts[0].isdigit():
            additions_total += int(parts[0])
        if parts[1].isdigit():
            deletions_total += int(parts[1])

    if include_untracked:
        for item in untracked:
            normalized = normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True)
            if not normalized:
                continue
            additions_total += count_file_lines(repo_root / normalized)

    changed_lines_total = additions_total + deletions_total
    changed_files_sha256 = string_sha256("\n".join(normalized_changed_files))
    scope_sha256 = string_sha256(
        f"{source}|{use_staged}|{include_untracked}|{len(normalized_changed_files)}|{changed_lines_total}|{changed_files_sha256}"
    )

    return {
        "detection_source": source,
        "use_staged": bool(use_staged),
        "include_untracked": bool(include_untracked),
        "changed_files": normalized_changed_files,
        "changed_files_count": len(normalized_changed_files),
        "additions_total": additions_total,
        "deletions_total": deletions_total,
        "changed_lines_total": changed_lines_total,
        "changed_files_sha256": changed_files_sha256,
        "scope_sha256": scope_sha256,
    }


def validate_preflight(preflight_path: Path, explicit_task_id: str):
    try:
        preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
    except Exception:
        raise RuntimeError(f"Preflight artifact is not valid JSON: {preflight_path}")

    errors = []
    resolved_task_id = None
    if explicit_task_id and explicit_task_id.strip():
        try:
            resolved_task_id = assert_valid_task_id(explicit_task_id)
        except Exception as exc:
            errors.append(str(exc))

    preflight_task_id = None
    raw_task_id = preflight.get("task_id")
    if raw_task_id is not None and str(raw_task_id).strip():
        try:
            preflight_task_id = assert_valid_task_id(str(raw_task_id))
        except Exception as exc:
            errors.append(f"preflight.task_id: {exc}")

    if resolved_task_id and preflight_task_id and resolved_task_id != preflight_task_id:
        errors.append(f"TaskId '{resolved_task_id}' does not match preflight.task_id '{preflight_task_id}'.")
    if (not resolved_task_id) and preflight_task_id:
        resolved_task_id = preflight_task_id
    if not resolved_task_id:
        errors.append("TaskId is required and must be provided either via --task-id or preflight.task_id.")

    mode = str(preflight.get("mode", "")).strip().upper()
    if mode not in {"FULL_PATH", "FAST_PATH"}:
        errors.append(f"Preflight field `mode` has unsupported value '{mode or '<missing>'}'.")

    required_reviews = preflight.get("required_reviews")
    required_keys = ("code", "db", "security", "refactor", "api", "test", "performance", "infra", "dependency")
    required_flags = {}
    if not isinstance(required_reviews, dict):
        errors.append("Preflight field `required_reviews` is required and must be an object.")
        required_reviews = {}
    for key in required_keys:
        if key not in required_reviews or not isinstance(required_reviews[key], bool):
            errors.append(f"Preflight field `required_reviews.{key}` is required and must be boolean.")
            required_flags[key] = False
        else:
            required_flags[key] = bool(required_reviews[key])

    metrics = preflight.get("metrics")
    if not isinstance(metrics, dict):
        errors.append("Preflight field `metrics` is required and must be an object.")
        metrics = {}
    try:
        changed_files_count = get_non_negative_int(metrics, "changed_files_count")
    except Exception:
        changed_files_count = 0
        errors.append("Preflight field `metrics.changed_files_count` is required and must be a non-negative integer.")
    try:
        changed_lines_total = get_non_negative_int(metrics, "changed_lines_total")
    except Exception:
        changed_lines_total = 0
        errors.append("Preflight field `metrics.changed_lines_total` is required and must be a non-negative integer.")

    detection_source = str(preflight.get("detection_source", "git_auto")).strip() or "git_auto"
    include_untracked = detection_source.lower() != "git_staged_only"

    return {
        "preflight": preflight,
        "resolved_task_id": resolved_task_id,
        "mode": mode,
        "required_reviews": required_flags,
        "changed_files_count": changed_files_count,
        "changed_lines_total": changed_lines_total,
        "detection_source": detection_source,
        "include_untracked": include_untracked,
        "preflight_hash": file_sha256(preflight_path),
        "errors": errors,
    }


def get_compile_gate_evidence(repo_root: Path, task_id: str, preflight_path: Path, preflight_hash: str, compile_evidence_path_arg: str):
    result = {
        "task_id": task_id,
        "evidence_path": None,
        "evidence_hash": None,
        "evidence_status": None,
        "evidence_outcome": None,
        "evidence_task_id": None,
        "evidence_preflight_path": None,
        "evidence_preflight_hash": None,
        "evidence_source": None,
        "evidence_scope_detection_source": None,
        "evidence_scope_include_untracked": True,
        "evidence_scope_changed_files": [],
        "evidence_scope_changed_files_count": 0,
        "evidence_scope_changed_lines_total": 0,
        "evidence_scope_changed_files_sha256": None,
        "evidence_scope_sha256": None,
        "status": "UNKNOWN",
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        return result

    if compile_evidence_path_arg and compile_evidence_path_arg.strip():
        evidence_path = Path(compile_evidence_path_arg.strip())
        if not evidence_path.is_absolute():
            evidence_path = (repo_root / evidence_path).resolve()
    else:
        evidence_path = (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-compile-gate.json").resolve()

    result["evidence_path"] = normalize_path(evidence_path)
    if not evidence_path.exists():
        result["status"] = "EVIDENCE_FILE_MISSING"
        return result
    result["evidence_hash"] = file_sha256(evidence_path)

    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception:
        result["status"] = "EVIDENCE_INVALID_JSON"
        return result

    recorded_task_id = str(evidence.get("task_id", "")).strip()
    recorded_status = str(evidence.get("status", "")).strip().upper()
    recorded_outcome = str(evidence.get("outcome", "")).strip().upper()
    recorded_preflight_hash = str(evidence.get("preflight_hash_sha256", "")).strip().lower()
    recorded_preflight_path = normalize_path(evidence.get("preflight_path"))
    recorded_source = str(evidence.get("event_source", "")).strip().lower()
    recorded_scope_detection_source = str(evidence.get("scope_detection_source", "")).strip().lower()
    recorded_scope_include_untracked = bool(evidence.get("scope_include_untracked", True))
    recorded_scope_changed_files = [normalize_path(item, trim=True, strip_dot_slash=True, strip_leading_slash=True) for item in list(evidence.get("scope_changed_files") or [])]
    recorded_scope_changed_files = [item for item in recorded_scope_changed_files if item]
    recorded_scope_changed_files_count = int(evidence.get("scope_changed_files_count", 0))
    recorded_scope_changed_lines_total = int(evidence.get("scope_changed_lines_total", 0))
    recorded_scope_changed_files_sha = str(evidence.get("scope_changed_files_sha256", "")).strip().lower()
    recorded_scope_sha = str(evidence.get("scope_sha256", "")).strip().lower()

    result["evidence_task_id"] = recorded_task_id or None
    result["evidence_status"] = recorded_status or None
    result["evidence_outcome"] = recorded_outcome or None
    result["evidence_preflight_hash"] = recorded_preflight_hash or None
    result["evidence_preflight_path"] = recorded_preflight_path
    result["evidence_source"] = recorded_source or None
    result["evidence_scope_detection_source"] = recorded_scope_detection_source or None
    result["evidence_scope_include_untracked"] = bool(recorded_scope_include_untracked)
    result["evidence_scope_changed_files"] = recorded_scope_changed_files
    result["evidence_scope_changed_files_count"] = recorded_scope_changed_files_count
    result["evidence_scope_changed_lines_total"] = recorded_scope_changed_lines_total
    result["evidence_scope_changed_files_sha256"] = recorded_scope_changed_files_sha or None
    result["evidence_scope_sha256"] = recorded_scope_sha or None

    if recorded_task_id != task_id:
        result["status"] = "EVIDENCE_TASK_MISMATCH"
        return result
    if recorded_source != "compile-gate":
        result["status"] = "EVIDENCE_SOURCE_INVALID"
        return result
    if recorded_preflight_hash != preflight_hash.strip().lower():
        result["status"] = "EVIDENCE_PREFLIGHT_HASH_MISMATCH"
        return result
    expected_preflight_path = normalize_path(preflight_path.resolve())
    if recorded_preflight_path and recorded_preflight_path.lower() != expected_preflight_path.lower():
        result["status"] = "EVIDENCE_PREFLIGHT_PATH_MISMATCH"
        return result

    if not recorded_scope_detection_source or not recorded_scope_changed_files_sha or not recorded_scope_sha:
        result["status"] = "EVIDENCE_SCOPE_MISSING"
        return result

    if recorded_status == "PASSED" and recorded_outcome == "PASS":
        result["status"] = "PASS"
        return result

    result["status"] = "EVIDENCE_NOT_PASS"
    return result


def test_compile_scope_drift(repo_root: Path, compile_evidence: dict):
    result = {
        "status": "UNKNOWN",
        "detection_source": None,
        "include_untracked": None,
        "current_scope": None,
        "evidence_scope_sha256": None,
        "evidence_changed_files_sha256": None,
        "evidence_changed_lines_total": None,
        "violations": [],
    }

    detection_source = str(compile_evidence.get("evidence_scope_detection_source") or "").strip()
    if not detection_source:
        result["status"] = "EVIDENCE_SCOPE_MISSING"
        result["violations"].append("Compile gate evidence does not include scope snapshot.")
        return result

    include_untracked = bool(compile_evidence.get("evidence_scope_include_untracked", True))
    current_scope = get_workspace_snapshot(
        repo_root,
        detection_source,
        include_untracked,
        explicit_changed_files=compile_evidence.get("evidence_scope_changed_files") or [],
    )

    result["detection_source"] = detection_source
    result["include_untracked"] = include_untracked
    result["current_scope"] = current_scope
    result["evidence_scope_sha256"] = str(compile_evidence.get("evidence_scope_sha256") or "")
    result["evidence_changed_files_sha256"] = str(compile_evidence.get("evidence_scope_changed_files_sha256") or "")
    result["evidence_changed_lines_total"] = int(compile_evidence.get("evidence_scope_changed_lines_total") or 0)

    if result["evidence_scope_sha256"] != current_scope["scope_sha256"]:
        result["violations"].append("Workspace scope fingerprint changed after compile gate.")
    if result["evidence_changed_files_sha256"] != current_scope["changed_files_sha256"]:
        result["violations"].append("Workspace changed_files fingerprint differs from compile evidence.")
    if result["evidence_changed_lines_total"] != int(current_scope["changed_lines_total"]):
        result["violations"].append(
            "Workspace changed_lines_total="
            f"{current_scope['changed_lines_total']} differs from compile evidence changed_lines_total="
            f"{result['evidence_changed_lines_total']}."
        )

    result["status"] = "DRIFT_DETECTED" if result["violations"] else "PASS"
    return result


def resolve_review_evidence_path(repo_root: Path, task_id: str, review_evidence_path_arg: str):
    if not task_id:
        return None
    if review_evidence_path_arg and review_evidence_path_arg.strip():
        evidence_path = Path(review_evidence_path_arg.strip())
        if not evidence_path.is_absolute():
            evidence_path = (repo_root / evidence_path).resolve()
        return evidence_path
    return (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-review-gate.json").resolve()


def write_review_evidence(
    review_evidence_path: Path,
    task_id: str,
    context: dict,
    status: str,
    outcome: str,
    violations,
):
    if not review_evidence_path or not task_id:
        return
    review_evidence_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_source": "required-reviews-check",
        "task_id": task_id,
        "status": status,
        "outcome": outcome,
        "violations": list(violations or []),
    }
    payload.update(context or {})
    review_evidence_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


REVIEW_CONTRACTS = (
    ("code", "REVIEW PASSED"),
    ("db", "DB REVIEW PASSED"),
    ("security", "SECURITY REVIEW PASSED"),
    ("refactor", "REFACTOR REVIEW PASSED"),
    ("api", "API REVIEW PASSED"),
    ("test", "TEST REVIEW PASSED"),
    ("performance", "PERFORMANCE REVIEW PASSED"),
    ("infra", "INFRA REVIEW PASSED"),
    ("dependency", "DEPENDENCY REVIEW PASSED"),
)


def verify_review_artifacts(repo_root, task_id, required_reviews, verdicts, skip_reviews, reviews_root_arg):
    """For each required review where a passing verdict is claimed, verify the artifact exists and contains the pass token."""
    if reviews_root_arg and reviews_root_arg.strip():
        reviews_root = Path(reviews_root_arg.strip())
        if not reviews_root.is_absolute():
            reviews_root = (repo_root / reviews_root).resolve()
    else:
        reviews_root = (repo_root / "Octopus-agent-orchestrator/runtime/reviews").resolve()

    result = {
        "reviews_root": normalize_path(reviews_root),
        "checked": [],
        "violations": [],
    }

    skip_set = {v.lower() for v in skip_reviews}

    for review_key, pass_token in REVIEW_CONTRACTS:
        if not bool(required_reviews.get(review_key, False)):
            continue
        actual_verdict = verdicts.get(review_key, "NOT_REQUIRED")
        if actual_verdict != pass_token:
            continue
        if review_key in skip_set:
            continue

        artifact_path = (reviews_root / f"{task_id}-{review_key}.md").resolve()
        entry = {
            "review": review_key,
            "path": normalize_path(artifact_path),
            "pass_token": pass_token,
            "present": False,
            "token_found": False,
            "sha256": None,
        }

        if not artifact_path.exists() or not artifact_path.is_file():
            result["violations"].append(
                f"Review artifact not found for claimed '{pass_token}': {entry['path']}"
            )
            result["checked"].append(entry)
            continue

        entry["present"] = True
        entry["sha256"] = file_sha256(artifact_path)
        content = artifact_path.read_text(encoding="utf-8")
        if pass_token in content:
            entry["token_found"] = True
        else:
            result["violations"].append(
                f"Review artifact '{entry['path']}' does not contain pass token '{pass_token}'."
            )
        result["checked"].append(entry)

    return result


parser = argparse.ArgumentParser()
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--task-id", default="")
parser.add_argument("--code-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--db-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--security-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--refactor-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--api-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--test-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--performance-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--infra-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--dependency-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--skip-reviews", default="")
parser.add_argument("--skip-reason", default="")
parser.add_argument("--override-artifact-path", default="")
parser.add_argument("--compile-evidence-path", default="")
parser.add_argument("--reviews-root", default="")
parser.add_argument("--review-evidence-path", default="")
parser.add_argument("--output-filters-path", default="Octopus-agent-orchestrator/live/config/output-filters.json")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

repo_root = resolve_project_root(script_dir)
output_filters_path = resolve_path_inside_repo(args.output_filters_path, repo_root, allow_missing=True)

preflight_path = Path(args.preflight_path)
if not preflight_path.is_absolute():
    preflight_path = preflight_path.resolve()
if not preflight_path.exists():
    print(f"Preflight artifact not found: {preflight_path}", file=sys.stderr)
    sys.exit(1)

validated_preflight = validate_preflight(preflight_path, args.task_id)
preflight = validated_preflight["preflight"]
resolved_task_id = validated_preflight["resolved_task_id"]
compile_gate_evidence = get_compile_gate_evidence(
    repo_root=repo_root,
    task_id=resolved_task_id,
    preflight_path=preflight_path,
    preflight_hash=validated_preflight["preflight_hash"],
    compile_evidence_path_arg=args.compile_evidence_path,
)
scope_drift = None
if compile_gate_evidence.get("status") == "PASS":
    scope_drift = test_compile_scope_drift(repo_root=repo_root, compile_evidence=compile_gate_evidence)

metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path_raw = "Octopus-agent-orchestrator/runtime/metrics.jsonl"
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = (repo_root / metrics_path).resolve()
else:
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = metrics_path.resolve()
emit_metrics = parse_bool(args.emit_metrics)

errors = list(validated_preflight["errors"])
skip_reviews_list = parse_skip_reviews(args.skip_reviews)
allowed_skips = {"code"}
for skip_item in skip_reviews_list:
    if skip_item not in allowed_skips:
        errors.append(f"Unsupported skip-review value '{skip_item}'. Allowed values: code.")

skip_reason = args.skip_reason or ""
if skip_reviews_list and not skip_reason.strip():
    errors.append("Skip-review override requires --skip-reason.")
if skip_reason.strip() and len(skip_reason.strip()) < 12:
    errors.append("Skip-review reason is too short. Provide a concrete justification (>= 12 chars).")

compile_status = compile_gate_evidence.get("status")
if compile_status == "TASK_ID_MISSING":
    errors.append("Compile gate evidence cannot be verified: task id is missing.")
elif compile_status == "EVIDENCE_FILE_MISSING":
    errors.append(f"Compile gate evidence missing: file not found at '{compile_gate_evidence.get('evidence_path')}'. Run compile-gate.ps1/.sh first.")
elif compile_status == "EVIDENCE_INVALID_JSON":
    errors.append(f"Compile gate evidence is invalid JSON at '{compile_gate_evidence.get('evidence_path')}'. Re-run compile-gate.ps1/.sh.")
elif compile_status == "EVIDENCE_TASK_MISMATCH":
    errors.append(f"Compile gate evidence task mismatch. Expected '{resolved_task_id}', got '{compile_gate_evidence.get('evidence_task_id')}'.")
elif compile_status == "EVIDENCE_SOURCE_INVALID":
    errors.append(f"Compile gate evidence source is invalid. Expected 'compile-gate', got '{compile_gate_evidence.get('evidence_source')}'.")
elif compile_status == "EVIDENCE_PREFLIGHT_HASH_MISMATCH":
    errors.append("Compile gate evidence preflight hash mismatch. Re-run compile-gate.ps1/.sh for the current preflight artifact.")
elif compile_status == "EVIDENCE_PREFLIGHT_PATH_MISMATCH":
    errors.append(f"Compile gate evidence preflight path mismatch. Evidence path='{compile_gate_evidence.get('evidence_preflight_path')}'.")
elif compile_status == "EVIDENCE_SCOPE_MISSING":
    errors.append("Compile gate evidence is missing scope snapshot fields. Re-run compile-gate.ps1/.sh.")
elif compile_status == "EVIDENCE_NOT_PASS":
    errors.append(
        f"Compile gate did not pass. Evidence status='{compile_gate_evidence.get('evidence_status')}', "
        f"outcome='{compile_gate_evidence.get('evidence_outcome')}'."
    )

if scope_drift is not None:
    if scope_drift.get("status") == "EVIDENCE_SCOPE_MISSING":
        errors.extend(scope_drift.get("violations", []))
    elif scope_drift.get("status") == "DRIFT_DETECTED":
        errors.append("Workspace changed after compile gate; rerun compile-gate.ps1/.sh before review gate.")
        errors.extend(scope_drift.get("violations", []))

required_code = bool(validated_preflight["required_reviews"]["code"])
required_db = bool(validated_preflight["required_reviews"]["db"])
required_security = bool(validated_preflight["required_reviews"]["security"])
required_refactor = bool(validated_preflight["required_reviews"]["refactor"])
required_api = bool(validated_preflight["required_reviews"]["api"])
required_test = bool(validated_preflight["required_reviews"]["test"])
required_performance = bool(validated_preflight["required_reviews"]["performance"])
required_infra = bool(validated_preflight["required_reviews"]["infra"])
required_dependency = bool(validated_preflight["required_reviews"]["dependency"])

changed_files_count = int(validated_preflight["changed_files_count"])
changed_lines_total = int(validated_preflight["changed_lines_total"])

can_skip_code = (
    required_code
    and (not required_db)
    and (not required_security)
    and (not required_refactor)
    and (not required_api)
    and (not required_test)
    and (not required_performance)
    and (not required_infra)
    and (not required_dependency)
    and changed_files_count <= 1
    and changed_lines_total <= 8
)

skip_code = "code" in skip_reviews_list
if skip_code and not can_skip_code:
    errors.append(
        "Code review override is not allowed for this change scope. "
        "Allowed only for tiny low-risk code changes (<=1 file and <=8 changed lines, with no specialized reviews)."
    )
if skip_code and not required_code:
    errors.append("Code review override was requested but code review is not required by preflight.")

test_expected_verdict(errors, "Code review", required_code, skip_code, args.code_review_verdict, "REVIEW PASSED")
test_expected_verdict(errors, "DB review", required_db, False, args.db_review_verdict, "DB REVIEW PASSED")
test_expected_verdict(errors, "Security review", required_security, False, args.security_review_verdict, "SECURITY REVIEW PASSED")
test_expected_verdict(errors, "Refactor review", required_refactor, False, args.refactor_review_verdict, "REFACTOR REVIEW PASSED")
test_expected_verdict(errors, "API review", required_api, False, args.api_review_verdict, "API REVIEW PASSED")
test_expected_verdict(errors, "Test review", required_test, False, args.test_review_verdict, "TEST REVIEW PASSED")
test_expected_verdict(errors, "Performance review", required_performance, False, args.performance_review_verdict, "PERFORMANCE REVIEW PASSED")
test_expected_verdict(errors, "Infra review", required_infra, False, args.infra_review_verdict, "INFRA REVIEW PASSED")
test_expected_verdict(errors, "Dependency review", required_dependency, False, args.dependency_review_verdict, "DEPENDENCY REVIEW PASSED")

artifact_evidence = verify_review_artifacts(
    repo_root=repo_root,
    task_id=resolved_task_id,
    required_reviews=validated_preflight["required_reviews"],
    verdicts={
        "code": args.code_review_verdict,
        "db": args.db_review_verdict,
        "security": args.security_review_verdict,
        "refactor": args.refactor_review_verdict,
        "api": args.api_review_verdict,
        "test": args.test_review_verdict,
        "performance": args.performance_review_verdict,
        "infra": args.infra_review_verdict,
        "dependency": args.dependency_review_verdict,
    },
    skip_reviews=skip_reviews_list,
    reviews_root_arg=args.reviews_root,
)
errors.extend(artifact_evidence["violations"])

review_evidence_path = resolve_review_evidence_path(repo_root, resolved_task_id, args.review_evidence_path)
review_evidence_context = {
    "preflight_path": normalize_path(preflight_path.resolve()),
    "preflight_hash_sha256": validated_preflight["preflight_hash"],
    "mode": validated_preflight["mode"],
    "compile_evidence_path": compile_gate_evidence.get("evidence_path"),
    "compile_evidence_hash_sha256": compile_gate_evidence.get("evidence_hash"),
    "output_filters_path": normalize_path(output_filters_path) if output_filters_path else None,
    "scope_drift": scope_drift,
    "required_reviews": validated_preflight["required_reviews"],
    "verdicts": {
        "code": args.code_review_verdict,
        "db": args.db_review_verdict,
        "security": args.security_review_verdict,
        "refactor": args.refactor_review_verdict,
        "api": args.api_review_verdict,
        "test": args.test_review_verdict,
        "performance": args.performance_review_verdict,
        "infra": args.infra_review_verdict,
        "dependency": args.dependency_review_verdict,
    },
    "skip_reviews": skip_reviews_list,
    "skip_reason": skip_reason,
    "override_artifact": normalize_path(args.override_artifact_path) if args.override_artifact_path.strip() else None,
    "artifact_evidence": artifact_evidence,
}

if errors:
    failure_output_lines = [
        "REVIEW_GATE_FAILED",
        f"Mode: {validated_preflight['mode']}",
        "Violations:",
        *[f"- {err}" for err in errors],
    ]
    failure_output_result = apply_output_filter_profile(
        failure_output_lines,
        output_filters_path,
        "review_gate_failure_console",
    )
    filtered_failure_output_lines = list(failure_output_result["lines"])
    failure_output_telemetry = build_output_telemetry(
        failure_output_lines,
        filtered_failure_output_lines,
        filter_mode=failure_output_result["filter_mode"],
        fallback_mode=failure_output_result["fallback_mode"],
        parser_mode=failure_output_result["parser_mode"],
        parser_name=failure_output_result["parser_name"],
        parser_strategy=failure_output_result["parser_strategy"],
    )
    review_evidence_context["output_telemetry"] = failure_output_telemetry
    write_review_evidence(
        review_evidence_path=review_evidence_path,
        task_id=resolved_task_id,
        context=review_evidence_context,
        status="FAILED",
        outcome="FAIL",
        violations=errors,
    )
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "review_gate_check",
        "status": "FAILED",
        "task_id": resolved_task_id,
        "review_evidence_path": normalize_path(review_evidence_path) if review_evidence_path else None,
        "preflight_path": normalize_path(preflight_path.resolve()),
        "mode": validated_preflight["mode"],
        "skip_reviews": skip_reviews_list,
        "skip_reason": skip_reason,
        "output_filters_path": normalize_path(output_filters_path) if output_filters_path else None,
        "compile_gate": compile_gate_evidence,
        "violations": errors,
    }
    failure_event.update(failure_output_telemetry)
    append_metrics_event(metrics_path, failure_event, emit_metrics)
    append_task_event(
        repo_root=repo_root,
        task_id=resolved_task_id,
        event_type="REVIEW_GATE_FAILED",
        outcome="FAIL",
        message="Required reviews gate failed.",
        details={
            "preflight_path": normalize_path(preflight_path),
            "mode": validated_preflight["mode"],
            "review_evidence_path": normalize_path(review_evidence_path) if review_evidence_path else None,
            "skip_reviews": skip_reviews_list,
            "skip_reason": skip_reason,
            "compile_gate": compile_gate_evidence,
            "violations": errors,
        },
    )

    for line in filtered_failure_output_lines:
        print(line)
    sys.exit(1)

override_artifact_path = args.override_artifact_path.strip()
if skip_code:
    if not override_artifact_path:
        preflight_dir = preflight_path.parent
        preflight_name = preflight_path.stem
        base_name = re.sub(r"-preflight$", "", preflight_name)
        override_artifact_path = str(preflight_dir / f"{base_name}-override.json")
    override_path = Path(override_artifact_path)
    if not override_path.is_absolute():
        override_path = override_path.resolve()
    override_path.parent.mkdir(parents=True, exist_ok=True)
    override_artifact = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "preflight_path": normalize_path(preflight_path),
        "mode": validated_preflight["mode"],
        "skipped_reviews": ["code"],
        "reason": skip_reason.strip(),
        "guardrails": {
            "required_db": required_db,
            "required_security": required_security,
            "required_refactor": required_refactor,
            "required_api": required_api,
            "required_test": required_test,
            "required_performance": required_performance,
            "required_infra": required_infra,
            "required_dependency": required_dependency,
            "changed_files_count": changed_files_count,
            "changed_lines_total": changed_lines_total,
        },
    }
    override_path.write_text(json.dumps(override_artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    override_artifact_path = str(override_path)

if skip_code:
    success_output_lines = [
        "REVIEW_GATE_PASSED_WITH_OVERRIDE",
        f"Mode: {validated_preflight['mode']}",
        "SkippedReviews: code",
    ]
    if override_artifact_path:
        success_output_lines.append(f"OverrideArtifact: {override_artifact_path}")
else:
    success_output_lines = [
        "REVIEW_GATE_PASSED",
        f"Mode: {validated_preflight['mode']}",
    ]
success_output_result = apply_output_filter_profile(
    success_output_lines,
    output_filters_path,
    "review_gate_success_console",
)
filtered_success_output_lines = list(success_output_result["lines"])
success_output_telemetry = build_output_telemetry(
    success_output_lines,
    filtered_success_output_lines,
    filter_mode=success_output_result["filter_mode"],
    fallback_mode=success_output_result["fallback_mode"],
    parser_mode=success_output_result["parser_mode"],
    parser_name=success_output_result["parser_name"],
    parser_strategy=success_output_result["parser_strategy"],
)
review_evidence_context["override_artifact"] = normalize_path(override_artifact_path) if override_artifact_path else None
review_evidence_context["output_telemetry"] = success_output_telemetry
write_review_evidence(
    review_evidence_path=review_evidence_path,
    task_id=resolved_task_id,
    context=review_evidence_context,
    status="PASSED",
    outcome="PASS",
    violations=[],
)

success_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "review_gate_check",
    "status": "PASSED",
    "task_id": resolved_task_id,
    "review_evidence_path": normalize_path(review_evidence_path) if review_evidence_path else None,
    "preflight_path": normalize_path(preflight_path),
    "mode": validated_preflight["mode"],
    "skip_reviews": skip_reviews_list,
    "skip_reason": skip_reason,
    "output_filters_path": normalize_path(output_filters_path) if output_filters_path else None,
    "compile_gate": compile_gate_evidence,
    "override_artifact": normalize_path(override_artifact_path) if override_artifact_path else None,
}
success_event.update(success_output_telemetry)
append_metrics_event(metrics_path, success_event, emit_metrics)

if skip_code:
    append_task_event(
        repo_root=repo_root,
        task_id=resolved_task_id,
        event_type="REVIEW_GATE_PASSED_WITH_OVERRIDE",
        outcome="PASS",
        message="Required reviews gate passed with audited override.",
        details={
            "preflight_path": normalize_path(preflight_path),
            "mode": validated_preflight["mode"],
            "review_evidence_path": normalize_path(review_evidence_path) if review_evidence_path else None,
            "skip_reviews": skip_reviews_list,
            "skip_reason": skip_reason,
            "compile_gate": compile_gate_evidence,
            "override_artifact": normalize_path(override_artifact_path) if override_artifact_path else None,
        },
    )
    for line in filtered_success_output_lines:
        print(line)
else:
    append_task_event(
        repo_root=repo_root,
        task_id=resolved_task_id,
        event_type="REVIEW_GATE_PASSED",
        outcome="PASS",
        message="Required reviews gate passed.",
        details={
            "preflight_path": normalize_path(preflight_path),
            "mode": validated_preflight["mode"],
            "review_evidence_path": normalize_path(review_evidence_path) if review_evidence_path else None,
            "skip_reviews": skip_reviews_list,
            "skip_reason": skip_reason,
            "compile_gate": compile_gate_evidence,
            "override_artifact": normalize_path(override_artifact_path) if override_artifact_path else None,
        },
    )
    for line in filtered_success_output_lines:
        print(line)
PY
