---
name: skill-builder
description: Build and wire additional live-only specialist skills after initialization. Use for requests like "add new skill", "create api-review", "add test-review", "add more agents", or "extend review pipeline". Do NOT use for normal task implementation.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(*)
  - Edit
  - Write
metadata:
  author: Octopus-agent-orchestrator
  version: 1.0.1
  runtime_requirement: Node.js 20 LTS for public CLI and gate commands
---

# Skill Builder

Use this skill to create project-specific specialist skills in `Octopus-agent-orchestrator/live/skills/**` only.
Never write generated specialist skills into `Octopus-agent-orchestrator/template/**`.
Generated live skills must follow the same per-skill format as core skills and optional pack skills: `skill.json` + `SKILL.md` + optional `README.md` / `references/*` / `agents/*`.

## Inputs
- User-approved skill list (for example: `api-review`, `test-review`, `performance-review`, `infra-review`, `dependency-review`, or custom).
- Desired strictness (`mandatory gate` or `manual/optional review`).
- Target trigger semantics.

## Mandatory Questions
1. Which specialist skills should be added now?
2. Should each skill be `mandatory` or `optional`?
3. Should triggering be strict (high recall) or conservative (low noise)?

## Workflow
1. Load references:
   - `references/skill-template.md`
   - `references/frontmatter-guide.md`
   - `references/wiring-checklist.md`
2. For each approved skill, create:
   - `Octopus-agent-orchestrator/live/skills/<skill-name>/skill.json`
   - `Octopus-agent-orchestrator/live/skills/<skill-name>/SKILL.md`
   - optional `Octopus-agent-orchestrator/live/skills/<skill-name>/README.md`
   - `Octopus-agent-orchestrator/live/skills/<skill-name>/references/<checklist>.md`
   - optional `Octopus-agent-orchestrator/live/skills/<skill-name>/agents/openai.yaml`
3. Update catalog:
   - append new skill path in `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`
4. Update trigger documentation:
   - add trigger section in `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`
5. Configure gate capability flags:
   - set `true` for supported skill keys in `Octopus-agent-orchestrator/live/config/review-capabilities.json`
   - supported keys: `api`, `test`, `performance`, `infra`, `dependency`
6. Mandatory-gate wiring rules:
   - if skill is mandatory and key is supported, ensure the `classify-change` gate emits `required_reviews.<key>` and the `required-reviews-check` gate validates `<Key>ReviewVerdict`
   - if skill is custom and unsupported by gate scripts, mark as optional review and document limitation in catalog
7. Validation:
   - run `node Octopus-agent-orchestrator/bin/octopus.js verify --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"`
   - run `node Octopus-agent-orchestrator/bin/octopus.js gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"`

## Hard Stops
- Do not modify `Octopus-agent-orchestrator/template/**` for project-specific specialist skills.
- Do not enable capability flags for skills that were not created.
- Do not mark custom unsupported skill as mandatory gate.
- Do not leave catalog/trigger docs out of sync with created skills.

## Output Contract
- List created `live/skills/*` paths.
- List updated wiring files.
- Capability flags changed.
- Validation results (`PASS`/`FAIL`).
