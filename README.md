![Octopus Agent Orchestrator](Image.png)

# Octopus Agent Orchestrator Bootstrap

This bundle deploys Octopus Agent Orchestrator entrypoints into project root, materializes canonical rules inside `Octopus-agent-orchestrator/live/`, and includes built-in token-usage optimization via `Octopus-agent-orchestrator/live/config/token-economy.json`.

## Quick Start
- User guide: `HOW_TO.md`
- Agent setup prompt: `AGENT_INIT_PROMPT.md`
- Full changelog: `CHANGELOG.md`

## Version
- Current bundle version: `1.0.7` (source: `VERSION`)
- Update command: `pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1`
- Optional shell wrapper: `bash Octopus-agent-orchestrator/scripts/check-update.sh` (still requires `pwsh`; wrapper only)
- Last documentation update: `2026-03-17`

## Runtime Model
- Top-level bundle maintenance scripts under `Octopus-agent-orchestrator/scripts/*.ps1` are the canonical control-plane implementations for install/init/reinit/verify/update/check-update.
- Sibling top-level `Octopus-agent-orchestrator/scripts/*.sh` files are thin compatibility wrappers that call the corresponding `.ps1` script through `pwsh`; they are not standalone Bash implementations.
- Task-execution gate scripts under `Octopus-agent-orchestrator/live/scripts/agent-gates/*.ps1` and `*.sh` are real dual-runtime implementations.
- Shell gate scripts require `bash` plus a Python runtime in PATH (`python3`, `python`, or `py -3`).

## Recent Changes (Short)
- Added update workflow with version check and optional auto-apply from git (`scripts/check-update.ps1`, `scripts/update.ps1`).
- Added `scripts/reinit.ps1` / `.sh` to re-ask init answers and reapply answer-dependent settings without full reinstall.
- Added deployment version metadata (`live/version.json`) and verification contract for version consistency.
- Added optional hard no-auto-commit guard (`.git/hooks/pre-commit`) controlled by init answer `EnforceNoAutoCommit`.
- Added manual commit helpers (`live/scripts/agent-gates/human-commit.ps1` and `.sh`) when guard is enabled.
- Improved TASK upgrade behavior: apply latest template while migrating existing queue rows.
- Clarified orchestration review mechanics: mandatory fallback self-review and explicit final commit decision prompt.
- Added hard compile gate before review phase (`live/scripts/agent-gates/compile-gate.ps1` and `.sh`) driven by `live/docs/agent-rules/40-commands.md`.
- Added hard completion gate before `DONE` (`live/scripts/agent-gates/completion-gate.ps1` and `.sh`) with resume protocol and mandatory finalization checks.
- Added token-usage optimization controls (`live/config/token-economy.json`) for compact gate output, scoped diffs, and deterministic fail-tail limits.
- Added update-time init-answer migration for existing deployments, with inference/default fallback and rollback-safe persistence of `runtime/init-answers.json`.
- Added parser-aware gate compaction and review-context artifacts for token-economy mode (`build-scoped-diff` metadata, `build-review-context`, compact compile/test/lint/review profiles).

## Design
- Canonical rule set lives only in `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- Source-of-truth entrypoint is selected at setup (`Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, or `Antigravity`).
- Selected entrypoint contains canonical routing index; all other entrypoint files are redirects.
- Provider-native agent directories are bridged to the same Octopus `live/skills/*` contracts.
- Context rules are initialized as generic templates and then filled using project discovery signals.
- Existing project docs and legacy agent files are read as context input only.
- No automatic moving or deleting of legacy files.

## Token Economy
- Reviewer-context token economy is controlled via `Octopus-agent-orchestrator/live/config/token-economy.json`.
- Shared gate output filter profiles live in `Octopus-agent-orchestrator/live/config/output-filters.json` and stay active regardless of the reviewer-context token-economy toggle.
- Conservative default: keep `token-economy.enabled=false` with `enabled_depths=[1,2]` unless the project explicitly wants compact reviewer context.
- When reviewer-context token economy is enabled, use `depth=1` only for small, well-localized tasks; prefer `depth=2` or `depth=3` when review correctness depends on broader context.
- `depth=3` keeps full reviewer rule packs by default; only shared gate output filtering and fail-tail compaction remain active.
- Gate metrics now record raw-vs-filtered payload size, parser mode, parser strategy, and estimated saved tokens for compile/review gates.
- Scoped-diff helpers can also persist metadata artifacts (`*-scoped.json`), and reviewer-context helpers can persist `*-review-context.json` with selected rule pack, omitted sections, and fallback evidence.

