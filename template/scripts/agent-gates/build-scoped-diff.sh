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
from pathlib import Path

script_dir = Path(os.environ["OA_GATE_SCRIPT_DIR"]).resolve()
sys.path.insert(0, str(script_dir / "lib"))

from gate_utils import (
    match_any_regex as gate_match_any_regex,
    normalize_path as gate_normalize_path,
    resolve_path_inside_repo as gate_resolve_path_inside_repo,
    resolve_project_root as gate_resolve_project_root,
    to_string_array as gate_to_string_array,
)


def resolve_project_root(script_dir: Path) -> Path:
    return gate_resolve_project_root(script_dir)


def normalize_path(path_value):
    return gate_normalize_path(path_value)


def resolve_git_root(repo_root: Path) -> Path:
    repo_root_resolved = repo_root.resolve()
    if (repo_root_resolved / ".git").exists():
        return repo_root_resolved
    bundle_candidate = (repo_root_resolved / "Octopus-agent-orchestrator").resolve()
    if (bundle_candidate / ".git").exists():
        return bundle_candidate
    return repo_root_resolved


def resolve_path_inside_repo(path_value: str, repo_root: Path, allow_missing: bool = False) -> Path:
    return gate_resolve_path_inside_repo(path_value, repo_root, allow_missing=allow_missing)


def to_string_array(value):
    return gate_to_string_array(value, trim_values=True)


def match_any_regex(path_value: str, regexes, review_type: str) -> bool:
    return gate_match_any_regex(
        path_value,
        regexes,
        invalid_regex_context=f"review '{review_type}'",
        skip_invalid_regex=True,
    )


def run_git_diff(repo_root: Path, use_staged: bool, pathspecs) -> str:
    command = ["git", "-C", str(repo_root), "diff", "--no-color"]
    if use_staged:
        command.append("--staged")
    else:
        command.append("HEAD")

    if pathspecs:
        command.append("--")
        command.extend(pathspecs)

    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(f"git diff exited with code {completed.returncode}. {stderr}".strip())

    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    if stderr.strip():
        if stdout and not stdout.endswith("\n"):
            stdout += "\n"
        stdout += stderr
    return stdout


def resolve_output_path(explicit_output_path: str, preflight_path: Path, review_type: str, repo_root: Path) -> Path:
    if explicit_output_path and explicit_output_path.strip():
        return resolve_path_inside_repo(explicit_output_path, repo_root, allow_missing=True)

    preflight_dir = preflight_path.parent
    preflight_name = preflight_path.stem
    base_name = re.sub(r"-preflight$", "", preflight_name)
    return (preflight_dir / f"{base_name}-{review_type}-scoped.diff").resolve()


def line_count(text: str) -> int:
    if not text:
        return 0
    return len(text.splitlines())


def normalize_pathspecs_for_git(pathspecs, repo_root: Path, git_root: Path):
    if repo_root.resolve() == git_root.resolve():
        return list(pathspecs)

    prefix = git_root.name + "/"
    normalized = []
    for item in pathspecs:
        candidate = str(item).replace("\\", "/")
        if candidate.lower().startswith(prefix.lower()):
            candidate = candidate[len(prefix):]
        normalized.append(candidate)
    return normalized


parser = argparse.ArgumentParser()
parser.add_argument("--review-type", choices=["db", "security"], required=True)
parser.add_argument("--preflight-path", required=True)
parser.add_argument("--paths-config-path", default="Octopus-agent-orchestrator/live/config/paths.json")
parser.add_argument("--output-path", default="")
parser.add_argument("--full-diff-path", default="")
parser.add_argument("--repo-root", default="")
parser.add_argument("--use-staged", action="store_true")
args = parser.parse_args()

script_dir = Path(os.environ.get("OA_GATE_SCRIPT_DIR", ".")).resolve()
repo_root = Path(args.repo_root).resolve() if args.repo_root.strip() else resolve_project_root(script_dir)
git_repo_root = resolve_git_root(repo_root)

preflight_path = resolve_path_inside_repo(args.preflight_path, repo_root)
paths_config_path = resolve_path_inside_repo(args.paths_config_path, repo_root)
output_path = resolve_output_path(args.output_path, preflight_path, args.review_type, repo_root)
full_diff_path = None
if args.full_diff_path and args.full_diff_path.strip():
    full_diff_path = resolve_path_inside_repo(args.full_diff_path, repo_root, allow_missing=True)

preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
changed_files = sorted({item.replace("\\", "/") for item in to_string_array(preflight.get("changed_files"))})

paths_config = json.loads(paths_config_path.read_text(encoding="utf-8"))
triggers = paths_config.get("triggers") or {}
trigger_regexes = to_string_array(triggers.get(args.review_type))
if not trigger_regexes:
    raise RuntimeError(f"No trigger regexes found for review type '{args.review_type}' in {paths_config_path}")

matched_files = [path for path in changed_files if match_any_regex(path, trigger_regexes, args.review_type)]

scoped_diff_text = ""
fallback_to_full_diff = False
full_diff_source = "none"

if matched_files:
    try:
        git_pathspecs = normalize_pathspecs_for_git(matched_files, repo_root, git_repo_root)
        scoped_diff_text = run_git_diff(git_repo_root, args.use_staged, git_pathspecs)
        if not scoped_diff_text.strip():
            fallback_to_full_diff = True
    except Exception as exc:
        print(f"WARNING: scoped diff generation failed for '{args.review_type}': {exc}", file=sys.stderr)
        fallback_to_full_diff = True
else:
    fallback_to_full_diff = True

output_diff_text = scoped_diff_text
if fallback_to_full_diff:
    if full_diff_path and full_diff_path.exists() and full_diff_path.is_file():
        output_diff_text = full_diff_path.read_text(encoding="utf-8")
        full_diff_source = "artifact"
    else:
        output_diff_text = run_git_diff(git_repo_root, args.use_staged, [])
        full_diff_source = "git"

output_path.parent.mkdir(parents=True, exist_ok=True)
output_payload = output_diff_text or ""
if output_payload and not output_payload.endswith("\n"):
    output_payload += "\n"
output_path.write_text(output_payload, encoding="utf-8")

result = {
    "review_type": args.review_type,
    "preflight_path": normalize_path(preflight_path),
    "paths_config_path": normalize_path(paths_config_path),
    "output_path": normalize_path(output_path),
    "git_repo_root": normalize_path(git_repo_root),
    "full_diff_path": normalize_path(full_diff_path) if full_diff_path else None,
    "full_diff_source": full_diff_source,
    "use_staged": bool(args.use_staged),
    "matched_files_count": len(matched_files),
    "matched_files": matched_files,
    "fallback_to_full_diff": bool(fallback_to_full_diff),
    "scoped_diff_line_count": line_count(scoped_diff_text),
    "output_diff_line_count": line_count(output_payload),
}

print("SCOPED_DIFF_READY")
print(f"ReviewType: {args.review_type}")
print(f"MatchedFilesCount: {len(matched_files)}")
print(f"FallbackToFullDiff: {str(bool(fallback_to_full_diff)).lower()}")
print(f"OutputPath: {normalize_path(output_path)}")
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
