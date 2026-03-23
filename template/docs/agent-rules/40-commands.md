# Commands

Primary entry point: selected source-of-truth entrypoint for this workspace.

IMPORTANT: The user prefers running commands manually. Do not execute `task` commands unless the prompt explicitly asks for it.
Exception: You may run tests and iterate only when the user explicitly requests this workflow.
Canonical gate surface is `node Octopus-agent-orchestrator/bin/octopus.js gate <name>`.

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
npx octopus-agent-orchestrator agent-init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md" --project-rules-updated yes --skills-prompted yes
npx octopus-agent-orchestrator doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
npx octopus-agent-orchestrator --help
```

### Skill Packs
```bash
npx octopus-agent-orchestrator skills list --target-root "."
npx octopus-agent-orchestrator skills suggest --target-root "." --task-text "<task summary>" --changed-path "<path>"
npx octopus-agent-orchestrator skills add node-backend --target-root "."
npx octopus-agent-orchestrator skills validate --target-root "."
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
- This command is executed by `node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate` before review phase.

### Build and Package
```bash
npm run build
docker build .
```

## Compact Command Policy

Compact command usage is mandatory by default. Treat full or verbose output as an escalation step, not a starting point.

### Required Protocol
1. First pass must use compact, summary, structured (`--json`), bounded, or path-scoped output.
2. Escalate in this order only: `scan -> inspect -> debug`.
3. Use repository-wide or unbounded output only when no scoped equivalent exists or the scoped pass failed to localize the issue.
4. Full output is allowed immediately only for:
   - security, auth, secrets, migrations, or infra-sensitive diagnostics;
   - the first encounter with an unfamiliar tool output format;
   - single-target failure debugging after localization.
5. Before switching to verbose or full output, state briefly why compact output is insufficient.

### Mode Selection
| Mode | Default output policy | Expected usage |
|---|---|---|
| `scan` | compact, bounded, summary-only | quick repo or tool overview |
| `inspect` | scoped, file/path/test-target bounded | localized investigation |
| `debug` | verbose/full, local target only | reproduce or explain a known failure |
| `sensitive` | complete output, no unsafe truncation | auth, secrets, CVE, migration, infra diagnostics |

### Two-Pass Rule
1. Start with compact scan.
2. Narrow to targeted inspect.
3. Escalate to verbose/full output only for the localized target.

Examples:
- `git diff --stat` -> `git diff -- path/to/file.ts`
- `rg -l --max-count=5 pattern src/` -> `rg -C2 pattern src/feature/`
- `pytest -q --tb=short` -> `pytest tests/test_auth.py::test_refresh -vv --tb=long`

### Noisy Commands Require Justification
Do not start with noisy or unbounded commands when a compact equivalent exists.

Examples that must not be first pass without a reason:
- `git diff` without `--stat` or pathspec
- `git log --all`
- `rg` or `grep` across the entire repository without path scope
- `cat` on large files
- `docker logs` / `kubectl logs` without `--tail`
- verbose test runners on the first pass

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
Canonical gate surface is the Node CLI router.

