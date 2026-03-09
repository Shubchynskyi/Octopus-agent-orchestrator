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
import sys
from datetime import datetime, timezone
from pathlib import Path


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

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
project_root_candidate = (script_dir / "../../../../").resolve()
fallback_root = (script_dir / "../../").resolve()
repo_root = Path(args.repo_root).resolve() if args.repo_root else (project_root_candidate if project_root_candidate.exists() else fallback_root)

task_id = args.task_id.strip()
event_type = args.event_type.strip()
if not task_id:
    print("task-id must not be empty", file=sys.stderr)
    sys.exit(1)
if not event_type:
    print("event-type must not be empty", file=sys.stderr)
    sys.exit(1)

if args.events_root.strip():
    events_root = Path(args.events_root).resolve()
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

event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "task_id": task_id,
    "event_type": event_type,
    "outcome": args.outcome,
    "actor": args.actor,
    "message": args.message,
    "details": details,
}
line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))

task_file_path = (events_root / f"{task_id}.jsonl").resolve()
all_tasks_path = (events_root / "all-tasks.jsonl").resolve()

with task_file_path.open("a", encoding="utf-8") as fh:
    fh.write(line + "\n")
with all_tasks_path.open("a", encoding="utf-8") as fh:
    fh.write(line + "\n")

result = {
    "status": "TASK_EVENT_LOGGED",
    "task_id": task_id,
    "event_type": event_type,
    "outcome": args.outcome,
    "actor": args.actor,
    "task_event_log_path": str(task_file_path).replace("\\", "/"),
    "all_tasks_log_path": str(all_tasks_path).replace("\\", "/"),
}
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
