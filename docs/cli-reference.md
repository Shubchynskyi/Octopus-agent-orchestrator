# CLI Reference

Complete command reference for Octopus Agent Orchestrator.

## Public Surface

The runtime is Node-only.

- Aliases: `octopus`, `oao`, `octopus-agent-orchestrator`
- Source invocation: `node bin/octopus.js <command>`
- Runtime baseline: `Node.js 24 LTS`
- Source installs from a git/source checkout run `npm prepare`, which builds the generated `bin/octopus.js` launcher and compiled runtime before execution.

---

## Core Commands

### `octopus`

Safe overview of the current workspace.

```text
octopus
```

### `octopus setup`

First-run onboarding. Recommended entrypoint for end users.

```text
octopus setup
octopus setup --target-root "." --no-prompt --assistant-language "English" --assistant-brevity concise --source-of-truth Codex --enforce-no-auto-commit no --claude-orchestrator-full-access no --token-economy-enabled yes
```

What it does:
- deploys or refreshes `./Octopus-agent-orchestrator/`
- collects or accepts the 6 init answers
- writes `runtime/init-answers.json`
- runs install
- validates `MANIFEST.md`
- leaves final agent onboarding for `AGENT_INIT_PROMPT.md` and `octopus agent-init`

Notes:
- `setup` supports `--active-agent-files` for fully scripted flows, but ordinary onboarding leaves explicit active-agent-file confirmation to `octopus agent-init`.
- After CLI setup the workspace is still in agent handoff state, not ready for task execution.

### `octopus agent-init`

Hard code-level onboarding gate. This command writes `runtime/agent-init-state.json` and blocks `Workspace ready` until it passes.

```text
octopus agent-init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md, CLAUDE.md" --project-rules-updated yes --skills-prompted yes
```

### `octopus status`

```text
octopus status --target-root "."
octopus status why-blocked --target-root "."
```

Notes:
- `status` prints the normal workspace readiness snapshot.
- `status why-blocked` inspects `TASK.md`, task timelines, and failed gate markers to explain why `BLOCKED`, `IN_PROGRESS`, or `IN_REVIEW` tasks are stalled.
- `status why-blocked` also surfaces task-event locks that can block timeline writes and reminds the operator that `runtime/reviews/` is not part of the lock subsystem.

### `octopus doctor`

Runs `octopus verify` plus `octopus gate validate-manifest`.

```text
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus doctor --target-root "." --cleanup-stale-locks --dry-run
octopus doctor --target-root "." --cleanup-stale-locks
octopus doctor explain COMPILE_GATE_FAILED
octopus doctor explain --list
```

Notes:
- `doctor` remains the aggregate verify + manifest + timeline health command.
- `doctor` reports task-event lock health under `Octopus-agent-orchestrator/runtime/task-events/*.lock`, including owner metadata, stale-vs-live assessment, and remediation guidance.
- `doctor --cleanup-stale-locks --dry-run` previews stale task-event locks that are safe to remove; rerun without `--dry-run` to delete only those proven-stale lock directories.
- `runtime/reviews/` is not part of the task-event lock subsystem and is never cleaned by `doctor --cleanup-stale-locks`.
- `doctor explain <FAILURE_ID>` prints remediation steps for known failure IDs such as `TASK_MODE_NOT_ENTERED`, `COMPILE_GATE_FAILED`, and `TIMELINE_INCOMPLETE`.
- `doctor explain --list` prints the current remediation database keys.

### `octopus bootstrap`

Deploy the bundle without running install.

```text
octopus bootstrap
octopus bootstrap --repo-url "<git-url>" --branch "<branch>"
```

### `octopus install`

Deploy or refresh the orchestrator from prepared init answers.

```text
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --repo-url "<git-url>" --branch "<branch>"
```

### `octopus init`

Re-materialize `live/` from an existing deployed bundle.

```text
octopus init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

### `octopus reinit`

Change init answers without a full reinstall.

```text
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

Notes:
- `reinit` re-materializes `live/` based on new answers and enforces a hard atomic consistency invariant for the deployed bundle.
- After sync, a mandatory post-reinit invariant check proves the deployed bundle is structurally complete (includes `bin`, `dist`, `package.json`, `VERSION`, and `template`) relative to the source being applied.

### `octopus verify`

Validate deployment consistency and rule contracts.

