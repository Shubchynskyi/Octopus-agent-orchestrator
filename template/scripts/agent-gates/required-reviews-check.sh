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
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_bool(value: str) -> bool:
    normalized = str(value).strip().lower()
    if normalized in ("1", "true", "yes", "y", "on"):
        return True
    if normalized in ("0", "false", "no", "n", "off"):
        return False
    raise ValueError(f"Unsupported boolean value: {value}")


def normalize_path(path_value: str):
    return str(path_value).replace("\\", "/")


def append_metrics_event(path: Path, event_obj: dict, emit_metrics: bool):
    if not emit_metrics:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event_obj, ensure_ascii=False, separators=(",", ":")) + "\n")


def parse_skip_reviews(value: str):
    if not value or not value.strip():
        return []
    parts = [item.strip().lower() for item in re.split(r"[,; ]+", value) if item and item.strip()]
    return sorted(set(parts))


def get_required_flag(required_reviews: dict, key: str) -> bool:
    if not isinstance(required_reviews, dict):
        return False
    return bool(required_reviews.get(key, False))


def test_expected_verdict(errors, label, required, skipped_by_override, actual_verdict, pass_verdict):
    if required and not skipped_by_override:
        if actual_verdict != pass_verdict:
            errors.append(f"{label} is required. Expected '{pass_verdict}', got '{actual_verdict}'.")
        return

    if skipped_by_override:
        allowed = {"NOT_REQUIRED", "SKIPPED_BY_OVERRIDE", pass_verdict}
        if actual_verdict not in allowed:
            allowed_text = "', '".join(sorted(allowed))
            errors.append(f"{label} override is active. Expected one of '{allowed_text}', got '{actual_verdict}'.")
        return

    if actual_verdict in ("NOT_REQUIRED", pass_verdict):
        return
    errors.append(f"{label} is not required. Expected 'NOT_REQUIRED' or '{pass_verdict}', got '{actual_verdict}'.")


parser = argparse.ArgumentParser()
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--code-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--db-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--security-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--refactor-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--api-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--test-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--performance-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--infra-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--dependency-review-verdict", default="NOT_REQUIRED")
parser.add_argument("--skip-reviews", default="")
parser.add_argument("--skip-reason", default="")
parser.add_argument("--override-artifact-path", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
project_root_candidate = (script_dir / "../../../../").resolve()
fallback_root = (script_dir / "../../").resolve()
repo_root = project_root_candidate if project_root_candidate.exists() else fallback_root

preflight_path = Path(args.preflight_path)
if not preflight_path.is_absolute():
    preflight_path = (repo_root / preflight_path).resolve()
if not preflight_path.exists():
    print(f"Preflight artifact not found: {preflight_path}", file=sys.stderr)
    sys.exit(1)

preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
required_reviews = preflight.get("required_reviews", {})
metrics = preflight.get("metrics", {})

metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path_raw = "Octopus-agent-orchestrator/runtime/metrics.jsonl"
metrics_path = Path(metrics_path_raw)
if not metrics_path.is_absolute():
    metrics_path = (repo_root / metrics_path).resolve()
emit_metrics = parse_bool(args.emit_metrics)

errors = []
skip_reviews_list = parse_skip_reviews(args.skip_reviews)
allowed_skips = {"code"}
for skip_item in skip_reviews_list:
    if skip_item not in allowed_skips:
        errors.append(f"Unsupported skip-review value '{skip_item}'. Allowed values: code.")

skip_reason = args.skip_reason or ""
if skip_reviews_list and not skip_reason.strip():
    errors.append("Skip-review override requires --skip-reason.")
if skip_reason.strip() and len(skip_reason.strip()) < 12:
    errors.append("Skip-review reason is too short. Provide a concrete justification (>= 12 chars).")

required_code = get_required_flag(required_reviews, "code")
required_db = get_required_flag(required_reviews, "db")
required_security = get_required_flag(required_reviews, "security")
required_refactor = get_required_flag(required_reviews, "refactor")
required_api = get_required_flag(required_reviews, "api")
required_test = get_required_flag(required_reviews, "test")
required_performance = get_required_flag(required_reviews, "performance")
required_infra = get_required_flag(required_reviews, "infra")
required_dependency = get_required_flag(required_reviews, "dependency")

changed_files_count = int(metrics.get("changed_files_count", 0))
changed_lines_total = int(metrics.get("changed_lines_total", 0))

can_skip_code = (
    required_code
    and (not required_db)
    and (not required_security)
    and (not required_refactor)
    and (not required_api)
    and (not required_test)
    and (not required_performance)
    and (not required_infra)
    and (not required_dependency)
    and changed_files_count <= 1
    and changed_lines_total <= 8
)

skip_code = "code" in skip_reviews_list
if skip_code and not can_skip_code:
    errors.append(
        "Code review override is not allowed for this change scope. "
        "Allowed only for tiny low-risk code changes (<=1 file and <=8 changed lines, with no specialized reviews)."
    )
if skip_code and not required_code:
    errors.append("Code review override was requested but code review is not required by preflight.")

test_expected_verdict(errors, "Code review", required_code, skip_code, args.code_review_verdict, "REVIEW PASSED")
test_expected_verdict(errors, "DB review", required_db, False, args.db_review_verdict, "DB REVIEW PASSED")
test_expected_verdict(errors, "Security review", required_security, False, args.security_review_verdict, "SECURITY REVIEW PASSED")
test_expected_verdict(errors, "Refactor review", required_refactor, False, args.refactor_review_verdict, "REFACTOR REVIEW PASSED")
test_expected_verdict(errors, "API review", required_api, False, args.api_review_verdict, "API REVIEW PASSED")
test_expected_verdict(errors, "Test review", required_test, False, args.test_review_verdict, "TEST REVIEW PASSED")
test_expected_verdict(errors, "Performance review", required_performance, False, args.performance_review_verdict, "PERFORMANCE REVIEW PASSED")
test_expected_verdict(errors, "Infra review", required_infra, False, args.infra_review_verdict, "INFRA REVIEW PASSED")
test_expected_verdict(errors, "Dependency review", required_dependency, False, args.dependency_review_verdict, "DEPENDENCY REVIEW PASSED")

if errors:
    failure_event = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event_type": "review_gate_check",
        "status": "FAILED",
        "preflight_path": normalize_path(preflight_path),
        "mode": preflight.get("mode"),
        "skip_reviews": skip_reviews_list,
        "skip_reason": skip_reason,
        "violations": errors,
    }
    append_metrics_event(metrics_path, failure_event, emit_metrics)

    print("REVIEW_GATE_FAILED")
    print(f"Mode: {preflight.get('mode')}")
    print("Violations:")
    for err in errors:
        print(f"- {err}")
    sys.exit(1)

