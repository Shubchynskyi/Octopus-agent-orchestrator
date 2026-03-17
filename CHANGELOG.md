# Changelog

All notable changes to this bundle are documented in this file.

## [Unreleased]

### Changed
- Added `scripts/uninstall.ps1` / `.sh` to remove deployed orchestrator files with explicit keep/delete choices for the primary entrypoint, `TASK.md`, and runtime backup preservation. Uninstall now strips Octopus-managed bridge blocks from mixed files, cleans merged Qwen/Claude settings plus commit-guard/gitignore additions, and removes the bundle directory without deleting unrelated user content.
- Added `scripts/reinit.ps1` / `.sh` so already installed workspaces can re-ask init answers and reapply only answer-dependent files (`runtime/init-answers.json`, `00-core.md`, entrypoint routing, guards, token-economy enabled flag, and `live/version.json`) without a full reinstall or runtime backup churn.
- Task-event logging now uses best-effort append locking for both per-task timelines and aggregate `all-tasks.jsonl`, reducing concurrent append corruption during local orchestrator runs.
- New task-event writes include per-task integrity metadata (`task_sequence`, `prev_event_sha256`, `event_sha256`), and timeline summary/completion checks now validate that hash chain to detect local replay, reordering, or post-hoc edits.
- `build-review-context.ps1` / `.sh` now emit canonical `rule_pack` and `token_economy` blocks without mirroring the same arrays and counters at the top level; artifacts declare `schema_version=2` and include an explicit legacy-field mapping for removed aliases.
- Gate root resolution now supports both source-repo and deployed-workspace layouts. Shared PowerShell/Python helpers detect workspace root vs orchestrator root, runtime/config paths resolve against the orchestrator root, and relative-path handling accepts both bare (`runtime/...`, `live/...`) and legacy prefixed (`Octopus-agent-orchestrator/...`) aliases.
- Managed live JSON configs now share explicit normalization contracts. `init.ps1` rewrites supported legacy shapes for `review-capabilities`, `paths`, `token-economy`, and `output-filters`, update inherits the same behavior via install, and `verify.ps1` now rejects incompatible shapes across all four configs with migration diagnostics.
- Clarified conservative reviewer-context token-economy defaults by aligning the checked-in live config and version metadata with the template/init defaults (`enabled=false`, `enabled_depths=[1,2]`), documenting that shared gate output filtering remains active at any depth, and regression-testing the optional `enabled_depths=[1,2,3]` case so `depth=3` keeps full reviewer scope while allowing only non-scope-reducing compaction.
- Token-economy telemetry is now text-aware instead of relying only on `chars/4`: shared helpers emit a `hybrid_text_v1` estimate plus the legacy `chars_per_4` baseline in metrics/review-context artifacts, and a dedicated short-form `depth=1` orchestration skill is available so localized tasks can avoid loading the full orchestration guidance.

### Documentation
- Clarified the local trust model for task timelines: the new integrity chain is procedural hardening inside a writable workspace, not a security-grade trust anchor.
- Documented the new `reinit` workflow for changing init answers without reinstalling the orchestrator.
- Documented the new uninstall workflow and backup semantics for removing an existing deployment.

## [1.0.7] - 2026-03-14

### Added
- Token-economy output telemetry baseline for gate payloads:
  - compile and review gates now emit `raw_line_count`, `raw_char_count`, `filtered_line_count`, `filtered_char_count`, `estimated_saved_chars`, `estimated_saved_tokens`, `filter_mode`, and `fallback_mode` into runtime metrics;
  - compile gates report current savings from tail/suppress-on-pass behavior without changing pass/fail verdict logic;
  - review gates report passthrough baseline telemetry so later compression changes can be measured against existing output size.
- Shared gate-output filter engine and config:
  - new config artifact `Octopus-agent-orchestrator/live/config/output-filters.json`;
  - PowerShell and shell gate runtimes now support shared line-based filter primitives (`strip_ansi`, regex replace, keep/drop matching lines, line truncation, head/tail, max-total-lines, emit-when-empty);
  - compile and required-review gates now resolve named output-filter profiles from config and fall back to passthrough with visible warning when config is missing or invalid.
