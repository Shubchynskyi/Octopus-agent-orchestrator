---
name: db-review
description: Independent database risk review with strict pass/fail verdict. Use for requests like "DB review", "review migration", "SQL safety check", or when preflight requires db review. Do NOT use for generic code-style-only feedback.
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

# DB Review

Use this skill for independent database risk assessment.
Prioritize correctness, performance, and data safety.

## Required Inputs
- Task goal and expected DB behavior.
- Changed files list and diff.
- Migration files and repository/query changes.
- Relevant rule files:
  - `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`

## Review Workflow
1. Detect DB-impact scope using `references/db-trigger-matrix.md`.
2. Review migrations for safety, rollback implications, and compatibility.
3. Review queries for N+1, full scans, index usage risks, and lock risks.
4. Review transaction boundaries and read/write routing consistency.
5. Review data integrity, constraints, and idempotency implications.
6. Use artifact structure from `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`.
7. Produce final DB verdict.

## Mandatory Output Format
1. Findings by severity with file references.
2. DB checklist rows with `rule_id`, `status` (`PASS` or `FAIL`), `evidence`.
3. Residual DB risks and required follow-up checks.
4. Explicit verdict: `DB REVIEW PASSED` or `DB REVIEW FAILED`.

## Hard Fail Conditions
Return `DB REVIEW FAILED` when any item is true:
- Migration safety risk can cause data loss without mitigation.
- Query path likely causes N+1 or unbounded scan on hot path.
- Required index strategy is missing for critical filter/sort path.
- Transaction semantics are ambiguous or inconsistent with data guarantees.
- Evidence is missing or non-auditable.

## Evidence Rules
- Attach file:line references for each finding.
- For performance claims, provide concrete query path and why risk exists.
- For index recommendations, specify query columns and expected index pattern.

