# Task Workflow

Primary entry point: [CLAUDE.md](../../../../CLAUDE.md)

## Canonical Workflow Source
- Canonical execution flow is defined in:
  - `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`
- Reviewer-agent execution mechanics are defined in `orchestration/SKILL.md` section `Reviewer Agent Execution (Claude Code)`.
- This file defines lifecycle semantics and hard-stop contracts only.
- Do not maintain parallel step-by-step workflow variants in multiple files.

## Task Lifecycle
- Task queue source: `TASK.md`.
- Status lifecycle: `TODO -> IN_PROGRESS -> IN_REVIEW -> DONE` or `BLOCKED`.
- Visual markers in `TASK.md` status are allowed (`🟦 TODO`, `🟨 IN_PROGRESS`, `🟧 IN_REVIEW`, `🟩 DONE`, `🟥 BLOCKED`), but canonical status token must remain present.
- If provider-native agent directories are present, use their orchestrator bridge profile before any implementation:
  - `.github/agents/orchestrator.md`
  - `.windsurf/agents/orchestrator.md`
  - `.junie/agents/orchestrator.md`
  - `.antigravity/agents/orchestrator.md`
- Provider bridges must refresh skill routing from `90-skill-catalog.md` and `review-capabilities.json`, including specialist skills added after init.
- One task in active execution at a time.
- Path mode values: `FAST_PATH` or `FULL_PATH`.
- Path mode is assigned only by:
  `Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1`.

## Depth Contract
- Supported depth values: `1`, `2`, `3`.
- Default depth: `2`.
- Depth never bypasses mandatory gates.
- Depth escalation applies when:
  - preflight returns `FULL_PATH`;
  - preflight requires specialized review (`db`, `security`, `refactor`, or enabled optional specialist review).

## Mandatory Gate Contract
- Preflight artifact must exist before review stage.
- Required reviews must be launched only from preflight `required_reviews.*`.
- Review gate script must pass before `DONE`:
  `Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1`.
- Task timeline log must be updated for lifecycle stages and gate outcomes:
  `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Documentation impact updates are required when behavior/contracts/ops docs changed.
- Final user report must include commit message suggestion plus explicit commit decision question (`Do you want me to commit now? (yes/no)`).
- Reviewer and specialist agents must be closed after verdict capture.

## Escape Hatch Contract
- Audited skip-review override is allowed only through gate script parameters.
- Current supported override scope:
  - only code review,
  - only tiny low-risk scope,
  - mandatory explicit reason,
  - mandatory override artifact.
- DB, security, and refactor mandatory reviews are never skippable by override.

## Reviewer Independence
- Preferred mode: reviewers are spawned with clean context (`fork_context=false`) when platform supports sub-agents.
- Fallback mode (single-agent platforms): run independent review passes sequentially, each with explicit scope and isolated checklist, before final verdict aggregation.
- Fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewers.
- Reviewer verdict is a release gate, not optional advice.
- Required verdicts:
  - code: `REVIEW PASSED`
  - db: `DB REVIEW PASSED`
  - security: `SECURITY REVIEW PASSED`
  - refactor: `REFACTOR REVIEW PASSED`
  - optional specialist verdicts when enabled and required:
    - api: `API REVIEW PASSED`
    - test: `TEST REVIEW PASSED`
    - performance: `PERFORMANCE REVIEW PASSED`
    - infra: `INFRA REVIEW PASSED`
    - dependency: `DEPENDENCY REVIEW PASSED`

## BLOCKED Semantics
- `BLOCKED` means pipeline is paused; no next stage may start.
- Resume only after explicit blocking condition resolution.
- Record `blocked_reason_code` in `TASK.md`.

