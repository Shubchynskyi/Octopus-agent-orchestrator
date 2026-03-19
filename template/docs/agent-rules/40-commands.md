# Commands

Primary entry point: [CLAUDE.md](../../../../CLAUDE.md)

IMPORTANT: The user prefers running commands manually. Do not execute `task` commands unless the prompt explicitly asks for it.
Exception: You may run tests and iterate only when the user explicitly requests this workflow.
PowerShell-based gate scripts require PowerShell 7+ (`pwsh`) unless shell alternatives are provided by the target project.

## Project Commands (Required)
Replace these defaults with repository-specific commands when the real project differs.

### Setup
```bash
npm install --prefer-offline --no-fund --no-audit
npx octopus-agent-orchestrator setup
```

### Run
```bash
npx octopus-agent-orchestrator status --target-root "."
npx octopus-agent-orchestrator doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
npx octopus-agent-orchestrator --help
```

### Test
```bash
npm test
npm run test:integration
npm run test:e2e
```

### Quality
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run format:check
```

### Compile Gate (Mandatory)
```bash
npm run build
```

Rules:
- First non-empty non-comment line from this block is the compile gate command.
- Command must be non-interactive and must return non-zero exit code on compile failure.
- This command is executed by `compile-gate.ps1` / `compile-gate.sh` before review phase.

### Build and Package
```bash
npm run build
docker build .
```

## Compact Command Hints

Prefer compact output flags for everyday shell commands. This reduces context noise and saves tokens regardless of token-economy settings.
Switch to full/verbose output only when diagnosing a specific failure.

### Principle
1. Use summary or structured (`--json`) output by default.
2. Limit result counts (`--max-count`, `-n`, `--tail`) when scanning, not inspecting.
3. Scope commands to affected paths instead of entire repository.
4. Never truncate output of security-relevant, migration, or auth-path commands.

### Version Control (git)
| Instead of | Prefer | Use case |
|---|---|---|
| `git diff` | `git diff --stat` | Scope overview |
| `git diff` | `git diff -- path/to/file.ts` | Targeted inspection |
| `git log` | `git log --oneline -n 20` | Recent history |
| `git log --all` | `git log --oneline --graph -n 30` | Branch topology |
| `git status` | `git status --short --branch` | Quick state |
| `git show <sha>` | `git show --stat <sha>` | Commit overview |
| `git stash list` | `git stash list --oneline` | Stash summary |

### Testing
| Tool | Compact flags | Notes |
|---|---|---|
| pytest | `-q --tb=short --no-header` | Add `--tb=long` only for failing test investigation |
| jest / vitest | `--silent` or `--verbose=false` | Default reporters are noisy |
| go test | `-count=1 -short` | Add `-v` only for specific test debug |
| cargo test | `-- --format=terse` | Terse hides passing tests |
| dotnet test | `--verbosity quiet` | Use `normal` on failure |
| phpunit | `--no-progress --compact` | Suppress per-test dots |

### Package Managers
| Instead of | Prefer | Saves |
|---|---|---|
| `npm install` | `npm install --prefer-offline --no-fund --no-audit` | Suppresses advisory noise |
| `npm ls` | `npm ls --depth=0` | Top-level deps only |
| `npm ls` (programmatic) | `npm ls --json --depth=0` | Structured, agent-friendly |
| `pip install -r req.txt` | `pip install -q -r req.txt` | Quiet progress bars |
| `pip list` | `pip list --format=columns` | Compact table |
| `yarn install` | `yarn install --silent` | No progress |
| `composer install` | `composer install --quiet` | No progress |

### Build, Lint & Type-Check
| Tool | Compact flags |
|---|---|
| tsc | `--noEmit --pretty false` |
| eslint | `--format=compact` |
| eslint (programmatic) | `--format=json` |
| dotnet build | `--verbosity quiet` |
| gradle | `-q` or `--console=plain` |
| mvn | `-q` (quiet) or `-B` (batch non-interactive) |
| cargo build | `--message-format=short` |

### Search & File Inspection
| Instead of | Prefer | Reason |
|---|---|---|
| `grep -r <pat> .` | `grep -rl --max-count=5 <pat> src/` | Files only, bounded, scoped |
| `rg <pat>` | `rg -l --max-count=5 <pat> src/` | Files only, bounded, scoped |
| `rg <pat>` (with context) | `rg -C2 --max-count=10 <pat> src/` | Limited context, bounded |
| `cat <large-file>` | `head -n 60 <file>` or `tail -n 60 <file>` | Targeted region |
| `find . -name "*.ts"` | `find . -name "*.ts" -not -path "*/node_modules/*"` | Exclude noise dirs |
| `ls -laR` | `ls -la src/` or `tree -L 2 src/` | Scoped, bounded depth |

### Containers & Infrastructure
| Instead of | Prefer |
|---|---|
| `docker logs <c>` | `docker logs --tail 50 <c>` |
| `kubectl logs <pod>` | `kubectl logs --tail=50 <pod>` |
| `docker ps` | `docker ps --format "table \{{.Names}}\t\{{.Status}}"` |
| `kubectl get pods` | `kubectl get pods -o wide` or `-o json` |

### When Full Output Is Required
- Diagnosing a specific test failure — use verbose mode (`--tb=long`, `-v`) for that test only.
- Debugging build/compile errors — read full compiler output, then switch back to compact.
- Security-sensitive commands — never truncate; auth, secrets, CVE, migration outputs must stay complete.
- First encounter with unfamiliar tool output — read full once, then adopt compact flags.

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