```text
octopus verify --target-root "." --source-of-truth "Codex" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

Provider values: `Claude`, `Codex`, `Gemini`, `Qwen`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

### `octopus check-update`

Compare the current deployment with a newer npm package or a local unpacked bundle root. By default this only checks; `--apply` performs the update immediately.

```text
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --package-spec "octopus-agent-orchestrator@latest"
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --source-path "."
```

Notes:
- By default `check-update` uses the deployed package name from `Octopus-agent-orchestrator/package.json` with the npm `latest` tag.
- `--package-spec` accepts npm specs such as `octopus-agent-orchestrator@<target-version>`, dist-tags like `@latest`, and local tarballs like `.\octopus-agent-orchestrator-<target-version>.tgz`.
- `--source-path` is for local testing against an unpacked repo or bundle directory.
- `--trust-override` is an explicit bypass for non-allowlisted npm specs, git sources, or local `--source-path` testing, and the public CLI only accepts it together with `--no-prompt`.
- Ordinary CLI/runtime flows ignore `OCTOPUS_UPDATE_TRUST_OVERRIDE`; that environment variable is reserved for test-only harness paths, not for production or CI.
- `--apply` runs the full update lifecycle after bundle sync, re-materializes `live/`, applies built-in live-rule contract migrations for existing workspaces, runs verify plus manifest validation, enforces a hard atomic consistency invariant for the deployed bundle, defers `VERSION` until lifecycle success, and creates rollback artifacts for the last applied update.

### `octopus update`

Apply the update workflow directly.

```text
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --package-spec "octopus-agent-orchestrator@latest"
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --source-path "."
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

Notes:
- `update` always applies the update workflow unless `--dry-run` is used.
- Use `--trust-override --no-prompt` only when you intentionally bypass the trusted-source allowlist for a local or non-standard source; the update report records that override.
- Successful applies sync bundle files, run install, re-materialize `live/`, apply built-in live-rule contract migrations for existing workspaces, run verify plus manifest validation, and only then write the final `VERSION` marker.
- Successful applies create rollback artifacts under `Octopus-agent-orchestrator/runtime/update-rollbacks/` and `Octopus-agent-orchestrator/runtime/bundle-backups/`.
- Update reports now reflect actual execution status; steps with no configured runner are reported as skipped rather than pass.
- Use `octopus check-update --apply` when you want a compare-first flow with optional apply.

### `octopus update git`

Apply the update workflow from a git source explicitly.

```text
octopus update git --target-root "." --repo-url "https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git"
octopus update git --target-root "." --repo-url "." --check-only
octopus update git --target-root "." --repo-url "." --branch "master"
octopus update git
```

Notes:
- `update git` uses `git clone --depth 1` into a temp directory, then runs the same update lifecycle as npm-based `update`.
- `--check-only` compares the git source without applying it.
- Trusted git sources stay in enforced mode; if you bypass git-source trust with `--trust-override --no-prompt`, that override is recorded in CLI output and the update report.
- With no extra flags, `octopus update git` targets the current directory and uses the default GitHub repository URL.

### `octopus rollback`

Rollback to a specific orchestrator version or restore from the latest rollback snapshot.

```text
octopus rollback --target-root "."
octopus rollback --target-root "." --dry-run
octopus rollback --target-root "." --snapshot-path "Octopus-agent-orchestrator/runtime/update-rollbacks/update-20260325-114000"
octopus rollback --target-root "." --to-version "<target-version>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus rollback --target-root "." --to-version "<target-version>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --source-path "."
octopus rollback --target-root "." --to-version "<target-version>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --package-spec "octopus-agent-orchestrator@<target-version>"
```

Notes:
- Without `--to-version`, `rollback` restores the latest saved pre-update workspace snapshot and, when available, the latest bundle backup created by `update` or `check-update --apply`.
- With `--to-version`, `rollback` acquires that orchestrator version, syncs the bundle, re-runs install/materialization, and updates `VERSION` only after success.
- `--init-answers-path` is required for version-based rollback because the workspace is re-materialized for the requested version.
- `--snapshot-path` applies to snapshot-mode rollback; with no `--snapshot-path`, `rollback` uses the latest saved rollback snapshot automatically.
- Older updates created before rollback metadata persistence may require manual recovery.

### `octopus cleanup`

Remove retained runtime artifacts under `Octopus-agent-orchestrator/runtime/` using count- and age-based retention limits. Use `--dry-run` to preview removals without deleting anything.

```text
octopus cleanup --target-root "."
octopus cleanup --target-root "." --dry-run
octopus cleanup --target-root "." --max-age-days 14 --max-backups 5 --max-task-events 30
octopus cleanup --target-root "." --max-reviews 20 --max-update-rollbacks 10 --max-update-reports 10 --max-bundle-backups 5
```

