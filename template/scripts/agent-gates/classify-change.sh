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
from datetime import datetime, timezone
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import (
    append_metrics_event,
    append_task_event,
    assert_valid_task_id,
    match_any_regex as gate_match_any_regex,
    normalize_path as gate_normalize_path,
    parse_bool,
    resolve_project_root,
    to_posix,
)


def normalize_path(path_value: str):
    return gate_normalize_path(path_value, trim=True, strip_dot_slash=True, strip_leading_slash=True)


def test_path_prefix(path_value: str, prefixes):
    lower_path = path_value.lower()
    for prefix in prefixes:
        if lower_path.startswith(prefix.lower()):
            return True
    return False


def test_match_any_regex(path_value: str, regexes):
    return gate_match_any_regex(path_value, regexes)


def resolve_task_id(explicit_task_id: str, output_path_hint: str):
    if explicit_task_id and explicit_task_id.strip():
        return explicit_task_id.strip()
    if not output_path_hint or not output_path_hint.strip():
        return None
    base_name = Path(output_path_hint).stem
    candidate = re.sub(r"-preflight$", "", base_name)
    candidate = candidate.strip()
    return candidate or None


def run_git(repo_root: Path, args):
    completed = subprocess.run(
        ["git", "-C", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"git command failed: {' '.join(args)}")
    return [line for line in completed.stdout.splitlines() if line.strip()]


def count_file_lines(path: Path):
    if not path.exists() or not path.is_file():
        return 0
    try:
        count = 0
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.rstrip("\r\n") != "":
                    count += 1
        return count
    except OSError:
        return 0


def normalize_roots(prefixes):
    normalized = []
    for prefix in prefixes:
        value = normalize_path(prefix)
        if not value:
            continue
        if not value.endswith("/"):
            value += "/"
        normalized.append(value)
    return sorted(set(normalized))


def get_default_classification_config():
    return {
        "metrics_path": "Octopus-agent-orchestrator/runtime/metrics.jsonl",
        "runtime_roots": [
            "src/",
            "app/",
            "apps/",
            "backend/",
            "frontend/",
            "web/",
            "api/",
            "services/",
            "packages/",
        ],
        "fast_path_roots": [
            "frontend/",
            "web/",
            "ui/",
            "mobile/",
            "apps/",
        ],
        "fast_path_allowed_regexes": [
            r"^.+\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$",
            r"^.+\.(svg|png|jpg|jpeg|webp|ico)$",
        ],
        "fast_path_sensitive_regexes": [
            r"(^|/)(auth|security|payment|checkout|webhook|token|jwt|guard|middleware|service|repository|query|migration|sql|datasource)(/|\.|$)"
        ],
        "sql_or_migration_regexes": [
            r"\.sql$",
            r"(^|/)(db|database|migrations?|schema)(/|$)",
        ],
        "triggers": {
            "db": [
                r"(^|/)(db|database|migrations?|schema)(/|$)",
                r"\.sql$",
                r"(Repository|Dao|Specification|Query|Migration)[^/]*\.(java|kt|ts|js|py|go|cs|rb|php)$",
                r"(?i)(typeorm|prisma|flyway|liquibase|alembic|knex|sequelize)",
            ],
            "security": [
                r"(^|/)(auth|security|oauth|jwt|token|rbac|acl|keycloak|okta|saml|openid|mfa|crypt|encryption|certificate|secret|vault|webhook|payment|checkout|billing)(/|\.|$)"
            ],
            "api": [
                r"(^|/)(controllers?|routes?|handlers?|endpoints?|graphql)(/|\.|$)",
                r"(Request|Response|Dto|DTO|Contract|Schema)[^/]*\.(java|kt|ts|tsx|js|jsx|py|go|cs|rb|php)$",
                r"(^|/)(openapi|swagger)\.(ya?ml|json)$",
            ],
            "dependency": [
                r"(^|/)pom\.xml$",
                r"(^|/)build\.gradle(\.kts)?$",
                r"(^|/)settings\.gradle(\.kts)?$",
                r"(^|/)package\.json$",
                r"(^|/)package-lock\.json$",
                r"(^|/)pnpm-lock\.yaml$",
                r"(^|/)yarn\.lock$",
                r"(^|/)requirements(\.txt|-dev\.txt)?$",
                r"(^|/)poetry\.lock$",
                r"(^|/)pyproject\.toml$",
                r"(^|/)go\.mod$",
                r"(^|/)go\.sum$",
                r"(^|/)Cargo\.toml$",
                r"(^|/)Cargo\.lock$",
                r"(^|/)composer\.json$",
                r"(^|/)Gemfile(\.lock)?$",
            ],
            "infra": [
                r"(^|/)Dockerfile(\..+)?$",
                r"(^|/)docker-compose(\.[^/]+)?\.ya?ml$",
                r"(^|/)(terraform|infra|infrastructure|helm|k8s|kubernetes)(/|$)",
                r"(^|/)\.github/workflows/",
            ],
            "test": [
                r"/src/test/",
                r"(^|/)(__tests__|tests?)/",
                r"\.(spec|test)\.(ts|tsx|js|jsx|java|kt|go|py|rb|php)$",
            ],
            "performance": [
                r"(Cache|Redis|Elasticsearch|Search|Query|Benchmark|Profil(e|ing))[^/]*\.(java|kt|ts|js|py|go|cs|rb|php)$",
                r"(^|/)(performance|perf|benchmark)/",
            ],
        },
        "code_like_regexes": [
            r"\.(java|kt|kts|groovy|ts|tsx|js|jsx|cjs|mjs|cs|go|py|rb|php|rs)$"
        ],
    }


def get_classification_config(repo_root: Path):
    defaults = get_default_classification_config()
    config_path = repo_root / "Octopus-agent-orchestrator/live/config/paths.json"
    source = "defaults"
    if config_path.exists():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
            for key in (
                "metrics_path",
                "runtime_roots",
                "fast_path_roots",
                "fast_path_allowed_regexes",
                "fast_path_sensitive_regexes",
                "sql_or_migration_regexes",
                "code_like_regexes",
            ):
                if key in raw:
                    defaults[key] = raw[key]

            if "triggers" in raw and isinstance(raw["triggers"], dict):
                for trigger_key in (
                    "db",
                    "security",
                    "api",
                    "dependency",
                    "infra",
                    "test",
                    "performance",
                ):
                    if trigger_key in raw["triggers"]:
                        defaults["triggers"][trigger_key] = raw["triggers"][trigger_key]
            source = "paths_json"
        except Exception:
            source = "defaults_with_config_parse_error"

    return {
        "source": source,
        "config_path": to_posix(config_path.resolve()),
        "metrics_path": str(defaults["metrics_path"]),
        "runtime_roots": normalize_roots(defaults["runtime_roots"]),
        "fast_path_roots": normalize_roots(defaults["fast_path_roots"]),
        "fast_path_allowed_regexes": list(defaults["fast_path_allowed_regexes"]),
        "fast_path_sensitive_regexes": list(defaults["fast_path_sensitive_regexes"]),
        "sql_or_migration_regexes": list(defaults["sql_or_migration_regexes"]),
        "db_trigger_regexes": list(defaults["triggers"]["db"]),
        "security_trigger_regexes": list(defaults["triggers"]["security"]),
        "api_trigger_regexes": list(defaults["triggers"]["api"]),
        "dependency_trigger_regexes": list(defaults["triggers"]["dependency"]),
        "infra_trigger_regexes": list(defaults["triggers"]["infra"]),
        "test_trigger_regexes": list(defaults["triggers"]["test"]),
        "performance_trigger_regexes": list(defaults["triggers"]["performance"]),
        "code_like_regexes": list(defaults["code_like_regexes"]),
    }


def get_review_capabilities(repo_root: Path):
    capabilities = {
        "code": True,
        "db": True,
        "security": True,
        "refactor": True,
        "api": False,
        "test": False,
        "performance": False,
        "infra": False,
        "dependency": False,
    }
    config_path = repo_root / "Octopus-agent-orchestrator/live/config/review-capabilities.json"
    if not config_path.exists():
        return capabilities
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        for key in list(capabilities.keys()):
            if key in raw:
                capabilities[key] = bool(raw[key])
    except Exception:
        pass
    return capabilities


parser = argparse.ArgumentParser()
parser.add_argument("--repo-root", default="")
parser.add_argument("--changed-file", action="append", default=[])
parser.add_argument("--changed-files", default="")
parser.add_argument("--use-staged", action="store_true")
parser.add_argument("--include-untracked", default="true")
parser.add_argument("--task-id", default="")
parser.add_argument("--task-intent", default="")
parser.add_argument("--fast-path-max-files", type=int, default=2)
parser.add_argument("--fast-path-max-changed-lines", type=int, default=40)
parser.add_argument("--performance-heuristic-min-lines", type=int, default=120)
parser.add_argument("--output-path", default="")
parser.add_argument("--metrics-path", default="")
parser.add_argument("--emit-metrics", default="true")
args = parser.parse_args()

repo_root = Path(args.repo_root).resolve() if args.repo_root else resolve_project_root(script_dir)

classification_config = get_classification_config(repo_root)
metrics_path_raw = args.metrics_path.strip() if args.metrics_path else ""
if not metrics_path_raw:
    metrics_path_raw = classification_config["metrics_path"]
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = (repo_root / metrics_path_raw).resolve()
else:
    metrics_path = Path(metrics_path_raw)
    if not metrics_path.is_absolute():
        metrics_path = metrics_path.resolve()

include_untracked = parse_bool(args.include_untracked)
emit_metrics = parse_bool(args.emit_metrics)

runtime_roots = classification_config["runtime_roots"]
fast_path_roots = classification_config["fast_path_roots"]
fast_path_allowed_regexes = classification_config["fast_path_allowed_regexes"]
fast_path_sensitive_regexes = classification_config["fast_path_sensitive_regexes"]
sql_or_migration_regexes = classification_config["sql_or_migration_regexes"]
db_trigger_regexes = classification_config["db_trigger_regexes"]
security_trigger_regexes = classification_config["security_trigger_regexes"]
api_trigger_regexes = classification_config["api_trigger_regexes"]
dependency_trigger_regexes = classification_config["dependency_trigger_regexes"]
infra_trigger_regexes = classification_config["infra_trigger_regexes"]
test_trigger_regexes = classification_config["test_trigger_regexes"]
performance_trigger_regexes = classification_config["performance_trigger_regexes"]
code_like_regexes = classification_config["code_like_regexes"]

explicit_changed = []
for raw_item in list(args.changed_file):
    for item in re.split(r"[,\n;]+", str(raw_item)):
        if item.strip():
            explicit_changed.append(item.strip())
if args.changed_files:
    for item in re.split(r"[,\n;]+", args.changed_files):
        if item.strip():
            explicit_changed.append(item.strip())
is_explicit_changed_files = len(explicit_changed) > 0
if is_explicit_changed_files and args.use_staged:
    print("Use either --changed-file/--changed-files or --use-staged, but not both.", file=sys.stderr)
    sys.exit(1)

try:
    git_available = subprocess.run(["git", "--version"], capture_output=True, text=True, check=False).returncode == 0
except FileNotFoundError:
    git_available = False
if (not git_available) and (not is_explicit_changed_files):
    print("Git is not available and no changed files were provided.", file=sys.stderr)
    sys.exit(1)

git_worktree_ready = False
if git_available:
    try:
        subprocess.run(["git", "-C", str(repo_root), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True, check=True)
        git_worktree_ready = True
    except Exception:
        git_worktree_ready = False
if (not is_explicit_changed_files) and (not git_worktree_ready):
    print(
        f"Git diff operations failed for repo root '{repo_root}'. Provide --changed-file/--changed-files or run inside a valid git worktree.",
        file=sys.stderr,
    )
    sys.exit(1)

detection_source = "explicit_changed_files"
detected_from_git = []
untracked_from_git = []
if not is_explicit_changed_files:
    if not git_worktree_ready:
        print(
            f"Git diff operations failed for repo root '{repo_root}'. Provide --changed-file/--changed-files or run inside a valid git worktree.",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        if args.use_staged:
            detection_source = "git_staged_plus_untracked" if include_untracked else "git_staged_only"
            detected_from_git = run_git(repo_root, ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"])
        else:
            detection_source = "git_auto"
            detected_from_git = run_git(repo_root, ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"])

        if include_untracked:
            untracked_from_git = run_git(repo_root, ["ls-files", "--others", "--exclude-standard"])

        changed_files = sorted(set(detected_from_git + untracked_from_git))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
else:
    changed_files = explicit_changed

normalized_files = sorted(
    {
        normalized
        for normalized in (normalize_path(item) for item in changed_files)
        if normalized
    }
)

changed_lines_total = 0
additions_total = 0
deletions_total = 0
rename_count = 0

if git_worktree_ready:
    numstat_args = ["diff", "--numstat", "--diff-filter=ACMRTUXB"]
    if (not is_explicit_changed_files) and args.use_staged:
        numstat_args.append("--cached")
    else:
        numstat_args.append("HEAD")

    numstat_rows = {}
    for line in run_git(repo_root, numstat_args):
        parts = line.split("\t")
        if len(parts) >= 3:
            key = normalize_path(parts[2])
            if key:
                numstat_rows[key] = {"additions": parts[0], "deletions": parts[1]}

    name_status_args = ["diff", "--name-status", "--diff-filter=ACMRTUXB"]
    if (not is_explicit_changed_files) and args.use_staged:
        name_status_args.append("--cached")
    else:
        name_status_args.append("HEAD")
    for line in run_git(repo_root, name_status_args):
        parts = line.split("\t")
        if parts and re.match(r"^R\d*$", parts[0]):
            rename_count += 1

    if is_explicit_changed_files:
        for file_path in normalized_files:
            if file_path in numstat_rows:
                row = numstat_rows[file_path]
                if row["additions"].isdigit():
                    additions_total += int(row["additions"])
                    changed_lines_total += int(row["additions"])
                if row["deletions"].isdigit():
                    deletions_total += int(row["deletions"])
                    changed_lines_total += int(row["deletions"])
                continue
            changed_lines = count_file_lines(repo_root / file_path)
            additions_total += changed_lines
            changed_lines_total += changed_lines
    else:
        for row in numstat_rows.values():
            if row["additions"].isdigit():
                additions_total += int(row["additions"])
                changed_lines_total += int(row["additions"])
            if row["deletions"].isdigit():
                deletions_total += int(row["deletions"])
                changed_lines_total += int(row["deletions"])
        for file_path in untracked_from_git:
            normalized = normalize_path(file_path)
            if normalized:
                changed_lines = count_file_lines(repo_root / normalized)
                additions_total += changed_lines
                changed_lines_total += changed_lines
elif is_explicit_changed_files:
    for file_path in normalized_files:
        changed_lines = count_file_lines(repo_root / file_path)
        additions_total += changed_lines
        changed_lines_total += changed_lines

runtime_changed = any(test_path_prefix(path, runtime_roots) for path in normalized_files)
db_triggered = any(test_match_any_regex(path, db_trigger_regexes) for path in normalized_files)
security_triggered = any(test_match_any_regex(path, security_trigger_regexes) for path in normalized_files)
api_triggered = any(test_match_any_regex(path, api_trigger_regexes) for path in normalized_files)
dependency_triggered = any(test_match_any_regex(path, dependency_trigger_regexes) for path in normalized_files)
infra_triggered = any(test_match_any_regex(path, infra_trigger_regexes) for path in normalized_files)
test_triggered = any(test_match_any_regex(path, test_trigger_regexes) for path in normalized_files)
performance_path_triggered = any(test_match_any_regex(path, performance_trigger_regexes) for path in normalized_files)
sql_or_migration_changed_count = sum(1 for path in normalized_files if test_match_any_regex(path, sql_or_migration_regexes))
only_sql_or_migration_changes = bool(normalized_files) and sql_or_migration_changed_count == len(normalized_files)

review_capabilities = get_review_capabilities(repo_root)

refactor_intent_triggered = bool(re.search(r"(?i)\b(refactor|cleanup|restructure|extract|rename|modularization|simplify)\b", args.task_intent))
code_like_changed_count = sum(1 for path in normalized_files if test_match_any_regex(path, code_like_regexes))
runtime_code_like_changed_count = sum(
    1
    for path in normalized_files
    if test_path_prefix(path, runtime_roots) and test_match_any_regex(path, code_like_regexes)
)
runtime_code_changed = runtime_code_like_changed_count > 0

refactor_heuristic_reasons = []
if runtime_changed and normalized_files:
    rename_ratio = round(rename_count / float(len(normalized_files)), 4) if normalized_files else 0.0
    if len(normalized_files) >= 2 and rename_ratio >= 0.4:
        refactor_heuristic_reasons.append("rename_ratio_high")

    total_churn = additions_total + deletions_total
    delta_balance_threshold = max(20, int(total_churn * 0.15))
    balanced_churn = abs(additions_total - deletions_total) <= delta_balance_threshold
    structural_churn = (
        code_like_changed_count >= 3
        and total_churn >= 80
        and balanced_churn
        and (not db_triggered)
        and (not security_triggered)
    )
    if structural_churn:
        refactor_heuristic_reasons.append("balanced_structural_churn")

refactor_heuristic_triggered = len(refactor_heuristic_reasons) > 0
refactor_triggered = refactor_intent_triggered or refactor_heuristic_triggered

performance_heuristic_triggered = (
    (not performance_path_triggered)
    and (api_triggered or (db_triggered and runtime_code_changed))
    and (not only_sql_or_migration_changes)
    and (changed_lines_total >= args.performance_heuristic_min_lines)
)
performance_triggered = performance_path_triggered or performance_heuristic_triggered

all_under_fast_roots = bool(normalized_files) and all(test_path_prefix(path, fast_path_roots) for path in normalized_files)
all_fast_allowed_types = bool(normalized_files) and all(test_match_any_regex(path, fast_path_allowed_regexes) for path in normalized_files)
has_fast_sensitive_match = any(test_match_any_regex(path, fast_path_sensitive_regexes) for path in normalized_files)

fast_path_eligible = (
    runtime_changed
    and all_under_fast_roots
    and all_fast_allowed_types
    and (not has_fast_sensitive_match)
    and (len(normalized_files) <= args.fast_path_max_files)
    and (changed_lines_total <= args.fast_path_max_changed_lines)
)

mode = "FULL_PATH"
if (
    fast_path_eligible
    and (not db_triggered)
    and (not security_triggered)
    and (not refactor_triggered)
    and (not api_triggered)
    and (not dependency_triggered)
    and (not infra_triggered)
    and (not performance_triggered)
):
    mode = "FAST_PATH"

required_code_review = runtime_code_changed and mode == "FULL_PATH"
required_db_review = db_triggered
required_security_review = security_triggered
required_refactor_review = refactor_triggered
required_api_review = api_triggered and bool(review_capabilities.get("api"))
required_test_review = test_triggered and bool(review_capabilities.get("test"))
required_performance_review = performance_triggered and bool(review_capabilities.get("performance"))
required_infra_review = infra_triggered and bool(review_capabilities.get("infra"))
required_dependency_review = dependency_triggered and bool(review_capabilities.get("dependency"))
resolved_task_id = resolve_task_id(args.task_id, args.output_path)
if resolved_task_id:
    try:
        resolved_task_id = assert_valid_task_id(resolved_task_id)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

result = {
    "detection_source": detection_source,
    "mode": mode,
    "metrics": {
        "classification_config_source": classification_config["source"],
        "classification_config_path": classification_config["config_path"],
        "changed_files_count": len(normalized_files),
        "changed_lines_total": changed_lines_total,
        "additions_total": additions_total,
        "deletions_total": deletions_total,
        "rename_count": rename_count,
        "code_like_changed_count": code_like_changed_count,
        "runtime_code_like_changed_count": runtime_code_like_changed_count,
        "review_capabilities": review_capabilities,
        "fast_path_max_files": args.fast_path_max_files,
        "fast_path_max_changed_lines": args.fast_path_max_changed_lines,
        "performance_heuristic_min_lines": args.performance_heuristic_min_lines,
    },
    "triggers": {
        "runtime_changed": runtime_changed,
        "runtime_code_changed": runtime_code_changed,
        "db": db_triggered,
        "security": security_triggered,
        "api": api_triggered,
        "test": test_triggered,
        "performance": performance_triggered,
        "infra": infra_triggered,
        "dependency": dependency_triggered,
        "refactor": refactor_triggered,
        "refactor_intent": refactor_intent_triggered,
        "refactor_heuristic": refactor_heuristic_triggered,
        "refactor_heuristic_reasons": refactor_heuristic_reasons,
        "performance_heuristic": performance_heuristic_triggered,
        "fast_path_eligible": fast_path_eligible,
        "fast_path_sensitive_match": has_fast_sensitive_match,
    },
    "required_reviews": {
        "code": required_code_review,
        "db": required_db_review,
        "security": required_security_review,
        "refactor": required_refactor_review,
        "api": required_api_review,
        "test": required_test_review,
        "performance": required_performance_review,
        "infra": required_infra_review,
        "dependency": required_dependency_review,
    },
    "changed_files": normalized_files,
}

if resolved_task_id:
    result["task_id"] = resolved_task_id

json_output = json.dumps(result, ensure_ascii=False, indent=2)

resolved_output_path = None
if args.output_path:
    out_path = Path(args.output_path)
    if not out_path.is_absolute():
        out_path = out_path.resolve()
    resolved_output_path = out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json_output + "\n", encoding="utf-8")

metrics_event = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "event_type": "preflight_classification",
    "repo_root": to_posix(repo_root),
    "task_id": resolved_task_id,
    "output_path": to_posix(resolved_output_path) if resolved_output_path else None,
    "result": result,
}
append_metrics_event(metrics_path, metrics_event, emit_metrics)

task_event_details = {
    "mode": mode,
    "output_path": to_posix(resolved_output_path) if resolved_output_path else None,
    "changed_files_count": len(normalized_files),
    "changed_lines_total": changed_lines_total,
    "required_reviews": result["required_reviews"],
}
append_task_event(
    repo_root=repo_root,
    task_id=resolved_task_id,
    event_type="PREFLIGHT_CLASSIFIED",
    outcome="INFO",
    message=f"Preflight completed with mode {mode}.",
    details=task_event_details,
)

print(json_output)
PY
