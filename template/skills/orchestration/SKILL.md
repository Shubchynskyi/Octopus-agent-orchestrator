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
  version: 1.6.2
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
- Token economy config: `Octopus-agent-orchestrator/live/config/token-economy.json`.

## Execution Depth
- Supported: `depth=1`, `depth=2`, `depth=3`.
- Default: `depth=2`.
- Depth controls context budget and validation thoroughness only.
- Mandatory gates are never optional because of depth.
- Escalation:
  - `FULL_PATH` => minimum `depth=2`
  - required `db/security/refactor` review => minimum `depth=2`
  - high-risk auth/payment/data/infra changes => prefer `depth=3`

## Token Economy
- Config source: `Octopus-agent-orchestrator/live/config/token-economy.json`.
- Activate only when `enabled=true` and effective depth is in `enabled_depths`.
- Recommendation: use `enabled=true` with `depth=1` only for small, well-localized tasks; prefer `depth=2` or `depth=3` when correctness depends on broader context.
- Depth-aware reviewer context loading when active:
  - `depth=1`: load task goal, changed files, required review flags, and minimal diff context only.
  - `depth=2`: load `depth=1` context plus required checklists and only relevant rule sections.
  - other depths: use full reviewer context.
- Depth-aware reviewer rule-pack contract when active:
  - `code` reviewer:
    - `depth=1`: `00-core.md`, `80-task-workflow.md`, plus rule ids/snippets directly triggered by changed scope.
    - `depth=2`: `00-core.md`, `35-strict-coding-rules.md`, `50-structure-and-docs.md`, `70-security.md`, `80-task-workflow.md`.
  - `db` reviewer:
    - `depth=1`: `00-core.md`, `80-task-workflow.md`, plus DB-triggered rule ids/snippets.
    - `depth=2`: `00-core.md`, `35-strict-coding-rules.md`, `70-security.md`, `80-task-workflow.md`.
  - `security` reviewer:
    - `depth=1`: `00-core.md`, `80-task-workflow.md`, plus security-triggered rule ids/snippets.
    - `depth=2`: `00-core.md`, `35-strict-coding-rules.md`, `70-security.md`, `80-task-workflow.md`.
  - `refactor` reviewer:
    - `depth=1`: `00-core.md`, `80-task-workflow.md`, plus refactor-triggered rule ids/snippets.
    - `depth=2`: `00-core.md`, `30-code-style.md`, `35-strict-coding-rules.md`, `50-structure-and-docs.md`, `80-task-workflow.md`.
  - `depth=3` or token economy disabled: full reviewer rule packs.
- Context trimming when active:
  - `strip_examples=true`: remove examples from loaded review/rule context.
  - `strip_code_blocks=true`: remove code blocks from loaded review/rule context.
- Scoped diff contract when active:
  - if `scoped_diffs=true` and reviewer type is `db` or `security`, generate scoped artifact before reviewer launch:
    - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1 -ReviewType "<db|security>" -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" -MetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"`
    - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh --review-type "<db|security>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"`
  - helper resolves trigger regexes from `Octopus-agent-orchestrator/live/config/paths.json` `triggers.<review-type>`.
  - if helper reports `fallback_to_full_diff=true`, pass full diff to reviewer and continue required review.
- Review-context artifact contract when active:
  - generate reviewer context artifact before reviewer launch:
    - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1 -ReviewType "<review-type>" -Depth "<1|2|3>" -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -ScopedDiffMetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"`
    - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh --review-type "<review-type>" --depth "<1|2|3>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"`
  - artifact must record selected rule pack, omitted sections, `deferred_by_depth` reason when applicable, and scoped-diff fallback evidence.
- Compact reviewer output contract when active:
  - if `compact_reviewer_output=true`, require compact reviewer artifacts but keep mandatory sections and exact verdict tokens.
  - on failed command/test evidence, cap pasted tail output to `fail_tail_lines`.

## Task Resume Protocol
- When resuming a task already in `IN_PROGRESS` or `IN_REVIEW`, treat resume as full orchestration execution.
- Mandatory resume sequence:
  1. Re-read `AGENTS.md` routing, `00-core.md`, and this orchestration skill before any edits.
  2. Re-open current task row in `TASK.md` and latest artifacts in `runtime/reviews/` plus timeline `runtime/task-events/<task-id>.jsonl`.
  3. Continue from current stage, but do not skip compile/review/completion gates.
  4. Final report contract remains mandatory on resume: summary -> commit command -> explicit commit question.

## Canonical Workflow
1. Select highest-priority `TODO` task in `TASK.md` and move to `IN_PROGRESS`.
2. If no `TODO` exists, create a task from current user request, then move it to `IN_PROGRESS`.
3. Resolve requested depth and record requested/effective depth in `TASK.md` notes.
4. Build concise plan: scope, files, risks, tests or validation strategy.
   - Log event: `PLAN_CREATED`.
5. Run preflight with explicit `-OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"`:
   - `classify-change.ps1` with `-ChangedFiles` for precise scope, or
   - `-UseStaged` in dirty workspaces.
   - environment selection: use `.ps1` via `pwsh` when available, otherwise use `.sh` bash equivalents.
   - `classify-change` writes task-scoped event `PREFLIGHT_CLASSIFIED` automatically.
