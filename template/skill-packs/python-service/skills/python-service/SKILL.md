---
name: python-service
description: Domain pack for Python service repositories. Use for FastAPI, Django, Flask, workers, packaging, typing, and production-safe service changes.
license: MIT
metadata:
  domain: backend
  triggers: Python service, FastAPI, Django, Flask, Celery, worker, API, packaging, pytest
  role: specialist
  scope: implementation
  output-format: code-and-review
  related-skills: orchestration, code-review, dependency-review
---

# Python Service

## Core Workflow

1. Confirm interpreter, package manager, and canonical test/build commands before editing.
2. Keep boundaries clear between API layer, domain logic, persistence, and background jobs.
3. Prefer explicit typing, validation, and deterministic configuration loading.
4. Treat migrations, dependency upgrades, concurrency, and secrets handling as high-risk.
5. Run lint, tests, and packaging/build commands from `40-commands.md` before completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any Python service feature or review |

## Constraints

- Do not bury configuration in import side effects.
- Do not couple framework adapters directly to data storage internals.
- Prefer explicit interfaces, fixtures, and typed boundaries over implicit magic.
