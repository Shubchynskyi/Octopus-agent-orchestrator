# Node Migration Contract — M0 Baseline

Version: 1.0.8
Frozen: 2026-03-19
Source: `bin/octopus.js`, `scripts/*.ps1`, `scripts/*.sh`, `live/`, `MANIFEST.md`

> Every Node implementation **must** reproduce the contracts below before the
> corresponding PowerShell / bash / Python implementation is removed.

---

## 1. CLI Aliases

The npm package exposes three equivalent CLI aliases through `package.json` `bin`:

| Alias | Target |
|---|---|
| `octopus` | `bin/octopus.js` |
| `oao` | `bin/octopus.js` |
| `octopus-agent-orchestrator` | `bin/octopus.js` |

Contract: all three aliases must remain functional and equivalent.

---

## 2. Command / Flag Inventory

### 2.1 Lifecycle Commands

The router recognises these command names (`LIFECYCLE_COMMANDS` set in `octopus.js`):

```
setup, status, doctor, bootstrap, install, init, reinit, update, uninstall
```

Zero-argument invocation prints `overview` (safe, non-destructive).
Unknown first positional falls through to `bootstrap`.

### 2.2 Global Options

| Flag | Alias | Type | Meaning |
|---|---|---|---|
| `--help` | `-h` | boolean | Print help text |
| `--version` | `-v` | boolean | Print package version |

### 2.3 Per-Command Flags

#### `octopus` (no args — overview)
No flags. Prints `OCTOPUS_OVERVIEW` banner, status snapshot, available commands.

#### `octopus setup`
| Flag | Type | Notes |
|---|---|---|
| `--target-root` | string | Workspace root, default `.` |
| `--init-answers-path` | string | Default `Octopus-agent-orchestrator/runtime/init-answers.json` |
| `--repo-url` | string | Clone source override |
| `--branch` | string | Branch override |
| `--dry-run` | boolean | Preview mode |
| `--verify` | boolean | Run verify post-setup |
| `--no-prompt` | boolean | Non-interactive mode |
| `--skip-verify` | boolean | Skip post-setup verify |
| `--skip-manifest-validation` | boolean | Skip manifest validation |
| `--assistant-language` | string | Communication language |
| `--assistant-brevity` | string | `concise` or `detailed` |
| `--active-agent-files` | string | Comma-separated entrypoints |
| `--source-of-truth` | string | One of: Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, Antigravity |
| `--enforce-no-auto-commit` | string | `yes`/`no`/`true`/`false` |
| `--claude-orchestrator-full-access` | string | Same |
| `--claude-full-access` | string | Alias for above |
| `--token-economy-enabled` | string | Same |

#### `octopus status`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |

#### `octopus doctor`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |

#### `octopus bootstrap`
| Flag | Type | Notes |
|---|---|---|
| `--destination` | string | Alias `--target` |
| `--repo-url` | string | |
| `--branch` | string | |
Accepts 1 positional arg as destination fallback.

#### `octopus install`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |
| `--repo-url` | string |
| `--branch` | string |
| `--dry-run` | boolean |

#### `octopus init`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |
| `--dry-run` | boolean |

#### `octopus reinit`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |
| `--no-prompt` | boolean |
| `--skip-verify` | boolean |
| `--skip-manifest-validation` | boolean |
| `--assistant-language` | string |
| `--assistant-brevity` | string |
| `--source-of-truth` | string |
| `--enforce-no-auto-commit` | string |
| `--claude-orchestrator-full-access` | string |
| `--claude-full-access` | string (alias) |
| `--token-economy-enabled` | string |

#### `octopus update`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |
| `--repo-url` | string |
| `--branch` | string |
| `--apply` | boolean |
| `--no-prompt` | boolean |
| `--dry-run` | boolean |
| `--skip-verify` | boolean |
| `--skip-manifest-validation` | boolean |

#### `octopus uninstall`
| Flag | Type |
|---|---|
| `--target-root` | string |
| `--init-answers-path` | string |
| `--no-prompt` | boolean |
| `--dry-run` | boolean |
| `--skip-backups` | boolean |
| `--keep-primary-entrypoint` | string (`yes`/`no`) |
| `--keep-task-file` | string (`yes`/`no`) |
| `--keep-runtime-artifacts` | string (`yes`/`no`) |

---

## 3. Init-Answer Schema

