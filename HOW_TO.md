# Octopus Agent Orchestrator: User How-To

This guide is for project owners who want to bootstrap the orchestrator with one agent prompt.

## 1. Copy Bundle
Copy the full `Octopus-agent-orchestrator/` directory into your target project root.

## 2. Run Setup Through Agent
Give your coding agent this file as instruction input:
- `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`

The setup prompt tells the agent to run installation and verification automatically.
Before installation, the agent must ask you:
- which language should be used for assistant explanations;
- which default response brevity should be used (`concise` or `detailed`).
- which file should be source of truth (`Claude`, `Codex`, `GitHubCopilot`, `Windsurf`, `Junie`, or `Antigravity`).
After install/init, the agent must use `Octopus-agent-orchestrator/live/project-discovery.md` to fill context rules for this repository.
After successful setup, the agent must provide a short `Usage Instructions` section in the language you selected.
After verification, the agent should optionally ask whether you want to add extra specialist skills (live-only).

## 3. Expected Result
After successful setup:
- Root entry points exist and route correctly (`CLAUDE.md`, `AGENTS.md`, `TASK.md`, platform files).
- Selected source-of-truth entrypoint contains canonical routing index.
- All non-selected entrypoint files redirect to the selected source-of-truth entrypoint.
- Canonical rules are available under `Octopus-agent-orchestrator/live/docs/agent-rules/`.
- Validation passes:
  - `install.ps1`
  - `verify.ps1`
  - `validate-manifest.ps1`
- Live capability config exists: `Octopus-agent-orchestrator/live/config/review-capabilities.json`
- Preflight path and trigger config exists: `Octopus-agent-orchestrator/live/config/paths.json`
- Discovery report exists: `Octopus-agent-orchestrator/live/project-discovery.md`
- Builder skill exists: `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md`

Note:
- Template placeholders like `{{ASSISTANT_RESPONSE_LANGUAGE}}` and `{{ASSISTANT_RESPONSE_BREVITY}}` are expected before install/init.
- They are resolved during setup into concrete values in `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`.

## 4. Start Working On Tasks
Use task commands in this shape:
- `Execute task T-001`
- `Execute task T-001 depth=1`
- `Execute task T-001 depth=2`
- `Execute task T-001 depth=3`

Depth behavior:
- `depth=2` is default.
- `depth=1` is quick mode for narrow low-risk tasks.
- `depth=3` is deep mode for high-risk or cross-module work.
- Required gates still apply at any depth.

## 5. Existing Project With Existing Docs
- Existing docs are used as context input.
- The orchestrator does not move or delete existing project documentation.
- Canonical agent workflow rules remain under `Octopus-agent-orchestrator/live/`.
- Additional specialist skills are created only in `Octopus-agent-orchestrator/live/skills/**` when explicitly requested.

## 6. Optional Manual Run (if no setup agent is used)
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/install.ps1 -AssistantLanguage "<language>" -AssistantBrevity "<concise|detailed>" -SourceOfTruth "<Claude|Codex|GitHubCopilot|Windsurf|Junie|Antigravity>"
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<Claude|Codex|GitHubCopilot|Windsurf|Junie|Antigravity>"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

Gate scripts also have Bash alternatives:
```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```
Agent policy: auto-detect environment and run `.ps1` with `pwsh` when available, otherwise run `.sh` with `bash`.
Bash gate scripts require a Python runtime in PATH (`python3`, `python`, or `py -3`).

## 7. Adding Specialist Skills After Init
To add specialist skills later, ask your agent for example:
- `Add api-review skill`
- `Create a test-review agent`
- `Add performance-review as optional`

The agent should use `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md` to:
- create specialist skill files under `Octopus-agent-orchestrator/live/skills/`;
- wire triggers in review matrix and skill catalog;
- enable capability flags in `Octopus-agent-orchestrator/live/config/review-capabilities.json` when needed;
- align trigger regexes in `Octopus-agent-orchestrator/live/config/paths.json` when new modules or file patterns are introduced;
- re-run verification and manifest validation.