6. Apply depth escalation from preflight output when required.
7. Execute implementation path:
   - `FULL_PATH` runtime => tests first, then implementation.
   - non-runtime or `FAST_PATH` runtime => objective validations, then implementation.
8. Run compile gate (mandatory) before review phase:
   - Resolve `fail_tail_lines` from `Octopus-agent-orchestrator/live/config/token-economy.json`; when missing/invalid, fallback to `50`.
   - Gate output filter profiles are loaded from `Octopus-agent-orchestrator/live/config/output-filters.json`; invalid config must warn and fall back to passthrough output.
   - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1 -TaskId "<task-id>" -CommandsPath "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md" -FailTailLines "<fail_tail_lines>"`
   - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md" --fail-tail-lines "<fail_tail_lines>"`
   - Compile gate writes task-scoped event `COMPILE_GATE_PASSED` or `COMPILE_GATE_FAILED` automatically.
   - Compile gate is strict about preflight scope freshness and fails on scope drift; rerun preflight when scope changes.
   - On failure, do not move to review phase; fix and rerun until pass.
9. Move task to `IN_REVIEW`.
   - Log event: `REVIEW_PHASE_STARTED`.
10. Run only required independent reviews from preflight:
    - preferred when available: clean-context reviewer agents
    - fallback for single-agent platforms: sequential independent review passes with explicit reviewer role prompt and isolated checklist per pass.
    - fallback self-review is mandatory and immediate on single-agent platforms; do not wait for external reviewer and do not require extra user confirmation to start review passes.
    - baseline: `code`, `db`, `security`, `refactor`
    - optional when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`: `api`, `test`, `performance`, `infra`, `dependency`
    - when token economy mode is active, generate review-context artifact and attach it to reviewer prompt.
    - when `scoped_diffs=true` and required reviewer is `db` or `security`, run scoped diff helper and attach scoped artifact path plus scoped metadata fallback flag to reviewer prompt.
    - Log event per reviewer invocation: `REVIEW_REQUESTED`.
11. Run `required-reviews-check.ps1` and treat result as release gate.
   - `required-reviews-check` writes task-scoped event `REVIEW_GATE_PASSED` or `REVIEW_GATE_FAILED` automatically.
   - `required-reviews-check` fails if compile evidence is missing in `runtime/task-events/<task-id>.jsonl` (missing `COMPILE_GATE_PASSED`).
   - `required-reviews-check` fails if workspace changed after compile evidence; rerun compile gate after post-compile edits.
12. Fix blocking findings and repeat required reviews + gate check until pass.
   - On failed gate and return to coding, log event: `REWORK_STARTED`.
13. Run doc impact gate before completion:
   - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -Decision "<NO_DOC_UPDATES|DOCS_UPDATED>" -BehaviorChanged "<true|false>" -ChangelogUpdated "<true|false>" -Rationale "<why>"`
   - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "<NO_DOC_UPDATES|DOCS_UPDATED>" --behavior-changed "<true|false>" --changelog-updated "<true|false>" --rationale "<why>"`
   - Doc impact gate writes task-scoped event `DOC_IMPACT_ASSESSED` or `DOC_IMPACT_ASSESSMENT_FAILED`.
14. Run completion gate and treat result as final readiness gate before `DONE`.
   - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"`
   - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"`
   - Completion gate writes task-scoped event `COMPLETION_GATE_PASSED` or `COMPLETION_GATE_FAILED` automatically.
15. Update required docs and changelog when behavior changed.
   - Internal orchestration artifacts (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) may remain gitignored in deployed workspaces; update them on disk but do not `git add -f` them unless the user explicitly asks to version orchestrator internals.
16. Record artifacts and evidence in `TASK.md`.
17. Set final status:
   - `DONE` only when compile gate, required review gate, doc impact gate, and completion gate passed.
   - `BLOCKED` when any mandatory gate failed or cannot run.
   - Log terminal event: `TASK_DONE` or `TASK_BLOCKED`.
18. Report to user in exact order:
    1. implementation summary (include depth, path mode, review verdicts, docs updated)
    2. commit suggestion as exact command form: `git commit -m "<message>"`
    3. explicit follow-up question: `Do you want me to commit now? (yes/no)`
19. Close spawned reviewer/specialist agents when platform supports agent lifecycle controls.
20. Never commit unless user explicitly requests commit.

## Reviewer Agent Execution (Platform-Agnostic)
- Apply this section on every platform.
- Preferred mode is always clean-context reviewer execution.
- Do not use provider-default reviewer agents that bypass this contract.
- Platform launch mapping:
  - Claude Code: use Agent tool/sub-agents with `fork_context=false`.
  - GitHub Copilot CLI: use `task` tool with `agent_type="general-purpose"`; run one reviewer per isolated task execution.
  - Platforms without task/sub-agent support: use sequential single-agent fallback with explicit reviewer role prompts and isolated checklists.
