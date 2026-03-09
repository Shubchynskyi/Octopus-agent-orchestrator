# Bundle Manifest

Bundle root: `Octopus-agent-orchestrator`
Template root: `Octopus-agent-orchestrator/template`
Live root: `Octopus-agent-orchestrator/live`

Installed to project root by `scripts/install.ps1`:
- CLAUDE.md
- AGENTS.md
- GEMINI.md
- .qwen/settings.json
- TASK.md
- .antigravity/rules.md
- .github/agents/orchestrator.md
- .github/agents/reviewer.md
- .github/agents/code-review.md
- .github/agents/db-review.md
- .github/agents/security-review.md
- .github/agents/refactor-review.md
- .github/agents/api-review.md
- .github/agents/test-review.md
- .github/agents/performance-review.md
- .github/agents/infra-review.md
- .github/agents/dependency-review.md
- .github/copilot-instructions.md
- .junie/guidelines.md
- .junie/agents/orchestrator.md
- .windsurf/rules/rules.md
- .windsurf/agents/orchestrator.md
- .antigravity/agents/orchestrator.md

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

Generated during task execution:
- runtime/reviews/**
- runtime/task-events/**

Kept inside bundle:
- template/**
- scripts/install.ps1
- scripts/install.sh
- scripts/init.ps1
- scripts/init.sh
- scripts/verify.ps1
- scripts/verify.sh
- README.md
- LICENSE
- AGENT_INIT_PROMPT.md
- MANIFEST.md

