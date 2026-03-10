# Changelog

All notable changes to this bundle are documented in this file.

## [Unreleased]

### Added
- Update workflow with remote version check and optional auto-apply from git:
  - `scripts/check-update.ps1` / `scripts/check-update.sh`
  - `scripts/update.ps1` / `scripts/update.sh`
- Deployment version tracking:
  - bundle marker file `VERSION`
  - runtime metadata `Octopus-agent-orchestrator/live/version.json`
  - update report output `Octopus-agent-orchestrator/runtime/update-reports/update-<timestamp>.md`
- Optional hard no-auto-commit guard (init flag `EnforceNoAutoCommit`) with managed `.git/hooks/pre-commit` block.
- Manual commit helpers for guarded repositories:
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.ps1`
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/human-commit.sh`

### Changed
- Upgrade behavior for `TASK.md`:
  - uses latest template managed block;
  - migrates existing active queue rows from previous task file;
  - keeps previous managed block if safe queue parsing is not possible.
- Orchestration review contract:
  - mandatory immediate fallback self-review on single-agent platforms;
  - explicit reviewer-agent execution mapping and verdict-to-gate parameter mapping;
  - final report must ask commit decision (`Do you want me to commit now? (yes/no)`).
- Verification contract extended for:
  - version consistency checks;
  - provider bridge contracts;
  - optional commit-guard enforcement checks.

## [1.0.0] - 2026-03-09

### Added
- Initial orchestrator bootstrap with canonical live rules, task workflow gates, provider bridge profiles, and initialization/verification scripts.