Notes:
- `cleanup` only operates on supported runtime artifact categories: backups, bundle-backups, task-event logs, review artifacts, update-rollbacks, and update-reports.
- `--dry-run` reports projected removals and bytes reclaimed without mutating the filesystem.
- Retention accepts both a global age limit (`--max-age-days`) and per-category count limits (`--max-backups`, `--max-task-events`, `--max-reviews`, `--max-update-rollbacks`, `--max-update-reports`, `--max-bundle-backups`).
- Count-based eviction uses **real filesystem recency** (file modification time), not task-id ordering. When the number of items exceeds the cap, the least recently modified entries are removed first. When modification times are equal, task-id / filename order is used as a deterministic tie-breaker.
- For review artifacts, recency is determined per task group: the most recent `mtime` among all files in a `T-xxx-*` group represents that group's freshness.
- `runtime/task-events/all-tasks.jsonl` is always preserved and is never treated as a removable task-event artifact.
- Cleanup runs under the lifecycle operation lock to avoid concurrent mutation of the same runtime state.

### `octopus uninstall`

Remove the orchestrator from a project.

```text
octopus uninstall --target-root "."
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes
octopus uninstall --target-root "." --dry-run --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts no
```

Notes:
- Uninstall removes managed blocks, bridge files, and the deployed bundle while preserving unrelated user content.
- Before destructive work, uninstall creates an internal journal snapshot and attempts automatic restore if the uninstall flow fails mid-run.
- `--skip-backups` skips the user-facing recovery backup copies; use it only when you intentionally accept losing those recovery artifacts.
- `--keep-runtime-artifacts yes` preserves runtime reports, rollback snapshots, and task-event history under `Octopus-agent-orchestrator/runtime/`, along with user-owned `live/docs/project-memory/**`.

### `octopus skills`

Manage optional built-in domain packs and generate code-driven recommendations from the compact skills index.

```text
octopus skills list --target-root "."
octopus skills suggest --target-root "." --task-text "Fix slow API endpoint" --changed-path "src/api/users.ts"
octopus skills add java-spring --target-root "."
octopus skills remove java-spring --target-root "."
octopus skills validate --target-root "."
```

Rules:
- `skills suggest` reads only `live/config/skills-index.json` to score optional skills.
- After user selection, the chosen pack is installed into `live/skills/**` without reading its full optional `SKILL.md` immediately.
- Full optional `SKILL.md` files are loaded only when a selected skill is actually activated for a task or a hard activation rule requires it.

---

## Gate Commands

Canonical gate surface is `octopus gate <name>` or `node bin/octopus.js gate <name>`.

| Gate | Canonical invocation |
|---|---|
| Enter task mode | `octopus gate enter-task-mode --task-id "T-001" --task-summary "..."` |
| Load rule pack | `octopus gate load-rule-pack --task-id "T-001" --stage "TASK_ENTRY" --loaded-rule-file "Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md"` |
| Classify change | `octopus gate classify-change --use-staged --task-intent "..."` |
| Compile gate | `octopus gate compile-gate --task-id "T-001"` |
| Review gate | `octopus gate required-reviews-check --task-id "T-001" --code-review-verdict "..."` |
| Audited no-op | `octopus gate record-no-op --task-id "T-001" --reason "Already implemented in current branch"` |
| Doc impact | `octopus gate doc-impact-gate --task-id "T-001" --decision "..."` |
| Completion gate | `octopus gate completion-gate --task-id "T-001"` |
| Scoped diff | `octopus gate build-scoped-diff --review-type "db"` |
| Review context | `octopus gate build-review-context --review-type "code" --depth 2` |
| Task events | `octopus gate task-events-summary --task-id "T-001"` |
| Log event | `octopus gate log-task-event --task-id "T-001" --event-type "..."` |
| Manifest validation | `octopus gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"` |
| Human commit | `octopus gate human-commit --message "<message>"` |

Full gate examples live in `template/docs/agent-rules/40-commands.md`.

Zero-diff task contract:
- A clean-tree `classify-change` result is baseline-only evidence, not proof that the task is complete.
- `required-reviews-check` and `completion-gate` now block zero-diff implementation tasks unless the task later produces a real diff or an audited no-op artifact is recorded.
- Use `octopus gate record-no-op --task-id "<task-id>" --reason "<rationale>"` only when the task is genuinely `already done`, `no changes required`, or `audit only`.

---

## Runtime Requirements

| Component | Requirement |
|---|---|
| Public CLI and gate commands | Node.js 24 LTS |
