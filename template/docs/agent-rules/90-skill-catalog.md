# Skill Catalog

Primary entry point: selected source-of-truth entrypoint for this workspace.

## Purpose
- Define available project skills.
- Define deterministic trigger policy for mandatory invocations.
- Avoid duplicating orchestration step sequence; canonical lifecycle is in:
  `Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md`.

## Available Project Skills
- `Octopus-agent-orchestrator/live/skills/orchestration`
- `Octopus-agent-orchestrator/live/skills/code-review`
- `Octopus-agent-orchestrator/live/skills/db-review`
- `Octopus-agent-orchestrator/live/skills/security-review`
- `Octopus-agent-orchestrator/live/skills/refactor-review`
- `Octopus-agent-orchestrator/live/skills/skill-builder`

## Optional Skills (Live-Only, On Demand)
- Optional specialist skills are created only under `Octopus-agent-orchestrator/live/skills/**`.
- Template must stay generic; project-specific specialists are not written back into `template/`.
- Capability flags for optional specialists are managed in:
  `Octopus-agent-orchestrator/live/config/review-capabilities.json`.
- Compact optional-skill discovery metadata is managed in:
  `Octopus-agent-orchestrator/live/config/skills-index.json`.
- Built-in domain packs are managed through:
  - `node Octopus-agent-orchestrator/bin/octopus.js skills list --target-root "."`
  - `node Octopus-agent-orchestrator/bin/octopus.js skills suggest --target-root "." --task-text "<task summary>" --changed-path "<path>"`
  - `node Octopus-agent-orchestrator/bin/octopus.js skills add <pack-id> --target-root "."`
  - `node Octopus-agent-orchestrator/bin/octopus.js skills remove <pack-id> --target-root "."`
  - `node Octopus-agent-orchestrator/bin/octopus.js skills validate --target-root "."`
- Installed built-in packs are recorded in:
  `Octopus-agent-orchestrator/live/config/skill-packs.json`.
- Built-in pack ids come from `skills list`; do not hardcode the list in downstream prompts.
- Optional skill selection contract:
  - read only `live/config/skills-index.json` when deciding what to suggest;
  - after the user selects a pack, install/copy it into `Octopus-agent-orchestrator/live/skills/**` without reading the full optional `SKILL.md`;
  - do not open a full optional `SKILL.md` unless that selected skill is actually being activated for a task or a hard activation rule requires it;
  - after a pack is installed, full optional skills live under `Octopus-agent-orchestrator/live/skills/**`.

## Preflight Gate (Mandatory)
- Run before review stage:
  `node Octopus-agent-orchestrator/bin/octopus.js gate classify-change --changed-file "<planned-file-1>" --changed-file "<planned-file-2>" --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"`
- In dirty workspaces prefer staged mode:
  `node Octopus-agent-orchestrator/bin/octopus.js gate classify-change --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"`
- Compile gate is mandatory after implementation and before `IN_REVIEW`:
  `node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"`
- Preflight artifact is the only source for:
  - `path_mode` (`FAST_PATH` / `FULL_PATH`)
  - `required_reviews.code`
  - `required_reviews.db`
  - `required_reviews.security`
  - `required_reviews.refactor`
  - optional keys (when capability enabled): `required_reviews.api`, `required_reviews.test`, `required_reviews.performance`, `required_reviews.infra`, `required_reviews.dependency`

## Invocation Contract
- Always start task execution with `orchestration`.
- Provider-native agent profiles are only bridges and must route to this same skill catalog:
  - `.github/agents/orchestrator.md`
  - `.github/agents/reviewer.md`
  - `.github/agents/code-review.md`
  - `.github/agents/db-review.md`
  - `.github/agents/security-review.md`
  - `.github/agents/refactor-review.md`
  - `.windsurf/agents/orchestrator.md`
  - `.junie/agents/orchestrator.md`
  - `.antigravity/agents/orchestrator.md`
- For GitHub Copilot bridge profiles, always refresh routing from:
  - `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`
  - `Octopus-agent-orchestrator/live/config/review-capabilities.json`
  - `Octopus-agent-orchestrator/live/skills/**` (including specialist skills added after init)
- Invoke review skills only when required by preflight:
  - `code-review` for `required_reviews.code=true`
  - `db-review` for `required_reviews.db=true`
  - `security-review` for `required_reviews.security=true`
  - `refactor-review` for `required_reviews.refactor=true`
  - optional specialist skills when enabled and required:
    - `api-review` for `required_reviews.api=true`
    - `test-review` for `required_reviews.test=true`
    - `performance-review` for `required_reviews.performance=true`
    - `infra-review` for `required_reviews.infra=true`
    - `dependency-review` for `required_reviews.dependency=true`
- Before `DONE`, run:
  `node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" ...`
- Then run completion gate:
  `node Octopus-agent-orchestrator/bin/octopus.js gate completion-gate --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"`

## Trigger Source of Truth
- Specialized trigger semantics are defined only in:
  `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`
- Trigger evaluation is executed only by preflight script.
- Optional/manual reviewers never satisfy mandatory gates.

## Escape Hatch Policy
- Optional audited override for mandatory review gate is supported only via:
  `node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check --skip-reviews ... --skip-reason ...`
- Default restrictions:
  - only code review can be skipped,
  - only tiny low-risk scope,
  - DB/security/refactor overrides are forbidden.
- Every override must produce an override artifact and be recorded in `TASK.md`.

## Enforcement
- Missing preflight artifact blocks progression.
- Missing compile-gate pass (`COMPILE_GATE_PASSED`) blocks progression to `IN_REVIEW` and `DONE`.
- Missing required skill invocation blocks progression.
- Missing required verdict blocks completion.
- Missing review gate check pass blocks completion.
- Missing completion gate pass (`COMPLETION_GATE_PASSED`) blocks completion.
- Missing task timeline evidence in `runtime/task-events/<task-id>.jsonl` blocks completion.
- Missing required docs/changelog updates blocks completion for doc-impacting changes.
- Reviewer/specialist agents must be closed after verdict capture.
