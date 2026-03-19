from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from gate_utils import audit_command_compactness  # noqa: E402


def test_audit_command_compactness_flags_unscoped_git_diff() -> None:
    result = audit_command_compactness("git diff", mode="scan")

    assert result["warning_count"] > 0
    assert "git_diff_unscoped" in result["matched_rules"]


def test_audit_command_compactness_flags_unbounded_logs() -> None:
    result = audit_command_compactness("docker logs api", mode="scan")

    assert result["warning_count"] > 0
    assert any("--tail 50" in warning for warning in result["warnings"])


def test_audit_command_compactness_suppresses_warning_when_justified() -> None:
    result = audit_command_compactness(
        "pytest -vv --tb=long tests/test_auth.py::test_refresh",
        mode="inspect",
        justification="localized failure reproduction",
    )

    assert result["warning_count"] == 0
    assert result["justification_present"] is True
