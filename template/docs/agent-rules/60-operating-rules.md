# Operating Rules

Primary entry point: [CLAUDE.md](../../../../CLAUDE.md)

## General
1. Always read the file before editing.
2. Follow `Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md` for end-to-end task lifecycle.
3. Follow existing project code style and stack constraints from `10-project-context.md` and `30-code-style.md`.
4. Do not create files unnecessarily.
5. Reuse existing utilities and helpers.

## Execution Depth
1. Resolve execution depth from user request as `depth=1`, `depth=2`, or `depth=3`; default is `depth=2`.
2. Treat depth as context and validation rigor profile, not as a way to bypass mandatory gates.
3. Apply automatic escalation after preflight:
   - `FULL_PATH` requires minimum `depth=2`.
   - required specialized review (`security`, `db`, `refactor`, or enabled optional specialist review) requires minimum `depth=2`.
4. Use profile scope:
   - `depth=1`: read `00-core.md`, `80-task-workflow.md`, and directly touched module context only.
   - `depth=2`: read `00/10/20/40/50/60/80/90` plus touched module context.
   - `depth=3`: read `depth=2` set plus `30/35/70` and perform cross-module edge-case checks.
5. Record selected depth and any escalation in `TASK.md` notes.

## Stack-Specific Rules
1. Do not assume a language or framework unless confirmed in `10-project-context.md` or `live/project-discovery.md`.
2. If language-specific guidance is missing, add it to `30-code-style.md` before making broad refactors.
3. Do not apply framework-specific patterns from another ecosystem (for example Java patterns in Python projects).
4. Keep commands and runbooks in `40-commands.md` aligned with actual project tooling.

## DevOps
1. Do not commit secrets.
2. Use `.env` for local setup.
3. Validate deployment or infrastructure changes using project-native tooling before commit.