```bash
node Octopus-agent-orchestrator/bin/octopus.js gate classify-change --changed-file "src/<example-file>" --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --metrics-path "Octopus-agent-orchestrator/runtime/metrics.jsonl"
node Octopus-agent-orchestrator/bin/octopus.js gate classify-change --use-staged --task-intent "<task summary>" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --metrics-path "Octopus-agent-orchestrator/runtime/metrics.jsonl"
node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate --task-id "<task-id>" --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"
node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "<verdict>" --db-review-verdict "<verdict>" --security-review-verdict "<verdict>" --refactor-review-verdict "<verdict>" --api-review-verdict "<verdict>" --test-review-verdict "<verdict>" --performance-review-verdict "<verdict>" --infra-review-verdict "<verdict>" --dependency-review-verdict "<verdict>"
node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --code-review-verdict "SKIPPED_BY_OVERRIDE" --skip-reviews "code" --skip-reason "1-line config hotfix; rollback plan exists"
node Octopus-agent-orchestrator/bin/octopus.js gate doc-impact-gate --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --rationale "No behavior/contract/ops-doc impact."
node Octopus-agent-orchestrator/bin/octopus.js gate doc-impact-gate --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>" --decision "NO_DOC_UPDATES" --behavior-changed false --changelog-updated false --sensitive-scope-reviewed true --rationale "API trigger fired but changes are internal-only: no public contract affected."
node Octopus-agent-orchestrator/bin/octopus.js gate completion-gate --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --task-id "<task-id>"
node Octopus-agent-orchestrator/bin/octopus.js gate log-task-event --task-id "<task-id>" --event-type "PLAN_CREATED" --outcome "INFO" --message "<short stage message>" --actor "orchestrator"
node Octopus-agent-orchestrator/bin/octopus.js gate task-events-summary --task-id "<task-id>"
node Octopus-agent-orchestrator/bin/octopus.js gate build-scoped-diff --review-type "<db|security|refactor>" --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.diff" --metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json"
node Octopus-agent-orchestrator/bin/octopus.js gate build-review-context --review-type "<code|db|security|refactor|api|test|performance|infra|dependency>" --depth <1|2|3> --preflight-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-preflight.json" --scoped-diff-metadata-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-scoped.json" --output-path "Octopus-agent-orchestrator/runtime/reviews/<task-id>-<review-type>-review-context.json"
node Octopus-agent-orchestrator/bin/octopus.js gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"
node Octopus-agent-orchestrator/bin/octopus.js gate human-commit --message "<message>"
```

Notes:
- In a dirty workspace, prefer `--use-staged` after staging task-related tracked files.
- `--use-staged` includes untracked files by default, so new files are classified even before `git add`.
- Do not use `git add -f` for ignored orchestration control-plane files (`TASK.md`, `Octopus-agent-orchestrator/runtime/**`, `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`); their absence from staged diff is expected.
- For maximum precision, pass planned task file list via repeated `--changed-file`.
- In a clean workspace, `classify-change` can auto-detect changed files from git without additional flags.
- Compile gate is mandatory before review phase; run `node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate` and treat non-zero result as blocking.
- Compile gate is strict: preflight scope drift blocks execution. Re-run `classify-change` when scope changes.
- `required-reviews-check` additionally validates compile evidence in `runtime/task-events/<task-id>.jsonl`; without `COMPILE_GATE_PASSED` the review gate fails.
- `required-reviews-check` validates workspace drift against compile evidence scope snapshot; any post-compile changes require re-run of compile gate.
- `required-reviews-check` supports audited override only for code review in tiny low-risk scopes; all other review overrides are rejected.
- `doc-impact-gate` is mandatory before completion; it writes `runtime/reviews/<task-id>-doc-impact.json`. When the preflight detected `api`, `security`, `infra`, `dependency`, or `db` triggers, `NO_DOC_UPDATES` requires `--sensitive-scope-reviewed true` with a rationale explaining why no documentation updates are needed.
- `completion-gate` validates compile evidence, review-gate evidence, doc-impact evidence, rework-after-failure evidence, required review artifacts, and best-effort task-event integrity before `DONE`.
- `build-scoped-diff` can also write `runtime/reviews/<task-id>-<review-type>-scoped.json` so reviewer prompts know whether scoped diff fell back to full diff.
- `build-review-context` writes `runtime/reviews/<task-id>-<review-type>-review-context.json` plus a sibling markdown snapshot referenced by `rule_context.artifact_path`; the JSON records selected rule pack, omitted sections, sanitized rule-context metadata, and scoped-diff fallback evidence for token economy mode.
- Classification roots and trigger regexes are configurable in `Octopus-agent-orchestrator/live/config/paths.json`.
- Optional specialist reviews (`api`, `test`, `performance`, `infra`, `dependency`) become required only when enabled in `Octopus-agent-orchestrator/live/config/review-capabilities.json`.
- Gate commands can append JSONL metrics to `Octopus-agent-orchestrator/runtime/metrics.jsonl` for threshold tuning.
- Task event timeline is written to `Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl` (plus aggregate `all-tasks.jsonl`) with best-effort append locking for both files.
- New task-event writes include a per-task hash chain (`integrity.task_sequence`, `prev_event_sha256`, `event_sha256`) to detect local tampering, replay, and out-of-order inserts after the fact.
- Human-readable timeline can be generated with `node Octopus-agent-orchestrator/bin/octopus.js gate task-events-summary`; summary output includes `IntegrityStatus`.
