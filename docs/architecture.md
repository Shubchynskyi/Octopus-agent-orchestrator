# Architecture

## Design Philosophy

- Canonical rule set lives only in `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- Source-of-truth entrypoint is selected at setup (Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, or Antigravity).
- Selected entrypoint contains canonical routing index; all other entrypoint files are redirects.
- Provider-native agent directories are bridged to the same Octopus `live/skills/*` contracts.
- Context rules are initialized as generic templates and then filled using project discovery signals.
- Existing project docs and legacy agent files are read as context input only — no automatic moving or deleting.

## Runtime Model

```
┌──────────────────────────────────────────────────────────────┐
│  npm CLI (bin/octopus.js)                                    │
│  Aliases: octopus, oao, octopus-agent-orchestrator           │
│  Role: bootstrap / lifecycle router                          │
└─────────────────────────┬────────────────────────────────────┘
                          │ delegates to
┌─────────────────────────▼────────────────────────────────────┐
│  Control-Plane Scripts (scripts/*.ps1)          [PowerShell] │
│  install · init · reinit · verify · update · uninstall       │
│  Shared library: scripts/lib/common.ps1                      │
│  Sibling *.sh are thin pwsh wrappers (not standalone bash)   │
└─────────────────────────┬────────────────────────────────────┘
                          │ materializes
┌─────────────────────────▼────────────────────────────────────┐
│  Live Workspace (live/)                                      │
│  ├── docs/agent-rules/   canonical rule set (00..90)         │
│  ├── config/             review-capabilities, paths,         │
│  │                       token-economy, output-filters       │
│  ├── scripts/agent-gates/ dual-runtime gate scripts          │
│  │   (*.ps1 = PowerShell, *.sh = real bash+python)           │
│  ├── skills/             orchestration, skill-builder,       │
│  │                       specialist skills                   │
│  └── version.json        deployment metadata                 │
└──────────────────────────────────────────────────────────────┘
```

### Transition Foundation (M1)

- `src/` now holds the staged TypeScript foundation for the migration: CLI metadata, core helpers, validators, and runtime loaders.
- This layer is **not** the active lifecycle runtime yet; `bin/octopus.js` still delegates all user-facing lifecycle work to PowerShell.
- New Node migration code is authored in TypeScript; `.node-build/` contains the staged runnable `.js` output used by the current foundation tests.
- The new build/test harness is documented in [`docs/node-platform-foundation.md`](node-platform-foundation.md).

### Three Script Categories

| Category | Location | Runtime | Role |
|---|---|---|---|
| **Control-plane** | `scripts/*.ps1` | PowerShell 7+ | Install, init, reinit, verify, update, uninstall |
| **Control-plane wrappers** | `scripts/*.sh` | bash → `pwsh` | Thin compatibility wrappers; not standalone |
| **Gate scripts** | `live/scripts/agent-gates/*` | `.ps1` (PowerShell) or `.sh` (bash + Python) | Real dual-runtime implementations |

## What Is Deployed To Project Root

After install, these files appear in the target project root:

### Entrypoint Files
| File | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code entrypoint |
| `AGENTS.md` | Codex / multi-agent entrypoint |
| `GEMINI.md` | Gemini entrypoint |
| `.github/copilot-instructions.md` | GitHub Copilot entrypoint |
| `.windsurf/rules/rules.md` | Windsurf entrypoint |
| `.junie/guidelines.md` | Junie entrypoint |
| `.antigravity/rules.md` | Antigravity entrypoint |
| `TASK.md` | Shared task queue |

One entrypoint is selected as source-of-truth (contains full routing index). All others redirect to it.

### Provider Bridge Profiles
| File | Purpose |
|---|---|
| `.github/agents/orchestrator.md` | Copilot orchestrator bridge |
| `.github/agents/reviewer.md` | Copilot reviewer bridge |
| `.github/agents/{code,db,security,refactor,...}-review.md` | Copilot specialist review bridges |
| `.windsurf/agents/orchestrator.md` | Windsurf orchestrator bridge |
| `.junie/agents/orchestrator.md` | Junie orchestrator bridge |
| `.antigravity/agents/orchestrator.md` | Antigravity orchestrator bridge |

### Settings Files (Conditional)
| File | Condition |
|---|---|
| `.claude/settings.local.json` | `ClaudeOrchestratorFullAccess=true` |
| `.qwen/settings.json` | Always (Qwen context bootstrap) |
| `.git/hooks/pre-commit` | `EnforceNoAutoCommit=true` |
| `.gitignore` | Managed entries for agent artifacts |

## What Is Materialized Inside Orchestrator

The `Octopus-agent-orchestrator/live/` directory contains:

| Path | Purpose |
|---|---|
| `docs/agent-rules/00..90` | Canonical rule set (core, context, architecture, style, strict, commands, structure, operating, security, workflow, skills) |
| `docs/changes/CHANGELOG.md` | Local changelog |
| `docs/reviews/TEMPLATE.md` | Review template |
| `docs/tasks/TASKS.md` | Internal task reference |
| `config/review-capabilities.json` | Which reviews are enabled |
| `config/paths.json` | Preflight roots and trigger regexes |
| `config/token-economy.json` | Token economy settings |
| `config/output-filters.json` | Gate output compaction profiles |
| `scripts/agent-gates/**` | Gate scripts (classify, compile, review, doc-impact, completion, scoped-diff, review-context, task-events, validate-manifest) |
| `skills/**` | Orchestration skills, skill-builder, specialist skills |
| `project-discovery.md` | Project context discovered during setup |
| `source-inventory.md` | Source file inventory |
| `USAGE.md` | Generated usage guide |
| `version.json` | Deployment version metadata |

## Task Lifecycle

```
TODO → IN_PROGRESS → IN_REVIEW → DONE
                  ↘ BLOCKED
```

Gate pipeline for each task:

```
1. Preflight (classify-change)    → required reviews determined
2. Implementation                 → code changes
3. Compile gate (mandatory)       → COMPILE_GATE_PASSED
4. Independent reviews            → code/db/security/refactor/...
5. Review gate                    → REVIEW_GATE_PASSED
6. Doc impact gate                → DOC_IMPACT_ASSESSED
7. Completion gate                → COMPLETION_GATE_PASSED
8. Task DONE                      → summary + commit suggestion
```

If any gate fails, the agent reworks and re-runs from the failed gate.
All gate events are logged to `runtime/task-events/<task-id>.jsonl` with hash-chain integrity.
