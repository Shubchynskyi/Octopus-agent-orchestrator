---
name: frontend-react
description: Domain pack for React frontends. Use for component architecture, state flow, accessibility, performance-sensitive UI changes, and frontend testing.
license: MIT
metadata:
  domain: frontend
  triggers: React, TypeScript UI, frontend, component, hooks, routing, accessibility, Vitest, Playwright
  role: specialist
  scope: implementation
  output-format: code-and-review
  related-skills: orchestration, code-review, performance-review
---

# Frontend React

## Core Workflow

1. Confirm routing, design system constraints, and canonical frontend test/build commands before editing.
2. Keep state ownership explicit and components focused.
3. Treat accessibility, loading/error states, and data-fetch transitions as required behavior.
4. Consider bundle size, rerender churn, and hydration/runtime boundaries for non-trivial UI changes.
5. Run lint, tests, type-check, and build commands from `40-commands.md` before completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any React feature or review |

## Constraints

- Do not hide state mutations in broad component trees.
- Do not ship inaccessible controls or untested state transitions.
- Treat routing, auth flows, caching, and form behavior as contract-sensitive.
