# Octopus Agent Orchestrator: User How-To

Step-by-step guide for project owners. For CLI command details see **[docs/cli-reference.md](docs/cli-reference.md)**.

## 1. One-Command Setup

```powershell
npx -y octopus-agent-orchestrator setup
```

Equivalent aliases: `oao`, `octopus-agent-orchestrator`.

Preferred and required runtime surface is the Node CLI.

This path:
- deploys `./Octopus-agent-orchestrator/`;
- asks or accepts the 6 init answers;
- writes `runtime/init-answers.json`;
- runs install;
- validates manifest;
- leaves final agent onboarding for `AGENT_INIT_PROMPT.md` and the hard `octopus agent-init` gate.

If you already installed globally:

```powershell
octopus setup
```

## 2. Optional Bundle-Only Bootstrap

```powershell
octopus bootstrap
```

This only deploys `./Octopus-agent-orchestrator/` and prints next steps.
It does **not** run install.

**Branch testing:**
```powershell
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
7. Offers to add optional built-in skill packs or custom skills.
8. Uses `octopus skills suggest` / `octopus skills list` for discovery first, installs selected packs without reading their full skill bodies, and opens full optional skill files only when they are actually activated for a task.

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

See **[docs/architecture.md](docs/architecture.md)** for full list of deployed files.

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
See **[docs/work-example.md](docs/work-example.md)** for a full task lifecycle walkthrough.

## 6. Existing Project With Existing Docs

- Existing docs are read as context input — orchestrator does not move or delete them.
- Canonical rules remain under `Octopus-agent-orchestrator/live/`.
- Specialist skills are created only in `Octopus-agent-orchestrator/live/skills/**`.

## 7. Post-Init Validation

```powershell
octopus agent-init --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md" --project-rules-updated yes --skills-prompted yes
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus verify --target-root "." --source-of-truth "<provider>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus gate validate-manifest --manifest-path "Octopus-agent-orchestrator/MANIFEST.md"
```

**Provider values:** `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

For day-to-day validation, prefer `octopus doctor`, `octopus verify`, and `octopus gate validate-manifest`.

See **[docs/cli-reference.md](docs/cli-reference.md)** for the full low-level script reference.

## 8. Change Init Answers (Reinit)

Change language, brevity, source-of-truth, or other init answers without reinstalling:

```powershell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

See **[docs/cli-reference.md](docs/cli-reference.md#octopus-reinit)** for details.

## 9. Update Existing Deployment

```powershell
# Check only
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Compare and auto-apply for CI
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt

# Direct apply
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Dry-run preview
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

`check-update` is compare-first and uses `--apply` only when you want it to perform the update.
`update` applies the update workflow directly unless `--dry-run` is used.

Update checks remote version, syncs bundle, migrates init answers, and runs verification.
See **[docs/cli-reference.md](docs/cli-reference.md#octopus-update)** for full options.

## 10. Uninstall

```powershell
# Interactive — asks what to keep
octopus uninstall --target-root "."

# Non-interactive
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes
```

Uninstall removes managed blocks, bridge files, and the bundle directory. User content is preserved.
See **[docs/cli-reference.md](docs/cli-reference.md#octopus-uninstall)** for full options.

## 11. Adding Specialist Skills After Init

Built-in packs:

```powershell
octopus skills list --target-root "."
octopus skills suggest --target-root "." --task-text "Fix slow API endpoint" --changed-path "src/api/users.ts"
octopus skills add java-spring --target-root "."
octopus skills remove java-spring --target-root "."
octopus skills validate --target-root "."
```

`skills suggest` uses only the compact `live/config/skills-index.json` index for discovery. After selection, the pack should just be installed into `live/skills/**`; full optional skill files should be read only later, when a selected skill is actually activated for task execution.

Custom project-specific skills still live under `Octopus-agent-orchestrator/live/skills/**` and can be created via `live/skills/skill-builder/SKILL.md`.

## Runtime Requirements

| Component | Requirement |
|---|---|
| Public CLI and gate commands | Node.js 20 LTS |

If you work on this repository itself in IntelliJ IDEA/WebStorm, open the root `tsconfig.json`; it extends `tsconfig.node-foundation.json` and is the editor-facing project file.

## Further Reading

- **[docs/architecture.md](docs/architecture.md)** — Design, runtime model, what gets deployed
- **[docs/configuration.md](docs/configuration.md)** — Token economy, output filters, review capabilities
- **[docs/cli-reference.md](docs/cli-reference.md)** — Complete CLI command reference
- **[docs/work-example.md](docs/work-example.md)** — Task lifecycle walkthrough
- **[CHANGELOG.md](CHANGELOG.md)** — Full changelog
