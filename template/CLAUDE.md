<!-- Octopus-agent-orchestrator:managed-start -->
# CLAUDE.md
<!-- markdownlint-disable MD040 -->

# Octopus Agent Orchestrator Rule Index

This file can serve as the source of truth for agent workflow rules.
At setup, source of truth is selected via `-SourceOfTruth` (`Claude`, `Codex`, `Gemini`, `Qwen`, `GitHubCopilot`, `Windsurf`, `Junie`, or `Antigravity`).
Non-selected entrypoint files must only redirect to the selected source-of-truth file.

## How To Use This File
1. Always read `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`.
2. Read only the linked rule files required for the current task.
3. Avoid loading unrelated rule files to save context and tokens.
4. Use compact command protocol from `40-commands.md`: first `scan`, then `inspect`, then verbose `debug` only by exception.

## Hard Stop For Task Execution
- Before implementing any task, open `TASK.md`.
- Before implementing any task, open `.agents/workflows/start-task.md`.
- Do not execute task work until this canonical file and `TASK.md` are both read.
- Treat `.agents/workflows/start-task.md` as the shared start-task router for root entrypoints and provider bridges; it routes to the canonical workflow and does not replace `80-task-workflow.md`.
- Execute tasks only through orchestration workflow (`Execute task <task-id> depth=<1|2|3>`), with preflight and required review gates.
- After opening downstream workflow files (`40-commands.md`, `80-task-workflow.md`, `90-skill-catalog.md`, and any risk-specific rule pack), record them via `node bin/octopus.js gate load-rule-pack ...` in a self-hosted source checkout, or `node Octopus-agent-orchestrator/bin/octopus.js gate load-rule-pack ...` inside a materialized/deployed workspace.
- If provider-native agent directories are available, execute through provider bridge profiles (`.github/agents/orchestrator.md`, `.windsurf/agents/orchestrator.md`, `.junie/agents/orchestrator.md`, `.antigravity/agents/orchestrator.md`).
- Provider bridge profiles must resolve skills from `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md` and `Octopus-agent-orchestrator/live/config/review-capabilities.json` (including skills added after init).

## Rule Routing
| Task context | File to read |
|---|---|
| Language, communication, code quality | `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md` |
| Project goals and tech stack | `Octopus-agent-orchestrator/live/docs/agent-rules/10-project-context.md` |
| Durable project memory summary | `Octopus-agent-orchestrator/live/docs/agent-rules/15-project-memory.md` |
| System architecture and data or event flow | `Octopus-agent-orchestrator/live/docs/agent-rules/20-architecture.md` |
| Java, TypeScript, Angular code style | `Octopus-agent-orchestrator/live/docs/agent-rules/30-code-style.md` |
| Strict SOLID rules and quality gates | `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md` |
| Command policy and available task commands | `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md` |
| Repository structure and documentation map | `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md` |
| Operating workflow rules | `Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md` |
| Security constraints and mandatory controls | `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md` |
| Task lifecycle and independent review process | `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md` |
| Mandatory skill catalog and invocation policy | `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md` |

## Rule Files
- `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/10-project-context.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/15-project-memory.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/20-architecture.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/30-code-style.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`
- `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`
<!-- Octopus-agent-orchestrator:managed-end -->
