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


def count_text_chars(lines: Any) -> int:
    normalized_lines = to_string_array(lines)
    if not normalized_lines:
        return 0
    return sum(len(line) for line in normalized_lines) + max(len(normalized_lines) - 1, 0)


def build_output_telemetry(
    raw_lines: Any,
    filtered_lines: Any,
    *,
    filter_mode: str = "passthrough",
    fallback_mode: str = "none",
) -> dict:
    raw_line_list = to_string_array(raw_lines)
    filtered_line_list = to_string_array(filtered_lines)
    raw_char_count = count_text_chars(raw_line_list)
    filtered_char_count = count_text_chars(filtered_line_list)
    estimated_saved_chars = max(raw_char_count - filtered_char_count, 0)
    estimated_saved_tokens = 0 if estimated_saved_chars <= 0 else (estimated_saved_chars + 3) // 4

    return {
        "raw_line_count": len(raw_line_list),
        "raw_char_count": raw_char_count,
        "filtered_line_count": len(filtered_line_list),
        "filtered_char_count": filtered_char_count,
        "estimated_saved_chars": estimated_saved_chars,
        "estimated_saved_tokens": estimated_saved_tokens,
        "filter_mode": filter_mode.strip() if str(filter_mode).strip() else "passthrough",
        "fallback_mode": str(fallback_mode).strip() if str(fallback_mode).strip() else "none",
    }


def _resolve_filter_int(value: Any, context: Optional[dict], field_name: str, minimum: int = 0) -> int:
    resolved_value = value
    if isinstance(value, dict) and isinstance(value.get("context_key"), str) and value.get("context_key").strip():
        context_key = value["context_key"].strip()
        if not isinstance(context, dict) or context_key not in context:
            raise ValueError(f"{field_name} references missing context key '{context_key}'.")
        resolved_value = context[context_key]

    if isinstance(resolved_value, bool):
        raise ValueError(f"{field_name} must resolve to integer >= {minimum}.")
    if isinstance(resolved_value, int):
        result = resolved_value
    elif isinstance(resolved_value, float) and int(resolved_value) == resolved_value:
        result = int(resolved_value)
    elif isinstance(resolved_value, str) and resolved_value.strip().lstrip("-").isdigit():
        result = int(resolved_value.strip())
    else:
        raise ValueError(f"{field_name} must resolve to integer >= {minimum}.")

    if result < minimum:
        raise ValueError(f"{field_name} must resolve to integer >= {minimum}.")
    return result


def _get_filter_patterns(operation: dict) -> List[str]:
    patterns_value = operation.get("patterns", operation.get("pattern"))
    patterns = to_string_array(patterns_value, trim_values=True)
    if not patterns:
        raise ValueError("Filter operation requires non-empty `pattern` or `patterns`.")
    for pattern in patterns:
        re.compile(pattern)
    return patterns


def _select_head_lines(lines: List[str], count: int) -> List[str]:
    if count <= 0:
        return []
    return list(lines[:count])


def _select_tail_lines(lines: List[str], count: int) -> List[str]:
    if count <= 0:
        return []
    return list(lines[-count:])


