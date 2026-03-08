# CHANGELOG

Runtime feature and behavior changes must be logged here.
Process and rule changes may also be logged when they change delivery workflow.

## Entry Template
```text
## YYYY-MM-DD - <short title>
- Task: <task-id>
- Type: feature | behavior-change | api-change | architecture-change
- Scope: <module or service>
- Summary: <what changed>
- Docs Updated: <list of updated doc files>
```

## 2026-03-05 - Agent workflow and quality gates formalized
- Task: T-001, T-002, T-004, T-005
- Type: behavior-change
- Scope: agent process
- Summary: Added hard-stop orchestration, mandatory code/DB review gates, documentation impact gates, and skill catalog.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`

## 2026-03-05 - Security review and artifact traceability extensions
- Task: T-006
- Type: behavior-change
- Scope: agent process
- Summary: Added mandatory security review trigger for auth/payments, blocked reason codes, and standardized review artifact templates.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`

## 2026-03-05 - Refactor review gate and specialist skill added
- Task: T-007
- Type: behavior-change
- Scope: agent process
- Summary: Added mandatory refactor review trigger, full refactor specialist skill package, and artifact contract extensions for refactor verdict tracking.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`

## 2026-03-05 - FAST_PATH/FULL_PATH preflight gates and reviewer minimization
- Task: T-008
- Type: behavior-change
- Scope: agent process
- Summary: Added automated preflight path-mode classification, mandatory review-gate check script, manifest duplicate validator, and rule updates so minor UI changes can skip unnecessary reviewer swarms.
- Docs Updated: `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `TASK.md`; `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`

## 2026-03-08 - Optional specialist-skill expansion and security hardening
- Task: T-009
- Type: behavior-change
- Scope: agent process
- Summary: Added post-init optional specialist-skill flow, live-only skill-builder package, capability-based optional review triggers (`api/test/performance/infra/dependency`), expanded deterministic gate contracts, and strengthened security baseline guidance.
- Docs Updated: `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/60-operating-rules.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`; `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`; `Octopus-agent-orchestrator/live/docs/tasks/TASKS.md`




