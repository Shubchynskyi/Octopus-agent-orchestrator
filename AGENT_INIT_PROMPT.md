# Agent Init Prompt

Read and execute this instruction completely. Do not ask the user to run scripts manually.

## Goal
Create a fully working agent orchestration workspace where canonical rules live only under `Octopus-agent-orchestrator/live/`, and root entrypoints route to those files.

## Required Execution Flow
1. Confirm working directory is the project root containing `Octopus-agent-orchestrator/`.
2. Open `Octopus-agent-orchestrator/runtime/init-answers.json` and determine whether all 6 mandatory answers are already present.
   - If the file already contains all 6 mandatory answers, reuse those answers instead of re-asking everything.
   - If the file already exists and is complete, **reuse all existing answers and do not ask those 6 questions again**.
   - When reusing a complete file, only validate `AssistantLanguage` before continuing:
     - normalize it to a clear agent-readable language label that other agents can understand without guesswork (for example `English`, `Russian`, `Ukrainian`, `German`);
     - if the language answer is ambiguous, typo-heavy, contradictory, or you cannot confidently map it to a single language, ask the user to clarify the language before proceeding;
     - if the language answer is ambiguous, typo-heavy, contradictory, or you cannot confidently map it to a single language, ask the user for a language clarification and do not ask the other setup questions again;
     - write the normalized language value back into `Octopus-agent-orchestrator/runtime/init-answers.json`.
   - If `ActiveAgentFiles` is missing, empty, or contains only the canonical source-of-truth entrypoint after CLI setup, decide yourself whether additional managed entrypoint files are actually needed for this repository.
     - inspect existing agent files already present in the repo and the tools/workflows actually used here;
     - choose the smallest practical set of active agent files;
     - ask the user only if real usage is ambiguous and you cannot infer it confidently.
   - If the file is missing, invalid, or incomplete, ask only the missing mandatory answers in the exact sequence below while preserving every already valid answer.
3. When questions are required, ask missing mandatory first-run questions in this exact sequence:
   - Ask: `Which language should be used for assistant explanations and help in this project?`
   - Wait for answer and store as `<assistant-language>`.
   - Normalize `<assistant-language>` to a clear agent-readable language label before saving it.
   - If you cannot confidently normalize the answer to one language, ask a clarification question and do not continue until clarified.
   - Immediately switch all subsequent user-facing messages to `<assistant-language>`, starting with the next question.
   - In `<assistant-language>`, ask: `What response brevity should be default: concise or detailed?`
   - Wait for answer and store as `<assistant-brevity>`.
   - In `<assistant-language>`, optionally ask: `Which agent entrypoint files do you actively use in this project? You may select multiple from CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md, .windsurf/rules/rules.md, .junie/guidelines.md, and .antigravity/rules.md. Recommendation: include the agent files you work with most often.`
   - If the user provides a value, store it as `<active-agent-files>`.
   - In `<assistant-language>`, ask: `Which source-of-truth file should be canonical for rules: Claude (CLAUDE.md), Codex (AGENTS.md), Gemini (GEMINI.md), GitHubCopilot (.github/copilot-instructions.md), Windsurf (.windsurf/rules/rules.md), Junie (.junie/guidelines.md), or Antigravity (.antigravity/rules.md)? All non-selected entrypoint files will redirect to this selected file. Recommendation: choose the agent file you work with most often, ideally from the active files you just selected.`
   - Wait for answer and store as `<source-of-truth>`.
   - In `<assistant-language>`, ask (4th mandatory question): a localized equivalent of `Should the no-auto-commit guard be strengthened? (yes/no)`
   - Wait for answer and store as `<enforce-no-auto-commit>`.
   - In `<assistant-language>`, ask (5th mandatory question): a localized equivalent of `Give Claude full access to orchestrator files? (yes/no)`
   - Wait for answer and store as `<claude-orchestrator-full-access>`.
   - In `<assistant-language>`, ask (6th mandatory question): a localized equivalent of `Enable token-economy mode by default? (yes/no)`
   - Clarify before collecting the answer: this toggle controls reviewer-context compaction for configured depths; shared gate output filtering and fail-tail compaction still apply at any depth.
   - Wait for answer and store as `<token-economy-enabled>`.
   - Hard-stop rule: **if all 6 answers are not collected, do not run installation**.
