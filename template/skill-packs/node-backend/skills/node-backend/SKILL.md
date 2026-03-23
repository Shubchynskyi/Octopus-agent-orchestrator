---
name: node-backend
description: Domain pack for Node.js backend repositories. Use for HTTP services, workers, validation, persistence, observability, and release-safe server changes.
license: MIT
metadata:
  domain: backend
  triggers: Node.js, Express, Fastify, NestJS, TypeScript service, worker, queue consumer, REST API
  role: specialist
  scope: implementation
  output-format: code-and-review
  related-skills: orchestration, code-review, dependency-review
---

# Node Backend

## Core Workflow

1. Confirm runtime entrypoints, package manager, and actual test/build commands before editing.
2. Keep clear boundaries between transport, application logic, persistence, and integrations.
3. Validate inputs at the edge and keep error responses deterministic.
4. Treat async flows, retries, queue consumers, and process shutdown as correctness concerns.
5. Run lint, type-check, test, and build commands from `40-commands.md` before completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any Node backend feature or review |

## Constraints

- Do not mix request shaping, business logic, and persistence in one handler.
- Do not silently widen runtime side effects.
- Treat schema, contract, concurrency, and dependency upgrades as high-risk.
