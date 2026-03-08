<!-- Octopus-agent-orchestrator:managed-start -->
# CLAUDE.md
<!-- markdownlint-disable MD040 -->

# Octopus Agent Orchestrator Rule Index

This file can serve as the source of truth for agent workflow rules.
At setup, source of truth is selected via `-SourceOfTruth` (`Claude`, `Codex`, `GitHubCopilot`, `Windsurf`, `Junie`, or `Antigravity`).
Non-selected entrypoint files must only redirect to the selected source-of-truth file.

## How To Use This File
1. Always read `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`.
2. Read only the linked rule files required for the current task.
3. Avoid loading unrelated rule files to save context and tokens.

## Rule Routing
| Task context | File to read |
|---|---|
| Language, communication, code quality | `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md` |
| Project goals and tech stack | `Octopus-agent-orchestrator/live/docs/agent-rules/10-project-context.md` |
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
- [Core Rules](Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md)
- [Project Context](Octopus-agent-orchestrator/live/docs/agent-rules/10-project-context.md)
- [Architecture](Octopus-agent-orchestrator/live/docs/agent-rules/20-architecture.md)
- [Code Style](Octopus-agent-orchestrator/live/docs/agent-rules/30-code-style.md)
- [Strict Coding Rules](Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md)
- [Commands](Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md)
- [Structure and Documentation](Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md)
- [Operating Rules](Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md)
- [Security](Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md)
- [Task Workflow](Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md)
- [Skill Catalog](Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md)
<!-- Octopus-agent-orchestrator:managed-end -->