4. Save required init answers artifact to `Octopus-agent-orchestrator/runtime/init-answers.json`:
```json
{
  "AssistantLanguage": "<assistant-language>",
  "AssistantBrevity": "<assistant-brevity>",
  "SourceOfTruth": "<source-of-truth>",
  "EnforceNoAutoCommit": "<enforce-no-auto-commit>",
  "ClaudeOrchestratorFullAccess": "<claude-orchestrator-full-access>",
  "TokenEconomyEnabled": "<token-economy-enabled>",
  "CollectedVia": "AGENT_INIT_PROMPT.md"
}
```
If `<active-agent-files>` was collected or inferred, also include:
```json
{
  "ActiveAgentFiles": "<active-agent-files>"
}
```
Additional rules for saving:
- if you only reused answers created by CLI setup and normalized `AssistantLanguage` and/or inferred `ActiveAgentFiles`, preserve the existing `CollectedVia` value (`CLI_INTERACTIVE` or `CLI_NONINTERACTIVE`);
- set `CollectedVia` to `AGENT_INIT_PROMPT.md` only if the agent actually had to collect one or more missing mandatory answers.
5. Decide whether reinstall is actually needed.
   - If `octopus setup` already completed primary initialization and `Octopus-agent-orchestrator/live/` plus root entrypoints already exist, **do not repeat the 6 questions and do not rerun install just to reapply the same answers**.
   - Run installer only when primary initialization is incomplete, or when missing answers had to be collected and answer-dependent files still need to be materialized/refreshed.
   - If you expand `ActiveAgentFiles` beyond the canonical entrypoint, rerun installer so the additional redirect entrypoints and provider bridge files are materialized.
6. If reinstall is needed, run installer (this also runs init automatically):
```powershell
node Octopus-agent-orchestrator/bin/octopus.js install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```
7. Read discovery artifact and update project-context rules for this real project:
   - `Octopus-agent-orchestrator/live/project-discovery.md`
   - update `10-project-context.md`, `20-architecture.md`, `30-code-style.md`, `40-commands.md`, `60-operating-rules.md` with repository-specific facts.
   - tune `Octopus-agent-orchestrator/live/config/paths.json` when default path roots or trigger regexes do not fit this repository.
8. Run the final doctor check yourself as part of agent initialization:
```powershell
npx octopus-agent-orchestrator doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```
If `npx octopus-agent-orchestrator` is unavailable in the current environment, run the equivalent canonical checks directly:
```powershell
node Octopus-agent-orchestrator/bin/octopus.js verify --target-root "." --source-of-truth "<source-of-truth>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
node Octopus-agent-orchestrator/bin/octopus.js gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"
```
9. Confirm task execution contract supports depth:
   - accepted command shape: `Execute task <task-id> depth=<1|2|3>`
   - default depth when omitted: `2`
10. Optional post-init specialization:
   - before the yes/no question, provide in `<assistant-language>`:
     - `Already configured specialist skills`:
       - read `Octopus-agent-orchestrator/live/config/review-capabilities.json` and list enabled specialist keys (`api`, `test`, `performance`, `infra`, `dependency`);
       - list existing specialist skill directories under `Octopus-agent-orchestrator/live/skills/**` beyond baseline (`orchestration`, `code-review`, `db-review`, `security-review`, `refactor-review`, `skill-builder`).
     - `Available specialist skills to enable/create now`:
       - predefined: `api-review`, `test-review`, `performance-review`, `infra-review`, `dependency-review`;
       - custom specialist skills that can be created via skill-builder.
     - `Recommendation for this project`:
       - provide a short recommended set (for example `api-review`/`test-review` for backend APIs, `performance-review` for latency-sensitive services, `infra-review` for deployment/terraform changes), based on discovered stack and repository structure.
   - then ask user: `Do you want to add additional specialist skills now? (yes/no)`
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
- `Octopus-agent-orchestrator/live/version.json` exists and matches `Octopus-agent-orchestrator/VERSION`.
- `Octopus-agent-orchestrator/live/config/token-economy.json` exists and its `enabled` flag matches `<token-economy-enabled>`.
- if `<enforce-no-auto-commit>` is true: `.git/hooks/pre-commit` contains Octopus managed commit guard block.
- `Octopus-agent-orchestrator/live/config/review-capabilities.json` exists.
- `Octopus-agent-orchestrator/live/config/paths.json` exists.
- `Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md` exists.
- `Octopus-agent-orchestrator/live/USAGE.md` exists with usage instructions in `<assistant-language>`.
- Root `TASK.md` contains `Depth` column in active queue.
- Provider-native bridge profiles exist and map back to canonical skills (`.github/agents/*.md`, `.windsurf/agents/orchestrator.md`, `.junie/agents/orchestrator.md`, `.antigravity/agents/orchestrator.md`).
- Copilot bridge profiles include specialist skills added after initialization by re-reading `live/docs/agent-rules/90-skill-catalog.md` and `live/config/review-capabilities.json`.
- Task workflow supports per-task timeline logs at `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl`.
- Existing project docs and legacy agent files are not moved or deleted.

