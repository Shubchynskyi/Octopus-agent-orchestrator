# Octopus Agent Orchestrator: User How-To

This guide is for project owners who want to bootstrap the orchestrator with one agent prompt.

## 1. Copy Bundle
Copy the full `Octopus-agent-orchestrator/` directory into your target project root.

## Runtime Model
- Top-level control-plane scripts in `Octopus-agent-orchestrator/scripts/*.ps1` are canonical for install/init/verify/update/check-update.
- Top-level `Octopus-agent-orchestrator/scripts/*.sh` files are only compatibility wrappers that invoke the matching `.ps1` script via `pwsh`.
- Real dual-runtime shell implementations exist for task gate scripts in `Octopus-agent-orchestrator/live/scripts/agent-gates/*.sh`.
- Shell gate scripts require `bash` and a Python runtime in PATH (`python3`, `python`, or `py -3`).

## 2. Run Setup Through Agent
Give your coding agent this file as instruction input:
- `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md`

The setup prompt tells the agent to run installation and verification automatically.
Before installation, the agent must ask you:
- which language should be used for assistant explanations;
- which default response brevity should be used (`concise` or `detailed`).
- which file should be source of truth: `Claude (CLAUDE.md) | Codex (AGENTS.md) | Gemini (GEMINI.md) | GitHubCopilot (.github/copilot-instructions.md) | Windsurf (.windsurf/rules/rules.md) | Junie (.junie/guidelines.md) | Antigravity (.antigravity/rules.md)`; all non-selected entrypoint files will redirect to the selected file.
- whether hard no-auto-commit guard should be enabled (`yes`/`no`).
- whether Claude should get full access to orchestrator files/commands (`yes`/`no`) so gate scripts and task-event logs run without extra permission prompts.
- whether token economy should be enabled by default (`yes`/`no`).
- hard-stop if any of these 6 answers is missing.
After collecting all 6 answers, the agent must write `Octopus-agent-orchestrator/runtime/init-answers.json` and pass it to `install.ps1` and `verify.ps1` through `-InitAnswersPath`.
After install/init, the agent must use `Octopus-agent-orchestrator/live/project-discovery.md` to fill context rules for this repository.
After successful setup, the agent must provide a short `Usage Instructions` section in the language you selected.
After verification, before asking `Do you want to add additional specialist skills now? (yes/no)`, the agent must show:
- already configured specialist skills (enabled capability keys + existing live specialist skill directories);
- available skills that can be enabled/created now (`api-review`, `test-review`, `performance-review`, `infra-review`, `dependency-review`, or custom via skill-builder);
- recommended specialist set for this specific project.
Then the agent asks the yes/no question and proceeds with skill creation only on approval.

