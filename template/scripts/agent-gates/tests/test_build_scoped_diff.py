"""Regression tests for refactor scoped-diff support in the Bash helper.

Validates that both live and template build-scoped-diff.sh variants:
- scope refactor reviews to relevant code/config files when triggers match;
- deterministically fall back to the full diff when no refactor trigger matches.

Run:
    pytest template/scripts/agent-gates/tests/test_build_scoped_diff.py -v
"""

from __future__ import annotations

import os
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
BASH_CANDIDATES = [
    shutil.which("bash"),
    r"C:\Program Files\Git\bin\bash.exe",
    r"C:\Program Files\Git\usr\bin\bash.exe",
]


def resolve_bash() -> str | None:
    for candidate in BASH_CANDIDATES:
        if not candidate:
            continue
        candidate_path = Path(candidate)
        if not candidate_path.exists():
            continue
        completed = subprocess.run(
            [str(candidate_path), "-lc", "true"],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode == 0:
            return str(candidate_path)
    return None


BASH_PATH = resolve_bash()
BASH_TEST_ENV = {**os.environ, "OCTOPUS_COMPAT_SHIM": "0"}

pytestmark = pytest.mark.skipif(BASH_PATH is None, reason="bash is required for build-scoped-diff.sh tests")


def run_checked(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, check=False)
    assert completed.returncode == 0, (
        f"Command failed ({completed.returncode}): {' '.join(command)}\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )
    return completed


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def new_temp_repo(tmp_path: Path, variant: str) -> Path:
    repo_path = tmp_path / f"repo-{variant}"
    repo_path.mkdir(parents=True, exist_ok=True)

    run_checked(["git", "init"], repo_path)
    run_checked(["git", "config", "user.name", "Copilot Tests"], repo_path)
    run_checked(["git", "config", "user.email", "copilot-tests@example.com"], repo_path)

    config_source = REPO_ROOT / variant / "config" / "paths.json"
    write_text(repo_path / "config" / "paths.json", config_source.read_text(encoding="utf-8"))
    return repo_path


def commit_baseline(repo_path: Path) -> None:
    run_checked(["git", "add", "."], repo_path)
    run_checked(["git", "commit", "-m", "baseline"], repo_path)


def run_scoped_diff(repo_path: Path, variant: str, changed_files: list[str]) -> tuple[dict, str]:
    preflight_path = repo_path / "runtime" / "reviews" / "T-008-preflight.json"
    output_path = repo_path / "runtime" / "reviews" / "T-008-refactor-scoped.diff"
    metadata_path = repo_path / "runtime" / "reviews" / "T-008-refactor-scoped.json"
    write_text(preflight_path, json.dumps({"changed_files": changed_files}, indent=2) + "\n")

    script_path = REPO_ROOT / variant / "scripts" / "agent-gates" / "build-scoped-diff.sh"
    run_checked(
        [
            BASH_PATH,
            str(script_path),
            "--review-type",
            "refactor",
            "--preflight-path",
            str(preflight_path),
            "--paths-config-path",
            "config/paths.json",
            "--output-path",
            str(output_path),
            "--metadata-path",
            str(metadata_path),
            "--repo-root",
            str(repo_path),
        ],
        REPO_ROOT,
        env=BASH_TEST_ENV,
    )

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    diff_text = output_path.read_text(encoding="utf-8")
    return metadata, diff_text


@pytest.mark.parametrize("variant", ["live", "template"])
def test_refactor_scope_includes_code_and_config_but_not_docs(tmp_path: Path, variant: str) -> None:
    repo_path = new_temp_repo(tmp_path, variant)

    write_text(repo_path / "src" / "feature.py", "def run():\n    return 'v1'\n")
    write_text(repo_path / "config" / "app-settings.json", '{\n  "mode": "v1"\n}\n')
    write_text(repo_path / "docs" / "notes.md", "# Notes\n\nBaseline.\n")
    commit_baseline(repo_path)

    write_text(repo_path / "src" / "feature.py", "def run():\n    return 'v2'\n")
    write_text(repo_path / "config" / "app-settings.json", '{\n  "mode": "v2"\n}\n')
    write_text(repo_path / "docs" / "notes.md", "# Notes\n\nUpdated doc only.\n")

    metadata, diff_text = run_scoped_diff(
        repo_path,
        variant,
        ["src/feature.py", "config/app-settings.json", "docs/notes.md"],
    )

    assert metadata["review_type"] == "refactor"
    assert metadata["fallback_to_full_diff"] is False
    assert metadata["matched_files_count"] == 2
    assert metadata["matched_files"] == ["config/app-settings.json", "src/feature.py"]
    assert "diff --git a/src/feature.py b/src/feature.py" in diff_text
    assert "diff --git a/config/app-settings.json b/config/app-settings.json" in diff_text
    assert "diff --git a/docs/notes.md b/docs/notes.md" not in diff_text


@pytest.mark.parametrize("variant", ["live", "template"])
def test_refactor_scope_falls_back_to_full_diff_when_no_paths_match(tmp_path: Path, variant: str) -> None:
    repo_path = new_temp_repo(tmp_path, variant)

    write_text(repo_path / "docs" / "notes.md", "# Notes\n\nBaseline.\n")
    commit_baseline(repo_path)

    write_text(repo_path / "docs" / "notes.md", "# Notes\n\nFallback proof.\n")

    metadata, diff_text = run_scoped_diff(repo_path, variant, ["docs/notes.md"])

    assert metadata["review_type"] == "refactor"
    assert metadata["fallback_to_full_diff"] is True
    assert metadata["matched_files_count"] == 0
    assert "diff --git a/docs/notes.md b/docs/notes.md" in diff_text
