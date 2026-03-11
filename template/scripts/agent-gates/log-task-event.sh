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
import glob
from datetime import datetime, timezone
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import (
    assert_valid_task_id,
    resolve_path_inside_repo,
    resolve_project_root,
    to_posix,
)


parser = argparse.ArgumentParser()
parser.add_argument("--task-id", required=True)
parser.add_argument("--event-type", required=True)
parser.add_argument("--outcome", default="INFO", choices=["INFO", "PASS", "FAIL", "BLOCKED"])
parser.add_argument("--message", default="")
parser.add_argument("--actor", default="orchestrator")
parser.add_argument("--details-json", default="")
parser.add_argument("--repo-root", default="")
parser.add_argument("--events-root", default="")
args = parser.parse_args()

repo_root = Path(args.repo_root).resolve() if args.repo_root else resolve_project_root(script_dir)

try:
    task_id = assert_valid_task_id(args.task_id)
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)

event_type = args.event_type.strip()
if not event_type:
    print("event-type must not be empty", file=sys.stderr)
    sys.exit(1)
if re.match(r"^(COMPILE_GATE_|REVIEW_GATE_|PREFLIGHT_)", event_type):
    print(f"event-type '{event_type}' is reserved and cannot be emitted via log-task-event", file=sys.stderr)
    sys.exit(1)

if args.events_root.strip():
    events_root = resolve_path_inside_repo(args.events_root, repo_root, allow_missing=True)
else:
    events_root = (repo_root / "Octopus-agent-orchestrator/runtime/task-events").resolve()
events_root.mkdir(parents=True, exist_ok=True)

details = None
if args.details_json.strip():
    try:
        details = json.loads(args.details_json)
    except Exception as exc:
        print(f"details-json is not valid JSON: {exc}", file=sys.stderr)
        sys.exit(1)


def as_details_map(details_obj):
    if details_obj is None:
        return {}
    if isinstance(details_obj, dict):
        return dict(details_obj)
    return {"input_details": details_obj}


def cleanup_terminal_compile_logs(repo_root_path: Path, task_identifier: str):
    result = {
        "triggered": True,
        "attempted_paths": 0,
        "discovered_paths": [],
        "deleted_paths": [],
        "missing_paths": [],
        "errors": [],
    }

    reviews_root = (repo_root_path / "Octopus-agent-orchestrator/runtime/reviews").resolve()
    candidates = set()

    for path_str in glob.glob(str(reviews_root / f"{task_identifier}-compile-output*.log")):
        candidates.add(str(Path(path_str).resolve()))

    compile_evidence_path = (reviews_root / f"{task_identifier}-compile-gate.json").resolve()
    if compile_evidence_path.exists() and compile_evidence_path.is_file():
        try:
            evidence_payload = json.loads(compile_evidence_path.read_text(encoding="utf-8"))
            evidence_output_path = evidence_payload.get("compile_output_path")
            if isinstance(evidence_output_path, str) and evidence_output_path.strip():
                resolved_evidence_output = resolve_path_inside_repo(evidence_output_path, repo_root_path)
                candidates.add(str(resolved_evidence_output))
        except Exception as exc:
            result["errors"].append(
                f"Failed to read compile evidence '{to_posix(compile_evidence_path)}': {exc}"
            )

    for candidate in sorted(candidates):
        try:
            resolved_candidate = resolve_path_inside_repo(candidate, repo_root_path)
        except Exception as exc:
            result["errors"].append(f"Compile output path is invalid '{candidate}': {exc}")
            continue

        normalized = to_posix(resolved_candidate)
        result["discovered_paths"].append(normalized)
        result["attempted_paths"] = len(result["discovered_paths"])

        if not resolved_candidate.exists() or not resolved_candidate.is_file():
            result["missing_paths"].append(normalized)
            continue

        try:
            resolved_candidate.unlink()
            result["deleted_paths"].append(normalized)
        except Exception as exc:
            result["errors"].append(f"Failed to delete compile output '{normalized}': {exc}")

    return result


is_terminal_event = event_type in {"TASK_DONE", "TASK_BLOCKED"}
terminal_log_cleanup = {
    "triggered": False,
    "attempted_paths": 0,
    "discovered_paths": [],
    "deleted_paths": [],
    "missing_paths": [],
    "errors": [],
}
cleanup_failed = False
event_details = details

if is_terminal_event:
    terminal_log_cleanup = cleanup_terminal_compile_logs(repo_root, task_id)
    cleanup_failed = len(terminal_log_cleanup["errors"]) > 0
    event_details = as_details_map(details)
    event_details["terminal_log_cleanup"] = terminal_log_cleanup

event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "task_id": task_id,
    "event_type": event_type,
    "outcome": args.outcome,
    "actor": args.actor,
    "message": args.message,
    "details": event_details,
}
line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))

task_file_path = (events_root / f"{task_id}.jsonl").resolve()
all_tasks_path = (events_root / "all-tasks.jsonl").resolve()

try:
    with task_file_path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    with all_tasks_path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
except Exception as exc:
    print(f"WARNING: task-event append failed: {exc}", file=sys.stderr)

result = {
    "status": "TASK_EVENT_LOGGED",
    "task_id": task_id,
    "event_type": event_type,
    "outcome": args.outcome,
    "actor": args.actor,
    "task_event_log_path": to_posix(task_file_path),
    "all_tasks_log_path": to_posix(all_tasks_path),
}
if is_terminal_event:
    result["terminal_log_cleanup"] = terminal_log_cleanup
if cleanup_failed:
    result["status"] = "TASK_EVENT_LOGGED_CLEANUP_FAILED"
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("terminal compile log cleanup failed", file=sys.stderr)
    sys.exit(1)

print(json.dumps(result, ensure_ascii=False, indent=2))
PY