## What Is Deployed To Project Root
- `CLAUDE.md` (always refreshed from template)
- `AGENTS.md`
- `GEMINI.md`
- `.claude/settings.local.json` (optional; created/merged when `ClaudeOrchestratorFullAccess=true`, contains Claude Code local permissions allowlist for orchestrator scripts)
- `.qwen/settings.json` (Qwen context bootstrap with `AGENTS.md` + `TASK.md`)
- `TASK.md`
- `.antigravity/rules.md`
- `.github/agents/orchestrator.md`
- `.github/agents/reviewer.md`
- `.github/agents/code-review.md`
- `.github/agents/db-review.md`
- `.github/agents/security-review.md`
- `.github/agents/refactor-review.md`
- `.github/agents/api-review.md`
- `.github/agents/test-review.md`
- `.github/agents/performance-review.md`
- `.github/agents/infra-review.md`
- `.github/agents/dependency-review.md`
- `.junie/guidelines.md`
- `.junie/agents/orchestrator.md`
- `.windsurf/rules/rules.md`
- `.windsurf/agents/orchestrator.md`
- `.antigravity/agents/orchestrator.md`
- `.github/copilot-instructions.md`

## What Is Materialized Inside Orchestrator
- `Octopus-agent-orchestrator/live/config/review-capabilities.json`
- `Octopus-agent-orchestrator/live/config/paths.json`
- `Octopus-agent-orchestrator/live/config/output-filters.json`
- `Octopus-agent-orchestrator/live/docs/agent-rules/00..90`
- `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`
- `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`
- `Octopus-agent-orchestrator/live/docs/tasks/TASKS.md`
- `Octopus-agent-orchestrator/live/scripts/agent-gates/**`
- `Octopus-agent-orchestrator/live/skills/**`
- `Octopus-agent-orchestrator/live/source-inventory.md`
- `Octopus-agent-orchestrator/live/init-report.md`
- `Octopus-agent-orchestrator/live/project-discovery.md`
- `Octopus-agent-orchestrator/live/USAGE.md`
- `Octopus-agent-orchestrator/live/version.json`

## Single-Agent Flow (Recommended)
1. Copy `Octopus-agent-orchestrator/` into target project root.
2. Give the setup agent this file:
   - `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`
3. Agent asks the user for:
   - preferred assistant response language;
   - preferred default response brevity (`concise` or `detailed`).
   - preferred source-of-truth entrypoint: `Claude (CLAUDE.md) | Codex (AGENTS.md) | Gemini (GEMINI.md) | GitHubCopilot (.github/copilot-instructions.md) | Windsurf (.windsurf/rules/rules.md) | Junie (.junie/guidelines.md) | Antigravity (.antigravity/rules.md)`; all non-selected entrypoint files will redirect to the selected file.
   - whether to enforce hard no-auto-commit guard (`yes` or `no`).
   - whether to grant Claude full access to orchestrator files/commands (`yes` or `no`) so gate scripts and task-event logs run without extra permission prompts.
   - whether reviewer-context token economy should be enabled by default (`yes` or `no`); shared gate output filtering remains active either way.
4. Agent must hard-stop setup unless all 6 answers are collected, then writes `Octopus-agent-orchestrator/runtime/init-answers.json`.
5. Agent executes install and init with `-InitAnswersPath`, then reads `live/project-discovery.md`.
6. Agent updates context rules (`10/20/30/40/60`) and `live/config/paths.json` to match the real repository.
7. Agent runs verify and manifest validation with the same `-InitAnswersPath`.
8. Agent returns `Usage Instructions` in the selected assistant language.
9. Agent presents optional specialization summary (live-only):
   - already configured specialist skills;
   - available skills that can be enabled/created now;
   - recommended set for this specific project.
   Then asks `Do you want to add additional specialist skills now? (yes/no)` and, if approved, uses `live/skills/skill-builder`.

## Post-Init Validation Commands
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

Real shell alternatives exist for gate scripts under `live/scripts/agent-gates/`:
```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --rationale "<why>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh --review-type "<db|security|refactor>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh --review-type "<code|db|security|refactor|api|test|performance|infra|dependency>" --depth 2 --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```