`runtime/init-answers.json` — required artifact for `install`, `init`, `doctor`, `reinit`, `update`, `uninstall`.

| Key | Type | Allowed values |
|---|---|---|
| `AssistantLanguage` | string | Any non-empty text |
| `AssistantBrevity` | string | `concise`, `detailed` |
| `SourceOfTruth` | string | `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity` |
| `EnforceNoAutoCommit` | string/bool | `true`/`false`/`yes`/`no`/`1`/`0`/`да`/`нет` |
| `ClaudeOrchestratorFullAccess` | string/bool | Same |
| `TokenEconomyEnabled` | string/bool | Same |
| `CollectedVia` | string | `AGENT_INIT_PROMPT.md`, `CLI_INTERACTIVE`, `CLI_NONINTERACTIVE` |
| `ActiveAgentFiles` | string (optional) | Comma-separated subset of canonical entrypoint files |

---

## 4. Source-of-Truth → Entrypoint Map

| SourceOfTruth | Canonical Entrypoint |
|---|---|
| Claude | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Gemini | `GEMINI.md` |
| GitHubCopilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/rules.md` |
| Junie | `.junie/guidelines.md` |
| Antigravity | `.antigravity/rules.md` |

---

## 5. Managed-File Inventory

### 5.1 Installed to Project Root (by `install.ps1`)

| File | Type |
|---|---|
| `CLAUDE.md` | Redirect entrypoint |
| `AGENTS.md` | Redirect entrypoint |
| `GEMINI.md` | Redirect entrypoint |
| `.qwen/settings.json` | Managed settings |
| `TASK.md` | Task queue |
| `.antigravity/rules.md` | Redirect entrypoint |
| `.github/agents/orchestrator.md` | Provider bridge |
| `.github/agents/reviewer.md` | Skill bridge |
| `.github/agents/code-review.md` | Skill bridge |
| `.github/agents/db-review.md` | Skill bridge |
| `.github/agents/security-review.md` | Skill bridge |
| `.github/agents/refactor-review.md` | Skill bridge |
| `.github/agents/api-review.md` | Skill bridge |
| `.github/agents/test-review.md` | Skill bridge |
| `.github/agents/performance-review.md` | Skill bridge |
| `.github/agents/infra-review.md` | Skill bridge |
| `.github/agents/dependency-review.md` | Skill bridge |
| `.github/copilot-instructions.md` | Redirect entrypoint |
| `.junie/guidelines.md` | Redirect entrypoint |
| `.junie/agents/orchestrator.md` | Provider bridge |
| `.windsurf/rules/rules.md` | Redirect entrypoint |
| `.windsurf/agents/orchestrator.md` | Provider bridge |
| `.antigravity/agents/orchestrator.md` | Provider bridge |

### 5.2 Managed Blocks

| Location | Block type |
|---|---|
| `.gitignore` | Octopus-managed entries between managed-start/managed-end markers |
| `.git/hooks/pre-commit` | Octopus no-auto-commit guard block (when `EnforceNoAutoCommit=true`) |
| `.qwen/settings.json` | Managed rules/mcpServers entries |
| `.claude/settings.local.json` | Managed include patterns |

### 5.3 Materialized into `Octopus-agent-orchestrator/live/`

| Path | Description |
|---|---|
| `live/config/review-capabilities.json` | Review type toggles |
| `live/config/paths.json` | Path trigger patterns |
| `live/config/token-economy.json` | Token economy settings |
| `live/config/output-filters.json` | Output filter profiles |
| `live/docs/agent-rules/**` | Agent rule contract documents |
| `live/docs/changes/**` | Change-related docs |
| `live/docs/reviews/**` | Review docs |
| `live/docs/tasks/**` | Task docs |
| `live/scripts/**` | Gate scripts and tests |
| `live/skills/**` | Skill definitions |
| `live/source-inventory.md` | Source inventory |
| `live/init-report.md` | Init report |
| `live/project-discovery.md` | Project discovery |
| `live/USAGE.md` | Usage instructions |
| `live/version.json` | Version + settings snapshot |

### 5.4 Runtime Artifacts

| Path | When created |
|---|---|
| `runtime/init-answers.json` | Setup / agent init |
| `runtime/reviews/**` | During task execution |
| `runtime/task-events/**` | During task execution |
| `runtime/update-reports/**` | During updates |
| `runtime/bundle-backups/**` | During updates |

### 5.5 Bundle Items (deployed/synced)

```
.gitattributes, bin, scripts, template, AGENT_INIT_PROMPT.md,
CHANGELOG.md, HOW_TO.md, LICENSE, MANIFEST.md, README.md,
VERSION, package.json
```

---

## 6. Config Artifact Shapes

### 6.1 `review-capabilities.json`
```json
{
  "code": true, "db": true, "security": true, "refactor": true,
  "api": false, "test": false, "performance": false,
  "infra": false, "dependency": false
}
```
All keys must be boolean. This is the exhaustive set.

### 6.2 `token-economy.json`
```json
{
  "enabled": false,
  "enabled_depths": [1, 2],
  "strip_examples": true, "strip_code_blocks": true,
  "scoped_diffs": true, "compact_reviewer_output": true,
  "fail_tail_lines": 50
}
```

### 6.3 `paths.json`
Top-level keys: `metrics_path`, `runtime_roots`, `fast_path_roots`,
`fast_path_allowed_regexes`, `fast_path_sensitive_regexes`,
`sql_or_migration_regexes`, `code_like_regexes`, `triggers`.
`triggers` sub-keys: `db`, `security`, `refactor`, `api`, `dependency`,
`infra`, `test`, `performance`.

### 6.4 `output-filters.json`
Version `2`. Top-level keys: `version`, `passthrough_ceiling`, `profiles`.
Profiles: `compile_failure_console`, `compile_failure_console_generic`,
`compile_failure_console_maven`, `compile_failure_console_gradle`,
`compile_failure_console_node`, `compile_failure_console_cargo`,
`compile_failure_console_dotnet`, `compile_failure_console_go`,
`compile_success_console`, `test_failure_console`, `test_success_console`,
`lint_failure_console`, `lint_success_console`,
`review_gate_failure_console`, `review_gate_success_console`,
`review_gate_console`.

### 6.5 `version.json`
Keys: `Version`, `UpdatedAt`, `SourceOfTruth`, `CanonicalEntrypoint`,
`ActiveAgentFiles`, `AssistantLanguage`, `AssistantBrevity`,
`EnforceNoAutoCommit`, `ClaudeOrchestratorFullAccess`,
`TokenEconomyEnabled`, `InitAnswersPath`.

---

## 7. Lifecycle Scenario Inventory — Golden Baselines

Each scenario below is a parity reference. A Node implementation passes
when it produces equivalent output markers, file trees, and exit codes.

### 7.1 Overview (no args)

- **Trigger**: `node bin/octopus.js` with no arguments.
- **Output markers**: `OCTOPUS_OVERVIEW`, `OCTOPUS_STATUS`, `Available Commands`.
- **Side effects**: none (read-only).
- **Exit code**: 0.

### 7.2 Help

- **Trigger**: `node bin/octopus.js help` or `node bin/octopus.js --help`.
- **Output markers**: `Octopus Agent Orchestrator CLI`, `Commands:`, `Global options:`.
- **Side effects**: none.
- **Exit code**: 0.

### 7.3 Version

- **Trigger**: `node bin/octopus.js --version`.
- **Output**: package version string only (e.g. `1.0.8`).
- **Exit code**: 0.

### 7.4 Bootstrap (fresh)

- **Trigger**: `node bin/octopus.js bootstrap` in an empty directory.
- **Output markers**: `OCTOPUS_BOOTSTRAP_OK`, `BundlePath:`, `NextSteps:`.
- **File tree**: `Octopus-agent-orchestrator/` with all `DEPLOY_ITEMS`.
- **Exit code**: 0.
- **Error case**: non-empty destination → error with message `already exists and is not empty`.

### 7.5 Setup (non-interactive)

- **Trigger**: `node bin/octopus.js setup --target-root "." --no-prompt --assistant-language English --assistant-brevity concise --source-of-truth Claude --enforce-no-auto-commit no --claude-orchestrator-full-access no --token-economy-enabled yes`
- **Output markers**: `OCTOPUS_SETUP`, `[1/3]`, `[2/3]`, `[3/3]`, `OCTOPUS_SETUP_STATUS`.
- **Side effects**: deploys bundle, writes `runtime/init-answers.json`, runs `setup.ps1` → `install.ps1` → materializes `live/`.
- **Exit code**: 0.
- **Post-conditions**: `live/version.json` exists, TASK.md exists, redirect entrypoints exist.

### 7.6 Install (from prepared init-answers)

- **Trigger**: `node bin/octopus.js install --target-root "." --init-answers-path "<path>"`
- **Prerequisite**: bundle deployed, `init-answers.json` prepared.
- **Delegates to**: `scripts/install.ps1` with `-TargetRoot`, `-AssistantLanguage`, `-AssistantBrevity`, `-SourceOfTruth`, `-InitAnswersPath`.
- **Exit code**: 0 on success, non-zero on failure.
- **Post-conditions**: all managed files materialized, `live/` populated.

### 7.7 Init (re-materialize live)

- **Trigger**: `node bin/octopus.js init --target-root "." --init-answers-path "<path>"`
- **Prerequisite**: bundle deployed, init-answers exist.
- **Delegates to**: `scripts/init.ps1` with `-TargetRoot`, `-AssistantLanguage`, `-AssistantBrevity`, `-SourceOfTruth`, `-EnforceNoAutoCommit`, `-TokenEconomyEnabled`.
- **Exit code**: 0 on success.

### 7.8 Reinit

- **Trigger**: `node bin/octopus.js reinit --target-root "." --init-answers-path "<path>"`
- **Delegates to**: `scripts/reinit.ps1`.
- **Effect**: rewrites `runtime/init-answers.json`, updates routing, metadata, `00-core.md`, `token-economy.json`, `version.json`.
- **Does NOT**: rebuild full `live/`, create backups.

### 7.9 Doctor

- **Trigger**: `node bin/octopus.js doctor --target-root "." --init-answers-path "<path>"`
- **Delegates to**: `scripts/verify.ps1` then `live/scripts/agent-gates/validate-manifest.ps1`.
- **Output on success**: `Doctor: PASS`.
- **Exit code**: 0 on pass, non-zero on fail.

### 7.10 Verify

- **Trigger**: `pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -TargetRoot "." -SourceOfTruth "<provider>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"`
- **Wrapper parity**: `scripts/verify.sh` prefers `node bin/octopus.js verify` and falls back to `verify.ps1` when Node shimming is disabled or `node` is unavailable.
- **Output on success**: `Verification: PASS`.
- **Failure contract**: exits non-zero after printing the detected contract violations and terminating with `Verification failed. Resolve listed issues and rerun.`
- **Side effects**: none.

### 7.11 Status

- **Trigger**: `node bin/octopus.js status --target-root "."`
- **Output markers**: `OCTOPUS_STATUS`, `Workspace Stages`, `RecommendedNextCommand:`.
- **Side effects**: none.
- **Exit code**: 0.

### 7.12 Update

- **Trigger**: `node bin/octopus.js update --target-root "." --init-answers-path "<path>" [--apply] [--no-prompt] [--dry-run]`
- **Delegates to**: `scripts/check-update.ps1`.
- **On newer version available**: syncs bundle, creates `runtime/bundle-backups/<timestamp>/`, writes `runtime/update-reports/update-<timestamp>.md`.
- **`--dry-run`**: preview only, no mutation.

### 7.13 Uninstall

- **Trigger**: `node bin/octopus.js uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts no`
- **Delegates to**: `scripts/uninstall.ps1`.
- **Removes**: bundle dir, redirect entrypoints, provider bridges, managed blocks from `.gitignore`/`.git/hooks/pre-commit`/`.qwen/settings.json`/`.claude/settings.local.json`.
- **Preserve matrix**: `--keep-primary-entrypoint`, `--keep-task-file`, `--keep-runtime-artifacts` each accept `yes`/`no`.
- **Backups**: written to `Octopus-agent-orchestrator-uninstall-backups/<timestamp>/` unless `--skip-backups`.

---

## 8. PowerShell Script Inventory

Control-plane scripts under `scripts/`:

| Script | Bash wrapper | Purpose |
|---|---|---|
| `setup.ps1` | `setup.sh` | First-run orchestrator |
| `install.ps1` | `install.sh` | Deploy + materialize |
| `init.ps1` | `init.sh` | Materialize live from template |
| `reinit.ps1` | `reinit.sh` | Partial refresh |
| `verify.ps1` | `verify.sh` | Deployment validation |
| `update.ps1` | `update.sh` | Manual post-sync update |
| `check-update.ps1` | `check-update.sh` | Version check + optional apply |
| `uninstall.ps1` | `uninstall.sh` | Clean removal |

Shared libraries under `scripts/lib/`:

| Library | Purpose |
|---|---|
| `common.ps1` | Path resolution, boolean parsing, entrypoint map, provider profiles |
| `init-answer-migrations.ps1` | Init-answer key migration helpers |
| `managed-config-contracts.ps1` | Managed config insert/strip helpers |
| `rule-contract-migrations.ps1` | Rule-file migration logic |

---

## 9. Gate Script Inventory

Under `live/scripts/agent-gates/`:

| Gate | `.ps1` | `.sh` | Parameters |
|---|---|---|---|
| Classify change | `classify-change.ps1` | `classify-change.sh` | `-UseStaged`, `-TaskIntent` |
| Compile gate | `compile-gate.ps1` | `compile-gate.sh` | `-TaskId` |
| Completion gate | `completion-gate.ps1` | `completion-gate.sh` | `-TaskId` |
| Build scoped diff | `build-scoped-diff.ps1` | `build-scoped-diff.sh` | `-ReviewType` |
| Build review context | `build-review-context.ps1` | `build-review-context.sh` | `-ReviewType`, `-Depth` |
| Doc impact gate | `doc-impact-gate.ps1` | `doc-impact-gate.sh` | `-TaskId`, `-Decision` |
| Required reviews check | `required-reviews-check.ps1` | `required-reviews-check.sh` | `-TaskId`, `-CodeReviewVerdict` |
| Log task event | `log-task-event.ps1` | `log-task-event.sh` | `-TaskId`, `-EventType` |
| Task events summary | `task-events-summary.ps1` | `task-events-summary.sh` | `-TaskId` |
| Validate manifest | `validate-manifest.ps1` | `validate-manifest.sh` | `-ManifestPath` |
| Human commit | `human-commit.ps1` | `human-commit.sh` | (direct use) |

---

## 10. Runtime Dependencies

| Component | Requirement |
|---|---|
| `bin/octopus.js` | Shipped M0 baseline: Node.js ≥ 16.14 before the M1 repository baseline moved to Node 20 LTS |
| `scripts/*.ps1` | PowerShell 7+ (`pwsh`) |
| `scripts/*.sh` | `bash` + `pwsh` (wrappers) |
| Gate `.ps1` | PowerShell 7+ |
| Gate `.sh` | `bash` + Python (`python3`/`python`/`py -3`) |

---

## 11. Key Constants

From `bin/octopus.js`:

| Constant | Value |
|---|---|
| `DEFAULT_BUNDLE_NAME` | `Octopus-agent-orchestrator` |
| `DEFAULT_INIT_ANSWERS_RELATIVE_PATH` | `Octopus-agent-orchestrator/runtime/init-answers.json` |
| `DEFAULT_REPO_URL` | `https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git` |
| `SOURCE_OF_TRUTH_VALUES` | Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, Antigravity |
| `BREVITY_VALUES` | concise, detailed |
| `COLLECTED_VIA_VALUES` | AGENT_INIT_PROMPT.md, CLI_INTERACTIVE, CLI_NONINTERACTIVE |

---

## 12. Exit-Code Contract

| Condition | Exit code |
|---|---|
| Successful command | 0 |
| Any error | non-zero (currently 1) |
| Error output marker | `OCTOPUS_BOOTSTRAP_FAILED` on stderr |

---

## 13. Validation Checklist

This contract is tested by `template/scripts/tests/node-migration-contract.Tests.ps1`.
That test validates:

- CLI entry point exists and is syntactically valid JS
- All lifecycle commands are registered in `LIFECYCLE_COMMANDS`
- All source-of-truth values map to entrypoint files
- All deploy items exist in the repo
- Config JSON files are well-formed with expected keys
- `MANIFEST.md` lists all control-plane and gate scripts
- `.ps1`/`.sh` parity: every `.ps1` under `scripts/` has a matching `.sh`
- Every gate `.ps1` under `live/scripts/agent-gates/` has a matching `.sh`
- `package.json` `bin` aliases are complete
- Constants match between JS and PowerShell common lib

Run: `Invoke-Pester -Path template/scripts/tests/node-migration-contract.Tests.ps1 -CI`
