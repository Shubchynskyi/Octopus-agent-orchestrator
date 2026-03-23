---
name: security-hardening
description: Domain pack for security-focused implementation and hardening work. Use for auth, secrets, input validation, dependency risk, and attack-surface reduction.
license: MIT
metadata:
  domain: security
  triggers: auth, authentication, authorization, secrets, OWASP, hardening, threat model, dependency risk, security patch
  role: specialist
  scope: review-and-implementation
  output-format: review
  related-skills: orchestration, security-review, dependency-review
---

# Security Hardening

## Core Workflow

1. Confirm the trust boundary, threat surface, and canonical validation commands before editing.
2. Review authentication, authorization, secret handling, and unsafe input paths first.
3. Minimize attack surface: least privilege, explicit validation, deterministic failure modes, no secret leakage.
4. Treat dependency changes, policy changes, and externally reachable behavior as high-risk.
5. Run all relevant test/build/security validation commands from `40-commands.md` before completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any security-sensitive change or review |

## Constraints

- Do not weaken authn/authz or secrets handling for convenience.
- Do not accept unverifiable security claims without code or config evidence.
- Prefer explicit deny-by-default behavior and auditable changes.