## Re-Ask Init Answers Without Reinstall
Use reinit when you want to change init answers such as assistant language, brevity, source-of-truth entrypoint, commit guard, Claude full-access flag, or token-economy default without rerunning full install.

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/reinit.ps1 -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

```bash
bash Octopus-agent-orchestrator/scripts/reinit.sh -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

The reinit flow:
- re-asks the init questionnaire (or accepts explicit overrides in non-interactive runs);
- rewrites `runtime/init-answers.json`;
- reapplies answer-dependent routing, guard, and metadata files;
- updates `live/docs/agent-rules/00-core.md`, `live/config/token-economy.json`, and `live/version.json`;
- avoids full `live/` resync and does not create install/update backup trees in `runtime/`.

## Updating Existing Deployment
Use this in normal cases:

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1
```

```bash
bash Octopus-agent-orchestrator/scripts/check-update.sh
```

The Bash form above is only a wrapper to `check-update.ps1` and still requires `pwsh`.

Behavior:
- if current version equals latest: `UP_TO_DATE`;
- if newer version exists: asks `Apply now? (y/N)` and updates on confirmation;
- during update, missing keys in `runtime/init-answers.json` are migrated automatically:
  - in interactive mode, new user-facing settings are asked even when a safe value can be inferred from existing live state;
  - when such an inferred value exists, it is shown as the recommended default answer instead of being applied silently;
  - in non-interactive mode (or with `-NoPrompt`), inference from existing `live/version.json` / `live/config/token-economy.json` is still applied automatically when possible;
  - otherwise safe defaults (for example `AssistantLanguage=English`) are used, with migration details written to update report.
- during refresh, `init.ps1` preserves existing `live/config/output-filters.json` values and fills in any newly introduced template keys.

Auto-apply (CI/non-interactive):
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -Apply -NoPrompt
```

`-Apply -NoPrompt` also suppresses update-time init-answer prompts in the nested `update.ps1` call and relies on inference/defaults only.

Optional flags (only when needed):
- `-InitAnswersPath "<path>"` if `init-answers.json` is not in default location.
- `-RepoUrl "<git-url>"` to update from a fork/mirror.
- `-TargetRoot "<project-root>"` when running from outside project root.

Example with custom repo:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -RepoUrl "<git-url>"
```

Manual fallback:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/update.ps1
```

Optional manual silent mode:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/update.ps1 -NoInitAnswerPrompt
```

## Work Example
Example feature request:
- User asks: `Create a task in TASK.md for feature "Invoice CSV export with email delivery".`

Agent splits it into three tasks in `TASK.md`:

| ID | Status | Priority | Area | Title | Owner | Updated | Depth | Notes |
|---|---|---|---|---|---|---|---|---|
| T-201 | 🟦 TODO | P1 | backend | Add invoice CSV export API and service | unassigned | 2026-03-09 | 3 | Requires runtime + API review path |
| T-202 | 🟦 TODO | P1 | worker | Add async email delivery job for exported CSV | unassigned | 2026-03-09 | 3 | Requires security review for outbound attachment flow |
| T-203 | 🟦 TODO | P2 | docs | Update docs/changelog and user-facing usage notes | unassigned | 2026-03-09 | 2 | Depends on T-201 and T-202 |

Then user asks:
- `Execute task T-201 depth=3`

Typical agent lifecycle:
1. Creates plan and logs `PLAN_CREATED`.
2. Runs preflight and gets `FULL_PATH` with required reviews.
3. Implements code, adds tests, updates docs where required.
4. Runs mandatory compile gate and gets `COMPILE_GATE_PASSED`.
5. Runs independent reviews.
6. Receives failed review or failed gate (`REVIEW_GATE_FAILED`), returns to code, logs `REWORK_STARTED`.
7. Fixes findings, reruns compile/reviews, receives `REVIEW_GATE_PASSED`.
8. Runs doc impact gate and receives `DOC_IMPACT_ASSESSED`.
9. Runs completion gate and receives `COMPLETION_GATE_PASSED`.
10. Marks task `DONE`, logs `TASK_DONE`, and returns summary + commit message suggestion.

Task timeline log commands:
```powershell
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "T-201"
```

```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "T-201"
```

