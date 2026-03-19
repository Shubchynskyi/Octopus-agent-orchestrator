# CLI Reference

Complete command reference for Octopus Agent Orchestrator.

## npm CLI

When installed from npm (`npm install octopus-agent-orchestrator`), three equivalent aliases are available:

```
octopus
oao
octopus-agent-orchestrator
```

From source tree, use: `node bin/octopus.js <command>`.

---

## Commands

### `octopus`

Show a safe overview: current project status plus available commands.

```powershell
octopus
```

This command is non-destructive. It does not deploy or modify files.

---

### `octopus setup`

First-run CLI onboarding. This is the recommended one-command entrypoint for end users.

```powershell
octopus setup
```

**What setup does:**
- Deploys or refreshes `./Octopus-agent-orchestrator/`.
- Collects the 6 init answers itself or accepts them from CLI flags.
- Writes `runtime/init-answers.json`.
- Runs install.
- Validates manifest.
- Leaves full project-specific verify for the setup agent or a later `octopus doctor`.

**Common non-interactive form:**
```powershell
octopus setup --target-root "." --no-prompt --assistant-language "English" --assistant-brevity concise --active-agent-files "AGENTS.md, CLAUDE.md" --source-of-truth Codex --enforce-no-auto-commit no --claude-orchestrator-full-access no --token-economy-enabled yes
```

---

### `octopus status`

Print a short workspace status snapshot.

```powershell
octopus status --target-root "."
```

---

### `octopus doctor`

Run `verify.ps1` plus manifest validation from existing init answers.

```powershell
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

---

### `octopus bootstrap`

Deploy a fresh orchestrator bundle into the current project without running install.

**Branch testing:**
```powershell
octopus bootstrap --repo-url "<git-url>" --branch "<branch>"
```

---

### `octopus install`

Deploy or refresh the orchestrator into a target project. Requires a prepared `init-answers.json` from either `octopus setup` or the setup agent.

```powershell
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**From a fork/branch:**
```powershell
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --repo-url "<git-url>" --branch "<branch>"
```

**Direct PowerShell equivalent:**
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/install.ps1 -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

---

### `octopus init`

Re-materialize `live/` from an existing deployed bundle and existing init answers.
Does **not** replace bootstrap — use when `live/` needs a rebuild.

```powershell
octopus init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**Direct PowerShell equivalent:**
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/init.ps1 -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

---

### `octopus reinit`

Change init answers (language, brevity, source-of-truth, commit guard, Claude access, token economy) without full reinstall.

```powershell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**What reinit does:**
- Re-asks the init questionnaire (or accepts overrides with `--no-prompt`).
- Rewrites `runtime/init-answers.json`.
- Reapplies routing, guard, and metadata.
- Updates `live/docs/agent-rules/00-core.md`, `live/config/token-economy.json`, `live/version.json`.
- Does **not** rebuild full `live/` or create backups.

**Direct PowerShell equivalent:**
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/reinit.ps1 -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**Bash wrapper** (requires `pwsh`):
```bash
bash Octopus-agent-orchestrator/scripts/reinit.sh -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

---

### `octopus update`

Check for updates and optionally apply from git.

```powershell
# Interactive — asks "Apply now?"
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Auto-apply for CI
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt

# From a fork
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --repo-url "<git-url>" --branch "<branch>" --apply

# Dry-run preview
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

**What update does:**
1. Compares local and remote `VERSION`.
2. If newer version exists, syncs bundle files with backup to `runtime/bundle-backups/<timestamp>/`.
3. Migrates missing `init-answers.json` keys (interactive: asks; non-interactive: infers/defaults).
4. Preserves existing `output-filters.json` values while merging new template keys.
5. Runs install/init sync, verification, and manifest validation.
6. Rebuilds `TASK.md` from latest template, migrating existing task rows.
7. Writes update report to `runtime/update-reports/update-<timestamp>.md`.

**Direct PowerShell equivalents:**
```powershell
# Check only
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"

# Auto-apply
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -TargetRoot "." -Apply -NoPrompt -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"

# Dry-run
pwsh -File Octopus-agent-orchestrator/scripts/check-update.ps1 -TargetRoot "." -DryRun -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"

# Manual update (bundle already replaced)
pwsh -File Octopus-agent-orchestrator/scripts/update.ps1 -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"

# Manual silent
pwsh -File Octopus-agent-orchestrator/scripts/update.ps1 -TargetRoot "." -NoInitAnswerPrompt -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**Bash wrapper** (requires `pwsh`):
```bash
bash Octopus-agent-orchestrator/scripts/check-update.sh -TargetRoot "." -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**Note:** `-TargetRoot` should be the project root (parent of `Octopus-agent-orchestrator/`), not the bundle directory itself.

