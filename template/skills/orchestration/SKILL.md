---
name: orchestration
description: Execute a task end-to-end with deterministic gates, preflight classification, depth control, and required independent reviews. Use for requests like "execute task", "run task", "implement task", "finish task T-00X", or "do task N". Do NOT use for standalone specialist review requests without implementation workflow.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(pwsh:*)
  - Edit
  - Write
metadata:
  author: Octopus-agent-orchestrator
  version: 1.3.0
  runtime_requirement: PowerShell 7+ (pwsh) for gate scripts
---

# Orchestration

This file is the canonical execution workflow.
Rule files provide policy context, but lifecycle steps and gate order are defined here.

## Required Inputs
- User request.
- Current task queue: `TASK.md`.
- Active source-of-truth entrypoint (`CLAUDE.md` or configured redirect target).
- Relevant rule files from `Octopus-agent-orchestrator/live/docs/agent-rules/`.

## Execution Depth
- Supported: `depth=1`, `depth=2`, `depth=3`.
- Default: `depth=2`.
- Depth controls context budget and validation thoroughness only.
- Mandatory gates are never optional because of depth.
- Escalation:
  - `FULL_PATH` => minimum `depth=2`
  - required `db/security/refactor` review => minimum `depth=2`
  - high-risk auth/payment/data/infra changes => prefer `depth=3`

## Canonical Workflow
1. Select highest-priority `TODO` task in `TASK.md` and move to `IN_PROGRESS`.
2. If no `TODO` exists, create a task from current user request, then move it to `IN_PROGRESS`.
3. Resolve requested depth and record requested/effective depth in `TASK.md` notes.
4. Build concise plan: scope, files, risks, tests or validation strategy.
5. Run preflight:
   - `classify-change.ps1` with `-ChangedFiles` for precise scope, or
   - `-UseStaged` in dirty workspaces.
6. Apply depth escalation from preflight output when required.
7. Execute implementation path:
   - `FULL_PATH` runtime => tests first, then implementation.
   - non-runtime or `FAST_PATH` runtime => objective validations, then implementation.
8. Run checks for changed scope (or explicitly report pending restricted checks).
9. Move task to `IN_REVIEW`.
10. Run only required independent reviews from preflight:
   - preferred when available: clean-context reviewer agents
   - fallback for single-agent platforms: sequential independent review passes with explicit reviewer role prompt and isolated checklist per pass
   - baseline: `code`, `db`, `security`, `refactor`
   - optional when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`: `api`, `test`, `performance`, `infra`, `dependency`
11. Run `required-reviews-check.ps1` and treat result as release gate.
12. Fix blocking findings and repeat required reviews + gate check until pass.
13. Update required docs and changelog when behavior changed.
14. Record artifacts and evidence in `TASK.md`.
15. Set final status:
   - `DONE` only when all mandatory gates passed.
   - `BLOCKED` when any mandatory gate failed or cannot run.
16. Report to user: implementation summary, depth, path mode, review verdicts, docs updated, commit message suggestion.
17. Close spawned reviewer/specialist agents when platform supports agent lifecycle controls.
18. Never commit unless user explicitly requests commit.

## Escape Hatch Policy (Audited Override)
- Supported only for code review and only for tiny low-risk scopes.
- Command pattern:
  `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 ... -SkipReviews "code" -SkipReason "<reason>"`
- Guardrails enforced by script:
  - only `code` can be skipped,
  - `db/security/refactor` overrides are forbidden,
  - max scope for override: `<=1` changed file and `<=8` changed lines,
  - reason is mandatory and persisted into override artifact.

## Hard Stops
- Do not assign `FAST_PATH` / `FULL_PATH` manually.
- Do not skip preflight classification.
- Do not move to implementation without plan.
- Do not bypass required reviews without deterministic gate override contract.
- Do not set `DONE` without passing `required-reviews-check.ps1`.
- Do not leave reviewer/specialist agents open after review completion (when platform supports agent lifecycle controls).

## Mandatory Outputs
- Updated task row and status transitions in `TASK.md`.
- Preflight artifact: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json`.
- Required review artifacts and verdicts.
- Gate check result (`REVIEW_GATE_PASSED` or `REVIEW_GATE_PASSED_WITH_OVERRIDE`).
- Documentation impact result and updated doc list.
- Final user report.

## Examples
- User: `Execute task T-003 depth=1`
  - Skill resolves task, runs preflight, escalates depth if needed, executes mandatory gates, and reports final state.
- User: `Execute task T-022 depth=2`
  - Skill follows full lifecycle and runs only required specialist reviews from preflight.
- User: `Execute task T-105 depth=1 --skip-review=code --reason="one-line config hotfix"`
  - Skill may use audited override only if gate script allows it for tiny low-risk scope.

## Troubleshooting
- Preflight not found or invalid:
  - Re-run `classify-change.ps1` with explicit `-OutputPath`.
- Required review verdict missing:
  - Re-run missing reviewer and then `required-reviews-check.ps1`.
- Override rejected:
  - Scope is too large or specialized reviews are required; remove override and run full review path.
- Git noise in dirty workspace:
  - Stage task-specific files and run preflight with `-UseStaged`.

