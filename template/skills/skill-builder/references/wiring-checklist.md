# Wiring Checklist

For every new live-only specialist skill:

1. Create skill files under `Octopus-agent-orchestrator/live/skills/<skill-name>/`.
2. Add skill path to `Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md`.
3. Add trigger semantics to `Octopus-agent-orchestrator/live/skills/orchestration/references/review-trigger-matrix.md`.
4. If supported key (`api|test|performance|infra|dependency`), set flag in:
   - `Octopus-agent-orchestrator/live/config/review-capabilities.json`
5. If mandatory gate requested, confirm script support exists:
   - `classify-change.ps1` emits `required_reviews.<key>`
   - `required-reviews-check.ps1` validates `<Key>ReviewVerdict`
6. Run verification and manifest validation.
7. Record added skills and flags in final report.