def apply_output_filter_operation(lines: Any, operation: dict, context: Optional[dict] = None) -> List[str]:
    if not isinstance(operation, dict):
        raise ValueError("Filter operation must be an object.")

    operation_type = str(operation.get("type", "")).strip().lower()
    if not operation_type:
        raise ValueError("Filter operation requires non-empty `type`.")

    current_lines = to_string_array(lines)
    if operation_type == "strip_ansi":
        ansi_pattern = re.compile(r"\x1B\[[0-9;?]*[ -/]*[@-~]")
        return [ansi_pattern.sub("", line) for line in current_lines]
    if operation_type == "regex_replace":
        pattern = str(operation.get("pattern", "")).strip()
        if not pattern:
            raise ValueError("regex_replace requires non-empty `pattern`.")
        compiled = re.compile(pattern)
        replacement = str(operation.get("replacement", ""))
        return [compiled.sub(replacement, line) for line in current_lines]
    if operation_type == "drop_lines_matching":
        patterns = _get_filter_patterns(operation)
        return [line for line in current_lines if not any(re.search(pattern, line) for pattern in patterns)]
    if operation_type == "keep_lines_matching":
        patterns = _get_filter_patterns(operation)
        return [line for line in current_lines if any(re.search(pattern, line) for pattern in patterns)]
    if operation_type == "truncate_line_length":
        max_chars = _resolve_filter_int(operation.get("max_chars"), context, "truncate_line_length.max_chars", minimum=1)
        suffix = str(operation.get("suffix", "..."))
        result: List[str] = []
        for line in current_lines:
            if len(line) <= max_chars:
                result.append(line)
            elif len(suffix) >= max_chars:
                result.append(suffix[:max_chars])
            else:
                result.append(line[: max_chars - len(suffix)] + suffix)
        return result
    if operation_type == "head":
        count = _resolve_filter_int(operation.get("count"), context, "head.count", minimum=1)
        return _select_head_lines(current_lines, count)
    if operation_type == "tail":
        count = _resolve_filter_int(operation.get("count"), context, "tail.count", minimum=1)
        return _select_tail_lines(current_lines, count)
    if operation_type == "max_total_lines":
        max_lines = _resolve_filter_int(operation.get("max_lines"), context, "max_total_lines.max_lines", minimum=0)
        strategy = str(operation.get("strategy", "tail")).strip().lower() or "tail"
        if max_lines == 0:
            return []
        if strategy == "head":
            return _select_head_lines(current_lines, max_lines)
        if strategy == "tail":
            return _select_tail_lines(current_lines, max_lines)
        raise ValueError("max_total_lines.strategy must be 'head' or 'tail'.")

    raise ValueError(f"Unsupported filter operation type '{operation_type}'.")


def apply_output_filter_profile(
    lines: Any,
    config_path: Optional[Path],
    profile_name: str,
    *,
    context: Optional[dict] = None,
) -> dict:
    original_lines = to_string_array(lines)
    passthrough = {
        "lines": original_lines,
        "filter_mode": "passthrough",
        "fallback_mode": "none",
    }

    if not str(profile_name or "").strip():
        return passthrough

    if not config_path or not Path(config_path).exists():
        print(f"WARNING: output filter config missing for profile '{profile_name}': {config_path}", file=sys.stderr)
        passthrough["fallback_mode"] = "missing_config_passthrough"
        return passthrough

    try:
        config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARNING: output filter config is invalid JSON for profile '{profile_name}': {exc}", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_config_passthrough"
        return passthrough

    profiles = config.get("profiles")
    if not isinstance(profiles, dict):
        print("WARNING: output filter config must contain object 'profiles'.", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_config_passthrough"
        return passthrough

    profile = profiles.get(profile_name)
    if profile is None:
        print(f"WARNING: output filter profile '{profile_name}' not found in {config_path}.", file=sys.stderr)
        passthrough["fallback_mode"] = "missing_profile_passthrough"
        return passthrough
    if not isinstance(profile, dict):
        print(f"WARNING: output filter profile '{profile_name}' must be an object.", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_profile_passthrough"
        return passthrough

    try:
        filtered_lines = list(original_lines)
        operations = profile.get("operations", [])
        if isinstance(operations, str) or not isinstance(operations, list):
            raise ValueError(f"Profile '{profile_name}' field 'operations' must be an array.")
        for operation in operations:
            filtered_lines = apply_output_filter_operation(filtered_lines, operation, context=context)

        emit_when_empty = str(profile.get("emit_when_empty", "")).strip()
        if not filtered_lines and emit_when_empty:
            filtered_lines = [emit_when_empty]

        return {
            "lines": filtered_lines,
            "filter_mode": f"profile:{profile_name}",
            "fallback_mode": "none",
        }
    except Exception as exc:
        print(f"WARNING: output filter profile '{profile_name}' is invalid: {exc}", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_profile_passthrough"
        return passthrough


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
