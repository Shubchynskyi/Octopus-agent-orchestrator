---
name: devops-k8s
description: Domain pack for infrastructure and delivery repositories. Use for containers, CI/CD, Kubernetes, rollout safety, secrets, and operational readiness.
license: MIT
metadata:
  domain: infrastructure
  triggers: Docker, Kubernetes, Helm, Terraform, CI/CD, GitHub Actions, deployment, rollout, observability
  role: specialist
  scope: implementation
  output-format: plans-and-review
  related-skills: orchestration, infra-review, security-review
---

# DevOps K8s

## Core Workflow

1. Confirm deployment targets, environments, and canonical validation commands before editing.
2. Treat secret handling, rollout strategy, and rollback behavior as first-class requirements.
3. Prefer deterministic manifests, pinned versions, and explicit health checks.
4. Consider observability, alerts, and operational ownership for any production-facing change.
5. Run the infrastructure validation commands from `40-commands.md` before completion.

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Delivery checklist | `references/checklist.md` | Any infra or deployment feature/review |

## Constraints

- Do not commit secrets or environment-specific credentials.
- Do not widen blast radius with implicit defaults.
- Treat production rollout paths, migrations, and infra access changes as high-risk.
