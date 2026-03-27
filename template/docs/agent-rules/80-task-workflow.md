# Task Workflow

Primary entry point: selected source-of-truth entrypoint for this workspace.

## Canonical Workflow Source
- Canonical execution flow is defined in:
  - `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`
- Reviewer-agent execution mechanics are defined in `orchestration/SKILL.md` section `Reviewer Agent Execution (Platform-Agnostic)`.
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
  `node Octopus-agent-orchestrator/bin/octopus.js gate classify-change`.

## Depth Contract
- Supported depth values: `1`, `2`, `3`.
- Default depth: `2`.
- Depth never bypasses mandatory gates.
- Depth escalation applies when:
  - preflight returns `FULL_PATH`;
  - preflight requires specialized review (`db`, `security`, `refactor`, or enabled optional specialist review).

## Task Resume Protocol
- Apply this protocol whenever resuming an existing task in `IN_PROGRESS` or `IN_REVIEW`.
- Mandatory resume sequence:
  1. Re-read `AGENTS.md` routing and `00-core.md`.
  2. Re-read orchestration workflow (`live/skills/orchestration/SKILL.md`) and current task row in `TASK.md`.
  3. Re-read existing task evidence (`runtime/reviews/*`, `runtime/task-events/<task-id>.jsonl`) before new changes.
  4. Continue with full mandatory gates; resume never bypasses compile/review/completion gates.
- Final user report contract is mandatory on resume too.

## Mandatory Gate Contract
- Task-mode entry command must pass before preflight or implementation:
  `node Octopus-agent-orchestrator/bin/octopus.js gate enter-task-mode`.
- Task-mode entry must produce `runtime/reviews/<task-id>-task-mode.json` and task-timeline event `TASK_MODE_ENTERED`.
- Preflight artifact must exist before review stage.
- Preflight classification must run with explicit `--output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"`.
- Compile gate command must pass before `IN_REVIEW`:
  `node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate`.
- Compile gate enforces preflight scope freshness; if scope drift is detected, re-run preflight before compile.
- Compile gate invocation must pass `fail_tail_lines` from `live/config/token-economy.json` (fallback `50`) to keep failure-output budget deterministic.
- Compile/review gate output compaction profiles are loaded from `live/config/output-filters.json`; invalid or missing config must warn and fall back to passthrough output instead of inventing filtered summaries.
- Shared gate-output compaction is independent of reviewer-context token economy scope; even with token economy disabled or at the default `depth=3` policy, compile/review gates still use `output-filters.json` and `fail_tail_lines`.
- Required reviews must be launched only from preflight `required_reviews.*`.
- Review gate command must pass before `DONE`:
  `node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check`.
- Review gate command validates compile evidence (`COMPILE_GATE_PASSED`) from task timeline for the same task id.
- Review gate command validates task-mode entry evidence (`TASK_MODE_ENTERED`) for the same task id.
- Review gate command validates no workspace drift after compile evidence; post-compile edits require compile gate rerun.
- Documentation impact gate command must pass before `DONE`:
  `node Octopus-agent-orchestrator/bin/octopus.js gate doc-impact-gate`.
- Completion gate command must pass before `DONE`:
  `node Octopus-agent-orchestrator/bin/octopus.js gate completion-gate`.
- Completion gate validates task-mode entry evidence, compile evidence, review-gate evidence, doc-impact evidence, timeline integrity (`TASK_MODE_ENTERED`, `COMPILE_GATE_PASSED`, review pass evidence, `REWORK_STARTED` after latest `REVIEW_GATE_FAILED`), best-effort task-event hash-chain integrity, required review artifacts, and final findings-resolution state in PASS review artifacts.
- Final PASS review artifacts must keep active `Findings by Severity` and `Residual Risks` empty (`none`). Non-blocking follow-ups may remain only in `Deferred Findings`, and every deferred entry must include `Justification:`.
- Task timeline log must be updated for lifecycle stages and gate outcomes:
  `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Task-event writers must use best-effort append locking for both per-task log and aggregate `all-tasks.jsonl`; do not rely on unsynchronized raw append for concurrent runs.
- Task-event integrity is procedural hardening only: local hash-chain and replay detection help detect tampering after the fact, but they are not a security-grade trust anchor.
- Orchestrator control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, and internal docs such as `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) are local workflow artifacts; in deployed workspaces their ignored status is normal.
- Terminal statuses (`DONE`, `BLOCKED`) require full cleanup of temporary reviewer/specialist logs after required artifacts are persisted.
- Documentation impact updates are required when behavior/contracts/ops docs changed.
- Required changelog or evidence updates to ignored orchestrator paths must stay local on disk; do not use `git add -f` unless the user explicitly requests versioning orchestrator internals.
- Final user report order is mandatory: implementation summary -> `git commit -m "<message>"` suggestion -> `Do you want me to commit now? (yes/no)`.
- At `depth=1` and `depth=2`, the implementation summary must include a token-economy savings line; at `depth=3` it is optional. Include approximate percentage when baseline is known and keep spaced breakdown formatting: `Saved tokens: ~882 (~67%) (824 code review context + 25 DB review context + 33 compile gate output).`
- Reviewer and specialist agents must be closed after verdict capture.
- HARD STOP: do not force-stage ignored orchestration control-plane files just because gates, changelog, or reviews reference them.
- HARD STOP: do not set `DONE` until completion gate is `COMPLETION_GATE_PASSED` and final user report is delivered in mandatory order.
- HARD STOP: do not set `DONE` until completion gate is `COMPLETION_GATE_PASSED`, every review finding is either resolved or explicitly deferred with `Justification:`, and the final user report is delivered in mandatory order.
- If compile command or workflow infra files are hotfixed inside current task, scope is expanded and full re-run is mandatory: preflight -> compile gate -> required reviews gate -> doc impact gate -> completion gate.

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
- Platform mapping: GitHub Copilot CLI must spawn reviewer runs via `task` tool with `agent_type="general-purpose"` (isolated context per reviewer run).
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
