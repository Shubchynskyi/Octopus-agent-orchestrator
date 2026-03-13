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
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
import sys

sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import normalize_path, parse_bool, resolve_path_inside_repo, resolve_project_root, to_string_array


def get_rule_pack(review_type: str) -> dict:
    if review_type == "code":
        return {
            "full": ["00-core.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "70-security.md", "80-task-workflow.md"],
            "depth1": ["00-core.md", "80-task-workflow.md"],
            "depth2": ["00-core.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "70-security.md", "80-task-workflow.md"],
        }
    if review_type in {"db", "security"}:
        return {
            "full": ["00-core.md", "35-strict-coding-rules.md", "70-security.md", "80-task-workflow.md"],
            "depth1": ["00-core.md", "80-task-workflow.md"],
            "depth2": ["00-core.md", "35-strict-coding-rules.md", "70-security.md", "80-task-workflow.md"],
        }
    if review_type == "refactor":
        return {
            "full": ["00-core.md", "30-code-style.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "80-task-workflow.md"],
            "depth1": ["00-core.md", "80-task-workflow.md"],
            "depth2": ["00-core.md", "30-code-style.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "80-task-workflow.md"],
        }
    return {
        "full": ["00-core.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "70-security.md", "80-task-workflow.md"],
        "depth1": ["00-core.md", "80-task-workflow.md"],
        "depth2": ["00-core.md", "35-strict-coding-rules.md", "50-structure-and-docs.md", "70-security.md", "80-task-workflow.md"],
    }


def resolve_output_path(explicit_output_path: str, preflight_path: Path, review_type: str, repo_root: Path) -> Path:
    if explicit_output_path and explicit_output_path.strip():
        return resolve_path_inside_repo(explicit_output_path, repo_root, allow_missing=True)
    preflight_dir = preflight_path.parent
    base_name = re.sub(r"-preflight$", "", preflight_path.stem)
    return (preflight_dir / f"{base_name}-{review_type}-context.json").resolve()


def resolve_scoped_diff_metadata_path(explicit_metadata_path: str, preflight_path: Path, review_type: str, repo_root: Path) -> Path:
    if explicit_metadata_path and explicit_metadata_path.strip():
        return resolve_path_inside_repo(explicit_metadata_path, repo_root, allow_missing=True)
    preflight_dir = preflight_path.parent
    base_name = re.sub(r"-preflight$", "", preflight_path.stem)
    return (preflight_dir / f"{base_name}-{review_type}-scoped.json").resolve()


def to_bool(value, default=False) -> bool:
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    try:
        return parse_bool(value)
    except Exception:
        return bool(default)


parser = argparse.ArgumentParser()
parser.add_argument("--review-type", choices=["code", "db", "security", "refactor", "api", "test", "performance", "infra", "dependency"], required=True)
parser.add_argument("--depth", type=int, choices=[1, 2, 3], required=True)
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--token-economy-config-path", default="Octopus-agent-orchestrator/live/config/token-economy.json")
parser.add_argument("--scoped-diff-metadata-path", default="")
parser.add_argument("--output-path", default="")
parser.add_argument("--repo-root", default="")
args = parser.parse_args()

repo_root = Path(args.repo_root).resolve() if args.repo_root.strip() else resolve_project_root(script_dir)
preflight_path = resolve_path_inside_repo(args.preflight_path, repo_root)
token_config_path = resolve_path_inside_repo(args.token_economy_config_path, repo_root, allow_missing=True)
scoped_diff_metadata_path = resolve_scoped_diff_metadata_path(args.scoped_diff_metadata_path, preflight_path, args.review_type, repo_root)
output_path = resolve_output_path(args.output_path, preflight_path, args.review_type, repo_root)

preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
token_config = {}
if token_config_path.exists() and token_config_path.is_file():
    token_config = json.loads(token_config_path.read_text(encoding="utf-8"))

enabled = to_bool(token_config.get("enabled"))
enabled_depths = sorted({int(item) for item in to_string_array(token_config.get("enabled_depths")) if str(item).strip().isdigit()})
token_economy_active = enabled and args.depth in enabled_depths

rule_pack = get_rule_pack(args.review_type)
full_rule_files = list(rule_pack["full"])
if not token_economy_active or args.depth >= 3:
    selected_rule_files = list(full_rule_files)
elif args.depth == 1:
    selected_rule_files = list(rule_pack["depth1"])
else:
    selected_rule_files = list(rule_pack["depth2"])

omitted_rule_files = [item for item in full_rule_files if item not in selected_rule_files]
selected_rule_paths = [f"Octopus-agent-orchestrator/live/docs/agent-rules/{item}" for item in selected_rule_files]
full_rule_paths = [f"Octopus-agent-orchestrator/live/docs/agent-rules/{item}" for item in full_rule_files]
omitted_rule_paths = [f"Octopus-agent-orchestrator/live/docs/agent-rules/{item}" for item in omitted_rule_files]

required_reviews = preflight.get("required_reviews") or {}
required_review = to_bool(required_reviews.get(args.review_type))
scoped_diff_expected = token_economy_active and args.review_type in {"db", "security"} and to_bool(token_config.get("scoped_diffs"))

scoped_diff_metadata = None
if scoped_diff_metadata_path.exists() and scoped_diff_metadata_path.is_file():
    try:
        scoped_diff_metadata = json.loads(scoped_diff_metadata_path.read_text(encoding="utf-8"))
    except Exception as exc:
        scoped_diff_metadata = {
            "metadata_path": normalize_path(scoped_diff_metadata_path),
            "parse_error": str(exc),
        }

omitted_sections = []
if token_economy_active and args.depth == 1:
    omitted_sections.append(
        {
            "section": "rule_pack",
            "reason": "deferred_by_depth",
            "details": "Only minimal reviewer rule context is selected at depth=1.",
        }
    )
if token_economy_active and to_bool(token_config.get("strip_examples")):
    omitted_sections.append(
        {
            "section": "examples",
            "reason": "token_economy_strip_examples",
            "details": "Examples may be omitted from reviewer context.",
        }
    )
if token_economy_active and to_bool(token_config.get("strip_code_blocks")):
    omitted_sections.append(
        {
            "section": "code_blocks",
            "reason": "token_economy_strip_code_blocks",
            "details": "Code blocks may be omitted from reviewer context.",
        }
    )

result = {
    "review_type": args.review_type,
    "depth": args.depth,
    "token_economy_active": bool(token_economy_active),
    "required_review": bool(required_review),
    "preflight_path": normalize_path(preflight_path),
    "output_path": normalize_path(output_path),
    "token_economy_config_path": normalize_path(token_config_path),
    "selected_rule_files": selected_rule_paths,
    "selected_rule_count": len(selected_rule_paths),
    "full_rule_pack_files": full_rule_paths,
    "omitted_rule_files": omitted_rule_paths,
    "omitted_rule_count": len(omitted_rule_paths),
    "omitted_sections": omitted_sections,
    "omitted_sections_count": len(omitted_sections),
    "omission_reason": "deferred_by_depth" if omitted_rule_paths else "none",
    "rule_pack": {
        "selected_rule_files": selected_rule_paths,
        "selected_rule_count": len(selected_rule_paths),
        "full_rule_pack_files": full_rule_paths,
        "omitted_rule_files": omitted_rule_paths,
        "omitted_rule_count": len(omitted_rule_paths),
        "omission_reason": "deferred_by_depth" if omitted_rule_paths else "none",
    },
    "token_economy_flags": {
        "enabled": bool(enabled),
        "enabled_depths": enabled_depths,
        "strip_examples": bool(to_bool(token_config.get("strip_examples"))),
        "strip_code_blocks": bool(to_bool(token_config.get("strip_code_blocks"))),
        "scoped_diffs": bool(to_bool(token_config.get("scoped_diffs"))),
        "compact_reviewer_output": bool(to_bool(token_config.get("compact_reviewer_output"))),
    },
    "token_economy": {
        "active": bool(token_economy_active),
        "flags": {
            "enabled": bool(enabled),
            "enabled_depths": enabled_depths,
            "strip_examples": bool(to_bool(token_config.get("strip_examples"))),
            "strip_code_blocks": bool(to_bool(token_config.get("strip_code_blocks"))),
            "scoped_diffs": bool(to_bool(token_config.get("scoped_diffs"))),
            "compact_reviewer_output": bool(to_bool(token_config.get("compact_reviewer_output"))),
        },
        "omitted_sections": omitted_sections,
        "omitted_sections_count": len(omitted_sections),
        "omission_reason": "token_economy_compaction" if omitted_sections or omitted_rule_paths else "none",
    },
    "scoped_diff": {
        "expected": bool(scoped_diff_expected),
        "metadata_path": normalize_path(scoped_diff_metadata_path),
        "metadata": scoped_diff_metadata,
    },
}

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("REVIEW_CONTEXT_READY")
print(f"ReviewType: {args.review_type}")
print(f"Depth: {args.depth}")
print(f"TokenEconomyActive: {str(bool(token_economy_active)).lower()}")
print(f"OmittedRuleCount: {len(omitted_rule_paths)}")
print(f"OutputPath: {normalize_path(output_path)}")
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
