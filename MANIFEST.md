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
- live/config/token-economy.json
- live/docs/agent-rules/**
- live/docs/changes/**
- live/docs/reviews/**
- live/docs/tasks/**
- live/scripts/**
- live/skills/**
- live/source-inventory.md
- live/init-report.md
- live/project-discovery.md
- live/version.json

Generated during task execution:
- runtime/reviews/**
- runtime/task-events/**

Generated during updates:
- runtime/update-reports/**
- runtime/bundle-backups/**

Configured when `EnforceNoAutoCommit=true`:
- .git/hooks/pre-commit (managed guard block)

Kept inside bundle:
- Control-plane scripts:
  - canonical implementations: `scripts/*.ps1`
  - compatibility wrappers: `scripts/*.sh` (invoke `pwsh`, not standalone Bash implementations)
- Gate scripts under `live/scripts/agent-gates/*.ps1` and `*.sh` are materialized runtime implementations; `.sh` gate files are real shell variants.
- template/**
- scripts/install.ps1
- scripts/install.sh
- scripts/init.ps1
- scripts/init.sh
- scripts/verify.ps1
- scripts/verify.sh
- scripts/update.ps1
- scripts/update.sh
- scripts/check-update.ps1
- scripts/check-update.sh
- scripts/lib/init-answer-migrations.ps1
- scripts/lib/rule-contract-migrations.ps1
- .gitattributes
- README.md
- CHANGELOG.md
- LICENSE
- AGENT_INIT_PROMPT.md
- MANIFEST.md
- VERSION

