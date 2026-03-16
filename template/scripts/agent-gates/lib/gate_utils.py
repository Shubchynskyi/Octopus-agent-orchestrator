from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
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


def string_sha256(value: Any) -> Optional[str]:
    if value is None:
        return None
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest().lower()


def _normalize_integrity_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _normalize_integrity_value(val) for key, val in sorted(value.items(), key=lambda item: str(item[0]))}
    if isinstance(value, (list, tuple, set)):
        return [_normalize_integrity_value(item) for item in value]
    if isinstance(value, Path):
        return to_posix(value)
    if isinstance(value, datetime):
        normalized = value
        if normalized.tzinfo is None:
            normalized = normalized.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).isoformat()
    return value


def build_event_integrity_hash(event_obj: dict) -> str:
    normalized_event = dict(event_obj)
    integrity = normalized_event.get("integrity")
    if isinstance(integrity, dict):
        normalized_integrity = dict(integrity)
        normalized_integrity.pop("event_sha256", None)
        normalized_event["integrity"] = normalized_integrity

    canonical_payload = json.dumps(
        _normalize_integrity_value(normalized_event),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest().lower()


def _acquire_append_lock(
    lock_path: Path,
    *,
    timeout_seconds: float = 10.0,
    stale_seconds: float = 120.0,
    poll_seconds: float = 0.05,
) -> None:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + max(timeout_seconds, 0.1)

    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {
                            "pid": os.getpid(),
                            "acquired_utc": datetime.now(timezone.utc).isoformat(),
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
            return
        except FileExistsError:
            try:
                if lock_path.exists():
                    age_seconds = time.time() - lock_path.stat().st_mtime
                    if age_seconds >= stale_seconds:
                        lock_path.unlink(missing_ok=True)
                        continue
            except FileNotFoundError:
                continue
            except Exception:
                pass

            if time.time() >= deadline:
                raise RuntimeError(f"Timed out acquiring append lock: {to_posix(lock_path)}")
            time.sleep(poll_seconds)


def _release_append_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink(missing_ok=True)
    except Exception:
        pass


def _read_task_event_append_state(task_file_path: Path, task_id: str) -> dict:
    state = {
        "matching_events": 0,
        "parse_errors": 0,
        "last_integrity_sequence": None,
        "last_event_sha256": None,
    }

    if not task_file_path.exists() or not task_file_path.is_file():
        return state

    for raw_line in task_file_path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue

        try:
            event = json.loads(raw_line)
        except Exception:
            state["parse_errors"] += 1
            continue

        event_task_id = str(event.get("task_id", "")).strip()
        if event_task_id and event_task_id != task_id:
            continue

        state["matching_events"] += 1
        integrity = event.get("integrity")
        if not isinstance(integrity, dict):
            continue

        sequence = integrity.get("task_sequence")
        event_sha256 = str(integrity.get("event_sha256", "")).strip().lower()
        if isinstance(sequence, int) and sequence > 0 and event_sha256:
            state["last_integrity_sequence"] = sequence
            state["last_event_sha256"] = event_sha256

    return state


def inspect_task_event_file(task_event_file: Path, task_id: str) -> dict:
    result = {
        "source_path": to_posix(task_event_file),
        "status": "UNKNOWN",
        "events_scanned": 0,
        "matching_events": 0,
        "parse_errors": 0,
        "task_id_mismatches": 0,
        "legacy_event_count": 0,
        "integrity_event_count": 0,
        "first_integrity_sequence": None,
        "last_integrity_sequence": None,
        "duplicate_event_hashes": [],
        "violations": [],
    }

    if not task_event_file.exists() or not task_event_file.is_file():
        result["status"] = "MISSING"
        result["violations"].append(f"Task events file not found: {to_posix(task_event_file)}")
        return result

    last_event_hash = None
    expected_sequence = None
    integrity_started = False
    seen_hashes = set()

    for line_number, raw_line in enumerate(task_event_file.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue

        result["events_scanned"] += 1
        try:
            event = json.loads(raw_line)
        except Exception:
            result["parse_errors"] += 1
            result["violations"].append(f"Task timeline contains invalid JSON at line {line_number}.")
            continue

        event_task_id = str(event.get("task_id", "")).strip()
        if event_task_id and event_task_id != task_id:
            result["task_id_mismatches"] += 1
            result["violations"].append(
                f"Task timeline contains foreign task_id '{event_task_id}' at line {line_number}."
            )
            continue

        result["matching_events"] += 1
        integrity = event.get("integrity")
        if not isinstance(integrity, dict):
            if integrity_started:
                result["violations"].append(
                    f"Task timeline contains legacy/unverified event after integrity chain start at line {line_number}."
                )
            else:
                result["legacy_event_count"] += 1
            continue

        schema_version = integrity.get("schema_version")
        task_sequence = integrity.get("task_sequence")
        prev_event_sha256 = integrity.get("prev_event_sha256")
        event_sha256 = str(integrity.get("event_sha256", "")).strip().lower()

        if schema_version != 1:
            result["violations"].append(
                f"Task timeline integrity schema mismatch at line {line_number}: expected 1, got '{schema_version}'."
            )
            continue
        if not isinstance(task_sequence, int) or task_sequence <= 0:
            result["violations"].append(f"Task timeline has invalid task_sequence at line {line_number}.")
            continue
        if prev_event_sha256 is not None and not str(prev_event_sha256).strip():
            prev_event_sha256 = None
        if not event_sha256:
            result["violations"].append(f"Task timeline missing event_sha256 at line {line_number}.")
            continue

        if not integrity_started:
            integrity_started = True
            expected_sequence = result["legacy_event_count"] + 1
            if prev_event_sha256 is not None:
                result["violations"].append(
                    f"Task timeline first integrity event must have null prev_event_sha256 (line {line_number})."
                )

        if task_sequence != expected_sequence:
            result["violations"].append(
                f"Task timeline sequence mismatch at line {line_number}: expected {expected_sequence}, got {task_sequence}."
            )

        expected_prev_hash = last_event_hash
        normalized_prev_hash = str(prev_event_sha256).strip().lower() if prev_event_sha256 is not None else None
        if normalized_prev_hash != expected_prev_hash:
            result["violations"].append(
                f"Task timeline prev_event_sha256 mismatch at line {line_number}."
            )

        recalculated_hash = build_event_integrity_hash(event)
        if recalculated_hash != event_sha256:
            result["violations"].append(
                f"Task timeline event_sha256 mismatch at line {line_number}."
            )

        if event_sha256 in seen_hashes:
            result["duplicate_event_hashes"].append(event_sha256)
            result["violations"].append(
                f"Task timeline duplicate/replayed event detected at line {line_number}."
            )
        seen_hashes.add(event_sha256)

        result["integrity_event_count"] += 1
        if result["first_integrity_sequence"] is None:
            result["first_integrity_sequence"] = task_sequence
        result["last_integrity_sequence"] = task_sequence
        last_event_hash = event_sha256
        expected_sequence = task_sequence + 1

    if result["violations"]:
        result["status"] = "FAILED"
    elif result["matching_events"] == 0:
        result["status"] = "EMPTY"
    elif result["integrity_event_count"] == 0:
        result["status"] = "LEGACY_ONLY"
    elif result["legacy_event_count"] > 0:
        result["status"] = "PASS_WITH_LEGACY_PREFIX"
    else:
        result["status"] = "PASS"

    return result


def resolve_project_root(script_dir: Path) -> Path:
    current_path = script_dir.resolve()

    while True:
        if is_workspace_root(current_path):
            return current_path

        parent_path = current_path.parent
        if parent_path == current_path:
            break
        current_path = parent_path

    project_root_candidate = (script_dir / "../../../../").resolve()
    fallback_root = (script_dir / "../../").resolve()
    return project_root_candidate if project_root_candidate.exists() else fallback_root


def is_orchestrator_root(candidate: Path) -> bool:
    if not candidate.exists() or not candidate.is_dir():
        return False
    return (candidate / "live/scripts/agent-gates").is_dir() and (candidate / "live/config").is_dir()


def is_workspace_root(candidate: Path) -> bool:
    if not candidate.exists() or not candidate.is_dir():
        return False

    if is_orchestrator_root(candidate) and (candidate / "template").is_dir() and (candidate / "scripts").is_dir():
        return True

    return is_orchestrator_root(candidate / "Octopus-agent-orchestrator")


def resolve_orchestrator_root(repo_root: Path) -> Path:
    workspace_root = repo_root.resolve()
    deployed_root = (workspace_root / "Octopus-agent-orchestrator").resolve()
    if is_orchestrator_root(deployed_root):
        return deployed_root
    if is_orchestrator_root(workspace_root):
        return workspace_root
    return deployed_root if deployed_root.exists() else workspace_root


def orchestrator_relative_path(repo_root: Path, path_value: str = "") -> Optional[str]:
    normalized = normalize_path(path_value, trim=True, strip_dot_slash=True, strip_leading_slash=True)
    prefix = "Octopus-agent-orchestrator/"
    if normalized and normalized.lower().startswith(prefix.lower()):
        normalized = normalized[len(prefix) :]

    workspace_root = repo_root.resolve()
    orchestrator_root = resolve_orchestrator_root(workspace_root)
    if orchestrator_root == workspace_root:
        return normalized
    if not normalized:
        return "Octopus-agent-orchestrator"
    return f"Octopus-agent-orchestrator/{normalized}"


def join_orchestrator_path(repo_root: Path, relative_path: str = "") -> Path:
    workspace_root = repo_root.resolve()
    orchestrator_root = resolve_orchestrator_root(workspace_root)
    normalized = normalize_path(relative_path, trim=True, strip_dot_slash=True, strip_leading_slash=True)
    prefix = "Octopus-agent-orchestrator/"
    if normalized and normalized.lower().startswith(prefix.lower()):
        normalized = normalized[len(prefix) :]

    candidate = orchestrator_root if not normalized else (orchestrator_root / normalized).resolve()
    try:
        candidate.relative_to(workspace_root)
    except ValueError as exc:
        raise RuntimeError(
            f"Path '{relative_path}' must resolve inside repository root '{workspace_root}'."
        ) from exc
    return candidate


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

    repo_root_resolved = repo_root.resolve()
    orchestrator_root = resolve_orchestrator_root(repo_root_resolved)
    candidate_paths = []

    candidate = Path(path_value.strip())
    if candidate.is_absolute():
        candidate_paths.append(candidate.resolve())
    else:
        normalized = normalize_path(path_value, trim=True, strip_dot_slash=True, strip_leading_slash=True) or ""
        candidate_paths.append((repo_root_resolved / normalized).resolve())

        prefix = "Octopus-agent-orchestrator/"
        if normalized.lower().startswith(prefix.lower()):
            trimmed = normalized[len(prefix) :]
            orchestrator_candidate = join_orchestrator_path(repo_root_resolved, trimmed)
            if orchestrator_candidate not in candidate_paths:
                candidate_paths.append(orchestrator_candidate)
        elif orchestrator_root != repo_root_resolved:
            orchestrator_candidate = join_orchestrator_path(repo_root_resolved, normalized)
            if orchestrator_candidate not in candidate_paths:
                candidate_paths.append(orchestrator_candidate)

    candidate = next((path for path in candidate_paths if path.exists()), candidate_paths[0])

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


def get_compact_review_budget(fail_tail_lines: Any = None) -> dict:
    resolved_fail_tail_lines = 50
    if isinstance(fail_tail_lines, bool):
        resolved_fail_tail_lines = 50
    elif isinstance(fail_tail_lines, int):
        resolved_fail_tail_lines = fail_tail_lines
    elif fail_tail_lines is not None:
        try:
            resolved_fail_tail_lines = int(str(fail_tail_lines).strip())
        except Exception:
            resolved_fail_tail_lines = 50

    resolved_fail_tail_lines = max(resolved_fail_tail_lines, 1)
    max_lines = max(120, resolved_fail_tail_lines + 70)
    max_chars = max(12000, max_lines * 100)
    max_code_fence_lines = 4
    max_example_markers = 0
    return {
        "fail_tail_lines": resolved_fail_tail_lines,
        "max_lines": max_lines,
        "max_chars": max_chars,
        "max_code_fence_lines": max_code_fence_lines,
        "max_example_markers": max_example_markers,
    }


def compact_markdown_content(content: Any, *, strip_examples: bool = False, strip_code_blocks: bool = False) -> dict:
    source_text = "" if content is None else str(content)
    source_text = source_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = source_text.split("\n")
    output_lines: List[str] = []
    example_heading_level: Optional[int] = None
    inside_removed_code_block = False
    pending_example_label = False
    removed_code_blocks = 0
    removed_example_sections = 0
    removed_example_labels = 0
    removed_example_content_lines = 0
    inserted_example_placeholder = False
    inserted_code_block_placeholder = False

    def ensure_blank_line() -> None:
        if output_lines and output_lines[-1] != "":
            output_lines.append("")

    def add_example_placeholder() -> None:
        nonlocal inserted_example_placeholder
        if inserted_example_placeholder:
            return
        ensure_blank_line()
        output_lines.append("> Example content omitted due to token economy.")
        inserted_example_placeholder = True

    def add_code_block_placeholder() -> None:
        nonlocal inserted_code_block_placeholder
        if inserted_code_block_placeholder:
            return
        ensure_blank_line()
        output_lines.append("> Code block omitted due to token economy.")
        inserted_code_block_placeholder = True

    example_heading_pattern = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
    example_label_pattern = re.compile(r"^\s*(?:bad|good)?\s*examples?\s*:\s*$", re.IGNORECASE)
    code_fence_pattern = re.compile(r"^\s*```")

    index = 0
    while index < len(lines):
        line = lines[index]
        heading_match = example_heading_pattern.match(line)

        if example_heading_level is not None:
            if heading_match and len(heading_match.group(1)) <= example_heading_level:
                example_heading_level = None
                inserted_example_placeholder = False
                continue
            removed_example_content_lines += 1
            index += 1
            continue

        if inside_removed_code_block:
            if code_fence_pattern.match(line):
                inside_removed_code_block = False
                inserted_code_block_placeholder = False
            index += 1
            continue

        if strip_examples and heading_match and "example" in heading_match.group(2).lower():
            ensure_blank_line()
            output_lines.append(line)
            output_lines.append("> Example section omitted due to token economy.")
            removed_example_sections += 1
            example_heading_level = len(heading_match.group(1))
            inserted_example_placeholder = True
            index += 1
            continue

        if strip_examples and example_label_pattern.match(line):
            add_example_placeholder()
            removed_example_labels += 1
            pending_example_label = True
            index += 1
            continue

        if pending_example_label:
            if code_fence_pattern.match(line):
                add_code_block_placeholder()
                removed_code_blocks += 1
                inside_removed_code_block = True
                pending_example_label = False
                index += 1
                continue
            if not line.strip():
                index += 1
                continue
            if heading_match:
                pending_example_label = False
                continue
            removed_example_content_lines += 1
            index += 1
            continue

        if strip_code_blocks and code_fence_pattern.match(line):
            add_code_block_placeholder()
            removed_code_blocks += 1
            inside_removed_code_block = True
            index += 1
            continue

        output_lines.append(line)
        index += 1

    sanitized_text = "\n".join(output_lines).strip("\n")
    if source_text.endswith("\n"):
        sanitized_text += "\n"

    return {
        "content": sanitized_text,
        "original_line_count": len(lines),
        "output_line_count": len(sanitized_text.splitlines()) if sanitized_text else 0,
        "original_char_count": len(source_text),
        "output_char_count": len(sanitized_text),
        "removed_code_blocks": removed_code_blocks,
        "removed_example_sections": removed_example_sections,
        "removed_example_labels": removed_example_labels,
        "removed_example_content_lines": removed_example_content_lines,
    }


def build_rule_context_artifact(
    repo_root: Path,
    *,
    selected_rule_paths: List[str],
    artifact_path: Path,
    strip_examples: bool = False,
    strip_code_blocks: bool = False,
) -> dict:
    file_entries = []
    output_sections = [
        "# Reviewer Rule Context",
        "",
        f"- strip_examples: {str(bool(strip_examples)).lower()}",
        f"- strip_code_blocks: {str(bool(strip_code_blocks)).lower()}",
        "",
    ]
    original_line_total = 0
    output_line_total = 0
    original_char_total = 0
    output_char_total = 0

    for selected_rule_path in selected_rule_paths:
        resolved_rule_path = resolve_path_inside_repo(selected_rule_path, repo_root)
        raw_content = resolved_rule_path.read_text(encoding="utf-8")
        compacted = compact_markdown_content(
            raw_content,
            strip_examples=strip_examples,
            strip_code_blocks=strip_code_blocks,
        )
        artifact_content = compacted["content"] or "_No remaining content after token-economy compaction._\n"
        if not artifact_content.endswith("\n"):
            artifact_content += "\n"

        output_sections.extend(
            [
                f"## Source: {selected_rule_path}",
                "",
                artifact_content.rstrip("\n"),
                "",
                "---",
                "",
            ]
        )

        original_line_total += compacted["original_line_count"]
        output_line_total += compacted["output_line_count"]
        original_char_total += compacted["original_char_count"]
        output_char_total += compacted["output_char_count"]

        file_entries.append(
            {
                "path": selected_rule_path,
                "artifact_source_path": normalize_path(resolved_rule_path),
                "original_line_count": compacted["original_line_count"],
                "output_line_count": compacted["output_line_count"],
                "original_char_count": compacted["original_char_count"],
                "output_char_count": compacted["output_char_count"],
                "removed_code_blocks": compacted["removed_code_blocks"],
                "removed_example_sections": compacted["removed_example_sections"],
                "removed_example_labels": compacted["removed_example_labels"],
                "removed_example_content_lines": compacted["removed_example_content_lines"],
                "content_sha256": string_sha256(compacted["content"] or ""),
            }
        )

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_text = "\n".join(output_sections).rstrip() + "\n"
    artifact_path.write_text(artifact_text, encoding="utf-8")

    return {
        "artifact_path": normalize_path(artifact_path),
        "artifact_sha256": file_sha256(artifact_path),
        "source_file_count": len(file_entries),
        "source_files": file_entries,
        "summary": {
            "original_line_count": original_line_total,
            "output_line_count": output_line_total,
            "original_char_count": original_char_total,
            "output_char_count": output_char_total,
            "estimated_saved_chars": max(original_char_total - output_char_total, 0),
            "estimated_saved_tokens": max((original_char_total - output_char_total) // 4, 0),
        },
    }


def audit_review_artifact_compaction(
    *,
    artifact_path: Path,
    content: str,
    review_context: Optional[dict],
) -> dict:
    review_context = review_context if isinstance(review_context, dict) else {}
    token_economy = review_context.get("token_economy") or {}
    flags = token_economy.get("flags") or {}
    token_economy_active = bool(review_context.get("token_economy_active")) or bool(token_economy.get("active"))
    compact_expected = token_economy_active and bool(flags.get("compact_reviewer_output"))
    budget = get_compact_review_budget(flags.get("fail_tail_lines"))

    lines = content.splitlines()
    code_fence_lines = sum(1 for line in lines if re.match(r"^\s*```", line))
    example_marker_lines = sum(
        1
        for line in lines
        if re.match(r"^\s*(?:#{1,6}\s+.*example.*|(?:bad|good)?\s*examples?\s*:)\s*$", line, re.IGNORECASE)
    )

    warnings = []
    if compact_expected:
        if len(lines) > budget["max_lines"]:
            warnings.append(
                f"Review artifact '{normalize_path(artifact_path)}' exceeds compact line budget ({len(lines)} > {budget['max_lines']})."
            )
        if len(content) > budget["max_chars"]:
            warnings.append(
                f"Review artifact '{normalize_path(artifact_path)}' exceeds compact char budget ({len(content)} > {budget['max_chars']})."
            )
        if code_fence_lines > budget["max_code_fence_lines"]:
            warnings.append(
                f"Review artifact '{normalize_path(artifact_path)}' exceeds code-fence budget ({code_fence_lines} > {budget['max_code_fence_lines']})."
            )
        if bool(flags.get("strip_examples")) and example_marker_lines > budget["max_example_markers"]:
            warnings.append(
                f"Review artifact '{normalize_path(artifact_path)}' still contains example markers while strip_examples=true."
            )

    return {
        "expected": compact_expected,
        "token_economy_active": token_economy_active,
        "review_context_path": normalize_path(review_context.get("output_path")) if isinstance(review_context, dict) else None,
        "line_count": len(lines),
        "char_count": len(content),
        "code_fence_line_count": code_fence_lines,
        "example_marker_count": example_marker_lines,
        "budget": budget,
        "warnings": warnings,
        "warning_count": len(warnings),
    }


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
    details: Any,
    *,
    actor: str = "gate",
    pass_thru: bool = False,
) -> Optional[dict]:
    if not task_id:
        return None

    safe_task_id = assert_valid_task_id(task_id)
    events_dir = join_orchestrator_path(repo_root, "runtime/task-events")
    task_file_path = (events_dir / f"{safe_task_id}.jsonl").resolve()
    all_tasks_path = (events_dir / "all-tasks.jsonl").resolve()
    task_lock_path = (events_dir / f"{safe_task_id}.jsonl.lock").resolve()
    all_tasks_lock_path = (events_dir / "all-tasks.jsonl.lock").resolve()

    event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "task_id": safe_task_id,
        "event_type": event_type,
        "outcome": outcome,
        "actor": actor,
        "message": message,
        "details": details,
    }

    result = {
        "task_event_log_path": to_posix(task_file_path),
        "all_tasks_log_path": to_posix(all_tasks_path),
        "integrity": None,
        "warnings": [],
    }

    line = None
    try:
        events_dir.mkdir(parents=True, exist_ok=True)
        _acquire_append_lock(task_lock_path)
        try:
            append_state = _read_task_event_append_state(task_file_path, safe_task_id)
            previous_sequence = append_state["last_integrity_sequence"]
            previous_hash = append_state["last_event_sha256"]
            next_sequence = (previous_sequence + 1) if isinstance(previous_sequence, int) else (append_state["matching_events"] + 1)

            event["integrity"] = {
                "schema_version": 1,
                "task_sequence": next_sequence,
                "prev_event_sha256": previous_hash,
            }
            event["integrity"]["event_sha256"] = build_event_integrity_hash(event)
            line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))

            with task_file_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

            result["integrity"] = dict(event["integrity"])
        finally:
            _release_append_lock(task_lock_path)
    except Exception as exc:
        warning = f"task-event append failed: {exc}"
        result["warnings"].append(warning)
        print(f"WARNING: {warning}", file=sys.stderr)
        return result if pass_thru else None

    try:
        _acquire_append_lock(all_tasks_lock_path)
        try:
            with all_tasks_path.open("a", encoding="utf-8") as fh:
                fh.write((line or "") + "\n")
        finally:
            _release_append_lock(all_tasks_lock_path)
    except Exception as exc:
        warning = f"task-event aggregate append failed: {exc}"
        result["warnings"].append(warning)
        print(f"WARNING: {warning}", file=sys.stderr)

    return result if pass_thru else None
