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
    parser_mode: str = "NONE",
    parser_name: str = "",
    parser_strategy: str = "",
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
        "parser_mode": str(parser_mode).strip().upper() if str(parser_mode).strip() else "NONE",
        "parser_name": str(parser_name).strip() if str(parser_name).strip() else None,
        "parser_strategy": str(parser_strategy).strip() if str(parser_strategy).strip() else None,
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


def _resolve_filter_str(
    value: Any,
    context: Optional[dict],
    field_name: str,
    *,
    allow_empty: bool = False,
) -> str:
    resolved_value = value
    if isinstance(value, dict) and isinstance(value.get("context_key"), str) and value.get("context_key").strip():
        context_key = value["context_key"].strip()
        if not isinstance(context, dict) or context_key not in context:
            raise ValueError(f"{field_name} references missing context key '{context_key}'.")
        resolved_value = context[context_key]

    if resolved_value is None:
        if allow_empty:
            return ""
        raise ValueError(f"{field_name} must resolve to non-empty string.")

    text = str(resolved_value).strip()
    if not text and not allow_empty:
        raise ValueError(f"{field_name} must resolve to non-empty string.")
    return text


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


def _add_unique_lines(destination: List[str], seen: set[str], lines: Any, *, limit: int = 0) -> None:
    for line_value in to_string_array(lines):
        line_text = str(line_value)
        if not line_text.strip() or line_text in seen:
            continue
        destination.append(line_text)
        seen.add(line_text)
        if limit > 0 and len(destination) >= limit:
            break


def _select_matching_lines(lines: List[str], patterns: List[str], *, limit: int = 0) -> List[str]:
    matches: List[str] = []
    for line in lines:
        if any(re.search(pattern, line) for pattern in patterns):
            matches.append(line)
            if limit > 0 and len(matches) >= limit:
                break
    return matches


def _get_compile_failure_strategy_config(strategy: str) -> dict:
    normalized = (strategy or "").strip().lower()
    if normalized == "maven":
        return {
            "display_name": "maven",
            "full_patterns": [
                r"^\[ERROR\]",
                r"BUILD FAILURE",
                r"COMPILATION ERROR",
                r"Failed to execute goal",
                r"There are test failures",
                r"Tests run: .*Failures:",
                r"Re-run Maven",
            ],
            "degraded_patterns": [r"^\[ERROR\]", r"^\[WARNING\]", r"BUILD FAILURE", r"error"],
        }
    if normalized == "gradle":
        return {
            "display_name": "gradle",
            "full_patterns": [
                r"^FAILURE: Build failed with an exception\.",
                r"^BUILD FAILED",
                r"Execution failed for task",
                r"^\* What went wrong:",
                r"^> .*",
                r"^> Task .*FAILED",
            ],
            "degraded_patterns": [r"^FAILURE:", r"^BUILD FAILED", r"FAILED", r"error"],
        }
    if normalized == "node":
        return {
            "display_name": "node-build",
            "full_patterns": [
                r"^npm ERR!",
                r"^ERR!",
                r"Command failed with exit code",
                r"Failed to compile",
                r"ERROR in",
                r"Type error",
                r"Module not found",
            ],
            "degraded_patterns": [r"^npm ERR!", r"warning", r"error", r"failed"],
        }
    if normalized == "cargo":
        return {
            "display_name": "cargo",
            "full_patterns": [
                r"^error(\[[A-Z0-9]+\])?:",
                r"^Caused by:",
                r"could not compile",
                r"^failures:",
                r"^test result: FAILED",
            ],
            "degraded_patterns": [r"^warning:", r"^error", r"FAILED"],
        }
    if normalized == "dotnet":
        return {
            "display_name": "dotnet",
            "full_patterns": [
                r"^Build FAILED\.",
                r"^\s*error [A-Z]{2,}\d+:",
                r"^\s*warning [A-Z]{2,}\d+:",
                r"^Failed!  - Failed:",
                r"^Test Run Failed\.",
            ],
            "degraded_patterns": [r"^\s*error ", r"^\s*warning ", r"FAILED"],
        }
    if normalized == "go":
        return {
            "display_name": "go",
            "full_patterns": [
                r"^# ",
                r"^--- FAIL:",
                r"^FAIL(\s|$)",
                r"^panic:",
                r"cannot use",
                r"undefined:",
            ],
            "degraded_patterns": [r"^FAIL", r"^panic:", r"error"],
        }
    return {
        "display_name": "generic-compile",
        "full_patterns": [r"error", r"failed", r"exception", r"cannot ", r"undefined", r"not found"],
        "degraded_patterns": [r"warning", r"error", r"failed"],
    }


