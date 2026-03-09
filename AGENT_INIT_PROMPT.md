# Agent Init Prompt

Read and execute this instruction completely. Do not ask the user to run scripts manually.

## Goal
Create a fully working agent orchestration workspace where canonical rules live only under `Octopus-agent-orchestrator/live/`, and root entrypoints route to those files.

## Required Execution Flow
1. Confirm working directory is the project root containing `Octopus-agent-orchestrator/`.
2. Ask mandatory first-run questions in this exact sequence:
   - Ask: `Which language should be used for assistant explanations and help in this project?`
   - Wait for answer and store as `<assistant-language>`.
   - Immediately switch all subsequent user-facing messages to `<assistant-language>`, starting with the next question.
   - In `<assistant-language>`, ask: `What response brevity should be default: concise or detailed?`
   - Wait for answer and store as `<assistant-brevity>`.
   - In `<assistant-language>`, ask: `Which source-of-truth file should be canonical for rules: Claude (CLAUDE.md), Codex (AGENTS.md), GitHubCopilot (.github/copilot-instructions.md), Windsurf (.windsurf/rules/rules.md), Junie (.junie/guidelines.md), or Antigravity (.antigravity/rules.md)? All non-selected entrypoint files will redirect to this selected file.`
   - Wait for answer and store as `<source-of-truth>`.
   - Hard-stop rule: **if all 3 answers are not collected, do not run installation**.
3. Save required init answers artifact to `Octopus-agent-orchestrator/runtime/init-answers.json`:
```json
{
  "AssistantLanguage": "<assistant-language>",
  "AssistantBrevity": "<assistant-brevity>",
  "SourceOfTruth": "<source-of-truth>",
  "CollectedVia": "AGENT_INIT_PROMPT.md"
}
```
4. Run installer (this also runs init automatically):
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/install.ps1 -AssistantLanguage "<assistant-language>" -AssistantBrevity "<assistant-brevity>" -SourceOfTruth "<source-of-truth>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```
5. Read discovery artifact and update project-context rules for this real project:
   - `Octopus-agent-orchestrator/live/project-discovery.md`
   - update `10-project-context.md`, `20-architecture.md`, `30-code-style.md`, `40-commands.md`, `60-operating-rules.md` with repository-specific facts.
   - tune `Octopus-agent-orchestrator/live/config/paths.json` when default path roots or trigger regexes do not fit this repository.
6. Run verification:
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<source-of-truth>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```
7. Validate manifest uniqueness:
```powershell
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```
8. Confirm task execution contract supports depth:
   - accepted command shape: `Execute task <task-id> depth=<1|2|3>`
   - default depth when omitted: `2`
9. Optional post-init specialization:
   - ask user: `Do you want to add additional specialist skills now? (yes/no)`
   - if `yes`, ask:
     - `Which skills should be added now? (api-review, test-review, performance-review, infra-review, dependency-review, or custom names)`
     - `For each selected skill, should it be mandatory gate or optional review?`
   - execute creation workflow via:
     - `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md`
   - create specialist skills only under `Octopus-agent-orchestrator/live/skills/**` (never under `template/**`)
   - if any skill is configured as mandatory and supported (`api|test|performance|infra|dependency`), set corresponding flag in `Octopus-agent-orchestrator/live/config/review-capabilities.json`
   - rerun verification and manifest validation after skill creation.

## Expected State After Success
- Selected source-of-truth entrypoint exists and routes to `Octopus-agent-orchestrator/live/docs/agent-rules/*`.
- All non-selected entrypoint files redirect to selected source-of-truth entrypoint.
- `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md` ... `90-skill-catalog.md` all exist and are non-empty.
- `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md` language is configured to user-selected `<assistant-language>`.
- `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md` default response brevity is configured to user-selected `<assistant-brevity>`.
- `Octopus-agent-orchestrator/live/init-report.md` exists.
- `Octopus-agent-orchestrator/live/project-discovery.md` exists.
- `Octopus-agent-orchestrator/live/source-inventory.md` exists.
- `Octopus-agent-orchestrator/live/config/review-capabilities.json` exists.
- `Octopus-agent-orchestrator/live/config/paths.json` exists.
- `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md` exists.
- `Octopus-agent-orchestrator/live/USAGE.md` exists with usage instructions in `<assistant-language>`.
- Root `TASK.md` contains `Depth` column in active queue.
- Existing project docs and legacy agent files are not moved or deleted.

## Behavior Requirements
- Read existing project docs and legacy agent files as input context.
- Do not migrate files by moving/removing them.
- Keep changes minimal and deterministic.
- Never run `install.ps1` before writing `Octopus-agent-orchestrator/runtime/init-answers.json` with all 3 required answers.
- Never run initialization by directly calling `install.ps1` outside this prompt flow.
- After `<assistant-language>` is collected, continue all following user-facing questions and reports in `<assistant-language>`.
- For gate scripts during task execution, auto-detect environment:
  - prefer `.ps1` via `pwsh` when `pwsh` is available;
  - otherwise use `.sh` equivalents via `bash`.
- When using `.sh` gate scripts, ensure a Python runtime is available in PATH (`python3`, `python`, or `py -3`).
- If any check fails, fix the issue and rerun checks until PASS.

## Final Report Format
- What was done.
- Result of each command (PASS or FAIL with key lines).
- Files created or updated.
- `Usage Instructions` section for the user in `<assistant-language>`, with exact next commands for:
  - executing a task (`Execute task <task-id> depth=<1|2|3>`);
  - using default depth (`Execute task <task-id>`);
  - when to use `depth=1`, `depth=2`, and `depth=3`.
  - where tasks are defined: tasks are managed in the root `TASK.md` file.
- Save the full `Usage Instructions` section to `Octopus-agent-orchestrator/live/USAGE.md` so the user can reference it later.
- If optional specialist skills were requested:
  - list newly created `Octopus-agent-orchestrator/live/skills/*` paths;
  - list changed capability flags in `review-capabilities.json`;
  - list whether each added skill is `mandatory` or `optional`.
- Confirmation line: `Workspace ready for task execution`.

## Constraints
- Do not commit.
- Do not remove unrelated files.
- Do not skip verification.

