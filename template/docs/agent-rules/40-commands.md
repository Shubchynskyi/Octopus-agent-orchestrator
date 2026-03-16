# Commands

Primary entry point: [CLAUDE.md](../../../../CLAUDE.md)

IMPORTANT: The user prefers running commands manually. Do not execute `task` commands unless the prompt explicitly asks for it.
Exception: You may run tests and iterate only when the user explicitly requests this workflow.
PowerShell-based gate scripts require PowerShell 7+ (`pwsh`) unless shell alternatives are provided by the target project.

## Project Commands (Required)
Replace placeholders with real commands from this repository.

### Setup
```bash
<install dependencies command>
<local environment bootstrap command>
```

### Run
```bash
<start backend command>
<start frontend command>
<start worker or background job command>
```

### Test
```bash
<unit test command>
<integration test command>
<e2e test command>
```

### Quality
```bash
<lint command>
<type-check command>
<format check command>
```

### Compile Gate (Mandatory)
```bash
<compile command>
```

Rules:
- First non-empty non-comment line from this block is the compile gate command.
- Command must be non-interactive and must return non-zero exit code on compile failure.
- This command is executed by `compile-gate.ps1` / `compile-gate.sh` before review phase.

### Build and Package
```bash
<build command>
<container or artifact packaging command>
```

## Agent Gates
```powershell
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -ChangedFiles @("src/<example-file>") -TaskIntent "<task summary>" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -MetricsPath "Octopus-agent-orchestrator/runtime/metrics.jsonl"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -UseStaged -TaskIntent "<task summary>" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -MetricsPath "Octopus-agent-orchestrator/runtime/metrics.jsonl"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.ps1 -TaskId "<task-id>" -CommandsPath "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -CodeReviewVerdict "<verdict>" -DbReviewVerdict "<verdict>" -SecurityReviewVerdict "<verdict>" -RefactorReviewVerdict "<verdict>" -ApiReviewVerdict "<verdict>" -TestReviewVerdict "<verdict>" -PerformanceReviewVerdict "<verdict>" -InfraReviewVerdict "<verdict>" -DependencyReviewVerdict "<verdict>"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -CodeReviewVerdict "SKIPPED_BY_OVERRIDE" -SkipReviews "code" -SkipReason "1-line config hotfix; rollback plan exists"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -Decision "NO_DOC_UPDATES" -BehaviorChanged $false -ChangelogUpdated $false -Rationale "No behavior/contract/ops-doc impact."
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>" -Decision "NO_DOC_UPDATES" -BehaviorChanged $false -ChangelogUpdated $false -SensitiveScopeReviewed $true -Rationale "API trigger fired but changes are internal-only: no public contract affected."
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -TaskId "<task-id>"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.ps1 -TaskId "<task-id>" -EventType "PLAN_CREATED" -Outcome "INFO" -Message "<short stage message>" -Actor "orchestrator"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.ps1 -TaskId "<task-id>"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.ps1 -ReviewType "<db|security|refactor>" -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" -MetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.ps1 -ReviewType "<code|db|security|refactor|api|test|performance|infra|dependency>" -Depth <1|2|3> -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -ScopedDiffMetadataPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath "Octopus-agent-orchestrator/MANIFEST.md"
```

```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --changed-file "src/<example-file>" --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --metrics-path "Octopus-agent-orchestrator/runtime/metrics.jsonl"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --metrics-path "Octopus-agent-orchestrator/runtime/metrics.jsonl"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/compile-gate.sh --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "SKIPPED_BY_OVERRIDE" --skip-reviews "code" --skip-reason "1-line config hotfix; rollback plan exists"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --rationale "No behavior/contract/ops-doc impact."
bash Octopus-agent-orchestrator/live/scripts/agent-gates/doc-impact-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --sensitive-scope-reviewed true --rationale "API trigger fired but changes are internal-only: no public contract affected."
bash Octopus-agent-orchestrator/live/scripts/agent-gates/completion-gate.sh --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/log-task-event.sh --task-id "<task-id>" --event-type "PLAN_CREATED" --outcome "INFO" --message "<short stage message>" --actor "orchestrator"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/task-events-summary.sh --task-id "<task-id>"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-scoped-diff.sh --review-type "<db|security|refactor>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/build-review-context.sh --review-type "<code|db|security|refactor|api|test|performance|infra|dependency>" --depth <1|2|3> --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```