---

### `octopus uninstall`

Remove the orchestrator from a project. Offers choices about what to keep.

```powershell
# Interactive — asks what to keep
octopus uninstall --target-root "."

# Non-interactive — explicit choices
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes

# Dry-run preview
octopus uninstall --target-root "." --dry-run --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts no
```

**What uninstall removes:**
- Managed entrypoints (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, etc.).
- Provider bridge files (`.github/agents/*.md`, `.windsurf/agents/orchestrator.md`, `.junie/agents/orchestrator.md`, `.antigravity/agents/orchestrator.md`).
- Orchestrator entries from `.qwen/settings.json` and `.claude/settings.local.json`.
- Managed commit-guard block from `.git/hooks/pre-commit`.
- The `Octopus-agent-orchestrator/` bundle directory.

**What uninstall preserves:**
- Non-Octopus content in mixed files (only managed blocks are removed).
- Optionally: primary entrypoint, `TASK.md`, runtime artifacts.
- Backups are written to `Octopus-agent-orchestrator-uninstall-backups/<timestamp>/` unless `-SkipBackups`.

**Direct PowerShell equivalents:**
```powershell
pwsh -File Octopus-agent-orchestrator/scripts/uninstall.ps1
pwsh -File Octopus-agent-orchestrator/scripts/uninstall.ps1 -NoPrompt -KeepPrimaryEntrypoint no -KeepTaskFile no -KeepRuntimeArtifacts yes
```

**Bash wrapper** (requires `pwsh`):
```bash
bash Octopus-agent-orchestrator/scripts/uninstall.sh
```

---

### `octopus verify`

Validate deployment consistency and rule contracts.

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -TargetRoot "." -SourceOfTruth "<provider>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
```

**Provider values:** `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

---

### `octopus validate-manifest`

Check manifest uniqueness and integrity.

```powershell
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

```bash
bash Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.sh "Octopus-agent-orchestrator/MANIFEST.md"
```

---

## Agent Gate Commands

Gate scripts exist under `live/scripts/agent-gates/` in both PowerShell (`.ps1`) and Bash (`.sh`) variants.
Bash gate scripts are real dual-runtime implementations (not wrappers) and require `bash` + Python in PATH.

Full gate command reference is in `template/docs/agent-rules/40-commands.md` section **Agent Gates**.

**Quick reference:**

| Gate | PowerShell | Bash |
|---|---|---|
| Classify change | `classify-change.ps1 -UseStaged -TaskIntent "..."` | `classify-change.sh --use-staged --task-intent "..."` |
| Compile gate | `compile-gate.ps1 -TaskId "T-001"` | `compile-gate.sh --task-id "T-001"` |
| Review gate | `required-reviews-check.ps1 -TaskId "T-001" -CodeReviewVerdict "..."` | `required-reviews-check.sh --task-id "T-001" --code-review-verdict "..."` |
| Doc impact | `doc-impact-gate.ps1 -TaskId "T-001" -Decision "..."` | `doc-impact-gate.sh --task-id "T-001" --decision "..."` |
| Completion gate | `completion-gate.ps1 -TaskId "T-001"` | `completion-gate.sh --task-id "T-001"` |
| Scoped diff | `build-scoped-diff.ps1 -ReviewType "db"` | `build-scoped-diff.sh --review-type "db"` |
| Review context | `build-review-context.ps1 -ReviewType "code" -Depth 2` | `build-review-context.sh --review-type "code" --depth 2` |
| Task events | `task-events-summary.ps1 -TaskId "T-001"` | `task-events-summary.sh --task-id "T-001"` |
| Log event | `log-task-event.ps1 -TaskId "T-001" -EventType "..."` | `log-task-event.sh --task-id "T-001" --event-type "..."` |

**Auto-detection pattern (recommended):**
```bash
if command -v pwsh >/dev/null 2>&1; then
  pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.ps1 -UseStaged -TaskIntent "<summary>"
else
  bash Octopus-agent-orchestrator/live/scripts/agent-gates/classify-change.sh --use-staged --task-intent "<summary>"
fi
```

---

## Runtime Requirements

| Component | Requirement |
|---|---|
| Control-plane scripts (`scripts/*.ps1`) | PowerShell 7+ (`pwsh`) |
| Control-plane wrappers (`scripts/*.sh`) | `bash` + `pwsh` |
| Gate scripts (`.ps1`) | PowerShell 7+ |
| Gate scripts (`.sh`) | `bash` + Python (`python3`, `python`, or `py -3`) |
| npm CLI (`bin/octopus.js`) | Node.js 18+ |
