---
name: java-spring
description: Domain pack for Spring Boot repositories. Use for layered services, REST APIs, persistence, security, testing, and release-safe Java backend work.
license: MIT
metadata:
  domain: backend
  triggers: Spring Boot, Spring MVC, Spring Security, Spring Data JPA, Maven, Gradle, Java service, REST API
  role: specialist
  scope: implementation
  output-format: code-and-review
  related-skills: orchestration, code-review, security-review
---

# Java Spring

## Core Workflow

1. Confirm module boundaries, runtime entrypoints, and build command before editing.
2. Keep a layered design: controller -> service -> persistence, with constructor injection only.
3. Treat validation, transactions, security filters, and error mapping as contract-critical.
4. Add or update tests for controller, service, and repository boundaries when behavior changes.
5. Run the project compile/test commands from `40-commands.md` before claiming completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any Spring Boot feature or review |

## Constraints

- Do not use field injection.
- Do not hide breaking API or schema changes behind silent refactors.
- Prefer explicit DTOs, validation, and exception mapping for public endpoints.
- Treat Flyway/Liquibase, security config, and persistence model changes as high-risk.
