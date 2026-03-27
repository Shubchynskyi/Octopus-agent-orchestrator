# Octopus Agent Orchestrator: User How-To

Step-by-step guide for project owners. For CLI command details see **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)**.

## 1. Recommended Setup

```shell
npm install -g octopus-agent-orchestrator
octopus setup
```

This is the recommended path when you want persistent CLI commands:
- `octopus`
- `oao`
- `octopus-agent-orchestrator`

One-off fallback without global install:

```shell
npx -y octopus-agent-orchestrator setup
```

`npx` runs the package temporarily and does not keep `octopus` or `oao` in your terminal `PATH`.

Preferred and required runtime surface is the Node CLI.

If you install from a source checkout instead of npm registry artifacts, `npm install` runs `prepare` and builds the generated `bin/octopus.js` launcher plus compiled runtime before first use.

This path:
- deploys `./Octopus-agent-orchestrator/`;
- asks or accepts the 6 init answers;
- writes `runtime/init-answers.json`;
- runs install;
- validates manifest;
- leaves final agent onboarding for `AGENT_INIT_PROMPT.md` and the hard `octopus agent-init` gate.

## 2. Optional Bundle-Only Bootstrap

```shell
octopus bootstrap
```

This only deploys `./Octopus-agent-orchestrator/` and prints next steps.
It does **not** run install.

**Branch testing:**
```shell
octopus bootstrap --repo-url "<git-url>" --branch "<branch>"
```

**Manual setup** (without npm):
Copy the full `Octopus-agent-orchestrator/` directory into your project root.

## 3. Finish Setup Through Agent

Give your coding agent this file:
```
Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md
```

If CLI setup already created `runtime/init-answers.json`, the agent should reuse it, validate/normalize the saved language, and ask again only when the language is ambiguous or cannot be confidently recognized.
The agent should not repeat the other 5 setup questions when the file is already complete.
However, the agent must still explicitly confirm which agent entrypoint files you actively use when `ActiveAgentFiles` is missing, empty, or still canonical-only after CLI setup.

Only if answers are still missing, the agent will ask you the missing questions. The active agent files question is also mandatory during agent initialization whenever it has not yet been explicitly confirmed:

| # | Question | Options |
|---|---|---|
| 1 | Assistant response language | Any language (e.g. English, Russian) |
| 2 | Default response brevity | `concise` or `detailed` |
| Required during agent init | Active agent files | Multiple values such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` |
| 3 | Source-of-truth entrypoint | Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, Antigravity |
| 4 | Hard no-auto-commit guard | `yes` or `no` |
| 5 | Claude full access to orchestrator | `yes` or `no` |
| 6 | Token economy enabled | `yes` or `no` |

After handoff, the agent:
1. Reuses `Octopus-agent-orchestrator/runtime/init-answers.json` if it is already complete.
2. Normalizes `AssistantLanguage` and asks for clarification only if it cannot confidently recognize the language.
3. Runs install only when primary initialization is incomplete or answers were actually missing.
4. Fills project context from `live/project-discovery.md`.
5. Explicitly confirms active agent files and then runs `octopus agent-init`.
6. Returns `Usage Instructions` in your selected language.
7. Asks a mandatory code-style policy question and records the answer in `30-code-style.md`: accept the default of explicit rules + tooling + common best practices, or provide custom project-specific rules now.
8. Offers to add optional built-in skill packs or custom skills.
9. Uses `octopus skills suggest` / `octopus skills list` for discovery first, installs selected packs without reading their full skill bodies, and opens full optional skill files only when they are actually activated for a task.

## 4. Expected Result

After successful setup:

- ✅ The selected source-of-truth entrypoint exists as the canonical file.
- ✅ Additional active agent files, if explicitly confirmed during agent init, are materialized as redirects or provider bridges.
- ✅ Provider bridge profiles exist (`.github/agents/*.md`, `.windsurf/agents/`, etc.).
- ✅ Canonical rules at `Octopus-agent-orchestrator/live/docs/agent-rules/`.
- ✅ Config files at `Octopus-agent-orchestrator/live/config/`.
- ✅ `octopus agent-init` passes and writes `runtime/agent-init-state.json`.
- ✅ `octopus verify` and `octopus gate validate-manifest` pass.
- ✅ `TASK.md` exists with task queue.

See **[docs/architecture.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/architecture.md)** for full list of deployed files.

## 5. Start Working On Tasks

```
Execute task T-001
Execute task T-001 depth=1
Execute task T-001 depth=2
Execute task T-001 depth=3
```

| Depth | When to Use |
|---|---|
| `depth=1` | Small, localized, low-risk tasks |
| `depth=2` | Default for most tasks |
| `depth=3` | High-risk, cross-module, security-sensitive work |

Required gates apply at any depth.
See **[docs/work-example.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/work-example.md)** for a full task lifecycle walkthrough.

## 6. Existing Project With Existing Docs

- Existing docs are read as context input — orchestrator does not move or delete them.
- Canonical rules remain under `Octopus-agent-orchestrator/live/`.
- Specialist skills are created only in `Octopus-agent-orchestrator/live/skills/**`.

## 7. Project Memory (Durable Knowledge)

Durable project knowledge lives in `Octopus-agent-orchestrator/live/docs/project-memory/`.

### What Belongs There

| File | Content |
|---|---|
| `context.md` | Business domain, project goals, scope boundaries. |
| `architecture.md` | Component boundaries, data flow, integration points. |
| `conventions.md` | Coding standards, naming rules, workflow conventions. |
| `stack.md` | Languages, frameworks, infrastructure, key dependencies. |
| `decisions.md` | Architectural and process decisions with rationale. |

Add new files in lowercase kebab-case `.md` format when no existing category fits.

### Ownership and Lifecycle

- `project-memory/` is **user-owned**. The materializer seeds it from templates on fresh install and never overwrites, merges, or deletes its contents on init, reinit, update, or uninstall-with-keep.
- `live/docs/agent-rules/15-project-memory.md` is a **generated summary** regenerated on every init, reinit, and update from the contents of `project-memory/`. Do not edit it directly; edit the source files in `project-memory/` instead.
- Context rule files (`10-project-context.md`, `20-architecture.md`, etc.) now redirect agents to `project-memory/` as the authoritative source. Do not embed durable knowledge in those managed rule files.

### How Agents Use It

- Agents read `project-memory/` files for context at any time.
- Agents write to `project-memory/` only with explicit user approval or a task instruction that authorises the update.
- Discovered facts (architecture insights, conventions, stack details, domain constraints, design decisions) go into the matching `project-memory/` file, not into managed rules or config.

## 8. Post-Init Validation

```shell
octopus agent-init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md" --project-rules-updated yes --skills-prompted yes
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus verify --target-root "." --source-of-truth "<provider>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"
```

**Provider values:** `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

For day-to-day validation, prefer `octopus doctor`, `octopus verify`, and `octopus gate validate-manifest`.

See **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)** for the full low-level script reference.

## 9. Change Init Answers (Reinit)

Change language, brevity, source-of-truth, or other init answers without reinstalling:

```shell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

See **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md#octopus-reinit)** for details.

## 10. Update Existing Deployment

```shell
# Check only
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Compare and auto-apply for CI
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt

# Direct apply
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Apply from git explicitly
octopus update git --target-root "." --repo-url "." --check-only
octopus update git

# Dry-run preview
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run

# Roll back the last applied update
octopus rollback --target-root "."

# Roll back to a specific orchestrator version
octopus rollback --target-root "." --to-version "<target-version>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

`check-update` is compare-first and uses `--apply` only when you want it to perform the update.
`update` applies the update workflow directly unless `--dry-run` is used.
`update git` uses a git clone source explicitly; without extra flags it uses the default GitHub repository and applies the update to the current workspace.
`rollback` without `--to-version` restores the latest saved rollback snapshot and bundle backup from the last applied update; with `--to-version` it acquires that version, syncs the bundle, and re-materializes the workspace.

By default `check-update` compares against the deployed package name using the npm `latest` tag. When an update is applied (`check-update --apply` or `update`), the workflow reuses and validates init answers, syncs bundle files, re-materializes `live/`, and only updates `VERSION` after the lifecycle succeeds. For local testing you can point `check-update/update` to `--source-path "."` or to a local tarball via `--package-spec`.

See **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md#octopus-update)** for full options.

## 11. Uninstall

```shell
# Interactive — asks what to keep
octopus uninstall --target-root "."

# Non-interactive
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes
```

Uninstall removes managed blocks, bridge files, and the bundle directory while preserving user content outside managed sections. It also creates an internal uninstall journal snapshot and attempts automatic restore on failure. Avoid `--skip-backups` unless you explicitly accept losing the user-facing recovery backup copies.
See **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md#octopus-uninstall)** for full options.

## 12. Adding Specialist Skills After Init

Built-in packs:

```shell
octopus skills list --target-root "."
octopus skills suggest --target-root "." --task-text "Fix slow API endpoint" --changed-path "src/api/users.ts"
octopus skills add java-spring --target-root "."
octopus skills remove java-spring --target-root "."
octopus skills validate --target-root "."
```

`skills list` and `skills suggest` should be read as two different layers:
- optional pack = installable bundle;
- skill = concrete directory under `live/skills/**` after install.
- baseline skills are already included and optional packs must not duplicate them.

The agent should first show what is already available now: baseline skills, installed optional packs, and installed optional skill directories. Only after that should it suggest additional optional packs to add. `skills suggest` uses only the compact `live/config/skills-index.json` index for discovery and should not recommend baseline skills or already installed optional skills as new additions. After selection, the pack should just be installed into `live/skills/**`; full optional skill files should be read only later, when a selected skill is actually activated for task execution.

Custom project-specific skills still live under `Octopus-agent-orchestrator/live/skills/**` and can be created via `live/skills/skill-builder/SKILL.md`.

## Runtime Requirements

| Component | Requirement |
|---|---|
| Public CLI and gate commands | Node.js 20 LTS |

If you work on this repository itself in IntelliJ IDEA/WebStorm, open the root `tsconfig.json`; it extends `tsconfig.node-foundation.json` and is the editor-facing project file.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `octopus: command not found` | Global install missing or `PATH` not refreshed | Run `npm install -g octopus-agent-orchestrator` and open a new terminal |
| `npx` fetches a stale version | npm cache holds an older package | Run `npx --yes --package octopus-agent-orchestrator@latest octopus setup` or clear cache with `npm cache clean --force` |
| `EACCES` / permission denied on global install | No write access to the global `node_modules` prefix | Use `sudo npm install -g …` (Linux/macOS) or fix the npm prefix directory permissions |
| `octopus setup` exits with "Node.js >= 20 required" | Active Node version is below 20 LTS | Install Node 20+ via `nvm install 20` / `nvm use 20` or download from nodejs.org |
| `octopus verify` fails after update | `live/` materialization is out of sync with new templates | Run `octopus init --target-root "."` to re-materialize, then `octopus verify` again |
| `validate-manifest` reports duplicate keys | MANIFEST.md has repeated file entries | Remove the duplicate lines in `MANIFEST.md` and rerun `octopus gate validate-manifest` |
| Agent skips init answers and re-asks all 6 questions | `runtime/init-answers.json` missing or unreadable | Verify the file exists and the path passed to the agent matches; rerun `octopus setup` if lost |
| Rollback fails with "no snapshot found" | No prior update created a rollback snapshot | Use `octopus update --dry-run` first; rollback is only available after a successful `update` or `check-update --apply` |

## Further Reading

- **[docs/architecture.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/architecture.md)** — Design, runtime model, what gets deployed
- **[docs/configuration.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/configuration.md)** — Token economy, output filters, review capabilities
- **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)** — Complete CLI command reference
- **[docs/work-example.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/work-example.md)** — Task lifecycle walkthrough
- **[CHANGELOG.md](CHANGELOG.md)** — Full changelog
