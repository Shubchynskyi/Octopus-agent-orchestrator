# Structure and Documentation

Primary entry point: selected source-of-truth entrypoint (`CLAUDE.md` by default template).

## Repository Structure
```text
<ProjectRoot>/
├── CLAUDE.md                     # Claude entrypoint; canonical only when source-of-truth=Claude
├── AGENTS.md                     # Codex entrypoint; canonical only when source-of-truth=Codex (recommended gitignored)
├── TASK.md                       # Task queue for orchestration (recommended gitignored)
├── .antigravity/rules.md         # Platform instruction file (recommended gitignored)
├── .github/copilot-instructions.md
├── .junie/guidelines.md          # Platform instruction file (recommended gitignored)
├── .windsurf/rules/rules.md      # Platform instruction file (recommended gitignored)
└── Octopus-agent-orchestrator/
    ├── template/                 # Immutable deployment template
    ├── live/                     # Active rule and skill set for this project
    │   ├── config/review-capabilities.json # Optional specialist-review capability flags
    │   ├── config/paths.json     # Runtime roots and preflight trigger regexes
    │   ├── docs/agent-rules/**   # Canonical rule set used by selected source-of-truth routing
    │   ├── docs/changes/CHANGELOG.md
    │   ├── docs/reviews/TEMPLATE.md
    │   ├── docs/tasks/TASKS.md
    │   ├── scripts/agent-gates/**# Gate scripts (`.ps1` + `.sh`)
    │   ├── skills/**             # Orchestration and review skills
    │   ├── project-discovery.md  # Auto-detected stack and command signals
    │   ├── init-report.md        # Init execution report
    │   └── source-inventory.md   # Discovered legacy docs and agent files
    ├── runtime/
    │   └── reviews/**            # Generated preflight and review artifacts
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
- `TASK.md` - canonical task list for agent execution workflow.
- `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md` - feature and behavior change log.
- `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md` - canonical review artifact template.
- `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md` - mandatory skill invocation policy.
- `Octopus-agent-orchestrator/live/config/paths.json` - configurable preflight path roots and trigger regexes.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1` - path mode and required review preflight gate.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1` - mandatory post-review gate checker.
- `Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1` - manifest duplicate-entry validator.
- `Octopus-agent-orchestrator/live/project-discovery.md` - auto-detected stack signals and suggested command baselines.
- `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md` - orchestration skill.
- `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md` - optional live-only specialist skill generator and wiring workflow.
- `Octopus-agent-orchestrator/live/skills/code-review/SKILL.md` - code review skill.
- `Octopus-agent-orchestrator/live/skills/db-review/SKILL.md` - DB review skill.
- `Octopus-agent-orchestrator/live/skills/security-review/SKILL.md` - security review skill.
- `Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md` - refactor review skill.