Example summary output:
```text
Task: T-201
Events: 10
Timeline:
[01] ... | PLAN_CREATED | INFO | actor=orchestrator
[02] ... | PREFLIGHT_CLASSIFIED | INFO
[03] ... | COMPILE_GATE_PASSED | PASS
[04] ... | REVIEW_PHASE_STARTED | INFO
[05] ... | REVIEW_REQUESTED | INFO | actor=code-review
[06] ... | REVIEW_GATE_FAILED | FAIL
[07] ... | REWORK_STARTED | INFO
[08] ... | REVIEW_GATE_PASSED | PASS
[09] ... | COMPLETION_GATE_PASSED | PASS
[10] ... | TASK_DONE | PASS
```

Optional commit message suggestion returned by agent:
```text
add CSV export endpoint with async email delivery hooks
```

## Important
- Run initialization only through `AGENT_INIT_PROMPT.md`; do not run `scripts/install.ps1` directly.
- To change previously collected init answers without reinstalling, use `scripts/reinit.ps1`.
- `scripts/install.ps1` and `scripts/verify.ps1` require `Octopus-agent-orchestrator/runtime/init-answers.json` with collected init answers.
- Top-level `scripts/*.ps1` are canonical; top-level `scripts/*.sh` are `pwsh` wrappers for the same control-plane entrypoints.
- For upgrades, use `scripts/check-update.ps1` (or `scripts/update.ps1` if bundle already replaced).
- Installer defaults to non-destructive mode for non-canonical entry files.
- During upgrades, `TASK.md` uses latest template and migrates existing queue rows (tasks are preserved).
- Selected source-of-truth entrypoint is intentionally refreshed to keep routing canonical.
- Installer creates backups in `Octopus-agent-orchestrator/runtime/backups/<timestamp>/`.
- If `EnforceNoAutoCommit=true`, installer configures `.git/hooks/pre-commit` guard that blocks detected agent sessions while allowing normal human commits (including IDE), plus manual commit helpers in `live/scripts/agent-gates/human-commit.*`.
- Installer updates `.gitignore` with managed agent entries.
- Commit message format is project-defined; conventional commit prefixes (for example `feat(...)`) are optional unless your repository policy requires them.
- If `ClaudeOrchestratorFullAccess=true`, installer merges `.claude/settings.local.json` and ensures `permissions.allow` entries for orchestrator `pwsh`/`bash` scripts (including `cd && git diff` patterns).
- Preflight roots and trigger regexes are configurable in `live/config/paths.json`.
- Scoped reviewer diff helper can persist both diff and fallback metadata artifacts (`build-scoped-diff.ps1` / `.sh`).
- Review-context helper can persist selected rule-pack and omission evidence (`build-review-context.ps1` / `.sh`) before reviewer launch.
- Compile gate command is configured in `live/docs/agent-rules/40-commands.md` under `### Compile Gate (Mandatory)` and is required before `IN_REVIEW`.
- Compile gate enforces preflight scope freshness; scope drift requires re-preflight before compile.
- Review gate (`required-reviews-check`) validates compile evidence plus post-compile drift and writes review evidence (`<task-id>-review-gate.json`).
- Doc impact gate (`doc-impact-gate`) writes machine-checkable documentation impact evidence (`<task-id>-doc-impact.json`) before completion.
- Completion gate (`completion-gate`) is required before `DONE`; it validates compile/review/doc-impact evidence, review-loop timeline integrity, best-effort task-event hash-chain integrity, and required review artifacts.
- Command placeholders in `live/docs/agent-rules/40-commands.md` must be replaced with real project commands; verify fails on unresolved placeholders.
- Gate scripts under `live/scripts/agent-gates/` support both `pwsh` (`*.ps1`) and `bash` (`*.sh`); agent should auto-detect environment there.
- Bash gate scripts require a Python runtime in PATH (`python3`, `python`, or `py -3`).
- Specialist skills added after init are project-specific and should be created only in `Octopus-agent-orchestrator/live/skills/**`.
- Copilot bridge profiles re-read `live/docs/agent-rules/90-skill-catalog.md` and `live/config/review-capabilities.json`, so post-init specialist skills are included in routing.
- Task timeline logs are written per task id to `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl` (plus aggregate `all-tasks.jsonl`) with best-effort append locking and per-task integrity metadata.
- Commit message text is a recommended output only; it is not a mandatory gate for task completion.

## License
MIT License. See `LICENSE`.

## Author
- Dmytro Shubchynskyi
- Email: d.shubchynskyi@gmail.com
- LinkedIn: https://www.linkedin.com/in/shubchynskyi
