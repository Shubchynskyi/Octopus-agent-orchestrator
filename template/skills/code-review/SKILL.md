---
name: code-review
description: Independent runtime code review with strict pass/fail verdict and auditable evidence. Use for requests like "code review", "review this diff", "review PR", "review before merge", or when preflight requires code review. Do NOT use for architecture brainstorming without concrete code changes.
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

# Code Review

Use this skill to produce a release-blocking technical review.
Review for defects and risks first. Keep summary secondary.

## Required Inputs
- Task goal and expected behavior.
- Changed files list.
- Diff summary or patch.
- Relevant rule files:
  - `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/50-structure-and-docs.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`

## Review Workflow
1. Build scope from changed files and diff.
2. Load checklist from `references/code-review-checklist.md`.
3. Validate correctness, regressions, edge cases, and security impact.
4. Validate test coverage adequacy for changed behavior.
5. Validate documentation impact handling and required doc updates.
6. Validate rule compliance using rule ids and evidence.
7. Use artifact structure from `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`.
8. Produce final verdict.

## Mandatory Output Format
1. Findings by severity with file references.
2. Rule checklist rows with `rule_id`, `status` (`PASS` or `FAIL`), `evidence`.
3. Rule coverage declaration with `applicable_rule_ids`, `not_applicable_rule_ids`, and reason for each skipped rule id.
4. Residual risks and testing gaps.
5. Explicit verdict: `REVIEW PASSED` or `REVIEW FAILED`.

## Hard Fail Conditions
Return `REVIEW FAILED` when any item is true:
- Unresolved critical or high-severity finding exists.
- Required tests are missing for runtime behavior changes.
- Rule checklist has `FAIL` without approved exception artifact.
- Rule checklist or coverage declaration is incomplete for applicable non-automated rules.
- Evidence is missing or non-auditable.

## Evidence Rules
- Use file references with line numbers when possible.
- If referencing command checks, include exact command and key output snippet.
- If exception is used, include the exception artifact location and rule id.

## Escalation
- Escalation triggers are defined only in `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`.
- Do not duplicate trigger rules in this skill.