```bash
# Gate runner auto-detection pattern (preferred in agent workflows)
if command -v pwsh >/dev/null 2>&1; then
  pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -UseStaged -TaskIntent "<task summary>" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
else
  bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json"
fi
```

Notes:
- Bash gate scripts require a Python runtime in PATH (`python3`, `python`, or `py -3`).
- In a dirty workspace, prefer `-UseStaged` after staging task-related tracked files.
- `-UseStaged` includes untracked files by default (`-IncludeUntracked=$true` for `ps1`, `--include-untracked true` for `sh`), so new files are classified even before `git add`.
- Do not use `git add -f` for ignored orchestration control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`); their absence from staged diff is expected.
- For maximum precision, pass planned task file list via `-ChangedFiles` (`ps1`) or repeated `--changed-file` (`sh`).
- In a clean workspace, `classify-change.ps1` and `classify-change.sh` can auto-detect changed files from git without additional flags.
- Compile gate is mandatory before review phase; run `compile-gate.ps1` / `compile-gate.sh` and treat non-zero result as blocking.
- Compile gate is strict: preflight scope drift blocks execution. Re-run `classify-change` when scope changes.
- `required-reviews-check` additionally validates compile evidence in `runtime/task-events/<task-id>.jsonl`; without `COMPILE_GATE_PASSED` the review gate fails.
- `required-reviews-check` validates workspace drift against compile evidence scope snapshot; any post-compile changes require re-run of compile gate.
- `required-reviews-check.ps1` and `required-reviews-check.sh` support audited override only for code review in tiny low-risk scopes; all other review overrides are rejected.
- `doc-impact-gate` is mandatory before completion; it writes `runtime/reviews/<task-id>-doc-impact.json`. When the preflight detected `api`, `security`, `infra`, `dependency`, or `db` triggers, `NO_DOC_UPDATES` requires `-SensitiveScopeReviewed:$true` / `--sensitive-scope-reviewed true` with a rationale explaining why no documentation updates are needed.
- `completion-gate` validates compile evidence, review-gate evidence, doc-impact evidence, rework-after-failure evidence, required review artifacts, and best-effort task-event integrity before `DONE`.
- `build-scoped-diff.ps1` / `.sh` can also write `runtime/reviews/<task-id>-<review-type>-scoped.json` so reviewer prompts know whether scoped diff fell back to full diff.
- `build-review-context.ps1` / `.sh` writes `runtime/reviews/<task-id>-<review-type>-review-context.json` plus a sibling markdown snapshot referenced by `rule_context.artifact_path`; the JSON records selected rule pack, omitted sections, sanitized rule-context metadata, and scoped-diff fallback evidence for token economy mode.
- Classification roots and trigger regexes are configurable in `Octopus-agent-orchestrator/live/config/paths.json`.
- Optional specialist reviews (`api`, `test`, `performance`, `infra`, `dependency`) become required only when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`.
- Gate scripts can append JSONL metrics to `Octopus-agent-orchestrator/runtime/metrics.jsonl` for threshold tuning.
- Task event timeline is written to `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl` (plus aggregate `all-tasks.jsonl`) with best-effort append locking for both files.
- New task-event writes include a per-task hash chain (`integrity.task_sequence`, `prev_event_sha256`, `event_sha256`) to detect local tampering, replay, and out-of-order inserts after the fact.
- Human-readable timeline can be generated with `task-events-summary.ps1` / `.sh`; summary output includes `IntegrityStatus`.