def _invoke_compile_failure_parser(lines: List[str], parser_config: dict, context: Optional[dict]) -> dict:
    strategy = _resolve_filter_str(parser_config.get("strategy"), context, "parser.strategy", allow_empty=True)
    if not strategy:
        strategy = _resolve_filter_str({"context_key": "command_filter_strategy"}, context, "parser.strategy_context", allow_empty=True)
    if not strategy:
        strategy = "generic"

    config = _get_compile_failure_strategy_config(strategy)
    max_matches = _resolve_filter_int(parser_config.get("max_matches"), context, "parser.max_matches", minimum=1)
    tail_count = _resolve_filter_int(parser_config.get("tail_count"), context, "parser.tail_count", minimum=0)

    full_matches = _select_matching_lines(lines, config["full_patterns"], limit=max_matches)
    if full_matches:
        summary_lines: List[str] = []
        seen: set[str] = set()
        _add_unique_lines(summary_lines, seen, [f"CompactSummary: FULL | strategy={config['display_name']}"])
        _add_unique_lines(summary_lines, seen, full_matches, limit=max_matches + 1)
        if tail_count > 0:
            _add_unique_lines(summary_lines, seen, _select_tail_lines(lines, tail_count))
        return {
            "lines": summary_lines,
            "parser_mode": "FULL",
            "parser_name": "compile_failure_summary",
            "parser_strategy": config["display_name"],
            "fallback_mode": "none",
        }

    degraded_matches = _select_matching_lines(lines, config["degraded_patterns"], limit=max(max_matches, 8))
    if degraded_matches:
        summary_lines = []
        seen = set()
        _add_unique_lines(summary_lines, seen, [f"CompactSummary: DEGRADED | strategy={config['display_name']}"])
        _add_unique_lines(summary_lines, seen, degraded_matches, limit=max(max_matches, 8) + 1)
        if tail_count > 0:
            _add_unique_lines(summary_lines, seen, _select_tail_lines(lines, tail_count))
        return {
            "lines": summary_lines,
            "parser_mode": "DEGRADED",
            "parser_name": "compile_failure_summary",
            "parser_strategy": config["display_name"],
            "fallback_mode": "none",
        }

    return {
        "lines": list(lines),
        "parser_mode": "PASSTHROUGH",
        "parser_name": "compile_failure_summary",
        "parser_strategy": config["display_name"],
        "fallback_mode": "parser_passthrough",
    }


