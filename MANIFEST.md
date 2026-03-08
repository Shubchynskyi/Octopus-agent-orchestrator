# Bundle Manifest

Bundle root: `Octopus-agent-orchestrator`
Template root: `Octopus-agent-orchestrator/template`
Live root: `Octopus-agent-orchestrator/live`

Installed to project root by `scripts/install.ps1`:
- CLAUDE.md
- AGENTS.md
- TASK.md
- .antigravity/rules.md
- .github/copilot-instructions.md
- .junie/guidelines.md
- .windsurf/rules/rules.md

Materialized inside `Octopus-agent-orchestrator/live` by `scripts/init.ps1`:
- live/config/review-capabilities.json
- live/config/paths.json
- live/docs/agent-rules/**
- live/docs/changes/**
- live/docs/reviews/**
- live/docs/tasks/**
- live/scripts/**
- live/skills/**
- live/source-inventory.md
- live/init-report.md
- live/project-discovery.md

Kept inside bundle:
- template/**
- scripts/install.ps1
- scripts/init.ps1
- scripts/verify.ps1
- README.md
- AGENT_INIT_PROMPT.md
- MANIFEST.md

