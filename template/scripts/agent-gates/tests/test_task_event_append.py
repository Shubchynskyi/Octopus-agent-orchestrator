from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from gate_utils import append_task_event  # noqa: E402


def test_append_task_event_preserves_integrity_chain(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()

    first = append_task_event(repo_root, "T-061", "TASK_START", "INFO", "start", {"step": 1}, actor="test", pass_thru=True)
    second = append_task_event(repo_root, "T-061", "TASK_PROGRESS", "INFO", "progress", {"step": 2}, actor="test", pass_thru=True)

    assert first is not None
    assert second is not None
    assert first["integrity"]["task_sequence"] == 1
    assert second["integrity"]["task_sequence"] == 2
    assert second["integrity"]["prev_event_sha256"] == first["integrity"]["event_sha256"]

    task_log_path = repo_root / "runtime" / "task-events" / "T-061.jsonl"
    rows = [json.loads(line) for line in task_log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [row["integrity"]["task_sequence"] for row in rows] == [1, 2]


def test_append_task_event_does_not_block_on_aggregate_lock(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    events_dir = repo_root / "runtime" / "task-events"
    events_dir.mkdir(parents=True)
    all_tasks_lock_path = events_dir / "all-tasks.jsonl.lock"
    all_tasks_lock_path.write_text('{"pid":999,"acquired_utc":"2026-01-01T00:00:00Z"}', encoding="utf-8")

    started = time.monotonic()
    result = append_task_event(repo_root, "T-062", "TASK_START", "INFO", "start", None, actor="test", pass_thru=True)
    elapsed = time.monotonic() - started

    assert result is not None
    assert elapsed < 4.0
    assert any("aggregate append failed" in warning for warning in result["warnings"])
    assert (events_dir / "T-062.jsonl").exists()
