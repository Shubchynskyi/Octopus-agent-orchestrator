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

### Build and Package
```bash
<build command>
<container or artifact packaging command>
```

## Agent Gates
```powershell
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -ChangedFiles @("src/<example-file>") -TaskIntent "<task summary>" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -MetricsPath "Octopus-agent-orchestrator/runtime/metrics.jsonl"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -UseStaged -TaskIntent "<task summary>" -OutputPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -MetricsPath "Octopus-agent-orchestrator/runtime/metrics.jsonl"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -CodeReviewVerdict "<verdict>" -DbReviewVerdict "<verdict>" -SecurityReviewVerdict "<verdict>" -RefactorReviewVerdict "<verdict>" -ApiReviewVerdict "<verdict>" -TestReviewVerdict "<verdict>" -PerformanceReviewVerdict "<verdict>" -InfraReviewVerdict "<verdict>" -DependencyReviewVerdict "<verdict>"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/required-reviews-check.ps1 -PreflightPath "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" -CodeReviewVerdict "SKIPPED_BY_OVERRIDE" -SkipReviews "code" -SkipReason "1-line config hotfix; rollback plan exists"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath "Octopus-agent-orchestrator/MANIFEST.md"
```

Notes:
- In a dirty workspace, prefer `-UseStaged` after staging task-related tracked files.
- `-UseStaged` includes untracked files by default (`-IncludeUntracked=$true`), so new files are classified even before `git add`.
- For maximum precision, pass planned task file list via `-ChangedFiles`.
- In a clean workspace, `classify-change.ps1` can auto-detect changed files from git without additional flags.
- `required-reviews-check.ps1` supports audited override only for code review in tiny low-risk scopes; all other review overrides are rejected.
- Classification roots and trigger regexes are configurable in `Octopus-agent-orchestrator/live/config/paths.json`.
- Optional specialist reviews (`api`, `test`, `performance`, `infra`, `dependency`) become required only when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`.
- Gate scripts can append JSONL metrics to `Octopus-agent-orchestrator/runtime/metrics.jsonl` for threshold tuning.

