# CLI Reference

Complete command reference for Octopus Agent Orchestrator.

## Public Surface

The runtime is Node-only.

- Aliases: `octopus`, `oao`, `octopus-agent-orchestrator`
- Source invocation: `node bin/octopus.js <command>`
- Runtime baseline: `Node.js 20 LTS`

---

## Core Commands

### `octopus`

Safe overview of the current workspace.

```powershell
octopus
```

### `octopus setup`

First-run onboarding. Recommended entrypoint for end users.

```powershell
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

```powershell
octopus agent-init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md, CLAUDE.md" --project-rules-updated yes --skills-prompted yes
```

### `octopus status`

```powershell
octopus status --target-root "."
```

### `octopus doctor`

Runs `octopus verify` plus `octopus gate validate-manifest`.

```powershell
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

### `octopus bootstrap`

Deploy the bundle without running install.

```powershell
octopus bootstrap
octopus bootstrap --repo-url "<git-url>" --branch "<branch>"
```

### `octopus install`

Deploy or refresh the orchestrator from prepared init answers.

```powershell
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --repo-url "<git-url>" --branch "<branch>"
```

### `octopus init`

Re-materialize `live/` from an existing deployed bundle.

```powershell
octopus init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

### `octopus reinit`

Change init answers without a full reinstall.

```powershell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

### `octopus verify`

Validate deployment consistency and rule contracts.

```powershell
octopus verify --target-root "." --source-of-truth "Codex" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

Provider values: `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

### `octopus check-update`

Compare the current deployment with a newer npm package or a local unpacked bundle root. By default this only checks; `--apply` performs the update immediately.

```powershell
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --package-spec "octopus-agent-orchestrator@latest"
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --source-path "."
```

Notes:
- By default `check-update` uses the deployed package name from `Octopus-agent-orchestrator/package.json` with the npm `latest` tag.
- `--package-spec` accepts npm specs such as `octopus-agent-orchestrator@2.0.1`, dist-tags like `@latest`, and local tarballs like `.\octopus-agent-orchestrator-2.0.1.tgz`.
- `--source-path` is for local testing against an unpacked repo or bundle directory.

### `octopus update`

Apply the update workflow directly.

```powershell
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --package-spec "octopus-agent-orchestrator@latest"
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --source-path "."
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

Notes:
- `update` always applies the update workflow unless `--dry-run` is used.
- Use `octopus check-update --apply` when you want a compare-first flow with optional apply.

### `octopus uninstall`

Remove the orchestrator from a project.

```powershell
octopus uninstall --target-root "."
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes
octopus uninstall --target-root "." --dry-run --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts no
```

### `octopus skills`

Manage optional built-in domain packs and generate code-driven recommendations from the compact skills index.

```powershell
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
| Classify change | `octopus gate classify-change --use-staged --task-intent "..."` |
| Compile gate | `octopus gate compile-gate --task-id "T-001"` |
| Review gate | `octopus gate required-reviews-check --task-id "T-001" --code-review-verdict "..."` |
| Doc impact | `octopus gate doc-impact-gate --task-id "T-001" --decision "..."` |
| Completion gate | `octopus gate completion-gate --task-id "T-001"` |
| Scoped diff | `octopus gate build-scoped-diff --review-type "db"` |
| Review context | `octopus gate build-review-context --review-type "code" --depth 2` |
| Task events | `octopus gate task-events-summary --task-id "T-001"` |
| Log event | `octopus gate log-task-event --task-id "T-001" --event-type "..."` |
| Manifest validation | `octopus gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"` |
| Human commit | `octopus gate human-commit --message "<message>"` |

Full gate examples live in `template/docs/agent-rules/40-commands.md`.

---

## Runtime Requirements

| Component | Requirement |
|---|---|
| Public CLI and gate commands | Node.js 20 LTS |
