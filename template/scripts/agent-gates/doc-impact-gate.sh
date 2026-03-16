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

from gate_utils import (  # noqa: E402
    append_metrics_event,
    append_task_event,
    assert_valid_task_id,
    file_sha256,
    normalize_path,
    parse_bool,
    resolve_project_root,
    to_string_array,
)


def validate_preflight(preflight_path: Path, explicit_task_id: str):
    try:
        preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
    except Exception:
        raise RuntimeError(f"Preflight artifact is not valid JSON: {preflight_path}")

    errors = []
    resolved_task_id = None
    if explicit_task_id and explicit_task_id.strip():
        try:
            resolved_task_id = assert_valid_task_id(explicit_task_id)
        except Exception as exc:
            errors.append(str(exc))

    preflight_task_id = str(preflight.get("task_id", "")).strip()
    if preflight_task_id:
        try:
            preflight_task_id = assert_valid_task_id(preflight_task_id)
        except Exception as exc:
            errors.append(f"preflight.task_id: {exc}")
            preflight_task_id = None
    else:
        preflight_task_id = None

    if resolved_task_id and preflight_task_id and resolved_task_id != preflight_task_id:
        errors.append(f"TaskId '{resolved_task_id}' does not match preflight.task_id '{preflight_task_id}'.")
    if (not resolved_task_id) and preflight_task_id:
        resolved_task_id = preflight_task_id
    if not resolved_task_id:
        errors.append("TaskId is required and must be provided either via --task-id or preflight.task_id.")

    return {
        "preflight": preflight,
        "resolved_task_id": resolved_task_id,
        "preflight_path": preflight_path.resolve(),
        "preflight_hash": file_sha256(preflight_path.resolve()),
        "errors": errors,
    }


parser = argparse.ArgumentParser()
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--task-id", default="")
parser.add_argument("--decision", default="NO_DOC_UPDATES", choices=["NO_DOC_UPDATES", "DOCS_UPDATED"])
parser.add_argument("--behavior-changed", default="false")
parser.add_argument("--docs-updated", action="append", default=[])
parser.add_argument("--changelog-updated", default="false")
parser.add_argument("--sensitive-scope-reviewed", default="false")
parser.add_argument("--rationale", default="")
parser.add_argument("--artifact-path", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

repo_root = resolve_project_root(script_dir)
preflight_path = Path(args.preflight_path)
if not preflight_path.is_absolute():
    preflight_path = preflight_path.resolve()
if not preflight_path.exists():
    print(f"Preflight artifact not found: {preflight_path}", file=sys.stderr)
    sys.exit(1)

validated_preflight = validate_preflight(preflight_path, args.task_id)
resolved_task_id = validated_preflight["resolved_task_id"]
decision = str(args.decision).strip().upper()
behavior_changed = parse_bool(args.behavior_changed)
changelog_updated = parse_bool(args.changelog_updated)
sensitive_scope_reviewed = parse_bool(args.sensitive_scope_reviewed)
docs_updated = sorted({item for item in to_string_array(args.docs_updated, trim_values=True) if item})
rationale = (args.rationale or "").strip()

sensitive_triggers_fired = []
preflight_obj = validated_preflight.get("preflight", {}) or {}
triggers_obj = preflight_obj.get("triggers") or {}
for trigger_name in ("api", "security", "infra", "dependency", "db"):
    if triggers_obj.get(trigger_name):
        sensitive_triggers_fired.append(trigger_name)

if args.artifact_path.strip():
    artifact_path = Path(args.artifact_path.strip())
    if not artifact_path.is_absolute():
        artifact_path = (repo_root / artifact_path).resolve()
else:
    artifact_path = (repo_root / f"Octopus-agent-orchestrator/runtime/reviews/{resolved_task_id}-doc-impact.json").resolve()

metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path = (repo_root / "Octopus-agent-orchestrator/runtime/metrics.jsonl").resolve()
else:
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = (repo_root / metrics_path).resolve()
emit_metrics = parse_bool(args.emit_metrics)

errors = list(validated_preflight["errors"])
if not rationale or len(rationale) < 12:
    errors.append("Rationale is required (>= 12 chars).")
if decision == "DOCS_UPDATED" and not docs_updated:
    errors.append("Decision DOCS_UPDATED requires non-empty docs_updated list.")
if behavior_changed and decision != "DOCS_UPDATED":
    errors.append("BehaviorChanged=true requires Decision=DOCS_UPDATED.")
if behavior_changed and not changelog_updated:
    errors.append("BehaviorChanged=true requires ChangelogUpdated=true.")
if sensitive_triggers_fired and decision == "NO_DOC_UPDATES" and not sensitive_scope_reviewed:
    triggers_str = ", ".join(sensitive_triggers_fired)
    errors.append(
        f"Sensitive scope triggers detected ({triggers_str}): NO_DOC_UPDATES requires "
        f"--sensitive-scope-reviewed true with rationale explaining why no documentation updates are needed."
    )

status = "FAILED" if errors else "PASSED"
outcome = "FAIL" if errors else "PASS"

artifact = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_source": "doc-impact-gate",
    "task_id": resolved_task_id,
    "status": status,
    "outcome": outcome,
    "preflight_path": normalize_path(validated_preflight["preflight_path"]),
    "preflight_hash_sha256": validated_preflight["preflight_hash"],
    "decision": decision,
    "behavior_changed": behavior_changed,
    "changelog_updated": changelog_updated,
    "sensitive_triggers_detected": sensitive_triggers_fired,
    "sensitive_scope_reviewed": sensitive_scope_reviewed,
    "docs_updated": docs_updated,
    "rationale": rationale,
    "violations": errors,
}

artifact_path.parent.mkdir(parents=True, exist_ok=True)
artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "doc_impact_gate_check",
    "status": status,
    "task_id": resolved_task_id,
    "artifact_path": normalize_path(artifact_path),
    "artifact": artifact,
}
append_metrics_event(metrics_path, event, emit_metrics)

task_event_type = "DOC_IMPACT_ASSESSMENT_FAILED" if errors else "DOC_IMPACT_ASSESSED"
task_message = "Doc impact gate failed." if errors else "Doc impact gate passed."
append_task_event(
    repo_root=repo_root,
    task_id=resolved_task_id,
    event_type=task_event_type,
    outcome=outcome,
    message=task_message,
    details=artifact,
)

if errors:
    print("DOC_IMPACT_GATE_FAILED")
    print("Violations:")
    for err in errors:
        print(f"- {err}")
    sys.exit(1)

print("DOC_IMPACT_GATE_PASSED")
print(f"DocImpactArtifactPath: {normalize_path(artifact_path)}")
PY
