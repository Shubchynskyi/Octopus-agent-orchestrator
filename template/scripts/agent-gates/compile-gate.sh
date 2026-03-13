#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OA_GATE_SCRIPT_DIR="$SCRIPT_DIR"
if command -v cygpath >/dev/null 2>&1; then
  export OA_GATE_BASH_BIN="$(cygpath -w "${BASH:-$(command -v bash)}")"
else
  export OA_GATE_BASH_BIN="${BASH:-$(command -v bash)}"
fi

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
import time
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
    resolve_path_inside_repo,
    resolve_project_root,
)

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
        if re.search(r"\borg\.apache\.maven\.wrapper\.mavenwrappermain\b", command, re.IGNORECASE):
            raise RuntimeError(
                "Compile command anti-pattern detected in "
                f"{rule_path}: use wrapper entrypoint script (for example './mvnw' or '.\\mvnw.cmd') "
                "instead of MavenWrapperMain class invocation."
            )
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


def resolve_compile_output_path(explicit_path: str, repo_root: Path, task_id: str):
    if not task_id:
        return None
    if explicit_path and explicit_path.strip():
        return resolve_path_inside_repo(explicit_path, repo_root)
    return (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{task_id}-compile-output.log").resolve()


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
            normalize_path(item)
            for item in (explicit_changed_files or [])
            if normalize_path(item)
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
            normalized = normalize_path(parts[2])
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
        files_fingerprint = string_sha256("\n".join(normalized_explicit_changed_files))
        scope_fingerprint = string_sha256(
            f"{source}|{False}|{include_untracked}|{len(normalized_explicit_changed_files)}|{changed_lines_total}|{files_fingerprint}"
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
            "changed_files_sha256": files_fingerprint,
            "scope_sha256": scope_fingerprint,
        }

    diff_args = ["diff", "--name-only", "--diff-filter=ACMRTUXB"]
    diff_args.extend(["--cached"] if use_staged else ["HEAD"])
    changed_from_diff = git_lines(repo_root, diff_args, "Failed to collect changed files snapshot.")

    untracked = []
    if include_untracked:
        untracked = git_lines(repo_root, ["ls-files", "--others", "--exclude-standard"], "Failed to collect untracked files snapshot.")

    normalized_changed_files = sorted({normalize_path(item) for item in (changed_from_diff + untracked) if normalize_path(item)})

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
            normalized = normalize_path(item)
            if not normalized:
                continue
            additions_total += count_file_lines(repo_root / normalized)

    changed_lines_total = additions_total + deletions_total
    files_fingerprint = string_sha256("\n".join(normalized_changed_files))
    scope_fingerprint = string_sha256(
        f"{source}|{use_staged}|{include_untracked}|{len(normalized_changed_files)}|{changed_lines_total}|{files_fingerprint}"
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
        "changed_files_sha256": files_fingerprint,
        "scope_sha256": scope_fingerprint,
    }


def get_preflight_context(preflight_path: Path, task_id: str):
    if not preflight_path or not preflight_path.exists():
        raise RuntimeError(f"Preflight artifact not found: {preflight_path}")
    try:
        preflight_object = json.loads(preflight_path.read_text(encoding="utf-8"))
    except Exception:
        raise RuntimeError(f"Preflight artifact is not valid JSON: {preflight_path}")

    preflight_task_id = str(preflight_object.get("task_id", "")).strip()
    if preflight_task_id and preflight_task_id != task_id:
        raise RuntimeError(f"TaskId '{task_id}' does not match preflight.task_id '{preflight_task_id}'.")

    if "changed_files" not in preflight_object:
        raise RuntimeError("Preflight field `changed_files` is required.")
    if "metrics" not in preflight_object or not isinstance(preflight_object.get("metrics"), dict):
        raise RuntimeError("Preflight field `metrics` is required.")
    if "required_reviews" not in preflight_object or not isinstance(preflight_object.get("required_reviews"), dict):
        raise RuntimeError("Preflight field `required_reviews` is required.")

    preflight_changed_files = sorted(
        {
            normalize_path(item)
            for item in (preflight_object.get("changed_files") or [])
            if normalize_path(item)
        }
    )
    changed_lines_total = preflight_object.get("metrics", {}).get("changed_lines_total")
    if not isinstance(changed_lines_total, int) or changed_lines_total < 0:
        raise RuntimeError("Preflight field `metrics.changed_lines_total` is required and must be non-negative.")

    detection_source = str(preflight_object.get("detection_source", "git_auto")).strip() or "git_auto"
    include_untracked = detection_source.lower() != "git_staged_only"

    return {
        "preflight": preflight_object,
        "task_id": task_id,
        "detection_source": detection_source,
        "include_untracked": include_untracked,
        "changed_files": preflight_changed_files,
        "changed_files_count": len(preflight_changed_files),
        "changed_lines_total": int(changed_lines_total),
        "changed_files_sha256": string_sha256("\n".join(preflight_changed_files)),
    }


def get_output_stats(lines):
    warning_lines = 0
    error_lines = 0
    for line in lines:
        if re.search(r"\bwarning\b", line, re.IGNORECASE):
            warning_lines += 1
        if re.search(r"\berror\b", line, re.IGNORECASE):
            error_lines += 1
    return warning_lines, error_lines


def append_compile_output_entry(output_path: Path, command_index: int, total_commands: int, command: str, output_lines):
    if not output_path:
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as fh:
        fh.write(f"==== COMMAND {command_index}/{total_commands} ====\n")
        fh.write(f"COMMAND: {command}\n")
        fh.write(f"TIMESTAMP_UTC: {datetime.now(timezone.utc).isoformat()}\n")
        fh.write("---- OUTPUT START ----\n")
        for line in output_lines:
            fh.write(f"{line}\n")
        fh.write("---- OUTPUT END ----\n\n")


def write_compile_evidence(
    evidence_path: Path,
    task_id: str,
    gate_context: dict,
    status: str,
    outcome: str,
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
        "error": error_message,
    }
    payload.update(gate_context)
    evidence_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


parser = argparse.ArgumentParser()
parser.add_argument("--commands-path", default="Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md")
parser.add_argument("--task-id", default="")
parser.add_argument("--preflight-path", default="")
parser.add_argument("--compile-evidence-path", default="")
parser.add_argument("--compile-output-path", default="")
parser.add_argument("--fail-tail-lines", default="50")
parser.add_argument("--output-filters-path", default="Octopus-agent-orchestrator/live/config/output-filters.json")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
parser.add_argument("--repo-root", default="")
args = parser.parse_args()

bash_executable = (os.environ.get("OA_GATE_BASH_BIN") or "bash").strip()
repo_root = Path(args.repo_root).resolve() if args.repo_root else resolve_project_root(script_dir)
task_id = args.task_id.strip()
if task_id:
    task_id = assert_valid_task_id(task_id)
if not task_id:
    raise RuntimeError("task-id is required for compile gate")

try:
    fail_tail_lines = int(str(args.fail_tail_lines).strip())
except Exception as exc:
    raise RuntimeError(f"fail-tail-lines must be an integer: {exc}")
if fail_tail_lines <= 0:
    raise RuntimeError("fail-tail-lines must be a positive integer")

metrics_path = Path(args.metrics_path).resolve() if args.metrics_path.strip() else (repo_root / "Octopus-agent-orchestrator/runtime/metrics.jsonl").resolve()
emit_metrics = args.emit_metrics.strip().lower() in {"1", "true", "yes", "y"}

resolved_commands_path = None
compile_commands = []
resolved_preflight_path = None
preflight_hash = None
preflight_context = None
workspace_snapshot = None
compile_evidence_path = None
compile_output_path = None
output_filters_path = None
compile_output_lines = []
warning_count = 0
error_count = 0
duration_ms = 0
exit_code = 0
error_message = None
started_at = time.perf_counter()

try:
    resolved_commands_path = resolve_commands_path(args.commands_path, repo_root)
    compile_commands = list(get_compile_commands(resolved_commands_path))
    resolved_preflight_path = resolve_preflight_path(args.preflight_path, repo_root, task_id)
    preflight_context = get_preflight_context(resolved_preflight_path, task_id)
    workspace_snapshot = get_workspace_snapshot(
        repo_root=repo_root,
        detection_source=preflight_context["detection_source"],
        include_untracked=bool(preflight_context["include_untracked"]),
        explicit_changed_files=preflight_context["changed_files"],
    )
    scope_violations = []
    if workspace_snapshot["changed_files_sha256"] != preflight_context["changed_files_sha256"]:
        scope_violations.append("Preflight changed_files differ from current workspace snapshot.")
    if int(workspace_snapshot["changed_lines_total"]) != int(preflight_context["changed_lines_total"]):
        scope_violations.append(
            "Preflight changed_lines_total="
            f"{preflight_context['changed_lines_total']} differs from current snapshot changed_lines_total="
            f"{workspace_snapshot['changed_lines_total']}."
        )
    if scope_violations:
        scope_details = {
            "preflight_changed_files": preflight_context["changed_files"],
            "preflight_changed_files_count": preflight_context["changed_files_count"],
            "preflight_changed_lines_total": preflight_context["changed_lines_total"],
            "preflight_changed_files_sha256": preflight_context["changed_files_sha256"],
            "snapshot_detection_source": workspace_snapshot["detection_source"],
            "snapshot_include_untracked": workspace_snapshot["include_untracked"],
            "snapshot_changed_files": workspace_snapshot["changed_files"],
            "snapshot_changed_files_count": workspace_snapshot["changed_files_count"],
            "snapshot_changed_lines_total": workspace_snapshot["changed_lines_total"],
            "snapshot_changed_files_sha256": workspace_snapshot["changed_files_sha256"],
            "violations": scope_violations,
        }
        raise RuntimeError(
            "Preflight scope drift detected. Re-run classify-change before compile gate. "
            + json.dumps(scope_details, ensure_ascii=False, separators=(",", ":"))
        )
    preflight_hash = file_sha256(resolved_preflight_path)
    compile_evidence_path = resolve_compile_evidence_path(args.compile_evidence_path, repo_root, task_id)
    compile_output_path = resolve_compile_output_path(args.compile_output_path, repo_root, task_id)
    output_filters_path = resolve_path_inside_repo(args.output_filters_path, repo_root, allow_missing=True)

    for command_index, compile_command in enumerate(compile_commands, start=1):
        command_output_lines = []
        command_exit_code = 0
        try:
            completed = subprocess.run(
                [bash_executable, "-lc", compile_command],
                capture_output=True,
                text=True,
                cwd=str(repo_root),
                check=False,
            )
            command_exit_code = int(completed.returncode)
            stdout_lines = completed.stdout.splitlines() if completed.stdout else []
            stderr_lines = completed.stderr.splitlines() if completed.stderr else []
            command_output_lines = stdout_lines + stderr_lines
        except Exception as exc:
            command_exit_code = 1
            command_output_lines = [f"Failed to execute compile command: {exc}"]

        compile_output_lines.extend(command_output_lines)
        command_warning_count, command_error_count = get_output_stats(command_output_lines)
        warning_count += command_warning_count
        error_count += command_error_count
        append_compile_output_entry(
            output_path=compile_output_path,
            command_index=command_index,
            total_commands=len(compile_commands),
            command=compile_command,
            output_lines=command_output_lines,
        )

        if command_exit_code != 0:
            exit_code = command_exit_code
            error_message = f"Compile command #{command_index} exited with code {command_exit_code}."
            break
except Exception as exc:
    if not error_message:
        error_message = str(exc)
    if exit_code == 0:
        exit_code = 1
finally:
    duration_ms = int(round((time.perf_counter() - started_at) * 1000))

gate_context = {
    "commands_path": normalize_path(resolved_commands_path),
    "compile_commands": compile_commands,
    "compile_command": compile_commands[0] if compile_commands else None,
    "preflight_path": normalize_path(resolved_preflight_path) if resolved_preflight_path else None,
    "preflight_hash_sha256": preflight_hash,
    "preflight_detection_source": preflight_context["detection_source"] if preflight_context else None,
    "preflight_include_untracked": bool(preflight_context["include_untracked"]) if preflight_context else None,
    "preflight_changed_files_count": int(preflight_context["changed_files_count"]) if preflight_context else None,
    "preflight_changed_lines_total": int(preflight_context["changed_lines_total"]) if preflight_context else None,
    "preflight_changed_files_sha256": preflight_context["changed_files_sha256"] if preflight_context else None,
    "scope_detection_source": workspace_snapshot["detection_source"] if workspace_snapshot else None,
    "scope_use_staged": bool(workspace_snapshot["use_staged"]) if workspace_snapshot else None,
    "scope_include_untracked": bool(workspace_snapshot["include_untracked"]) if workspace_snapshot else None,
    "scope_changed_files": workspace_snapshot["changed_files"] if workspace_snapshot else [],
    "scope_changed_files_count": int(workspace_snapshot["changed_files_count"]) if workspace_snapshot else 0,
    "scope_changed_lines_total": int(workspace_snapshot["changed_lines_total"]) if workspace_snapshot else 0,
    "scope_changed_files_sha256": workspace_snapshot["changed_files_sha256"] if workspace_snapshot else None,
    "scope_sha256": workspace_snapshot["scope_sha256"] if workspace_snapshot else None,
    "evidence_path": normalize_path(compile_evidence_path) if compile_evidence_path else None,
    "compile_output_path": normalize_path(compile_output_path) if compile_output_path else None,
    "output_filters_path": normalize_path(output_filters_path) if output_filters_path else None,
    "compile_output_lines": len(compile_output_lines),
    "compile_output_warning_lines": warning_count,
    "compile_output_error_lines": error_count,
    "duration_ms": duration_ms,
    "exit_code": exit_code if error_message else 0,
}
compile_output_context = {"fail_tail_lines": fail_tail_lines}
if error_message:
    filtered_output_result = apply_output_filter_profile(
        compile_output_lines,
        output_filters_path,
        "compile_failure_console",
        context=compile_output_context,
    )
else:
    filtered_output_result = apply_output_filter_profile(
        compile_output_lines,
        output_filters_path,
        "compile_success_console",
        context=compile_output_context,
    )
filtered_output_lines = list(filtered_output_result["lines"])
compile_output_telemetry = build_output_telemetry(
    compile_output_lines,
    filtered_output_lines,
    filter_mode=filtered_output_result["filter_mode"],
    fallback_mode=filtered_output_result["fallback_mode"],
)
gate_context.update(compile_output_telemetry)

if error_message:
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "compile_gate_check",
        "status": "FAILED",
        "task_id": task_id or None,
        "error": error_message,
    }
    failure_event.update(gate_context)
    append_metrics_event(metrics_path, failure_event, emit_metrics)
    write_compile_evidence(
        evidence_path=compile_evidence_path,
        task_id=task_id,
        gate_context=gate_context,
        status="FAILED",
        outcome="FAIL",
        error_message=error_message,
    )
    append_task_event(repo_root, task_id, "COMPILE_GATE_FAILED", "FAIL", "Compile gate failed.", failure_event)

    print("COMPILE_GATE_FAILED")
    print(
        f"CompileSummary: FAILED | duration_ms={duration_ms} | exit_code={exit_code} | errors={error_count} | warnings={warning_count}"
    )
    if compile_output_path:
        print(f"CompileOutputPath: {normalize_path(compile_output_path)}")
    if filtered_output_lines:
        if (
            compile_output_telemetry["filter_mode"] == "profile:compile_failure_console"
            and compile_output_telemetry["fallback_mode"] == "none"
        ):
            print(f"CompileOutputTailLast{min(fail_tail_lines, len(filtered_output_lines))}Lines:")
        else:
            print("CompileOutputFilteredLines:")
        for line in filtered_output_lines:
            print(line)
    print(f"Reason: {error_message}")
    sys.exit(1)

success_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "compile_gate_check",
    "status": "PASSED",
    "task_id": task_id or None,
}
success_event.update(gate_context)
append_metrics_event(metrics_path, success_event, emit_metrics)
write_compile_evidence(
    evidence_path=compile_evidence_path,
    task_id=task_id,
    gate_context=gate_context,
    status="PASSED",
    outcome="PASS",
    error_message=None,
)
append_task_event(repo_root, task_id, "COMPILE_GATE_PASSED", "PASS", "Compile gate passed.", success_event)

print("COMPILE_GATE_PASSED")
print(f"CompileSummary: PASSED | duration_ms={duration_ms} | exit_code=0 | errors={error_count} | warnings={warning_count}")
if compile_output_path:
    print(f"CompileOutputPath: {normalize_path(compile_output_path)}")
PY
