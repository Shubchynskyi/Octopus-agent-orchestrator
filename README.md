![Octopus Agent Orchestrator](Image.png)

# Octopus Agent Orchestrator Bootstrap

This bundle deploys Octopus Agent Orchestrator entrypoints into project root and materializes canonical rules inside `Octopus-agent-orchestrator/live/`.

## Quick Start
- User guide: `HOW_TO.md`
- Agent setup prompt: `AGENT_INIT_PROMPT.md`

## Design
- Canonical rule set lives only in `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- Source-of-truth entrypoint is selected at setup (`Claude`, `Codex`, `GitHubCopilot`, `Windsurf`, `Junie`, or `Antigravity`).
- Selected entrypoint contains canonical routing index; all other entrypoint files are redirects.
- Context rules are initialized as generic templates and then filled using project discovery signals.
- Existing project docs and legacy agent files are read as context input only.
- No automatic moving or deleting of legacy files.

## What Is Deployed To Project Root
- `CLAUDE.md` (always refreshed from template)
- `AGENTS.md`
- `TASK.md`
- `.antigravity/rules.md`
- `.junie/guidelines.md`
- `.windsurf/rules/rules.md`
- `.github/copilot-instructions.md`

## What Is Materialized Inside Orchestrator
- `Octopus-agent-orchestrator/live/config/review-capabilities.json`
- `Octopus-agent-orchestrator/live/config/paths.json`
- `Octopus-agent-orchestrator/live/docs/agent-rules/00..90`
- `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`
- `Octopus-agent-orchestrator/live/docs/reviews/TEMPLATE.md`
- `Octopus-agent-orchestrator/live/docs/tasks/TASKS.md`
- `Octopus-agent-orchestrator/live/scripts/agent-gates/**`
- `Octopus-agent-orchestrator/live/skills/**`
- `Octopus-agent-orchestrator/live/source-inventory.md`
- `Octopus-agent-orchestrator/live/init-report.md`
- `Octopus-agent-orchestrator/live/project-discovery.md`

## Single-Agent Flow (Recommended)
1. Copy `Octopus-agent-orchestrator/` into target project root.
2. Give the setup agent this file:
   - `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`
3. Agent asks the user for:
   - preferred assistant response language;
   - preferred default response brevity (`concise` or `detailed`).
   - preferred source-of-truth entrypoint: `Claude (CLAUDE.md) | Codex (AGENTS.md) | GitHubCopilot (.github/copilot-instructions.md) | Windsurf (.windsurf/rules/rules.md) | Junie (.junie/guidelines.md) | Antigravity (.antigravity/rules.md)`; all non-selected entrypoint files will redirect to the selected file.
4. Agent must hard-stop setup unless all 3 answers are collected, then writes `Octopus-agent-orchestrator/runtime/init-answers.json`.
5. Agent executes install and init with `-InitAnswersPath`, then reads `live/project-discovery.md`.
6. Agent updates context rules (`10/20/30/40/60`) and `live/config/paths.json` to match the real repository.
7. Agent runs verify and manifest validation with the same `-InitAnswersPath`.
8. Agent returns `Usage Instructions` in the selected assistant language.
9. Agent asks whether to add optional specialist skills (live-only) and, if approved, uses `live/skills/skill-builder`.

## Post-Init Validation Commands
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<Claude|Codex|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```

## Important
- Run initialization only through `AGENT_INIT_PROMPT.md`; do not run `scripts/install.ps1` directly.
- `scripts/install.ps1` and `scripts/verify.ps1` require `Octopus-agent-orchestrator/runtime/init-answers.json` with collected init answers.
- Installer defaults to non-destructive mode for non-canonical entry files.
- Selected source-of-truth entrypoint is intentionally refreshed to keep routing canonical.
- Installer creates backups in `Octopus-agent-orchestrator/runtime/backups/<timestamp>/`.
- Installer updates `.gitignore` with managed agent entries.
- Preflight roots and trigger regexes are configurable in `live/config/paths.json`.
- Gate scripts support both `pwsh` (`*.ps1`) and `bash` (`*.sh`); agent should auto-detect environment.
- Bash gate scripts require a Python runtime in PATH (`python3`, `python`, or `py -3`).
- Specialist skills added after init are project-specific and should be created only in `Octopus-agent-orchestrator/live/skills/**`.

## License
MIT License. See `LICENSE`.

## Author
- Dmytro Shubchynskyi
- Email: d.shubchynskyi@gmail.com
- LinkedIn: https://www.linkedin.com/in/shubchynskyi

