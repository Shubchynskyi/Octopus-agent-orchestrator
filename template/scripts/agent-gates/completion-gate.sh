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
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import (  # noqa: E402
    audit_review_artifact_compaction,
    append_metrics_event,
    append_task_event,
    assert_valid_task_id,
    file_sha256,
    inspect_task_event_file,
    join_orchestrator_path,
    normalize_path,
    parse_bool,
    resolve_path_inside_repo,
    resolve_project_root,
)


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


def parse_skip_reviews(value):
    if value is None:
        return []

    parts = []
    values = value if isinstance(value, (list, tuple, set)) else [value]
    for item in values:
        text = str(item).strip().lower()
        if not text:
            continue
        parts.extend([segment.strip().lower() for segment in re.split(r"[,; ]+", text) if segment and segment.strip()])
    return sorted(set(parts))


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

    preflight_task_id = preflight.get("task_id")
    if preflight_task_id is not None and str(preflight_task_id).strip():
        try:
            preflight_task_id = assert_valid_task_id(str(preflight_task_id))
        except Exception as exc:
            errors.append(f"preflight.task_id: {exc}")
            preflight_task_id = None
    else:
        preflight_task_id = None

    if resolved_task_id and preflight_task_id and resolved_task_id != preflight_task_id:
        errors.append(f"TaskId '{resolved_task_id}' does not match preflight.task_id '{preflight_task_id}'.")
    if (not resolved_task_id) and preflight_task_id:
        resolved_task_id = preflight_task_id
    if not resolved_task_id:
        errors.append("TaskId is required and must be provided either via --task-id or preflight.task_id.")

    required_reviews = preflight.get("required_reviews")
    required_flags = {}
    required_keys = ("code", "db", "security", "refactor", "api", "test", "performance", "infra", "dependency")
    if not isinstance(required_reviews, dict):
        errors.append("Preflight field `required_reviews` is required and must be an object.")
        required_reviews = {}

    for key in required_keys:
        value = required_reviews.get(key)
        if not isinstance(value, bool):
            errors.append(f"Preflight field `required_reviews.{key}` is required and must be boolean.")
            required_flags[key] = False
        else:
            required_flags[key] = bool(value)

    return {
        "preflight": preflight,
        "resolved_task_id": resolved_task_id,
        "required_reviews": required_flags,
        "preflight_path": preflight_path.resolve(),
        "preflight_hash": file_sha256(preflight_path.resolve()),
        "errors": errors,
    }


