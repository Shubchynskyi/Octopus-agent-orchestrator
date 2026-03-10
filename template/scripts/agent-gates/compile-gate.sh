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
import subprocess
import sys
import time
import hashlib
from datetime import datetime, timezone
from pathlib import Path


def normalize_path(path_value):
    if path_value is None:
        return None
    return str(path_value).replace("\\", "/")


def assert_valid_task_id(value: str):
    if not value or not value.strip():
        raise ValueError("TaskId must not be empty.")
    task_id = value.strip()
    if len(task_id) > 128:
        raise ValueError("TaskId must be 128 characters or fewer.")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", task_id):
        raise ValueError(f"TaskId '{task_id}' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$")
    return task_id


def file_sha256(path: Path):
    if not path or not path.exists() or not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest().lower()


def append_metrics_event(path: Path, event_obj: dict, emit_metrics: bool):
    if not emit_metrics:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event_obj, ensure_ascii=False, separators=(",", ":")) + "\n")


def append_task_event(repo_root: Path, task_id: str, event_type: str, outcome: str, message: str, details: dict):
    if not task_id:
        return
    task_id = assert_valid_task_id(task_id)
    events_root = (repo_root / "Octopus-agent-orchestrator/runtime/task-events").resolve()
    events_root.mkdir(parents=True, exist_ok=True)
    event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "task_id": task_id,
        "event_type": event_type,
        "outcome": outcome,
        "message": message,
        "details": details,
    }
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    with (events_root / f"{task_id}.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    with (events_root / "all-tasks.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def resolve_path_inside_repo(path_value: str, repo_root: Path) -> Path:
    if not path_value or not path_value.strip():
        raise RuntimeError("Path value must not be empty")
    candidate = Path(path_value.strip())
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    candidate = candidate.resolve()
    repo_root_resolved = repo_root.resolve()
    if not str(candidate).lower().startswith(str(repo_root_resolved).lower()):
        raise RuntimeError(f"Path '{path_value}' must resolve inside repository root '{repo_root_resolved}'.")
    return candidate


def resolve_commands_path(path_value: str, repo_root: Path) -> Path:
    if not path_value.strip():
        raise RuntimeError("commands-path must not be empty")
    candidate = resolve_path_inside_repo(path_value, repo_root)
    if not candidate.exists():
        raise RuntimeError(f"Commands file not found: {candidate}")
    return candidate


def get_compile_commands(rule_path: Path):
    lines = rule_path.read_text(encoding="utf-8").splitlines()
    if not lines:
        raise RuntimeError(f"Commands file is empty: {rule_path}")

    section_index = -1
    for idx, line in enumerate(lines):
        if line.strip() == "### Compile Gate (Mandatory)":
            section_index = idx
            break
    if section_index < 0:
        raise RuntimeError(f"Section '### Compile Gate (Mandatory)' not found in {rule_path}")

    fence_start = -1
    for idx in range(section_index + 1, len(lines)):
        stripped = lines[idx].strip()
        if stripped.startswith("```"):
            fence_start = idx
            break
        if stripped.startswith("### "):
            break
    if fence_start < 0:
        raise RuntimeError(
            f"Code fence with compile command not found under '### Compile Gate (Mandatory)' in {rule_path}"
        )

    commands = []
    for idx in range(fence_start + 1, len(lines)):
        stripped = lines[idx].strip()
        if stripped.startswith("```"):
            break
        if not stripped or stripped.startswith("#"):
            continue
        commands.append(stripped)

    if not commands:
        raise RuntimeError(f"Compile command is missing under '### Compile Gate (Mandatory)' in {rule_path}")

    for command in commands:
        if re.match(r"^\s*<[^>]+>\s*$", command):
            raise RuntimeError(f"Compile command placeholder is unresolved in {rule_path}: {command}")
    return commands


def resolve_preflight_path(explicit_preflight_path: str, repo_root: Path, task_id: str):
    if explicit_preflight_path and explicit_preflight_path.strip():
        return resolve_path_inside_repo(explicit_preflight_path, repo_root)
    if not task_id:
        return None
    return (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-preflight.json").resolve()


def resolve_compile_evidence_path(explicit_path: str, repo_root: Path, task_id: str):
    if not task_id:
        return None
    if explicit_path and explicit_path.strip():
        return resolve_path_inside_repo(explicit_path, repo_root)
    return (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-compile-gate.json").resolve()


def write_compile_evidence(
    evidence_path: Path,
    task_id: str,
    preflight_path: Path,
    preflight_hash: str,
    status: str,
    outcome: str,
    compile_commands,
    commands_path: Path,
    duration_ms: int,
    exit_code: int,
    error_message: str,
):
    if not evidence_path or not task_id:
        return
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_source": "compile-gate",
        "task_id": task_id,
        "status": status,
        "outcome": outcome,
        "commands_path": normalize_path(commands_path),
        "compile_commands": compile_commands,
        "preflight_path": normalize_path(preflight_path) if preflight_path else None,
        "preflight_hash_sha256": preflight_hash,
        "duration_ms": duration_ms,
        "exit_code": exit_code,
        "error": error_message,
    }
    evidence_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


parser = argparse.ArgumentParser()
parser.add_argument("--commands-path", default="Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md")
parser.add_argument("--task-id", default="")
parser.add_argument("--preflight-path", default="")
parser.add_argument("--compile-evidence-path", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
parser.add_argument("--repo-root", default="")
args = parser.parse_args()

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
project_root_candidate = (script_dir / "../../../../").resolve()
fallback_root = (script_dir / "../../").resolve()
repo_root = Path(args.repo_root).resolve() if args.repo_root else (project_root_candidate if project_root_candidate.exists() else fallback_root)
task_id = args.task_id.strip()
if task_id:
    task_id = assert_valid_task_id(task_id)

metrics_path = Path(args.metrics_path).resolve() if args.metrics_path.strip() else (repo_root / "Octopus-agent-orchestrator/runtime/metrics.jsonl").resolve()
emit_metrics = args.emit_metrics.strip().lower() in {"1", "true", "yes", "y"}

resolved_commands_path = None
compile_commands = []
resolved_preflight_path = None
preflight_hash = None
compile_evidence_path = None
duration_ms = 0
exit_code = 1
error_message = None
started_at = time.perf_counter()

try:
    resolved_commands_path = resolve_commands_path(args.commands_path, repo_root)
    compile_commands = list(get_compile_commands(resolved_commands_path))
    resolved_preflight_path = resolve_preflight_path(args.preflight_path, repo_root, task_id)
    preflight_hash = file_sha256(resolved_preflight_path)
    compile_evidence_path = resolve_compile_evidence_path(args.compile_evidence_path, repo_root, task_id)

    for compile_command in compile_commands:
        completed = subprocess.run(
            compile_command,
            shell=True,
            cwd=str(repo_root),
            check=False,
        )
        exit_code = int(completed.returncode)
        if exit_code != 0:
            raise RuntimeError(f"Compile command exited with code {exit_code}.")
except Exception as exc:
    error_message = str(exc)
finally:
    duration_ms = int(round((time.perf_counter() - started_at) * 1000))

if error_message:
    failure_details = {
        "commands_path": normalize_path(resolved_commands_path),
        "compile_commands": compile_commands,
        "compile_command": compile_commands[0] if compile_commands else None,
        "preflight_path": normalize_path(resolved_preflight_path) if resolved_preflight_path else None,
        "preflight_hash_sha256": preflight_hash,
        "evidence_path": normalize_path(compile_evidence_path) if compile_evidence_path else None,
        "duration_ms": duration_ms,
        "exit_code": exit_code,
        "error": error_message,
    }
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "compile_gate_check",
        "status": "FAILED",
        "task_id": task_id or None,
        "commands_path": normalize_path(resolved_commands_path),
        "compile_commands": compile_commands,
        "compile_command": compile_commands[0] if compile_commands else None,
        "preflight_path": normalize_path(resolved_preflight_path) if resolved_preflight_path else None,
        "preflight_hash_sha256": preflight_hash,
        "evidence_path": normalize_path(compile_evidence_path) if compile_evidence_path else None,
        "duration_ms": duration_ms,
        "exit_code": exit_code,
        "error": error_message,
    }
    append_metrics_event(metrics_path, failure_event, emit_metrics)
    write_compile_evidence(
        evidence_path=compile_evidence_path,
        task_id=task_id,
        preflight_path=resolved_preflight_path,
        preflight_hash=preflight_hash,
        status="FAILED",
        outcome="FAIL",
        compile_commands=compile_commands,
        commands_path=resolved_commands_path,
        duration_ms=duration_ms,
        exit_code=exit_code,
        error_message=error_message,
    )
    append_task_event(repo_root, task_id, "COMPILE_GATE_FAILED", "FAIL", "Compile gate failed.", failure_details)

    print("COMPILE_GATE_FAILED")
    if resolved_commands_path:
        print(f"CommandsPath: {normalize_path(resolved_commands_path)}")
    if compile_commands:
        print(f"CompileCommand: {compile_commands[0]}")
        if len(compile_commands) > 1:
            print(f"CompileCommandsCount: {len(compile_commands)}")
    if compile_evidence_path:
        print(f"CompileEvidencePath: {normalize_path(compile_evidence_path)}")
    print(f"DurationMs: {duration_ms}")
    print(f"ExitCode: {exit_code}")
    print(f"Reason: {error_message}")
    sys.exit(1)

success_details = {
    "commands_path": normalize_path(resolved_commands_path),
    "compile_commands": compile_commands,
    "compile_command": compile_commands[0] if compile_commands else None,
    "preflight_path": normalize_path(resolved_preflight_path) if resolved_preflight_path else None,
    "preflight_hash_sha256": preflight_hash,
    "evidence_path": normalize_path(compile_evidence_path) if compile_evidence_path else None,
    "duration_ms": duration_ms,
    "exit_code": 0,
}
success_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "compile_gate_check",
    "status": "PASSED",
    "task_id": task_id or None,
    "commands_path": normalize_path(resolved_commands_path),
    "compile_commands": compile_commands,
    "compile_command": compile_commands[0] if compile_commands else None,
    "preflight_path": normalize_path(resolved_preflight_path) if resolved_preflight_path else None,
    "preflight_hash_sha256": preflight_hash,
    "evidence_path": normalize_path(compile_evidence_path) if compile_evidence_path else None,
    "duration_ms": duration_ms,
    "exit_code": 0,
}
append_metrics_event(metrics_path, success_event, emit_metrics)
write_compile_evidence(
    evidence_path=compile_evidence_path,
    task_id=task_id,
    preflight_path=resolved_preflight_path,
    preflight_hash=preflight_hash,
    status="PASSED",
    outcome="PASS",
    compile_commands=compile_commands,
    commands_path=resolved_commands_path,
    duration_ms=duration_ms,
    exit_code=0,
    error_message=None,
)
append_task_event(repo_root, task_id, "COMPILE_GATE_PASSED", "PASS", "Compile gate passed.", success_details)

print("COMPILE_GATE_PASSED")
print(f"CommandsPath: {normalize_path(resolved_commands_path)}")
if compile_commands:
    print(f"CompileCommand: {compile_commands[0]}")
    if len(compile_commands) > 1:
        print(f"CompileCommandsCount: {len(compile_commands)}")
if compile_evidence_path:
    print(f"CompileEvidencePath: {normalize_path(compile_evidence_path)}")
print(f"DurationMs: {duration_ms}")
PY
