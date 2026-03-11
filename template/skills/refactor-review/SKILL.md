---
name: refactor-review
description: Independent refactor safety review for behavior-preserving changes with strict pass/fail verdict. Use for requests like "refactor review", "cleanup review", "restructure review", or when preflight requires refactor review. Do NOT use for feature-design discussions without behavior-preservation scope.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(pwsh:*)
  - Write
metadata:
  author: Octopus-agent-orchestrator
  version: 1.3.0
  runtime_requirement: PowerShell 7+ (pwsh) for gate scripts
---

# Refactor Review

Use this skill for independent refactor safety assessment.
Primary goal is behavior preservation with lower maintenance risk.

## Required Inputs
- Task goal and explicit statement that behavior should remain unchanged.
- Changed files list and diff.
- Relevant tests and verification scope.
- Rule context package selected by orchestration and explicitly passed to reviewer:
  - token economy active + `depth=1`: only `00-core.md`, `80-task-workflow.md`, and refactor-triggered rule ids/snippets for changed scope.
  - token economy active + `depth=2`: `00-core.md`, `30-code-style.md`, `35-strict-coding-rules.md`, `50-structure-and-docs.md`, `80-task-workflow.md`.
  - token economy disabled or `depth=3`: full required refactor rule set for changed scope.

## Token Economy Mode
- Config source: `Octopus-agent-orchestrator/live/config/token-economy.json`.
- Apply this section only when `enabled=true` and effective depth is in `enabled_depths`.
- While active, this section takes precedence over any static rule-file list in `Required Inputs`.
- Depth-aware required-rules behavior:
  - `depth=1`: evaluate required refactor rules directly triggered by changed scope first; avoid unrelated rule expansion and full static rule loading.
  - `depth=2`: evaluate the full required refactor checklist for changed scope.
  - other depths: follow full review behavior without token-economy reductions.
- Compact mode contract:
  - when `compact_reviewer_output=true`, keep the same mandatory output sections and exact verdict token.
  - keep findings concise (`risk -> evidence -> required action`) and move detail overflow to residual risks.
  - when including failing command/test snippets, cap pasted tail output to `fail_tail_lines`.

## Review Workflow
1. Detect refactor-impact scope using canonical trigger matrix:
   `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`.
2. Load checklist from `references/refactor-review-checklist.md`.
3. Validate behavior preservation for public contracts and user-visible flows.
4. Validate that refactor reduced complexity or coupling without hidden regressions.
5. Validate test adequacy for refactored paths.
6. Use artifact structure from `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`.
7. Produce final refactor verdict.

## Mandatory Output Format
1. Findings by severity with file references.
2. Refactor checklist rows with `rule_id`, `status` (`PASS` or `FAIL`), `evidence`.
3. Residual risks and potential rollback points.
4. Explicit verdict: `REFACTOR REVIEW PASSED` or `REFACTOR REVIEW FAILED`.

## Hard Fail Conditions
Return `REFACTOR REVIEW FAILED` when any item is true:
- Public contract or behavior changed without explicit requirement update.
- Refactor introduced hidden side effects or regression risk without coverage.
- Refactor increases complexity without clear justification.
- Evidence is missing or non-auditable.

## Evidence Rules
- Use file references with line numbers for findings.
- Link each FAIL to specific behavior or contract risk.
- Include remediation suggestions per blocking finding.

