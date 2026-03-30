# Architecture

## Design Philosophy

- Canonical rules live only in `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- The selected source-of-truth entrypoint contains the full routing index.
- Additional active agent files can be materialized as redirects or provider bridges, but unused entrypoints are not created by default.
- Provider-native agent profiles bridge back to the same `live/skills/*` contracts.
- The public runtime surface is the generated Node CLI launcher: `bin/octopus.js`.
- Existing project docs and legacy agent files are read as input context only.

## Runtime Model

```text
bin/octopus.js
  -> loads compiled dist/src/**/*.js (or staged .node-build/src/**/*.js for tests)
  -> generated from strict TypeScript source in src/bin/octopus.ts
  -> loads runtime compiled from strict TypeScript source in src/**/*.ts
  -> runs lifecycle commands, validators, and gates
  -> materializes live/, runtime/, and managed root entrypoints
```

### Runtime Layers

| Layer | Location | Runtime | Role |
|---|---|---|---|
| Public CLI | `bin/octopus.js` | Node.js 24 LTS | Generated launcher compiled from `src/bin/octopus.ts` |
| TypeScript source of truth | `src/**/*.ts` | compile-time only | Strict compiler-enforced runtime source |
| Executed runtime | `dist/src/**/*.js` and `.node-build/src/**/*.js` | Node.js 24 LTS | Compiled lifecycle, validator, and gate implementation |
| Live workspace | `live/**` | materialized content | Canonical rules, config, skills, metadata |

## What Is Deployed To Project Root

### Entrypoint Files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code entrypoint |
| `AGENTS.md` | Codex entrypoint |
| `GEMINI.md` | Gemini entrypoint |
| `QWEN.md` | Qwen entrypoint |
| `.github/copilot-instructions.md` | GitHub Copilot entrypoint |
| `.windsurf/rules/rules.md` | Windsurf entrypoint |
| `.junie/guidelines.md` | Junie entrypoint |
| `.antigravity/rules.md` | Antigravity entrypoint |
| `TASK.md` | Shared task queue |

One entrypoint is canonical. Additional entrypoints are created only when they were explicitly confirmed as active during agent initialization.

### Provider Bridge Profiles

| File | Purpose |
|---|---|
| `.github/agents/orchestrator.md` | Copilot orchestrator bridge |
| `.github/agents/reviewer.md` | Copilot reviewer bridge |
| `.github/agents/{code,db,security,refactor,...}-review.md` | Copilot specialist review bridges |
| `.windsurf/agents/orchestrator.md` | Windsurf orchestrator bridge |
| `.junie/agents/orchestrator.md` | Junie orchestrator bridge |
| `.antigravity/agents/orchestrator.md` | Antigravity orchestrator bridge |

### Settings Files

| File | Condition |
|---|---|
| `.claude/settings.local.json` | `ClaudeOrchestratorFullAccess=true` |
| `.qwen/settings.json` | Only when the project already contains this file; managed entries mirror `TASK.md` plus the current canonical entrypoint |
| `.git/hooks/pre-commit` | `EnforceNoAutoCommit=true` |
| `.gitignore` | Managed entries for agent artifacts |

## What Is Materialized Inside Orchestrator

| Path | Purpose |
|---|---|
| `live/docs/agent-rules/00..90` | Canonical rule set |
| `live/docs/changes/CHANGELOG.md` | Local changelog |
| `live/docs/reviews/TEMPLATE.md` | Review template |
| `live/docs/tasks/TASKS.md` | Internal task reference |
| `live/config/review-capabilities.json` | Enabled review types |
| `live/config/paths.json` | Preflight roots and trigger regexes |
| `live/config/token-economy.json` | Token economy settings |
| `live/config/output-filters.json` | Gate output compaction profiles |
| `live/config/skill-packs.json` | Installed built-in domain packs |
| `live/config/skills-index.json` | Compact optional-skill discovery index |
| `live/skills/**` | Orchestration and review skills |
| `live/project-discovery.md` | Project context discovered during setup |
| `live/source-inventory.md` | Source inventory |
| `live/USAGE.md` | Generated usage guide |
| `live/version.json` | Deployment metadata |
| `runtime/agent-init-state.json` | Hard onboarding state written by `octopus agent-init` |
| `runtime/update-rollbacks/**` | Saved pre-update workspace snapshots for rollback |
| `runtime/bundle-backups/**` | Saved bundle copies created during applied updates |
| `runtime/update-reports/**` | Update and rollback reports |

## Task Lifecycle

```text
TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
                     \-> BLOCKED
```

Gate pipeline:

```text
1. enter-task-mode
2. load-rule-pack (TASK_ENTRY)
3. classify-change
4. load-rule-pack (POST_PREFLIGHT)
5. implementation
6. compile-gate
7. independent reviews
8. required-reviews-check
9. doc-impact-gate
10. completion-gate
11. DONE
```

All gate events are logged to `runtime/task-events/<task-id>.jsonl` with hash-chain integrity.

## Validation Contract

- `tsconfig.build.json` enforces `strict:true` for `src/**/*.ts`.
- `tsconfig.tests.json` enforces `strict:true` for `src/**/*.ts`, `tests/node/**/*.ts`, and `scripts/node-foundation/**/*.ts`.
- `npm run validate:release` is the explicit release proof path: `build -> test -> pack -> install/invoke`.
