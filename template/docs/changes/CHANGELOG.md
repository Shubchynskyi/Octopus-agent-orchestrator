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

## 2026-03-11 - Completion gate and resume hard-stop contract
- Task: ad-hoc
- Type: behavior-change
- Scope: orchestration / gate scripts / verification
- Summary: Added completion gate scripts (`completion-gate.ps1` and `.sh`) to enforce final readiness before `DONE`, including timeline integrity checks (`COMPILE_GATE_PASSED`, review pass evidence, rework-after-failure), required review artifact validation, and task-event/metrics emission (`COMPLETION_GATE_PASSED` or `COMPLETION_GATE_FAILED`). Added explicit task resume protocol and hard completion stop in workflow/skill docs, wired completion gate into command catalog and provider bridge contract, and extended contract migrations/verification to enforce these rules on upgrades.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/00-core.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/skills/orchestration/references/stage-gates.md`; `Octopus-agent-orchestrator/scripts/lib/rule-contract-migrations.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/VERSION`; `Octopus-agent-orchestrator/README.md`

## 2026-03-11 - Platform-agnostic reviewer routing and version bump
- Task: ad-hoc
- Type: behavior-change
- Scope: orchestration / provider bridge / release metadata
- Summary: Renamed reviewer execution guidance to platform-agnostic contract, added explicit GitHub Copilot CLI reviewer launch mapping (`task` + `agent_type="general-purpose"`), updated provider bridge managed blocks with the same mapping, fixed stale reviewer verifier snippets for backward compatibility, hardened repo-boundary checks in gate scripts, aligned PowerShell compile gate working directory with shell parity, made `check-update` scripts-directory sync/rollback deterministic, wired orchestration compile invocation to pass token-economy `fail_tail_lines`, and bumped bundle version to `1.0.2`.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/template/skills/orchestration/SKILL.md`; `Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md`; `Octopus-agent-orchestrator/scripts/install.ps1`; `Octopus-agent-orchestrator/scripts/verify.ps1`; `Octopus-agent-orchestrator/scripts/check-update.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/compile-gate.sh`; `Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.ps1`; `Octopus-agent-orchestrator/template/scripts/agent-gates/log-task-event.sh`; `Octopus-agent-orchestrator/VERSION`

## 2026-03-10 - Security, token-economy, and cleanup contracts hardened
- Task: ad-hoc
- Type: behavior-change
- Scope: gates / verification / bundle metadata
- Summary: Enforced token-economy config contract in verification, updated install bridge profiles to re-read token-economy config, added token-economy artifact to manifested live config outputs, hardened compile-gate execution and compact output handling (including Git Bash path pinning on Windows), switched gate telemetry append failures to warning-level visibility, added terminal-task compile-log cleanup with fail-closed behavior, and replaced check-update fallback version comparison with numeric dotted-segment logic.
- Docs Updated: `Octopus-agent-orchestrator/CHANGELOG.md`; `Octopus-agent-orchestrator/MANIFEST.md`; `Octopus-agent-orchestrator/template/docs/changes/CHANGELOG.md`

## 2026-03-10 - Commit guard no longer blocks human IDE commits
- Task: ad-hoc
- Type: behavior-change
- Scope: install / git hooks
- Summary: Updated managed pre-commit guard generation to block only detected agent sessions (with manual override helper) so human commits from IDE/terminal are not blocked.
- Docs Updated: `Octopus-agent-orchestrator/README.md`; `Octopus-agent-orchestrator/HOW_TO.md`; `Octopus-agent-orchestrator/CHANGELOG.md`

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




