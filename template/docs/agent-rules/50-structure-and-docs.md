# Structure and Documentation

Primary entry point: selected source-of-truth entrypoint (`CLAUDE.md` by default template).

## Repository Structure
```text
<ProjectRoot>/
├── CLAUDE.md                     # Claude entrypoint; canonical only when source-of-truth=Claude
├── AGENTS.md                     # Codex entrypoint; canonical only when source-of-truth=Codex (recommended gitignore)
├── GEMINI.md                     # Gemini entrypoint; canonical only when source-of-truth=Gemini
├── .claude/settings.local.json   # Optional (when ClaudeOrchestratorFullAccess=true): Claude Code local permission allowlist for orchestrator scripts
├── .qwen/settings.json           # Qwen context bootstrap (`AGENTS.md` + `TASK.md`)
├── TASK.md                       # Task queue for orchestration (recommended gitignore)
├── .antigravity/rules.md         # Platform instruction file (recommended gitignore)
├── .github/copilot-instructions.md
├── .github/agents/orchestrator.md # GitHub Agents orchestration profile
├── .github/agents/reviewer.md     # GitHub generic review bridge profile
├── .github/agents/code-review.md  # GitHub code-review bridge profile
├── .github/agents/db-review.md    # GitHub DB-review bridge profile
├── .github/agents/security-review.md # GitHub security-review bridge profile
├── .github/agents/refactor-review.md # GitHub refactor-review bridge profile
├── .github/agents/api-review.md   # GitHub optional API-review bridge profile
├── .github/agents/test-review.md  # GitHub optional test-review bridge profile
├── .github/agents/performance-review.md # GitHub optional performance-review bridge profile
├── .github/agents/infra-review.md # GitHub optional infra-review bridge profile
├── .github/agents/dependency-review.md # GitHub optional dependency-review bridge profile
├── .junie/guidelines.md          # Platform instruction file (recommended gitignore)
├── .junie/agents/orchestrator.md # Junie agent bridge profile
├── .windsurf/rules/rules.md      # Platform instruction file (recommended gitignore)
├── .windsurf/agents/orchestrator.md # Windsurf agent bridge profile
├── .antigravity/agents/orchestrator.md # Antigravity agent bridge profile
└── Octopus-agent-orchestrator/
    ├── template/                 # Immutable deployment template
    ├── live/                     # Active rule and skill set for this project
    │   ├── config/review-capabilities.json # Optional specialist-review capability flags
    │   ├── config/paths.json     # Runtime roots and preflight trigger regexes
    │   ├── config/output-filters.json # Shared gate-output filter profiles
    │   ├── docs/agent-rules/**   # Canonical rule set used by selected source-of-truth routing
    │   ├── docs/changes/CHANGELOG.md
    │   ├── docs/reviews/TEMPLATE.md
    │   ├── docs/tasks/TASKS.md
    │   ├── scripts/agent-gates/** # Gate scripts (`.ps1` + `.sh`)
    │   ├── skills/**             # Orchestration and review skills
    │   ├── USAGE.md              # Post-init usage instructions for the selected assistant language
    │   ├── project-discovery.md  # Auto-detected stack and command signals
    │   ├── init-report.md        # Init execution report
    │   └── source-inventory.md   # Discovered legacy docs and agent files
    ├── runtime/
    │   ├── reviews/**            # Generated preflight and review artifacts
    │   └── task-events/**        # Task timeline logs by task id
    ├── scripts/install.ps1       # Installer + init trigger
    ├── scripts/init.ps1          # Context materialization into live/
    ├── scripts/verify.ps1        # Verification script
    ├── MANIFEST.md               # Bundle manifest
    └── AGENT_INIT_PROMPT.md      # Single prompt for setup agent
```

## Core Documents
- Source-of-truth entrypoint file (selected at install): canonical routing index for agent rules.
- `CLAUDE.md` - Claude entrypoint (canonical only when selected).
- `AGENTS.md` - Codex entrypoint (canonical only when selected).
- `GEMINI.md` - Gemini entrypoint (canonical only when selected).
- `.claude/settings.local.json` - optional (when `ClaudeOrchestratorFullAccess=true`): Claude Code local permission allowlist for orchestrator scripts.
- `.qwen/settings.json` - Qwen context bootstrap (loads `AGENTS.md` and `TASK.md`).
- `TASK.md` - canonical task list for agent execution workflow.
- `.github/agents/orchestrator.md` - mandatory orchestration profile for GitHub Agents task execution.
- `.github/agents/reviewer.md` and `.github/agents/*-review.md` - GitHub review-profile bridges to canonical `live/skills/*`.
- `.github/agents/api-review.md`, `.github/agents/test-review.md`, `.github/agents/performance-review.md`, `.github/agents/infra-review.md`, `.github/agents/dependency-review.md` - optional specialist bridges (enabled by capability flags).
- `.windsurf/agents/orchestrator.md` - Windsurf orchestrator bridge profile.
- `.junie/agents/orchestrator.md` - Junie orchestrator bridge profile.
- `.antigravity/agents/orchestrator.md` - Antigravity orchestrator bridge profile.
- `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md` - feature and behavior change log.
- `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md` - canonical review artifact template.
- `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md` - mandatory skill invocation policy.
- `Octopus-agent-orchestrator/live/config/paths.json` - configurable preflight path roots and trigger regexes.
- `Octopus-agent-orchestrator/live/config/output-filters.json` - shared compile/review output filter profiles for gate compaction.
- `Octopus-agent-orchestrator/live/USAGE.md` - post-init usage instructions rendered in the selected assistant language.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1` / `.sh` - path mode and required review preflight gate.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1` / `.sh` - mandatory compile gate before review phase.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1` / `.sh` - mandatory post-review gate checker.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1` / `.sh` - task timeline event logger by task id.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1` / `.sh` - human-readable task timeline summary by task id.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1` / `.sh` - reviewer scoped-diff artifact builder with fallback metadata.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1` / `.sh` - reviewer context artifact builder for token economy rule-pack selection.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1` / `.sh` - manifest duplicate-entry validator.
- `Octopus-agent-orchestrator/live/project-discovery.md` - auto-detected stack signals and suggested command baselines.
- `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md` - orchestration skill.
- `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md` - optional live-only specialist skill generator and wiring workflow.
- `Octopus-agent-orchestrator/live/skills/code-review/SKILL.md` - code review skill.
- `Octopus-agent-orchestrator/live/skills/db-review/SKILL.md` - DB review skill.
- `Octopus-agent-orchestrator/live/skills/security-review/SKILL.md` - security review skill.
- `Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md` - refactor review skill.

## Orchestrator Git Boundary
- In normal project deployments, local orchestration control-plane files are expected to stay gitignored.
- This includes `TASK.md`, installer-managed provider bridge files, `Octopus-agent-orchestrator/runtime/**`, and internal orchestrator docs such as `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`.
- Their absence from `git status`, staged diff, or PR scope is normal and must not be treated as a workflow failure.
- Only stage or version these paths when the user explicitly requests orchestrator-source changes or the current repository is the orchestrator bundle source itself.
