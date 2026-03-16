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

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import assert_valid_task_id, inspect_task_event_file, resolve_path_inside_repo, resolve_project_root, to_posix


def parse_timestamp(value):
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)

    text = str(value).strip()
    if not text:
        return datetime.min.replace(tzinfo=timezone.utc)

    candidate = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def format_timestamp(value):
    if value is None:
        return None

    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        candidate = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
        except Exception:
            return text

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


parser = argparse.ArgumentParser()
parser.add_argument("--task-id", required=True)
parser.add_argument("--repo-root", default="")
parser.add_argument("--events-root", default="")
parser.add_argument("--output-path", default="")
parser.add_argument("--as-json", action="store_true")
parser.add_argument("--include-details", action="store_true")
args = parser.parse_args()

repo_root = Path(args.repo_root).resolve() if args.repo_root else resolve_project_root(script_dir)

try:
    task_id = assert_valid_task_id(args.task_id)
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)

if args.events_root.strip():
    events_root = resolve_path_inside_repo(args.events_root, repo_root, allow_missing=True)
else:
    events_root = (repo_root / "Octopus-agent-orchestrator/runtime/task-events").resolve()

task_event_file = (events_root / f"{task_id}.jsonl").resolve()
if not task_event_file.exists() or not task_event_file.is_file():
    print(f"Task events file not found: {task_event_file}", file=sys.stderr)
    sys.exit(1)

lines = [line for line in task_event_file.read_text(encoding="utf-8").splitlines() if line.strip()]
events = []
parse_errors = 0
integrity_report = inspect_task_event_file(task_event_file, task_id)

for line in lines:
    try:
        event = json.loads(line)
    except Exception:
        parse_errors += 1
        continue
    if event is None:
        continue
    events.append(event)

events.sort(key=lambda item: parse_timestamp(item.get("timestamp_utc") if isinstance(item, dict) else None))

summary = {
    "task_id": task_id,
    "source_path": to_posix(task_event_file),
    "events_count": len(events),
    "parse_errors": parse_errors,
    "integrity": integrity_report,
    "first_event_utc": format_timestamp(events[0].get("timestamp_utc")) if events else None,
    "last_event_utc": format_timestamp(events[-1].get("timestamp_utc")) if events else None,
    "timeline": [],
}

for index, event in enumerate(events, start=1):
    summary["timeline"].append(
        {
            "index": index,
            "timestamp_utc": format_timestamp(event.get("timestamp_utc")),
            "event_type": str(event.get("event_type") or "UNKNOWN"),
            "outcome": str(event.get("outcome") or "UNKNOWN"),
            "actor": str(event.get("actor")) if event.get("actor") is not None else None,
            "message": str(event.get("message") or ""),
            "details": event.get("details"),
        }
    )

if args.as_json:
    output_text = json.dumps(summary, ensure_ascii=False, indent=2)
else:
    output_lines = [
        f"Task: {task_id}",
        f"Source: {summary['source_path']}",
        f"Events: {summary['events_count']}",
        f"IntegrityStatus: {integrity_report['status']}",
    ]
    if parse_errors > 0:
        output_lines.append(f"ParseErrors: {parse_errors}")
    if integrity_report["integrity_event_count"] > 0:
        output_lines.append(f"IntegrityEvents: {integrity_report['integrity_event_count']}")
    if integrity_report["legacy_event_count"] > 0:
        output_lines.append(f"LegacyEvents: {integrity_report['legacy_event_count']}")
    if integrity_report["violations"]:
        output_lines.append(f"IntegrityViolations: {len(integrity_report['violations'])}")
    if summary["first_event_utc"]:
        output_lines.append(f"FirstEventUTC: {summary['first_event_utc']}")
    if summary["last_event_utc"]:
        output_lines.append(f"LastEventUTC: {summary['last_event_utc']}")

    output_lines.extend(["", "Timeline:"])

    for item in summary["timeline"]:
        timestamp = item["timestamp_utc"] or ""
        line = f"[{item['index']:02d}] {timestamp} | {item['event_type']} | {item['outcome']}"
        actor = item.get("actor")
        if actor and actor.strip():
            line += f" | actor={actor}"
        message = item.get("message") or ""
        if message.strip():
            line += f" | {message}"
        output_lines.append(line)

        if args.include_details and item.get("details") is not None:
            details_json = json.dumps(item["details"], ensure_ascii=False, separators=(",", ":"))
            output_lines.append(f"       details={details_json}")

    if integrity_report["violations"]:
        output_lines.extend(["", "IntegrityViolations:"])
        for violation in integrity_report["violations"]:
            output_lines.append(f"- {violation}")

    output_text = "\n".join(output_lines)

if args.output_path.strip():
    output_path = resolve_path_inside_repo(args.output_path, repo_root, allow_missing=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output_text, encoding="utf-8")

print(output_text)
PY
