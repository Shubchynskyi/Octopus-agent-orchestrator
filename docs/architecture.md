# Architecture

## Design Philosophy

- Canonical rules live only in `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- The selected source-of-truth entrypoint contains the full routing index; all other entrypoints redirect to it.
- Provider-native agent profiles bridge back to the same `live/skills/*` contracts.
- The public runtime surface is the Node CLI: `bin/octopus.js`.
- Existing project docs and legacy agent files are read as input context only.

## Runtime Model

```text
bin/octopus.js
  -> loads src/**/*.ts
  -> runs lifecycle commands, validators, and gates
  -> materializes live/, runtime/, and managed root entrypoints
```

### Runtime Layers

| Layer | Location | Runtime | Role |
|---|---|---|---|
| Public CLI | `bin/octopus.js` | Node.js 20 LTS | Main lifecycle and gate router |
| Canonical runtime | `src/**/*.ts` | Node.js 20 LTS | TypeScript source of behavior |
| Live workspace | `live/**` | materialized content | Canonical rules, config, skills, metadata |

## What Is Deployed To Project Root

### Entrypoint Files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code entrypoint |
| `AGENTS.md` | Codex entrypoint |
| `GEMINI.md` | Gemini entrypoint |
| `.github/copilot-instructions.md` | GitHub Copilot entrypoint |
| `.windsurf/rules/rules.md` | Windsurf entrypoint |
| `.junie/guidelines.md` | Junie entrypoint |
| `.antigravity/rules.md` | Antigravity entrypoint |
| `TASK.md` | Shared task queue |

One entrypoint is canonical. All others redirect to it.

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
| `.qwen/settings.json` | Always |
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
| `live/skills/**` | Orchestration and review skills |
| `live/project-discovery.md` | Project context discovered during setup |
| `live/source-inventory.md` | Source inventory |
| `live/USAGE.md` | Generated usage guide |
| `live/version.json` | Deployment metadata |

## Task Lifecycle

```text
TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
                     \-> BLOCKED
```

Gate pipeline:

```text
1. classify-change
2. implementation
3. compile-gate
4. independent reviews
5. required-reviews-check
6. doc-impact-gate
7. completion-gate
8. DONE
```

All gate events are logged to `runtime/task-events/<task-id>.jsonl` with hash-chain integrity.
