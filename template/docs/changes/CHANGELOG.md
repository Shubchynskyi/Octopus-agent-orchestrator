# CHANGELOG

Runtime feature and behavior changes must be logged here.
Process and rule changes may also be logged when they change delivery workflow.

## Entry Template
```text
## YYYY-MM-DD - <short title>
- Task: <task-id>
- Type: feature | behavior-change | api-change | architecture-change
- Scope: <module or service>
- Summary: <what changed>
- Docs Updated: <list of updated doc files>
```

## 2026-03-17 - Uninstall workflow for deployed orchestrators
- Task: T-014
- Type: feature
- Scope: install lifecycle / cleanup / docs
- Summary: Added `scripts/uninstall.ps1` / `.sh` to cleanly remove deployed orchestrator surfaces with explicit keep/delete choices for the primary entrypoint, `TASK.md`, and runtime preservation. Uninstall removes managed bridge files, provider agent profiles, Qwen/Claude orchestrator settings, the managed commit-guard block, and `.gitignore` additions without deleting unrelated user content; when runtime artifacts must be kept, they are copied into an uninstall-backup snapshot before the bundle directory is removed.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/uninstall.ps1`; `Octopus-agent-orchestrator/scripts/uninstall.sh`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/template/scripts/tests/uninstall-flow.Tests.ps1`

## 2026-03-16 - Conservative token-economy defaults and depth=3 policy clarified
- Task: T-011
- Type: behavior-change
- Scope: token economy / reviewer context / docs
- Summary: Kept the conservative reviewer-context token-economy default by aligning checked-in live metadata with the template/init defaults (`enabled=false`, `enabled_depths=[1,2]`), documented that shared gate output filtering still applies at any depth, and clarified that default `depth=3` keeps full reviewer scope while explicit `enabled_depths=[1,2,3]` only enables non-scope-reducing compaction.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/skills/code-review/SKILL.md`; `Octopus-agent-orchestrator/template/skills/db-review/SKILL.md`; `Octopus-agent-orchestrator/template/skills/security-review/SKILL.md`; `Octopus-agent-orchestrator/template/skills/refactor-review/SKILL.md`; `Octopus-agent-orchestrator/scripts/init.ps1`

## 2026-03-16 - Task-event integrity chain and append locking
- Task: T-006
- Type: architecture-change
- Scope: task-event logging / completion gate / docs
- Summary: Hardened task timeline handling with best-effort append locking for per-task and aggregate JSONL writers, added per-task integrity metadata (`schema_version`, `task_sequence`, `prev_event_sha256`, `event_sha256`) on new events, and taught timeline summary plus completion gate to detect local tampering, replay, out-of-order inserts, foreign task ids, and malformed event lines. Documented the threat model explicitly as procedural hardening rather than a real external trust anchor.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/live/docs/review-trust-model.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`

## 2026-03-16 - Review-context payload deduplication
- Task: T-007
- Type: api-change
- Scope: review-context artifact contract
- Summary: Removed duplicated top-level review-context payload aliases for selected rule files, token-economy flags, and omission counters. `build-review-context.ps1` and `.sh` now emit canonical nested `rule_pack` and `token_economy` blocks with `schema_version=2`, plus explicit compatibility metadata that maps removed legacy fields to their canonical nested paths.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`

## 2026-03-16 - Gate root resolution supports source and deployed layouts
- Task: T-007
- Type: behavior-change
- Scope: gate path resolution / runtime evidence / shell parity
- Summary: Shared gate path helpers now distinguish workspace root from orchestrator root so the same scripts work both in the bootstrap source repository (`<repo>/live/...`) and in deployed workspaces (`<workspace>/Octopus-agent-orchestrator/live/...`). Runtime/config paths now resolve against the orchestrator root, relative-path inputs accept both bare and legacy-prefixed aliases, and PowerShell plus shell gates stay aligned on the same evidence locations.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`

## 2026-03-14 - Bundle version bumped to 1.0.7
- Task: ad-hoc
- Type: behavior-change
- Scope: release metadata / docs
- Summary: Finalized the token-economy hardening release as bundle version `1.0.7`, synchronized source-level version references in the main changelog and user-facing README, and extended update-time rule migrations so older deployed `40-commands.md` files gain the new `build-scoped-diff`, `build-review-context`, and `task-events-summary.sh` command-contract snippets required by verification.
- Docs Updated: `Octopus-agent-orchestrator/VERSION`; `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/lib/rule-contract-migrations.ps1`