def get_timeline_evidence(repo_root: Path, task_id: str, timeline_path_arg: str):
    result = {
        "timeline_path": None,
        "status": "UNKNOWN",
        "events_scanned": 0,
        "matching_events": 0,
        "parse_errors": 0,
        "compile_gate_passed": False,
        "review_gate_passed": False,
        "review_gate_pass_event_type": None,
        "review_gate_passed_after_last_failure": False,
        "rework_started_after_last_failure": False,
        "last_review_gate_failed_index": None,
        "last_review_gate_passed_index": None,
        "skip_reviews": [],
        "integrity": None,
        "violations": [],
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Task timeline cannot be validated: task id is missing.")
        return result

    if timeline_path_arg and timeline_path_arg.strip():
        timeline_path = resolve_path_inside_repo(timeline_path_arg, repo_root, allow_missing=True)
    else:
        timeline_path = join_orchestrator_path(repo_root, f"runtime/task-events/{task_id}.jsonl")
    result["timeline_path"] = normalize_path(timeline_path)

    if not timeline_path.exists() or not timeline_path.is_file():
        result["status"] = "TIMELINE_MISSING"
        result["violations"].append(f"Task timeline not found: {result['timeline_path']}")
        return result

    integrity_evidence = inspect_task_event_file(timeline_path, task_id)
    result["integrity"] = integrity_evidence
    result["violations"].extend(integrity_evidence["violations"])

    last_failed_index = None
    last_passed_index = None
    pass_skip_reviews = []
    rework_indices = []

    event_index = 0
    for raw_line in timeline_path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue

        event_index += 1
        result["events_scanned"] = event_index
        try:
            event = json.loads(raw_line)
        except Exception:
            result["parse_errors"] += 1
            continue

        event_task_id = str(event.get("task_id", "")).strip()
        if event_task_id and event_task_id != task_id:
            continue

        result["matching_events"] += 1
        event_type = str(event.get("event_type", "")).strip()

        if event_type == "COMPILE_GATE_PASSED":
            result["compile_gate_passed"] = True
        elif event_type == "REVIEW_GATE_FAILED":
            last_failed_index = event_index
            result["last_review_gate_failed_index"] = event_index
        elif event_type == "REWORK_STARTED":
            rework_indices.append(event_index)
        elif event_type in ("REVIEW_GATE_PASSED", "REVIEW_GATE_PASSED_WITH_OVERRIDE"):
            last_passed_index = event_index
            result["review_gate_passed"] = True
            result["review_gate_pass_event_type"] = event_type
            if event_type == "REVIEW_GATE_PASSED_WITH_OVERRIDE":
                details = event.get("details")
                skip_reviews_value = details.get("skip_reviews") if isinstance(details, dict) else None
                pass_skip_reviews = parse_skip_reviews(skip_reviews_value)
            else:
                pass_skip_reviews = []

    result["last_review_gate_passed_index"] = last_passed_index
    result["skip_reviews"] = pass_skip_reviews

    if not result["compile_gate_passed"]:
        result["violations"].append("Task timeline does not contain COMPILE_GATE_PASSED.")
    if last_passed_index is None:
        result["violations"].append("Task timeline does not contain REVIEW_GATE_PASSED or REVIEW_GATE_PASSED_WITH_OVERRIDE.")

    if last_failed_index is not None:
        if any(index > last_failed_index for index in rework_indices):
            result["rework_started_after_last_failure"] = True
        else:
            result["violations"].append("Task timeline contains REVIEW_GATE_FAILED but no REWORK_STARTED after latest failure.")

        if last_passed_index is not None and last_passed_index > last_failed_index:
            result["review_gate_passed_after_last_failure"] = True
        else:
            result["violations"].append("Task timeline contains REVIEW_GATE_FAILED but no review gate pass after latest failure.")

    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


def get_review_artifact_evidence(repo_root: Path, task_id: str, required_reviews: dict, skip_reviews, reviews_root_arg: str):
    result = {
        "reviews_root": None,
        "status": "UNKNOWN",
        "checked": [],
        "skipped_by_override": [],
        "missing": [],
        "token_missing": [],
        "violations": [],
        "compaction_warnings": [],
        "compaction_warning_count": 0,
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Review artifacts cannot be validated: task id is missing.")
        return result

    if reviews_root_arg and reviews_root_arg.strip():
        reviews_root = resolve_path_inside_repo(reviews_root_arg, repo_root, allow_missing=True)
    else:
        reviews_root = join_orchestrator_path(repo_root, "runtime/reviews")
    result["reviews_root"] = normalize_path(reviews_root)

    skip_set = {value.lower() for value in skip_reviews}

    for review_key, pass_token in REVIEW_CONTRACTS:
        if not bool(required_reviews.get(review_key, False)):
            continue

        if review_key in skip_set:
            result["skipped_by_override"].append(review_key)
            continue

        artifact_path = (reviews_root / f"{task_id}-{review_key}.md").resolve()
        entry = {
            "review": review_key,
            "path": normalize_path(artifact_path),
            "pass_token": pass_token,
            "present": False,
            "token_found": False,
            "review_context_path": None,
            "review_context_present": False,
            "review_context_valid": False,
            "compaction_audit": None,
        }

        if not artifact_path.exists() or not artifact_path.is_file():
            result["missing"].append(review_key)
            result["violations"].append(f"Missing required review artifact: {entry['path']}")
            result["checked"].append(entry)
            continue

        entry["present"] = True
        content = artifact_path.read_text(encoding="utf-8")
        if pass_token in content:
            entry["token_found"] = True
        else:
            result["token_missing"].append(review_key)
            result["violations"].append(f"Review artifact '{entry['path']}' does not contain pass token '{pass_token}'.")

        review_context_path = (reviews_root / f"{task_id}-{review_key}-context.json").resolve()
        entry["review_context_path"] = normalize_path(review_context_path)
        review_context = None
        if review_context_path.exists() and review_context_path.is_file():
            entry["review_context_present"] = True
            try:
                review_context = json.loads(review_context_path.read_text(encoding="utf-8"))
                entry["review_context_valid"] = True
            except Exception as exc:
                result["compaction_warnings"].append(
                    f"Review context artifact '{entry['review_context_path']}' is invalid JSON: {exc}"
                )

        compaction_audit = audit_review_artifact_compaction(
            artifact_path=artifact_path,
            content=content,
            review_context=review_context,
        )
        entry["compaction_audit"] = compaction_audit
        result["compaction_warnings"].extend(compaction_audit["warnings"])

        result["checked"].append(entry)

    result["compaction_warning_count"] = len(result["compaction_warnings"])
    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


def get_compile_gate_evidence(
    repo_root: Path,
    task_id: str,
    preflight_path: Path,
    preflight_hash: str,
    compile_evidence_path_arg: str,
):
    result = {
        "evidence_path": None,
        "evidence_hash": None,
        "status": "UNKNOWN",
        "violations": [],
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Compile evidence cannot be validated: task id is missing.")
        return result

    if compile_evidence_path_arg and compile_evidence_path_arg.strip():
        evidence_path = resolve_path_inside_repo(compile_evidence_path_arg, repo_root, allow_missing=True)
    else:
        evidence_path = join_orchestrator_path(repo_root, f"runtime/reviews/{task_id}-compile-gate.json")

    result["evidence_path"] = normalize_path(evidence_path)
    if not evidence_path.exists() or not evidence_path.is_file():
        result["status"] = "EVIDENCE_FILE_MISSING"
        result["violations"].append(f"Compile evidence file not found: {result['evidence_path']}")
        return result

    result["evidence_hash"] = file_sha256(evidence_path)
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception:
        result["status"] = "EVIDENCE_INVALID_JSON"
        result["violations"].append(f"Compile evidence is invalid JSON: {result['evidence_path']}")
        return result

    recorded_task_id = str(evidence.get("task_id", "")).strip()
    recorded_source = str(evidence.get("event_source", "")).strip().lower()
    recorded_status = str(evidence.get("status", "")).strip().upper()
    recorded_outcome = str(evidence.get("outcome", "")).strip().upper()
    recorded_preflight_path = normalize_path(evidence.get("preflight_path"))
    recorded_preflight_hash = str(evidence.get("preflight_hash_sha256", "")).strip().lower()

    if recorded_task_id != task_id:
        result["violations"].append(f"Compile evidence task mismatch. Expected '{task_id}', got '{recorded_task_id}'.")
    if recorded_source != "compile-gate":
        result["violations"].append(f"Compile evidence source mismatch. Expected 'compile-gate', got '{recorded_source}'.")
    if not (recorded_status == "PASSED" and recorded_outcome == "PASS"):
        result["violations"].append(f"Compile evidence is not PASS. status='{recorded_status}', outcome='{recorded_outcome}'.")
    if recorded_preflight_hash != preflight_hash.strip().lower():
        result["violations"].append("Compile evidence preflight hash mismatch.")
    expected_preflight_path = normalize_path(preflight_path.resolve())
    if recorded_preflight_path and recorded_preflight_path.lower() != expected_preflight_path.lower():
        result["violations"].append("Compile evidence preflight path mismatch.")

    result["evidence"] = evidence
    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


def get_review_gate_evidence(
    repo_root: Path,
    task_id: str,
    preflight_path: Path,
    preflight_hash: str,
    review_evidence_path_arg: str,
    compile_evidence: dict,
):
    result = {
        "evidence_path": None,
        "status": "UNKNOWN",
        "violations": [],
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Review evidence cannot be validated: task id is missing.")
        return result

    if review_evidence_path_arg and review_evidence_path_arg.strip():
        evidence_path = resolve_path_inside_repo(review_evidence_path_arg, repo_root, allow_missing=True)
    else:
        evidence_path = join_orchestrator_path(repo_root, f"runtime/reviews/{task_id}-review-gate.json")

    result["evidence_path"] = normalize_path(evidence_path)
    if not evidence_path.exists() or not evidence_path.is_file():
        result["status"] = "EVIDENCE_FILE_MISSING"
        result["violations"].append(f"Review evidence file not found: {result['evidence_path']}")
        return result

    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception:
        result["status"] = "EVIDENCE_INVALID_JSON"
        result["violations"].append(f"Review evidence is invalid JSON: {result['evidence_path']}")
        return result

    recorded_task_id = str(evidence.get("task_id", "")).strip()
    recorded_source = str(evidence.get("event_source", "")).strip().lower()
    recorded_status = str(evidence.get("status", "")).strip().upper()
    recorded_outcome = str(evidence.get("outcome", "")).strip().upper()
    recorded_preflight_path = normalize_path(evidence.get("preflight_path"))
    recorded_preflight_hash = str(evidence.get("preflight_hash_sha256", "")).strip().lower()
    recorded_compile_path = normalize_path(evidence.get("compile_evidence_path"))
    recorded_compile_hash = str(evidence.get("compile_evidence_hash_sha256", "")).strip().lower()

    if recorded_task_id != task_id:
        result["violations"].append(f"Review evidence task mismatch. Expected '{task_id}', got '{recorded_task_id}'.")
    if recorded_source != "required-reviews-check":
        result["violations"].append(
            "Review evidence source mismatch. Expected 'required-reviews-check', "
            f"got '{recorded_source}'."
        )
    if not (recorded_status == "PASSED" and recorded_outcome == "PASS"):
        result["violations"].append(f"Review evidence is not PASS. status='{recorded_status}', outcome='{recorded_outcome}'.")
    if recorded_preflight_hash != preflight_hash.strip().lower():
        result["violations"].append("Review evidence preflight hash mismatch.")
    expected_preflight_path = normalize_path(preflight_path.resolve())
    if recorded_preflight_path and recorded_preflight_path.lower() != expected_preflight_path.lower():
        result["violations"].append("Review evidence preflight path mismatch.")
    if compile_evidence:
        compile_path = compile_evidence.get("evidence_path")
        compile_hash = str(compile_evidence.get("evidence_hash") or "").strip().lower()
        if recorded_compile_path and compile_path and recorded_compile_path.lower() != str(compile_path).lower():
            result["violations"].append("Review evidence compile path mismatch.")
        if recorded_compile_hash and compile_hash and recorded_compile_hash != compile_hash:
            result["violations"].append("Review evidence compile hash mismatch.")

    result["evidence"] = evidence
    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


def get_doc_impact_evidence(
    repo_root: Path,
    task_id: str,
    preflight_path: Path,
    preflight_hash: str,
    doc_impact_path_arg: str,
):
    result = {
        "evidence_path": None,
        "status": "UNKNOWN",
        "violations": [],
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Doc impact evidence cannot be validated: task id is missing.")
        return result

    if doc_impact_path_arg and doc_impact_path_arg.strip():
        evidence_path = resolve_path_inside_repo(doc_impact_path_arg, repo_root, allow_missing=True)
    else:
        evidence_path = join_orchestrator_path(repo_root, f"runtime/reviews/{task_id}-doc-impact.json")

    result["evidence_path"] = normalize_path(evidence_path)
    if not evidence_path.exists() or not evidence_path.is_file():
        result["status"] = "EVIDENCE_FILE_MISSING"
        result["violations"].append(f"Doc impact evidence file not found: {result['evidence_path']}")
        return result

    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception:
        result["status"] = "EVIDENCE_INVALID_JSON"
        result["violations"].append(f"Doc impact evidence is invalid JSON: {result['evidence_path']}")
        return result

    recorded_task_id = str(evidence.get("task_id", "")).strip()
    recorded_source = str(evidence.get("event_source", "")).strip().lower()
    recorded_status = str(evidence.get("status", "")).strip().upper()
    recorded_outcome = str(evidence.get("outcome", "")).strip().upper()
    recorded_preflight_path = normalize_path(evidence.get("preflight_path"))
    recorded_preflight_hash = str(evidence.get("preflight_hash_sha256", "")).strip().lower()
    recorded_decision = str(evidence.get("decision", "")).strip().upper()
    recorded_rationale = str(evidence.get("rationale", "")).strip()
    recorded_behavior_changed = bool(evidence.get("behavior_changed", False))
    recorded_changelog_updated = bool(evidence.get("changelog_updated", False))
    docs_updated = [str(item).strip() for item in (evidence.get("docs_updated") or []) if str(item).strip()]
    recorded_sensitive_triggers = [str(item).strip() for item in (evidence.get("sensitive_triggers_detected") or []) if str(item).strip()]
    recorded_sensitive_scope_reviewed = bool(evidence.get("sensitive_scope_reviewed", False))

    if recorded_task_id != task_id:
        result["violations"].append(f"Doc impact evidence task mismatch. Expected '{task_id}', got '{recorded_task_id}'.")
    if recorded_source != "doc-impact-gate":
        result["violations"].append(f"Doc impact evidence source mismatch. Expected 'doc-impact-gate', got '{recorded_source}'.")
    if not (recorded_status == "PASSED" and recorded_outcome == "PASS"):
        result["violations"].append(f"Doc impact evidence is not PASS. status='{recorded_status}', outcome='{recorded_outcome}'.")
    if recorded_preflight_hash != preflight_hash.strip().lower():
        result["violations"].append("Doc impact evidence preflight hash mismatch.")
    expected_preflight_path = normalize_path(preflight_path.resolve())
    if recorded_preflight_path and recorded_preflight_path.lower() != expected_preflight_path.lower():
        result["violations"].append("Doc impact evidence preflight path mismatch.")

    if recorded_decision not in {"NO_DOC_UPDATES", "DOCS_UPDATED"}:
        result["violations"].append(f"Doc impact decision '{recorded_decision}' is invalid.")
    if not recorded_rationale or len(recorded_rationale) < 12:
        result["violations"].append("Doc impact rationale must be provided (>= 12 chars).")
    if recorded_decision == "DOCS_UPDATED" and not docs_updated:
        result["violations"].append("Doc impact decision DOCS_UPDATED requires non-empty docs_updated list.")
    if recorded_behavior_changed and recorded_decision != "DOCS_UPDATED":
        result["violations"].append("Behavior-changed tasks must set decision=DOCS_UPDATED.")
    if recorded_behavior_changed and not recorded_changelog_updated:
        result["violations"].append("Behavior-changed tasks must set changelog_updated=true.")
    if recorded_sensitive_triggers and recorded_decision == "NO_DOC_UPDATES" and not recorded_sensitive_scope_reviewed:
        triggers_str = ", ".join(recorded_sensitive_triggers)
        result["violations"].append(
            f"Sensitive scope triggers ({triggers_str}) detected: NO_DOC_UPDATES requires sensitive_scope_reviewed=true."
        )

    result["evidence"] = evidence
    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


parser = argparse.ArgumentParser()
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--task-id", default="")
parser.add_argument("--timeline-path", default="")
parser.add_argument("--reviews-root", default="")
parser.add_argument("--compile-evidence-path", default="")
parser.add_argument("--review-evidence-path", default="")
parser.add_argument("--doc-impact-path", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

repo_root = resolve_project_root(script_dir)
preflight_path = resolve_path_inside_repo(args.preflight_path, repo_root)
if not preflight_path.exists():
    print(f"Preflight artifact not found: {preflight_path}", file=sys.stderr)
    sys.exit(1)

validated_preflight = validate_preflight(preflight_path, args.task_id)
resolved_task_id = validated_preflight["resolved_task_id"]

metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path = join_orchestrator_path(repo_root, "runtime/metrics.jsonl")
else:
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = resolve_path_inside_repo(metrics_path_raw, repo_root, allow_missing=True)
emit_metrics = parse_bool(args.emit_metrics)

compile_evidence = get_compile_gate_evidence(
    repo_root=repo_root,
    task_id=resolved_task_id,
    preflight_path=validated_preflight["preflight_path"],
    preflight_hash=validated_preflight["preflight_hash"],
    compile_evidence_path_arg=args.compile_evidence_path,
)
review_gate_evidence = get_review_gate_evidence(
    repo_root=repo_root,
    task_id=resolved_task_id,
    preflight_path=validated_preflight["preflight_path"],
    preflight_hash=validated_preflight["preflight_hash"],
    review_evidence_path_arg=args.review_evidence_path,
    compile_evidence=compile_evidence,
)
doc_impact_evidence = get_doc_impact_evidence(
    repo_root=repo_root,
    task_id=resolved_task_id,
    preflight_path=validated_preflight["preflight_path"],
    preflight_hash=validated_preflight["preflight_hash"],
    doc_impact_path_arg=args.doc_impact_path,
)
timeline_evidence = get_timeline_evidence(repo_root, resolved_task_id, args.timeline_path)
artifact_evidence = get_review_artifact_evidence(
    repo_root=repo_root,
    task_id=resolved_task_id,
    required_reviews=validated_preflight["required_reviews"],
    skip_reviews=timeline_evidence["skip_reviews"],
    reviews_root_arg=args.reviews_root,
)

errors = []
errors.extend(validated_preflight["errors"])
errors.extend(compile_evidence["violations"])
errors.extend(review_gate_evidence["violations"])
errors.extend(doc_impact_evidence["violations"])
errors.extend(timeline_evidence["violations"])
errors.extend(artifact_evidence["violations"])

if errors:
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "completion_gate_check",
        "status": "FAILED",
        "task_id": resolved_task_id,
        "preflight_path": normalize_path(validated_preflight["preflight_path"]),
        "compile_evidence": compile_evidence,
        "review_gate_evidence": review_gate_evidence,
        "doc_impact_evidence": doc_impact_evidence,
        "timeline": timeline_evidence,
        "review_artifacts": artifact_evidence,
        "violations": errors,
    }
    append_metrics_event(metrics_path, failure_event, emit_metrics)
    append_task_event(
        repo_root=repo_root,
        task_id=resolved_task_id,
        event_type="COMPLETION_GATE_FAILED",
        outcome="FAIL",
        message="Completion gate failed.",
        details={
            "preflight_path": normalize_path(validated_preflight["preflight_path"]),
            "compile_evidence": compile_evidence,
            "review_gate_evidence": review_gate_evidence,
            "doc_impact_evidence": doc_impact_evidence,
            "timeline": timeline_evidence,
            "review_artifacts": artifact_evidence,
            "violations": errors,
        },
    )

    print("COMPLETION_GATE_FAILED")
    print("Violations:")
    for err in errors:
        print(f"- {err}")
    sys.exit(1)

success_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "completion_gate_check",
    "status": "PASSED",
    "task_id": resolved_task_id,
    "preflight_path": normalize_path(validated_preflight["preflight_path"]),
    "compile_evidence": compile_evidence,
    "review_gate_evidence": review_gate_evidence,
    "doc_impact_evidence": doc_impact_evidence,
    "timeline": timeline_evidence,
    "review_artifacts": artifact_evidence,
}
append_metrics_event(metrics_path, success_event, emit_metrics)
append_task_event(
    repo_root=repo_root,
    task_id=resolved_task_id,
    event_type="COMPLETION_GATE_PASSED",
    outcome="PASS",
    message="Completion gate passed.",
    details={
        "preflight_path": normalize_path(validated_preflight["preflight_path"]),
        "compile_evidence": compile_evidence,
        "review_gate_evidence": review_gate_evidence,
        "doc_impact_evidence": doc_impact_evidence,
        "timeline": timeline_evidence,
        "review_artifacts": artifact_evidence,
    },
)

print("COMPLETION_GATE_PASSED")
print(f"RequiredReviewArtifactsChecked: {len(artifact_evidence['checked'])}")
if artifact_evidence["skipped_by_override"]:
    print(f"SkippedByOverride: {','.join(artifact_evidence['skipped_by_override'])}")
if artifact_evidence["compaction_warning_count"] > 0:
    print(f"CompactionWarnings: {artifact_evidence['compaction_warning_count']}")
PY
