from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, List, Optional


def normalize_path(
    path_value: Any,
    *,
    trim: bool = False,
    strip_dot_slash: bool = False,
    strip_leading_slash: bool = False,
) -> Optional[str]:
    if path_value is None:
        return None
    normalized = str(path_value).replace("\\", "/")
    if trim:
        normalized = normalized.strip()
    if strip_dot_slash:
        while normalized.startswith("./"):
            normalized = normalized[2:]
    if strip_leading_slash:
        normalized = normalized.lstrip("/")
    return normalized or None


def to_posix(path_obj: Path) -> str:
    return str(path_obj).replace("\\", "/")


def parse_bool(value: Any) -> bool:
    normalized = str(value).strip().lower()
    if normalized in ("1", "true", "yes", "y", "on"):
        return True
    if normalized in ("0", "false", "no", "n", "off"):
        return False
    raise ValueError(f"Unsupported boolean value: {value}")


def assert_valid_task_id(value: str) -> str:
    if not value or not value.strip():
        raise ValueError("TaskId must not be empty.")
    task_id = value.strip()
    if len(task_id) > 128:
        raise ValueError("TaskId must be 128 characters or fewer.")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", task_id):
        raise ValueError(
            f"TaskId '{task_id}' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$"
        )
    return task_id


def file_sha256(path: Optional[Path]) -> Optional[str]:
    if not path or not path.exists() or not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest().lower()


def resolve_project_root(script_dir: Path) -> Path:
    project_root_candidate = (script_dir / "../../../../").resolve()
    fallback_root = (script_dir / "../../").resolve()
    return project_root_candidate if project_root_candidate.exists() else fallback_root


def resolve_path_inside_repo(
    path_value: str,
    repo_root: Path,
    *,
    allow_missing: bool = False,
    allow_empty: bool = False,
) -> Optional[Path]:
    if not path_value or not path_value.strip():
        if allow_empty:
            return None
        raise RuntimeError("Path value must not be empty.")

    candidate = Path(path_value.strip())
    if not candidate.is_absolute():
        candidate = repo_root / candidate

    candidate = candidate.resolve()
    repo_root_resolved = repo_root.resolve()

    try:
        candidate.relative_to(repo_root_resolved)
    except ValueError as exc:
        raise RuntimeError(
            f"Path '{path_value}' must resolve inside repository root '{repo_root_resolved}'."
        ) from exc

    if not allow_missing and not candidate.exists():
        raise RuntimeError(f"Path not found: {candidate}")

    return candidate


def to_string_array(value: Any, *, trim_values: bool = False) -> List[str]:
    if value is None:
        return []

    if isinstance(value, str):
        text = value.strip() if trim_values else value
        return [text] if text and text.strip() else []

    if isinstance(value, Iterable):
        result: List[str] = []
        for item in value:
            if item is None:
                continue
            text = str(item)
            if trim_values:
                text = text.strip()
            if not text or not text.strip():
                continue
            result.append(text)
        return result

    text = str(value)
    if trim_values:
        text = text.strip()
    return [text] if text and text.strip() else []


def match_any_regex(
    path_value: str,
    regexes: Iterable[str],
    *,
    invalid_regex_context: Optional[str] = None,
    skip_invalid_regex: bool = False,
) -> bool:
    for pattern in regexes:
        if not pattern:
            continue
        try:
            if re.search(pattern, path_value):
                return True
        except re.error as exc:
            if not skip_invalid_regex:
                raise
            context = f" for {invalid_regex_context}" if invalid_regex_context else ""
            print(f"WARNING: invalid regex '{pattern}'{context}: {exc}", file=sys.stderr)
    return False


def append_metrics_event(path: Optional[Path], event_obj: dict, emit_metrics: bool) -> None:
    if not emit_metrics or not path:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event_obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception as exc:
        print(f"WARNING: metrics append failed: {exc}", file=sys.stderr)


def append_task_event(
    repo_root: Path,
    task_id: str,
    event_type: str,
    outcome: str,
    message: str,
    details: dict,
) -> None:
    if not task_id:
        return

    safe_task_id = assert_valid_task_id(task_id)
    events_dir = (repo_root / "Octopus-agent-orchestrator/runtime/task-events").resolve()

    event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "task_id": safe_task_id,
        "event_type": event_type,
        "outcome": outcome,
        "message": message,
        "details": details,
    }
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))

    try:
        events_dir.mkdir(parents=True, exist_ok=True)
        with (events_dir / f"{safe_task_id}.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        with (events_dir / "all-tasks.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception as exc:
        print(f"WARNING: task-event append failed: {exc}", file=sys.stderr)