## 2026-03-11 - Completion gate and resume hard-stop contract
- Task: ad-hoc
- Type: behavior-change
- Scope: orchestration / gate scripts / verification
- Summary: Added completion gate scripts (`completion-gate.ps1` and `.sh`) to enforce final readiness before `DONE`, including timeline integrity checks (`COMPILE_GATE_PASSED`, review pass evidence, rework-after-failure), required review artifact validation, and task-event/metrics emission (`COMPLETION_GATE_PASSED` or `COMPLETION_GATE_FAILED`). Added explicit task resume protocol and hard completion stop in workflow/skill docs, wired completion gate into command catalog and provider bridge contract, and extended contract migrations/verification to enforce these rules on upgrades.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/00-core.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/skills/orchestration/references/stage-gates.md`; `Octopus-agent-orchestrator/scripts/lib/rule-contract-migrations.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/VERSION`; `Octopus-agent-orchestrator/README.md`

## 2026-03-13 - Ignored orchestrator artifacts are normal
- Task: ad-hoc
- Type: behavior-change
- Scope: orchestration / rules / provider bridges
- Summary: Clarified that ignored orchestration control-plane files in deployed workspaces (`TASK.md`, `runtime/**`, and internal docs such as `live/docs/changes/CHANGELOG.md`) are expected local artifacts. Added explicit anti-`git add -f` guidance to task/workflow rules, orchestration skill, and generated bridge profiles so agents stop force-staging internal orchestration documents just because gates or changelog policy reference them.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/TASK.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/35-strict-coding-rules.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/60-operating-rules.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`

## 2026-03-13 - Token economy init toggle and depth recommendation
- Task: ad-hoc
- Type: behavior-change
- Scope: initialization / token economy / docs
- Summary: Added a dedicated init question for whether token economy should be enabled by default, wired the answer into materialized `live/config/token-economy.json`, and documented that `enabled=true + depth=1` should be used only for small, well-localized tasks because it reduces reviewer context breadth.
- Docs Updated: `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/init.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`

## 2026-03-13 - Update-time init answer migration for existing deployments
- Task: ad-hoc
- Type: behavior-change
- Scope: update workflow / initialization / release metadata
- Summary: Added a migration layer for `scripts/update.ps1` so existing deployments with older `runtime/init-answers.json` files automatically backfill missing keys from current live metadata when possible, prompt only for missing answers in interactive runs, and otherwise fall back to safe defaults with full migration details written to update report. The migrated init answers file is now covered by update rollback snapshot, and `check-update.ps1 -Apply -NoPrompt` suppresses nested init migration prompts for silent updates.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/check-update.ps1`; `Octopus-agent-orchestrator/scripts/update.ps1`; `Octopus-agent-orchestrator/scripts/lib/init-answer-migrations.ps1`; `Octopus-agent-orchestrator/VERSION`

## 2026-03-13 - Runtime model clarified for PowerShell wrappers vs shell gates
- Task: ad-hoc
- Type: behavior-change
- Scope: documentation / runtime model
- Summary: Clarified that top-level bundle maintenance scripts are PowerShell-first (`scripts/*.ps1`) and that sibling `scripts/*.sh` files are only compatibility wrappers requiring `pwsh`, while `live/scripts/agent-gates/*.sh` remain real Bash + Python implementations for task execution gates.
- Docs Updated: `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`

## 2026-03-13 - Update migrations now restore ignored-artifact rule snippets
- Task: ad-hoc
- Type: behavior-change
- Scope: update workflow / rule-contract migrations / verification
- Summary: Extended `scripts/lib/rule-contract-migrations.ps1` so update runs patch older deployed `live/docs/agent-rules/35/40/50/60/80` files with the ignored-orchestrator git-boundary snippets now enforced by `scripts/verify.ps1`, preventing rollback-only failures during VERIFY on existing installations.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/lib/rule-contract-migrations.ps1`

## 2026-03-13 - Token economy telemetry baseline for gates
- Task: T-010
- Type: architecture-change
- Scope: gate telemetry / token economy
- Summary: Added shared raw-vs-filtered output telemetry helpers for PowerShell and shell gate implementations. Compile gate now records current savings produced by tail/suppress-on-pass behavior, while required-review gate records passthrough baseline telemetry so future output compression can be measured without changing current gate verdict logic.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate-utils.psm1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate_utils.py`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.sh`

## 2026-03-17 - Reinit workflow for answer-only refresh
- Task: T-013
- Type: behavior-change
- Scope: init workflow / installer routing / verification
- Summary: Added `scripts/reinit.ps1` / `.sh` so existing deployments can re-ask init answers without a full reinstall. Reinit reuses init-answer prompting and explicit override support, rewrites `runtime/init-answers.json`, reapplies answer-dependent entrypoint/guard/version metadata, updates `live/docs/agent-rules/00-core.md` and `live/config/token-economy.json`, and avoids install/update backup churn in `runtime/`.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/AGENTS.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/reinit.ps1`; `Octopus-agent-orchestrator/scripts/reinit.sh`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/scripts/lib/init-answer-migrations.ps1`

## 2026-03-13 - Shared output-filter engine for gate console payloads
- Task: T-011
- Type: architecture-change
- Scope: gate runtime / verification / config
- Summary: Added a shared output-filter engine for PowerShell and shell gate runtimes plus managed config `live/config/output-filters.json`. Compile gate now resolves named success/failure console profiles from config instead of hardcoded tail logic, required-review gate is wired to the same engine with passthrough profile, and verification/bridge contracts now require the new config artifact.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/template/config/output-filters.json`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate-utils.psm1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate_utils.py`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.sh`

## 2026-03-13 - Token economy parser filters and review-context artifacts
- Task: T-012 / T-013 / T-014 / T-015
- Type: architecture-change
- Scope: compile gate / review gate / token economy / update workflow
- Summary: Completed the next token-economy hardening pass. Compile gate now classifies compile/test/lint commands and routes failures through parser-aware output profiles with explicit `FULL`, `DEGRADED`, and `PASSTHROUGH` telemetry. Review gate uses compact pass/fail profiles through the same filter engine. Scoped diff helpers now write metadata sidecars, new `build-review-context.ps1` / `.sh` artifacts record selected rule packs and omitted sections for depth-aware reviewer prompts, and interactive update migrations now always ask about new user-facing init settings while offering inferred values as recommended defaults. `init.ps1` also preserves existing `live/config/output-filters.json` values during refresh.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`; `Octopus-agent-orchestrator/scripts/init.ps1`; `Octopus-agent-orchestrator/scripts/update.ps1`; `Octopus-agent-orchestrator/scripts/lib/init-answer-migrations.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/template/config/output-filters.json`; `Octopus-agent-orchestrator/template/scripts/agent-gates/build-scoped-diff.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/build-scoped-diff.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/build-review-context.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/build-review-context.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/task-events-summary.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate-utils.psm1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/lib/gate_utils.py`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/required-reviews-check.sh`

## 2026-03-11 - Platform-agnostic reviewer routing and version bump
- Task: ad-hoc
- Type: behavior-change
- Scope: orchestration / provider bridge / release metadata
- Summary: Renamed reviewer execution guidance to platform-agnostic contract, added explicit GitHub Copilot CLI reviewer launch mapping (`task` + `agent_type="general-purpose"`), updated provider bridge managed blocks with the same mapping, fixed stale reviewer verifier snippets for backward compatibility, hardened repo-boundary checks in gate scripts, aligned PowerShell compile gate working directory with shell parity, made `check-update` scripts-directory sync/rollback deterministic, wired orchestration compile invocation to pass token-economy `fail_tail_lines`, and bumped bundle version to `1.0.2`.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/scripts/check-update.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.sh`; `Octopus-agent-orchestrator/VERSION`

## 2026-03-10 - Security, token-economy, and cleanup contracts hardened
- Task: ad-hoc
- Type: behavior-change
- Scope: gates / verification / bundle metadata
- Summary: Enforced token-economy config contract in verification, updated install bridge profiles to re-read token-economy config, added token-economy artifact to manifested live config outputs, hardened compile-gate execution and compact output handling (including Git Bash path pinning on Windows), switched gate telemetry append failures to warning-level visibility, added terminal-task compile-log cleanup with fail-closed behavior, and replaced check-update fallback version comparison with numeric dotted-segment logic.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`

## 2026-03-10 - Commit guard no longer blocks human IDE commits
- Task: ad-hoc
- Type: behavior-change
- Scope: install / git hooks
- Summary: Updated managed pre-commit guard generation to block only detected agent sessions (with manual override helper) so human commits from IDE/terminal are not blocked.
- Docs Updated: `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/CHANGELOG.md`

## 2026-03-05 - Agent workflow and quality gates formalized
- Task: T-001, T-002, T-004, T-005
- Type: behavior-change
- Scope: agent process
- Summary: Added hard-stop orchestration, mandatory code/DB review gates, documentation impact gates, and skill catalog.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`

## 2026-03-05 - Security review and artifact traceability extensions
- Task: T-006
- Type: behavior-change
- Scope: agent process
- Summary: Added mandatory security review trigger for auth/payments, blocked reason codes, and standardized review artifact templates.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`

## 2026-03-05 - Refactor review gate and specialist skill added
- Task: T-007
- Type: behavior-change
- Scope: agent process
- Summary: Added mandatory refactor review trigger, full refactor specialist skill package, and artifact contract extensions for refactor verdict tracking.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`

## 2026-03-05 - FAST_PATH/FULL_PATH preflight gates and reviewer minimization
- Task: T-008
- Type: behavior-change
- Scope: agent process
- Summary: Added automated preflight path-mode classification, mandatory review-gate check script, manifest duplicate validator, and rule updates so minor UI changes can skip unnecessary reviewer swarms.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`

## 2026-03-08 - Optional specialist-skill expansion and security hardening
- Task: T-009
- Type: behavior-change
- Scope: agent process
- Summary: Added post-init optional specialist-skill flow, live-only skill-builder package, capability-based optional review triggers (`api/test/performance/infra/dependency`), expanded deterministic gate contracts, and strengthened security baseline guidance.
- Docs Updated: `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`; `Octopus-agent-orchestrator/live/docs/tasks/TASKS.md`
