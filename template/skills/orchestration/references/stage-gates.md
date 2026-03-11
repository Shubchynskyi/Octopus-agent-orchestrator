# Stage Gates

## Gate 1: Task Selection
Pass criteria:
- Task exists in `TODO` and moved to `IN_PROGRESS`.

## Gate 2: Plan
Pass criteria:
- Plan covers scope, files, risks, and checks.

## Gate 3: Preflight Classification
Pass criteria:
- Preflight artifact exists: `Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json`.
- Path mode is declared by script output: `FAST_PATH` or `FULL_PATH`.
- Required reviews are declared by preflight output.

## Gate 4: Tests or Validation
Pass criteria:
- `FULL_PATH` runtime code: required tests defined and currently meaningful.
- `FAST_PATH` runtime code or non-runtime tasks: explicit validation checklist exists.

## Gate 5: Implementation
Pass criteria:
- Changes satisfy planned scope without unrelated edits.

## Gate 6: Checks
Pass criteria:
- Compile gate passed before review phase:
  - `compile-gate.ps1` / `compile-gate.sh` result is pass.
  - Task timeline contains `COMPILE_GATE_PASSED`.

## Gate 7: Independent Reviews
Pass criteria:
- Task moved to `IN_REVIEW`.
- Code review verdict `REVIEW PASSED` when `required_reviews.code=true`, otherwise `NOT_REQUIRED`.
- DB review verdict `DB REVIEW PASSED` when `required_reviews.db=true`, otherwise `NOT_REQUIRED`.
- Security review verdict `SECURITY REVIEW PASSED` when `required_reviews.security=true`, otherwise `NOT_REQUIRED`.
- Refactor review verdict `REFACTOR REVIEW PASSED` when `required_reviews.refactor=true`, otherwise `NOT_REQUIRED`.
- Review artifacts satisfy `TASK.md` artifact contract.
- `required-reviews-check.ps1` / `.sh` result is pass.
- `required-reviews-check` compile-evidence check is pass for same task id.

## Gate 8: Documentation Finalization
Pass criteria:
- Documentation impact assessed.
- Required docs updated for impacted behavior.
- Changelog updated for runtime behavior changes.

## Gate 9: Completion
Pass criteria:
- All required gates passed.
- `completion-gate.ps1` / `.sh` result is pass.
- Timeline contains `COMPLETION_GATE_PASSED`.
- Task marked `DONE`.
- Artifact contract fields are valid for path mode, required verdicts, and evidence.
- User report is delivered in mandatory order: implementation summary -> `git commit -m "<message>"` suggestion -> `Do you want me to commit now? (yes/no)`.

## Failure Policy
- Any failed gate blocks next gates.
- Set task status to `BLOCKED` when gate cannot be satisfied now.
- Resume only after blocker is resolved.