def _invoke_test_failure_parser(lines: List[str], parser_config: dict, context: Optional[dict]) -> dict:
    max_matches = _resolve_filter_int(parser_config.get("max_matches"), context, "parser.max_matches", minimum=1)
    tail_count = _resolve_filter_int(parser_config.get("tail_count"), context, "parser.tail_count", minimum=0)
    patterns = [
        r"^--- FAIL:",
        r"^FAIL(\s|$)",
        r"^FAILED",
        r"^failures?:",
        r"^panic:",
        r"^AssertionError",
        r"^Error:",
        r"[0-9]+\s+failed",
        r"Test Run Failed",
        r"[✕×]",
    ]
    matches = _select_matching_lines(lines, patterns, limit=max_matches)
    if matches:
        summary_lines: List[str] = []
        seen: set[str] = set()
        _add_unique_lines(summary_lines, seen, ["CompactSummary: FULL | strategy=test"])
        _add_unique_lines(summary_lines, seen, matches, limit=max_matches + 1)
        if tail_count > 0:
            _add_unique_lines(summary_lines, seen, _select_tail_lines(lines, tail_count))
        return {
            "lines": summary_lines,
            "parser_mode": "FULL",
            "parser_name": "test_failure_summary",
            "parser_strategy": "test",
            "fallback_mode": "none",
        }

    return {
        "lines": list(lines),
        "parser_mode": "PASSTHROUGH",
        "parser_name": "test_failure_summary",
        "parser_strategy": "test",
        "fallback_mode": "parser_passthrough",
    }


def _invoke_lint_failure_parser(lines: List[str], parser_config: dict, context: Optional[dict]) -> dict:
    max_matches = _resolve_filter_int(parser_config.get("max_matches"), context, "parser.max_matches", minimum=1)
    tail_count = _resolve_filter_int(parser_config.get("tail_count"), context, "parser.tail_count", minimum=0)
    patterns = [
        r"^\s*error",
        r"^\s*warning",
        r":[0-9]+(:[0-9]+)?\s+(error|warning)",
        r"^Found\s+[0-9]+\s+errors?",
        r"^[✖×]",
        r"problems?",
    ]
    matches = _select_matching_lines(lines, patterns, limit=max_matches)
    if matches:
        summary_lines: List[str] = []
        seen: set[str] = set()
        _add_unique_lines(summary_lines, seen, ["CompactSummary: FULL | strategy=lint"])
        _add_unique_lines(summary_lines, seen, matches, limit=max_matches + 1)
        if tail_count > 0:
            _add_unique_lines(summary_lines, seen, _select_tail_lines(lines, tail_count))
        return {
            "lines": summary_lines,
            "parser_mode": "FULL",
            "parser_name": "lint_failure_summary",
            "parser_strategy": "lint",
            "fallback_mode": "none",
        }

    return {
        "lines": list(lines),
        "parser_mode": "PASSTHROUGH",
        "parser_name": "lint_failure_summary",
        "parser_strategy": "lint",
        "fallback_mode": "parser_passthrough",
    }


def _invoke_review_summary_parser(lines: List[str], parser_config: dict, context: Optional[dict]) -> dict:
    max_lines = _resolve_filter_int(parser_config.get("max_lines"), context, "parser.max_lines", minimum=1)
    summary_lines = _select_head_lines(lines, max_lines)
    if not summary_lines:
        return {
            "lines": list(lines),
            "parser_mode": "PASSTHROUGH",
            "parser_name": "review_gate_summary",
            "parser_strategy": "review",
            "fallback_mode": "parser_passthrough",
        }

    return {
        "lines": summary_lines,
        "parser_mode": "FULL",
        "parser_name": "review_gate_summary",
        "parser_strategy": "review",
        "fallback_mode": "none",
    }


def _apply_output_parser(lines: List[str], parser_config: Any, context: Optional[dict]) -> dict:
    if parser_config is None:
        return {
            "lines": list(lines),
            "parser_mode": "NONE",
            "parser_name": None,
            "parser_strategy": None,
            "fallback_mode": "none",
        }
    if not isinstance(parser_config, dict):
        raise ValueError("Profile parser must be an object.")

    parser_type = _resolve_filter_str(parser_config.get("type"), context, "parser.type")
    normalized = parser_type.strip().lower()
    if normalized == "compile_failure_summary":
        return _invoke_compile_failure_parser(lines, parser_config, context)
    if normalized == "test_failure_summary":
        return _invoke_test_failure_parser(lines, parser_config, context)
    if normalized == "lint_failure_summary":
        return _invoke_lint_failure_parser(lines, parser_config, context)
    if normalized == "review_gate_summary":
        return _invoke_review_summary_parser(lines, parser_config, context)
    raise ValueError(f"Unsupported profile parser type '{parser_type}'.")


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