## 3. Expected Result
After successful setup:
- Root entry points exist and route correctly (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.qwen/settings.json`, `.github/agents/orchestrator.md`, `TASK.md`, platform files; plus optional `.claude/settings.local.json` when `ClaudeOrchestratorFullAccess=true`).
- Provider-native bridge profiles exist and route to canonical skills (`.github/agents/*.md`, `.windsurf/agents/orchestrator.md`, `.junie/agents/orchestrator.md`, `.antigravity/agents/orchestrator.md`).
- Copilot bridge profiles account for specialist skills added after init by reading `live/docs/agent-rules/90-skill-catalog.md` and `live/config/review-capabilities.json`.
- Task timeline logs are stored per task id in `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Selected source-of-truth entrypoint contains canonical routing index.
- All non-selected entrypoint files redirect to the selected source-of-truth entrypoint.
- Canonical rules are available under `Octopus-agent-orchestrator/live/docs/agent-rules/`.
- Compile gate scripts are available under `Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1` and `.sh`.
- Validation passes:
  - `install.ps1`
  - `verify.ps1`
  - `validate-manifest.ps1`
- Live capability config exists: `Octopus-agent-orchestrator/live/config/review-capabilities.json`
- Preflight path and trigger config exists: `Octopus-agent-orchestrator/live/config/paths.json`
- Token-economy config exists: `Octopus-agent-orchestrator/live/config/token-economy.json` (compact output and fail-tail controls).
- Discovery report exists: `Octopus-agent-orchestrator/live/project-discovery.md`
- Deployment version metadata exists: `Octopus-agent-orchestrator/live/version.json`
- If enabled in init answers, no-auto-commit guard exists in `.git/hooks/pre-commit` and blocks detected agent sessions while keeping normal human commits available.
- Builder skill exists: `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md`

Note:
- Template placeholders like `{{ASSISTANT_RESPONSE_LANGUAGE}}` and `{{ASSISTANT_RESPONSE_BREVITY}}` are expected before install/init.
- They are resolved during setup into concrete values in `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`.
- Command placeholders in `live/docs/agent-rules/40-commands.md` are not auto-resolved; they must be replaced with real project commands during setup, including `### Compile Gate (Mandatory)`.

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
- If token economy is enabled, use `depth=1` only for small, well-localized tasks; prefer `depth=2` otherwise.
- Required gates still apply at any depth.

## 5. Existing Project With Existing Docs
- Existing docs are used as context input.
- The orchestrator does not move or delete existing project documentation.
- Canonical agent workflow rules remain under `Octopus-agent-orchestrator/live/`.
- Additional specialist skills are created only in `Octopus-agent-orchestrator/live/skills/**` when explicitly requested.

## 6. Post-Init Validation Commands
Initialization must be run through `AGENT_INIT_PROMPT.md` (not by direct `install.ps1` call).

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

Gate scripts also have Bash alternatives:
```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --rationale "<why>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```
Agent policy: auto-detect environment and run `.ps1` with `pwsh` when available, otherwise run `.sh` with `bash`.
Bash gate scripts require a Python runtime in PATH (`python3`, `python`, or `py -3`).
Compile gate command source is `Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md` section `### Compile Gate (Mandatory)`.
Compile gate validates preflight scope freshness and writes compile evidence (`<task-id>-compile-gate.json`).
Review gate validates compile evidence and post-compile drift; it writes review evidence (`<task-id>-review-gate.json`).
Doc impact gate writes machine-checkable documentation assessment (`<task-id>-doc-impact.json`) before completion.
Completion gate validates compile/review/doc-impact evidence, review-loop timeline consistency, and required review artifacts before `DONE`.

## 7. Update Existing Deployment
Preferred flow (check + optional apply from git):

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

```bash
bash Octopus-agent-orchestrator/scripts/check-update.sh -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

This Bash entrypoint is a wrapper to `check-update.ps1` and still requires `pwsh`.

Behavior:
- if latest version is already installed: reports `UP_TO_DATE`;
- if update is available: asks `Apply now? (y/N)`;
- for CI/non-interactive mode: use `-Apply -NoPrompt`;
- if `runtime/init-answers.json` is missing newer keys, update migrates them automatically:
  - first by inferring values from existing `live/version.json` and `live/config/token-economy.json`;
  - then by asking only the missing questions in interactive mode;
  - otherwise by applying safe defaults and recording the decision in update report.

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -Apply -NoPrompt -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

`-Apply -NoPrompt` also suppresses update-time init migration prompts and uses inference/defaults only.

If you pass `-TargetRoot` manually for `check-update.ps1` or `update.ps1`, use the project root path (parent directory that contains `Octopus-agent-orchestrator/`), not the bundle directory itself.

By default, `check-update.ps1` uses:
`https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git`

To use your fork or mirror, provide repository URL:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -RepoUrl "<git-url>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

What update pipeline does:
- compares local and remote `VERSION`;
- syncs bundle files with backup to `Octopus-agent-orchestrator/runtime/bundle-backups/<timestamp>/`;
- reads `AssistantLanguage`, `AssistantBrevity`, `SourceOfTruth`, `EnforceNoAutoCommit`, `ClaudeOrchestratorFullAccess`, and `TokenEconomyEnabled` from `runtime/init-answers.json`;
- if some init answers are missing, backfills them into `runtime/init-answers.json` before install and includes that file in rollback snapshot;
- runs install/init sync, verification, and manifest validation;
- rebuilds `TASK.md` from latest template and migrates existing queue rows from previous `TASK.md`;
- if queue migration cannot be parsed safely, keeps existing `TASK.md` managed block unchanged;
- updates `Octopus-agent-orchestrator/live/version.json`;
- writes `Octopus-agent-orchestrator/runtime/update-reports/update-<timestamp>.md`.

Note:
- top-level `scripts/update.sh` / `scripts/check-update.sh` are wrapper entrypoints for environments that prefer `bash`, but they still execute the PowerShell implementation underneath.
- `live/scripts/agent-gates/*.sh` are different: those are real shell implementations and do not require `pwsh`.

Manual direct update can suppress migration prompts too:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/update.ps1 -NoInitAnswerPrompt -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

Dry-run preview:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -DryRun -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

## 8. Adding Specialist Skills After Init
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

