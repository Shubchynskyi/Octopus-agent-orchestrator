---
name: security-review
description: Independent security risk review with strict pass/fail verdict. Use for requests like "security review", "auth review", "webhook hardening", "secret handling review", or when preflight requires security review. Do NOT use for non-security product design discussions.
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

# Security Review

Use this skill for independent security risk assessment.
Prioritize exploitability, authorization integrity, and payment safety.

## Required Inputs
- Task goal and expected secure behavior.
- Changed files list and diff.
- Auth, payment, webhook, and secret-related code changes.
- Relevant rule files:
  - `Octopus-agent-orchestrator/live/docs/agent-rules/70-security.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md`
  - `Octopus-agent-orchestrator/live/docs/agent-rules/35-strict-coding-rules.md`

## Review Workflow
1. Detect security-impact scope using canonical trigger matrix:
   `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`.
2. Validate authentication and token validation flows.
3. Validate authorization checks at service boundaries.
4. Validate payment authorization, webhook authenticity, and idempotency controls.
5. Validate secret handling and sensitive data exposure risks.
6. Use artifact structure from `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`.
7. Produce final security verdict.

## Mandatory Output Format
1. Findings by severity with file references.
2. Security checklist rows with `rule_id`, `status` (`PASS` or `FAIL`), `evidence`.
3. Residual risks and follow-up mitigations.
4. Explicit verdict: `SECURITY REVIEW PASSED` or `SECURITY REVIEW FAILED`.

## Hard Fail Conditions
Return `SECURITY REVIEW FAILED` when any item is true:
- Missing or bypassable authorization checks for protected operations.
- Insecure token validation path or trust boundary violation.
- Payment or webhook flow allows replay, forgery, or unauthorized capture.
- Secrets are hardcoded, logged, or otherwise exposed.
- Evidence is missing or non-auditable.

## Evidence Rules
- Use file references with line numbers for each finding.
- Include concrete exploit path or abuse scenario for high-risk findings.
- Include required remediation action per finding.