## Behavior Requirements
- Read existing project docs and legacy agent files as input context.
- Do not migrate files by moving/removing them.
- Keep changes minimal and deterministic.
- If `runtime/init-answers.json` already exists and is complete, reuse it instead of forcing the user through all 6 questions again.
- After `octopus setup`, treat the 6 answers as already collected; the agent must not repeat them unless the file is missing, invalid, incomplete, or `AssistantLanguage` cannot be confidently recognized.
- Always validate and normalize `AssistantLanguage` into a clear agent-readable label before saving or re-saving init answers.
- If `AssistantLanguage` cannot be confidently recognized, ask the user for clarification before continuing.
- Never run install before writing `Octopus-agent-orchestrator/runtime/init-answers.json` with all 6 required answers.
- Do not overwrite `CollectedVia=CLI_INTERACTIVE` or `CLI_NONINTERACTIVE` when you are only reusing CLI-collected answers and normalizing the language field.
- Run the final doctor check yourself; do not ask the user to run `doctor`, `verify`, or `validate-manifest` manually.
- Do not modify `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md` during project onboarding.
- Update `Octopus-agent-orchestrator/live/USAGE.md` as part of successful onboarding; that file is expected to become project-specific.
- Never bypass the Node CLI install flow outside this prompt.
- After `<assistant-language>` is collected, continue all following user-facing questions and reports in `<assistant-language>`.
- Treat `node Octopus-agent-orchestrator/bin/octopus.js` as the only canonical runtime surface for lifecycle commands and gates.
- If any check fails, fix the issue and rerun checks until PASS.

## Final Report Format
- What was done.
- Result of each command (PASS or FAIL with key lines).
- Files created or updated.
- `Usage Instructions` section for the user in `<assistant-language>`, with exact next commands for:
  - executing a task (`Execute task <task-id> depth=<1|2|3>`);
  - using default depth (`Execute task <task-id>`);
  - when to use `depth=1`, `depth=2`, and `depth=3`.
  - if token economy is enabled, use `depth=1` only for small, well-localized tasks.
  - default `depth=3` keeps full reviewer context while shared gate-output filtering still applies.
  - where tasks are defined: tasks are managed in the root `TASK.md` file.
  - updating orchestrator workspace:
    - `node Octopus-agent-orchestrator/bin/octopus.js check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"`
    - manual apply: `node Octopus-agent-orchestrator/bin/octopus.js update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt`
- Explicit orchestration note:
  - orchestrator mode starts when the agent executes a task from `TASK.md`;
  - if needed, the agent may create new tasks from user requests and then execute them through the orchestrator workflow.
- Save the full `Usage Instructions` section to `Octopus-agent-orchestrator/live/USAGE.md` so the user can reference it later.
- If optional specialist skills were requested:
  - list newly created `Octopus-agent-orchestrator/live/skills/*` paths;
  - list changed capability flags in `review-capabilities.json`;
  - list whether each added skill is `mandatory` or `optional`.
- If optional specialist skills were not requested:
  - still include the presented `already configured` list, `available` list, and recommendation in the report for traceability.
- Confirmation line: `Workspace ready for task execution`.

## Constraints
- Do not commit.
- Do not remove unrelated files.
- Do not skip verification.