- Token-economy context observability:
  - `build-scoped-diff.ps1` / `.sh` now write scoped-diff metadata sidecars (`*-scoped.json`) alongside diff artifacts;
  - new `build-review-context.ps1` / `.sh` emit reviewer-context artifacts with selected rule pack, omitted sections, `deferred_by_depth` evidence, token-economy flags, and scoped-diff fallback metadata;
  - new Bash parity script `task-events-summary.sh` mirrors the existing task timeline summary helper.

### Changed
- Compile/test/lint/review gate compaction is now parser-aware:
  - compile gate classifies command families (`maven`, `gradle`, `node`, `cargo`, `dotnet`, `go`, generic) and command kinds (`compile`, `test`, `lint`);
  - output filters can run structured `FULL -> DEGRADED -> PASSTHROUGH` parsers before line-level filtering;
  - success paths stay compact, while failure paths surface compact summaries plus deterministic fallback context.
- Interactive updates now ask about new user-facing init settings even when a safe inferred value already exists, and present that inferred value as the recommended default answer instead of silently applying it.
- `init.ps1` now preserves existing `live/config/output-filters.json` values during refresh while filling missing keys from the latest template.
- Bundle version bumped to `1.0.7` for distribution and update detection via `scripts/check-update.ps1`.

### Fixed
- Update-time rule contract migrations now also backfill the newer `40-commands.md` command snippets for `build-scoped-diff`, `build-review-context`, and `task-events-summary.sh`, so upgrades from older deployments no longer fail VERIFY with `CommandsContractViolationCount > 0`.

## [1.0.6] - 2026-03-13

### Changed
- Bundle version bumped to `1.0.6` for distribution and update detection via `scripts/check-update.ps1`.

### Fixed
- Update-time rule contract migrations now backfill the ignored orchestrator git-boundary snippets required by `scripts/verify.ps1` for existing deployments, so `scripts/update.ps1` no longer fails during VERIFY when older live rule files are missing the newer `35/40/50/60/80` guardrails.

## [1.0.5] - 2026-03-13

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
- Bundle version bumped to `1.0.5` for distribution and update detection via `scripts/check-update.ps1`.
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
- `classify-change.ps1` / `.sh` now normalize explicit changed-file input when multiple paths are passed as one comma/semicolon/newline-delimited string (prevents false `changed_files_count=1`).
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
- Orchestrator git-boundary guidance hardened:
  - rules and orchestration skill now explicitly treat ignored control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) as normal local artifacts in deployed workspaces;
  - generated redirect/provider bridge profiles now explicitly forbid `git add -f` for those ignored orchestrator files unless the user explicitly asks to version orchestrator internals;
  - `scripts/verify.ps1` now enforces the new ignored-artifact contract in task/workflow docs and generated entrypoints.
- Init flow now asks whether token economy should be enabled by default and syncs that answer into `live/config/token-economy.json`.
- Documentation now recommends using `enabled=true + depth=1` only for small, well-localized tasks.
- Update workflow now migrates missing init answers for existing deployments:
  - infers missing values from current `live/version.json` / `live/config/token-economy.json` when possible;
  - prompts only for missing answers during interactive update runs;
  - applies safe defaults during non-interactive updates and records migration details in update report;
  - includes migrated `runtime/init-answers.json` in update rollback snapshot;
  - `check-update.ps1 -Apply -NoPrompt` now also suppresses update-time init migration prompts.
- Documentation now explicitly separates runtime layers:
  - top-level `scripts/*.ps1` are canonical control-plane implementations;
  - top-level `scripts/*.sh` are `pwsh` wrappers only;
  - `live/scripts/agent-gates/*.sh` remain real Bash + Python gate implementations.
- Added root `.gitattributes` to normalize repository text files to `LF`, keep shell/Python scripts Unix-safe, and reduce noisy `LF -> CRLF` warnings on Windows.

## [1.0.4] - 2026-03-11

### Changed
- Bundle version bumped to `1.0.4` for distribution and update detection via `scripts/check-update.ps1`.
- Orchestration gate chain hardened with mandatory documentation-impact gate (`doc-impact-gate.ps1` / `.sh`) and evidence wiring in completion checks.
- Compile/review/completion gate contracts tightened for scope-drift checks and task-scoped evidence consistency.
- Security path triggers expanded (`payment`, `checkout`, `billing`) in change classification config and gate classifiers.

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
