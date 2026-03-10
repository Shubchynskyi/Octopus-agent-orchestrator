# Skill Template

Use this skeleton for each new specialist skill.

```md
---
name: <skill-name>
description: <what it does + when to use + trigger phrases + negative trigger>
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(pwsh:*)
  - Write
metadata:
  author: <team>
  version: 1.0.1
---

# <Skill Name>

## Required Inputs
- ...

## Review Workflow
1. ...

## Mandatory Output Format
1. Findings by severity with file references.
2. Checklist rows with `rule_id`, `status`, `evidence`.
3. Residual risks.
4. Explicit verdict token.

## Hard Fail Conditions
- ...

## Evidence Rules
- ...
```
