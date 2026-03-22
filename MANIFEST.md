# Bundle Manifest

Bundle root: `Octopus-agent-orchestrator`
Template root: `Octopus-agent-orchestrator/template`
Live root: `Octopus-agent-orchestrator/live`

Installed to project root by `node Octopus-agent-orchestrator/bin/octopus.js install`:
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

Materialized inside `Octopus-agent-orchestrator/live` by `node Octopus-agent-orchestrator/bin/octopus.js init`:
- live/config/review-capabilities.json
- live/config/paths.json
- live/config/token-economy.json
- live/config/output-filters.json
- live/docs/agent-rules/**
- live/docs/changes/**
- live/docs/reviews/**
- live/docs/tasks/**
- live/skills/**
- live/source-inventory.md
- live/init-report.md
- live/project-discovery.md
- live/USAGE.md
- live/version.json

Generated during task execution:
- runtime/reviews/**
- runtime/task-events/**

Generated during updates:
- runtime/update-reports/**
- runtime/bundle-backups/**

Removed by `node Octopus-agent-orchestrator/bin/octopus.js uninstall`:
- the deployed `Octopus-agent-orchestrator/` bundle directory
- all redirect entrypoints and provider bridge agent files created by install
- the selected primary entrypoint only when the user chooses delete during uninstall
- `TASK.md` only when the user chooses delete during uninstall
- orchestrator-only entries from `.qwen/settings.json`, `.claude/settings.local.json`, `.git/hooks/pre-commit`, and `.gitignore`, while preserving unrelated user content outside managed blocks
- when runtime artifacts are kept, `Octopus-agent-orchestrator/runtime/**` is copied into `Octopus-agent-orchestrator-uninstall-backups/<timestamp>/Octopus-agent-orchestrator/runtime/` before bundle removal

Configured when `EnforceNoAutoCommit=true`:
- .git/hooks/pre-commit (managed guard block)

Kept inside bundle:
- `package.json` (npm package metadata shipped with the source bundle and synced into deployed workspaces during update)
- `bin/octopus.js` (npm bootstrap/lifecycle/gate CLI; exposes `octopus`, `oao`, and `octopus-agent-orchestrator`)
- `src/**` (canonical Node/TypeScript runtime for lifecycle commands, validators, and gates)
- template/**
- .gitattributes
- README.md
- CHANGELOG.md
- LICENSE
- AGENT_INIT_PROMPT.md
- MANIFEST.md
- VERSION
