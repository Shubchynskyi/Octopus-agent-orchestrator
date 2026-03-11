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
    append_metrics_event,
    append_task_event,
    assert_valid_task_id,
    normalize_path,
    parse_bool,
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
        "violations": [],
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Task timeline cannot be validated: task id is missing.")
        return result

    if timeline_path_arg and timeline_path_arg.strip():
        timeline_path = Path(timeline_path_arg.strip())
        if not timeline_path.is_absolute():
            timeline_path = (repo_root / timeline_path).resolve()
    else:
        timeline_path = (repo_root / f"Octopus-agent-orchestrator/runtime/task-events/{task_id}.jsonl").resolve()
    result["timeline_path"] = normalize_path(timeline_path)

    if not timeline_path.exists() or not timeline_path.is_file():
        result["status"] = "TIMELINE_MISSING"
        result["violations"].append(f"Task timeline not found: {result['timeline_path']}")
        return result

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
    }

    if not task_id:
        result["status"] = "TASK_ID_MISSING"
        result["violations"].append("Review artifacts cannot be validated: task id is missing.")
        return result

    if reviews_root_arg and reviews_root_arg.strip():
        reviews_root = Path(reviews_root_arg.strip())
        if not reviews_root.is_absolute():
            reviews_root = (repo_root / reviews_root).resolve()
    else:
        reviews_root = (repo_root / "Octopus-agent-orchestrator/runtime/reviews").resolve()
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

        result["checked"].append(entry)

    result["status"] = "FAILED" if result["violations"] else "PASS"
    return result


parser = argparse.ArgumentParser()
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--task-id", default="")
parser.add_argument("--timeline-path", default="")
parser.add_argument("--reviews-root", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

repo_root = resolve_project_root(script_dir)
preflight_path = Path(args.preflight_path)
if not preflight_path.is_absolute():
    preflight_path = preflight_path.resolve()
if not preflight_path.exists():
    print(f"Preflight artifact not found: {preflight_path}", file=sys.stderr)
    sys.exit(1)

validated_preflight = validate_preflight(preflight_path, args.task_id)
resolved_task_id = validated_preflight["resolved_task_id"]

metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path = (repo_root / "Octopus-agent-orchestrator/runtime/metrics.jsonl").resolve()
else:
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = (repo_root / metrics_path).resolve()
emit_metrics = parse_bool(args.emit_metrics)

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
errors.extend(timeline_evidence["violations"])
errors.extend(artifact_evidence["violations"])

if errors:
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "completion_gate_check",
        "status": "FAILED",
        "task_id": resolved_task_id,
        "preflight_path": normalize_path(validated_preflight["preflight_path"]),
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
        "timeline": timeline_evidence,
        "review_artifacts": artifact_evidence,
    },
)

print("COMPLETION_GATE_PASSED")
print(f"RequiredReviewArtifactsChecked: {len(artifact_evidence['checked'])}")
if artifact_evidence["skipped_by_override"]:
    print(f"SkippedByOverride: {','.join(artifact_evidence['skipped_by_override'])}")
PY