def _apply_passthrough_ceiling(lines: List[str], config: Optional[dict], fallback_mode: str) -> List[str]:
    DEFAULT_MAX = 60
    max_lines = DEFAULT_MAX
    strategy = "tail"

    if isinstance(config, dict):
        ceiling_cfg = config.get("passthrough_ceiling")
        if isinstance(ceiling_cfg, dict):
            cfg_max = ceiling_cfg.get("max_lines")
            cfg_strategy = ceiling_cfg.get("strategy")
            if isinstance(cfg_max, int) and cfg_max > 0:
                max_lines = cfg_max
            if cfg_strategy == "head":
                strategy = "head"

    total = len(lines)
    if total <= max_lines:
        return list(lines)

    capped = _select_head_lines(lines, max_lines) if strategy == "head" else _select_tail_lines(lines, max_lines)
    header = f"[passthrough-ceiling] fallback={fallback_mode} total={total} ceiling={max_lines} strategy={strategy}"
    return [header] + capped


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
        "parser_mode": "NONE",
        "parser_name": None,
        "parser_strategy": None,
    }

    if not str(profile_name or "").strip():
        return passthrough

    if not config_path or not Path(config_path).exists():
        print(f"WARNING: output filter config missing for profile '{profile_name}': {config_path}", file=sys.stderr)
        passthrough["fallback_mode"] = "missing_config_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, None, "missing_config_passthrough")
        return passthrough

    try:
        config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARNING: output filter config is invalid JSON for profile '{profile_name}': {exc}", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_config_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, None, "invalid_config_passthrough")
        return passthrough

    profiles = config.get("profiles")
    if not isinstance(profiles, dict):
        print("WARNING: output filter config must contain object 'profiles'.", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_config_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, config, "invalid_config_passthrough")
        return passthrough

    profile = profiles.get(profile_name)
    if profile is None:
        print(f"WARNING: output filter profile '{profile_name}' not found in {config_path}.", file=sys.stderr)
        passthrough["fallback_mode"] = "missing_profile_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, config, "missing_profile_passthrough")
        return passthrough
    if not isinstance(profile, dict):
        print(f"WARNING: output filter profile '{profile_name}' must be an object.", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_profile_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, config, "invalid_profile_passthrough")
        return passthrough

    try:
        filtered_lines = list(original_lines)
        operations = profile.get("operations", [])
        if isinstance(operations, str) or not isinstance(operations, list):
            raise ValueError(f"Profile '{profile_name}' field 'operations' must be an array.")
        for operation in operations:
            filtered_lines = apply_output_filter_operation(filtered_lines, operation, context=context)

        parser_result = _apply_output_parser(filtered_lines, profile.get("parser"), context)
        filtered_lines = list(parser_result["lines"])
        if parser_result["parser_mode"] == "PASSTHROUGH":
            filtered_lines = _apply_passthrough_ceiling(filtered_lines, config, "parser_passthrough")
        emit_when_empty = str(profile.get("emit_when_empty", "")).strip()
        if not filtered_lines and emit_when_empty:
            filtered_lines = [emit_when_empty]

        return {
            "lines": filtered_lines,
            "filter_mode": f"profile:{profile_name}",
            "fallback_mode": parser_result["fallback_mode"],
            "parser_mode": parser_result["parser_mode"],
            "parser_name": parser_result["parser_name"],
            "parser_strategy": parser_result["parser_strategy"],
        }
    except Exception as exc:
        print(f"WARNING: output filter profile '{profile_name}' is invalid: {exc}", file=sys.stderr)
        passthrough["fallback_mode"] = "invalid_profile_passthrough"
        passthrough["lines"] = _apply_passthrough_ceiling(original_lines, config, "invalid_profile_passthrough")
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
