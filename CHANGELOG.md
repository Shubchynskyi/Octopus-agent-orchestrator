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
- Security + token-economy + cleanup contracts hardened:
  - `scripts/verify.ps1` now requires and validates `live/config/token-economy.json` schema (`enabled`, `enabled_depths`, `strip_*`, `scoped_diffs`, `compact_reviewer_output`, `fail_tail_lines`);
  - `scripts/install.ps1` provider bridge profiles now explicitly require re-reading `live/config/token-economy.json`;
  - `MANIFEST.md` now lists `live/config/token-economy.json` in materialized live config artifacts;
  - compile gates now execute in isolated child processes, emit compact pass/fail summaries, and persist full compile output in task-scoped log files;
  - shell compile gate now resolves and uses current Git Bash binary on Windows (`OA_GATE_BASH_BIN`) instead of ambiguous system `bash.exe` discovery;
  - terminal task events (`TASK_DONE`, `TASK_BLOCKED`) now enforce compile-output cleanup and fail closed when cleanup cannot complete;
  - gate telemetry writes are now best-effort with visible warnings (`Write-Warning` in PowerShell gates; `stderr` warnings in shell/Python gates) instead of silent verbose-only failures.
- `scripts/check-update.ps1` version fallback comparison now uses numeric dotted segments instead of lexicographic string comparison.
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

## [1.0.3] - 2026-03-11

### Added
- Hard completion gate scripts:
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1`
  - `Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh`

### Changed
- Task finalization contract hardened:
  - added explicit resume protocol and completion hard-stop in workflow rules;
  - `DONE` now requires completion gate pass (`COMPLETION_GATE_PASSED`) in addition to compile/review gates;
  - orchestration skill now runs completion gate before terminal status and includes resume flow requirements.
- Rule migrations now auto-add completion-gate command snippets and finalization reminder snippets for upgraded live rule files.
- Verification contract now enforces completion-gate scripts, completion-gate orchestration linkage, and core finalization reminder.
- Provider orchestrator bridge template now requires running completion gate before marking `DONE`.
- Bundle metadata/docs updated for version `1.0.3` and completion-gate workflow.

## [1.0.2] - 2026-03-11

### Changed
- Bundle version bumped to `1.0.2` for distribution and update detection via `check-update`.
- Reviewer execution guidance in orchestration skill is now platform-agnostic and explicitly maps GitHub Copilot CLI reviewer launches via `task` + `agent_type="general-purpose"`.
- Provider bridge managed blocks generated by `install.ps1` now include explicit reviewer-launch mapping and Copilot CLI isolation contract.
- Shell compile gate now pins current Git Bash binary (`OA_GATE_BASH_BIN`) on Windows to avoid ambiguous `bash.exe` resolution.
- Verification contract for reviewer execution now accepts both legacy and platform-agnostic orchestration wording.
- PowerShell compile gate now executes compile commands from `RepoRoot` to match shell gate behavior.
- Gate path-boundary checks now enforce canonical repo containment (`root` or `root + separator`) instead of raw prefix matches.
- `check-update.ps1` script-directory sync/rollback is now deterministic for fileset parity (extra files removed, running updater script excluded).
- Orchestration compile-gate contract now explicitly resolves and passes `fail_tail_lines` from token-economy config (fallback `50`).

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