- For each required review where preflight `required_reviews.<type>=true`:
  1. Launch reviewer using the platform mapping above with clean context isolation.
  2. Prompt must include:
     - task id and task goal;
     - changed files list from preflight artifact;
     - diff summary (or exact staged diff if available);
     - mandatory skill path for this review type;
     - explicit rule-context package paths selected for this reviewer/depth (do not include non-selected rule files while token economy mode is active);
     - review-context artifact path (`Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json`) when token economy mode is active;
     - token economy flags when active (`depth`, `compact_reviewer_output`, `strip_examples`, `strip_code_blocks`);
     - for `db` / `security` required reviews when scoped diffs are enabled: scoped artifact produced by `build-scoped-diff.ps1/.sh`, with scoped metadata artifact and full-diff fallback when helper reports empty scope;
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
- After review gate pass, run doc impact gate:
  - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1 -PreflightPath "<path>" -TaskId "<task-id>" -Decision "<NO_DOC_UPDATES|DOCS_UPDATED>" -BehaviorChanged "<true|false>" -ChangelogUpdated "<true|false>" -Rationale "<why>"`
  - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "<path>" --task-id "<task-id>" --decision "<NO_DOC_UPDATES|DOCS_UPDATED>" --behavior-changed "<true|false>" --changelog-updated "<true|false>" --rationale "<why>"`
- After review gate pass, run completion gate before `DONE`:
  - PowerShell: `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1 -PreflightPath "<path>" -TaskId "<task-id>"`
  - Bash: `bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "<path>" --task-id "<task-id>"`
- In single-agent fallback mode (no Agent tool), run the same review scopes sequentially with explicit role prompts and use the same verdict tokens and artifact contract.

## Task Event Logging Commands
- PowerShell:
  `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1 -TaskId "<task-id>" -EventType "<event-type>" -Outcome "INFO|PASS|FAIL|BLOCKED" -Message "<short message>" -Actor "orchestrator"`
- Bash:
  `bash Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh --task-id "<task-id>" --event-type "<event-type>" --outcome "INFO|PASS|FAIL|BLOCKED" --message "<short message>" --actor "orchestrator"`
- Task event logs:
  - `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`
  - `Octopus-agent-orchestrator/runtime/task-events/all-tasks.jsonl`
- New task-event writes add best-effort append locking and per-task integrity metadata (`integrity.task_sequence`, `prev_event_sha256`, `event_sha256`).
- Terminal events `TASK_DONE` and `TASK_BLOCKED` trigger full log cleanup for temporary reviewer/specialist logs after required artifacts are persisted.
- Human-readable summary:
  - `pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "<task-id>"`
  - `bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"`

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
- Do not skip preflight classification with explicit `-OutputPath`.
- Do not move to implementation without plan.
- Do not move to `IN_REVIEW` without passing compile gate (`COMPILE_GATE_PASSED`).
- Do not bypass required reviews without deterministic gate override contract.
- Do not set `DONE` without passing compile gate, `required-reviews-check.ps1`, `doc-impact-gate.ps1`, and `completion-gate.ps1`.
- Do not continue after compile/review when scope changed; rerun preflight and full mandatory gates.
- Do not use `git add -f` to stage ignored orchestration control-plane files just because gates or changelog rules mention them.
- Do not change final report order: summary -> `git commit -m` suggestion -> `Do you want me to commit now? (yes/no)`.
- Do not leave reviewer/specialist agents open after review completion (when platform supports agent lifecycle controls).

## Mandatory Outputs
- Updated task row and status transitions in `TASK.md`.
- Preflight artifact: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json`.
- Compile gate result: `COMPILE_GATE_PASSED`.
- Compile gate evidence: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-compile-gate.json`.
- Required review artifacts and verdicts.
- Gate check result (`REVIEW_GATE_PASSED` or `REVIEW_GATE_PASSED_WITH_OVERRIDE`).
- Review gate evidence: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-review-gate.json`.
- Documentation impact gate result and artifact: `DOC_IMPACT_ASSESSED` + `Octopus-agent-orchestrator/runtime/reviews/<task-id>-doc-impact.json`.
- Completion gate result (`COMPLETION_GATE_PASSED`).
- Task event trace: `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Optional timeline summary for final report: `task-events-summary.ps1` / `.sh` output.
- Optional review-context artifact for token economy mode: `build-review-context.ps1` / `.sh` output.
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
- Completion gate failed:
  - Resolve listed timeline/artifact/integrity violations, then rerun `completion-gate.ps1` / `.sh`.
- Compile gate failed:
  - Fix compile errors and rerun `compile-gate.ps1` / `.sh` until `COMPILE_GATE_PASSED`.
- Compile gate failed with preflight scope drift:
  - Re-run `classify-change.ps1/.sh` for current scope, then rerun compile and review gates.
- Doc impact gate failed:
  - Fix doc-impact decision/rationale/changelog flags and rerun `doc-impact-gate.ps1` / `.sh`.
- Override rejected:
  - Scope is too large or specialized reviews are required; remove override and run full review path.
- Git noise in dirty workspace:
  - Stage task-specific project files and run preflight with `-UseStaged`.
  - Ignored orchestration control-plane files should stay unstaged unless the user explicitly asks to version them.