override_artifact_path = args.override_artifact_path.strip()
if skip_code:
    if not override_artifact_path:
        preflight_dir = preflight_path.parent
        preflight_name = preflight_path.stem
        base_name = re.sub(r"-preflight$", "", preflight_name)
        override_artifact_path = str(preflight_dir / f"{base_name}-override.json")
    override_path = Path(override_artifact_path)
    if not override_path.is_absolute():
        override_path = (repo_root / override_path).resolve()
    override_path.parent.mkdir(parents=True, exist_ok=True)
    override_artifact = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "preflight_path": normalize_path(preflight_path),
        "mode": preflight.get("mode"),
        "skipped_reviews": ["code"],
        "reason": skip_reason.strip(),
        "guardrails": {
            "required_db": required_db,
            "required_security": required_security,
            "required_refactor": required_refactor,
            "required_api": required_api,
            "required_test": required_test,
            "required_performance": required_performance,
            "required_infra": required_infra,
            "required_dependency": required_dependency,
            "changed_files_count": changed_files_count,
            "changed_lines_total": changed_lines_total,
        },
    }
    override_path.write_text(json.dumps(override_artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    override_artifact_path = str(override_path)

success_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "review_gate_check",
    "status": "PASSED",
    "preflight_path": normalize_path(preflight_path),
    "mode": preflight.get("mode"),
    "skip_reviews": skip_reviews_list,
    "skip_reason": skip_reason,
    "override_artifact": normalize_path(override_artifact_path) if override_artifact_path else None,
}
append_metrics_event(metrics_path, success_event, emit_metrics)

if skip_code:
    print("REVIEW_GATE_PASSED_WITH_OVERRIDE")
    print(f"Mode: {preflight.get('mode')}")
    print("SkippedReviews: code")
    print(f"OverrideArtifact: {override_artifact_path}")
else:
    print("REVIEW_GATE_PASSED")
    print(f"Mode: {preflight.get('mode')}")
PY
