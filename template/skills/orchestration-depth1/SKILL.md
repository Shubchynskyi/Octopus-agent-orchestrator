---
name: orchestration-depth1
description: Short-form orchestration guidance for localized `depth=1` execution when token economy is active. Use for small, well-bounded tasks that do not require broader cross-module reasoning or mandatory depth escalation.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(pwsh:*)
  - Edit
  - Write
metadata:
  author: Octopus-agent-orchestrator
  version: 1.0.0
  runtime_requirement: PowerShell 7+ (pwsh) or Bash + Python 3 for gate scripts
---

# Orchestration (Depth 1 Short Form)

Use this short form only when all of the following stay true:
- effective depth is `1`;
- scope is small and well localized;
- no automatic escalation trigger fires;
- correctness does not depend on broad cross-module context.

Escalate back to the full orchestration skill immediately if:
- preflight reports `FULL_PATH`;
- required `db`, `security`, or `refactor` review forces `depth>=2`;
- the change touches auth, payments, sensitive data, infra, or other high-risk areas;
- scope drifts beyond the original task.

## Minimal Required Inputs
- user request;
- `TASK.md` row for the task;
- `AGENTS.md` routing entrypoint;
- preflight artifact for the task;
- directly touched module context;
- `00-core.md` and `80-task-workflow.md`;
- only the rule ids/snippets directly triggered by changed scope.

## Compact Workflow
1. Move the task to `IN_PROGRESS` and capture requested/effective depth in `TASK.md`.
2. Build a concise plan focused on changed files, risks, and validation.
3. Run preflight/classification and stop using this short form if escalation is required.
4. Read only minimal context: core rules, task workflow, touched module context, and scope-triggered rule snippets.
5. Implement the smallest safe change that satisfies the task.
6. Run objective validation for the touched area.
7. Run the mandatory compile gate.
8. Run only the required independent reviews from preflight.
9. Resolve findings, run completion gate, and only then mark the task `DONE`.

## Hard Rules
- Depth changes context budget, never gate obligations.
- Do not skip compile, review, or completion gates.
- Re-run preflight after meaningful scope changes.
- Do not mark a task `DONE` while review findings remain unresolved or unjustified.
- Prefer concise evidence and scoped artifacts over pasting large raw outputs.
