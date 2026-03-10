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
- Mandatory compile gate scripts:
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1`
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh`

### Changed
- Commit guard behavior now blocks only detected agent sessions (Codex/Claude/Aider/Cursor markers) and no longer blocks normal human commits from IDE/terminal.
- Upgrade behavior for `TASK.md`:
  - uses latest template managed block;
  - migrates existing active queue rows from previous task file;
  - keeps previous managed block if safe queue parsing is not possible.
- Orchestration review contract:
  - mandatory immediate fallback self-review on single-agent platforms;
  - explicit reviewer-agent execution mapping and verdict-to-gate parameter mapping;
  - final report must ask commit decision (`Do you want me to commit now? (yes/no)`).
- Init specialization step contract:
  - before asking `Do you want to add additional specialist skills now? (yes/no)`, the agent must show:
    - already configured specialist skills;
    - available skills that can be enabled/created now;
    - project-specific recommendation for specialist skills.
- Workflow gates contract:
  - compile gate is now mandatory before `IN_REVIEW`;
  - review gate now enforces compile evidence (`COMPILE_GATE_PASSED`) for the same task id;
  - `40-commands.md` requires concrete compile command in `### Compile Gate (Mandatory)`;
  - verification fails if command placeholders remain unresolved in live command catalog.
- Update/install reliability fixes:
  - `init.ps1` now prefers existing `live` context rules over template defaults to preserve project-specific command catalogs;
  - `install.ps1` now reapplies latest `TASK.md` managed template even when existing queue is empty;
  - `install/init/update/check-update` now block `TargetRoot` pointing to the bundle directory (prevents nested `Octopus-agent-orchestrator/Octopus-agent-orchestrator`);
  - orchestration stage-gates reference updated to require compile gate evidence before review gate completion.
- Verification contract extended for:
  - version consistency checks;
  - provider bridge contracts;
  - optional commit-guard enforcement checks.

## [1.0.1] - 2026-03-10

### Changed
- Bundle version bumped to `1.0.1` for distribution and update detection via `check-update`.
- Hardened update/install/verify path validation for `InitAnswersPath` (must resolve inside `TargetRoot`).
- Added rollback protection for `update.ps1` and `check-update.ps1` when apply phase fails.
- `install.ps1` now fails closed for `EnforceNoAutoCommit=true` when `.git` is missing.
- `.qwen/settings.json` alignment now preserves existing JSON and merges mandatory context entries (`AGENTS.md`, `TASK.md`).
- `verify.ps1` now requires `validate-manifest.ps1` alongside shell manifest validator.
- `init.ps1` discovery overlay policy aligned for context file set `10/20/30/40/50/60`.

### Fixed
- `check-update.ps1` no longer removes `Octopus-agent-orchestrator/scripts` while running from that directory on Windows.
- Script bundle sync now updates `scripts` in-place and skips the currently executing `check-update.ps1` to avoid file-lock failures.
- Sync rollback for `scripts` now restores content in-place (with the same lock-safe behavior) instead of deleting the directory root.
- Contract snippet migrations were moved to shared module `scripts/lib/rule-contract-migrations.ps1` and are now reused by `init.ps1`, `update.ps1`, and `verify.ps1` from a single source of truth.
- `update.ps1` now has explicit `CONTRACT_MIGRATIONS` stage before verification and includes migration status/count in update report output.
- `init.ps1` migration pass now auto-fills missing compile/review gate snippets for `40-commands.md` (including compile-gate command references) and reviewer-linkage snippets for `80-task-workflow.md` when legacy/live sources lag behind current contract.

## [1.0.0] - 2026-03-09

### Added
- Initial orchestrator bootstrap with canonical live rules, task workflow gates, provider bridge profiles, and initialization/verification scripts.
