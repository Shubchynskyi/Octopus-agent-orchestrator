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
  version: 1.5.0
  runtime_requirement: PowerShell 7+ (pwsh) or Bash + Python 3 for gate scripts
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
   - Log event: `PLAN_CREATED`.
5. Run preflight:
   - `classify-change.ps1` with `-ChangedFiles` for precise scope, or
   - `-UseStaged` in dirty workspaces.
   - environment selection: use `.ps1` via `pwsh` when available, otherwise use `.sh` bash equivalents.
   - `classify-change` writes task-scoped event `PREFLIGHT_CLASSIFIED` automatically.
6. Apply depth escalation from preflight output when required.
7. Execute implementation path:
   - `FULL_PATH` runtime => tests first, then implementation.
   - non-runtime or `FAST_PATH` runtime => objective validations, then implementation.
8. Run checks for changed scope (or explicitly report pending restricted checks).
9. Move task to `IN_REVIEW`.
   - Log event: `REVIEW_PHASE_STARTED`.
10. Run only required independent reviews from preflight:
   - preferred when available: clean-context reviewer agents
   - fallback for single-agent platforms: sequential independent review passes with explicit reviewer role prompt and isolated checklist per pass.
   - fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewer and do not require extra user confirmation to start review passes.
   - baseline: `code`, `db`, `security`, `refactor`
   - optional when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`: `api`, `test`, `performance`, `infra`, `dependency`
   - Log event per reviewer invocation: `REVIEW_REQUESTED`.
11. Run `required-reviews-check.ps1` and treat result as release gate.
   - `required-reviews-check` writes task-scoped event `REVIEW_GATE_PASSED` or `REVIEW_GATE_FAILED` automatically.
12. Fix blocking findings and repeat required reviews + gate check until pass.
   - On failed gate and return to coding, log event: `REWORK_STARTED`.
13. Update required docs and changelog when behavior changed.
14. Record artifacts and evidence in `TASK.md`.
15. Set final status:
   - `DONE` only when all mandatory gates passed.
   - `BLOCKED` when any mandatory gate failed or cannot run.
   - Log terminal event: `TASK_DONE` or `TASK_BLOCKED`.
16. Report to user: implementation summary, depth, path mode, review verdicts, docs updated, and commit message suggestion.
    - Always ask explicit follow-up question: `Do you want me to commit now? (yes/no)`.
17. Close spawned reviewer/specialist agents when platform supports agent lifecycle controls.
18. Never commit unless user explicitly requests commit.

## Reviewer Agent Execution (Claude Code)
- Apply this section when platform supports Agent tool/sub-agents.
- For each required review where preflight `required_reviews.<type>=true`:
  1. Launch reviewer via Agent tool using clean context (`fork_context=false`).
  2. Prompt must include:
     - task id and task goal;
     - changed files list from preflight artifact;
     - diff summary (or exact staged diff if available);
     - mandatory skill path for this review type;
     - required output contract:
       - verdict token (`... PASSED` or `... FAILED`);
       - findings list with file evidence;
       - review artifact write path: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>.md`.
  3. Parse verdict token from reviewer output.
  4. If verdict is failed, fix findings and rerun the same reviewer until pass.
- Reviewer mapping contract:
  - `required_reviews.code=true` => skill `Octopus-agent-orchestrator/live/skills/code-review/SKILL.md` => pass token `REVIEW PASSED` => gate parameter `-CodeReviewVerdict`
  - `required_reviews.db=true` => skill `Octopus-agent-orchestrator/live/skills/db-review/SKILL.md` => pass token `DB REVIEW PASSED` => gate parameter `-DbReviewVerdict`
  - `required_reviews.security=true` => skill `Octopus-agent-orchestrator/live/skills/security-review/SKILL.md` => pass token `SECURITY REVIEW PASSED` => gate parameter `-SecurityReviewVerdict`
  - `required_reviews.refactor=true` => skill `Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md` => pass token `REFACTOR REVIEW PASSED` => gate parameter `-RefactorReviewVerdict`
  - `required_reviews.api=true` => skill `Octopus-agent-orchestrator/live/skills/api-review/SKILL.md` => pass token `API REVIEW PASSED` => gate parameter `-ApiReviewVerdict`
  - `required_reviews.test=true` => skill `Octopus-agent-orchestrator/live/skills/test-review/SKILL.md` => pass token `TEST REVIEW PASSED` => gate parameter `-TestReviewVerdict`
  - `required_reviews.performance=true` => skill `Octopus-agent-orchestrator/live/skills/performance-review/SKILL.md` => pass token `PERFORMANCE REVIEW PASSED` => gate parameter `-PerformanceReviewVerdict`
  - `required_reviews.infra=true` => skill `Octopus-agent-orchestrator/live/skills/infra-review/SKILL.md` => pass token `INFRA REVIEW PASSED` => gate parameter `-InfraReviewVerdict`
  - `required_reviews.dependency=true` => skill `Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md` => pass token `DEPENDENCY REVIEW PASSED` => gate parameter `-DependencyReviewVerdict`
- After all required verdicts are collected, run gate script with all verdict parameters:
  - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "<path>" -TaskId "<task-id>" -CodeReviewVerdict "<...>" -DbReviewVerdict "<...>" -SecurityReviewVerdict "<...>" -RefactorReviewVerdict "<...>" -ApiReviewVerdict "<...>" -TestReviewVerdict "<...>" -PerformanceReviewVerdict "<...>" -InfraReviewVerdict "<...>" -DependencyReviewVerdict "<...>"`
  - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "<path>" --task-id "<task-id>" --code-review-verdict "<...>" --db-review-verdict "<...>" --security-review-verdict "<...>" --refactor-review-verdict "<...>" --api-review-verdict "<...>" --test-review-verdict "<...>" --performance-review-verdict "<...>" --infra-review-verdict "<...>" --dependency-review-verdict "<...>"`
- In single-agent fallback mode (no Agent tool), run the same review scopes sequentially with explicit role prompts and use the same verdict tokens and artifact contract.

## Task Event Logging Commands
- PowerShell:
  `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1 -TaskId "<task-id>" -EventType "<event-type>" -Outcome "INFO|PASS|FAIL|BLOCKED" -Message "<short message>" -Actor "orchestrator"`
- Bash:
  `bash Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh --task-id "<task-id>" --event-type "<event-type>" --outcome "INFO|PASS|FAIL|BLOCKED" --message "<short message>" --actor "orchestrator"`
- Task event logs:
  - `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`
  - `Octopus-agent-orchestrator/runtime/task-events/all-tasks.jsonl`
- Human-readable summary:
  - `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "<task-id>"`

## Escape Hatch Policy (Audited Override)
- Supported only for code review and only for tiny low-risk scopes.
- Command pattern:
  `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 ... -SkipReviews "code" -SkipReason "<reason>"`
- Bash equivalent:
  `bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "<path>" --code-review-verdict "SKIPPED_BY_OVERRIDE" --skip-reviews "code" --skip-reason "<reason>"`
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
- Do not skip explicit final user prompt about commit decision after reporting commit message suggestion.
- Do not leave reviewer/specialist agents open after review completion (when platform supports agent lifecycle controls).

## Mandatory Outputs
- Updated task row and status transitions in `TASK.md`.
- Preflight artifact: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json`.
- Required review artifacts and verdicts.
- Gate check result (`REVIEW_GATE_PASSED` or `REVIEW_GATE_PASSED_WITH_OVERRIDE`).
- Task event trace: `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Optional timeline summary for final report: `task-events-summary.ps1` output.
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

