# Octopus Agent Orchestrator: User How-To

Step-by-step guide for project owners. For CLI command details see **[docs/cli-reference.md](docs/cli-reference.md)**.

## 1. Deploy Bundle

```powershell
octopus
```

Equivalent aliases: `oao`, `octopus-agent-orchestrator`.

This deploys `./Octopus-agent-orchestrator/` and prints the paths for next steps.
Does **not** run install or ask setup questions.

**Branch testing:**
```powershell
octopus bootstrap --repo-url "<git-url>" --branch "<branch>"
```

**Manual setup** (without npm):
Copy the full `Octopus-agent-orchestrator/` directory into your project root.

## 2. Run Setup Through Agent

Give your coding agent this file:
```
Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md
```

The agent will ask you 6 mandatory questions:

| # | Question | Options |
|---|---|---|
| 1 | Assistant response language | Any language (e.g. English, Russian) |
| 2 | Default response brevity | `concise` or `detailed` |
| 3 | Source-of-truth entrypoint | Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, Antigravity |
| 4 | Hard no-auto-commit guard | `yes` or `no` |
| 5 | Claude full access to orchestrator | `yes` or `no` |
| 6 | Token economy enabled | `yes` or `no` |

After collecting answers, the agent:
1. Writes `Octopus-agent-orchestrator/runtime/init-answers.json`.
2. Runs install and verify.
3. Fills project context from `live/project-discovery.md`.
4. Returns `Usage Instructions` in your selected language.
5. Offers to add specialist skills.

### Install via npm CLI

After the agent writes `init-answers.json`:

```powershell
octopus install --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

## 3. Expected Result

After successful setup:

- ✅ Root entrypoints exist and route correctly (selected source-of-truth has full index, others redirect).
- ✅ Provider bridge profiles exist (`.github/agents/*.md`, `.windsurf/agents/`, etc.).
- ✅ Canonical rules at `Octopus-agent-orchestrator/live/docs/agent-rules/`.
- ✅ Gate scripts at `Octopus-agent-orchestrator/live/scripts/agent-gates/`.
- ✅ Config files at `Octopus-agent-orchestrator/live/config/`.
- ✅ `verify.ps1` and `validate-manifest.ps1` pass.
- ✅ `TASK.md` exists with task queue.

See **[docs/architecture.md](docs/architecture.md)** for full list of deployed files.

## 4. Start Working On Tasks

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

## 5. Existing Project With Existing Docs

- Existing docs are read as context input — orchestrator does not move or delete them.
- Canonical rules remain under `Octopus-agent-orchestrator/live/`.
- Specialist skills are created only in `Octopus-agent-orchestrator/live/skills/**`.

## 6. Post-Init Validation

```powershell
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -SourceOfTruth "<provider>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

**Provider values:** `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

Gate scripts also have Bash alternatives — see **[docs/cli-reference.md](docs/cli-reference.md)** for full reference.

## 7. Change Init Answers (Reinit)

Change language, brevity, source-of-truth, or other init answers without reinstalling:

```powershell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

See **[docs/cli-reference.md](docs/cli-reference.md#octopus-reinit)** for details.

## 8. Update Existing Deployment

```powershell
# Interactive
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"

# Auto-apply for CI
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt

# Dry-run preview
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

Update checks remote version, syncs bundle, migrates init answers, runs verification.
See **[docs/cli-reference.md](docs/cli-reference.md#octopus-update)** for full options.

## 9. Uninstall

```powershell
# Interactive — asks what to keep
octopus uninstall --target-root "."

# Non-interactive
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file no --keep-runtime-artifacts yes
```

Uninstall removes managed blocks, bridge files, and the bundle directory. User content is preserved.
See **[docs/cli-reference.md](docs/cli-reference.md#octopus-uninstall)** for full options.

## 10. Adding Specialist Skills After Init

Ask your agent:
- `Add api-review skill`
- `Create a test-review agent`
- `Add performance-review as optional`

The agent uses `live/skills/skill-builder/SKILL.md` to create skills and wire triggers.

## Runtime Requirements

| Component | Requirement |
|---|---|
| npm CLI | Node.js 18+ |
| Control-plane scripts | PowerShell 7+ (`pwsh`) |
| Gate scripts (`.sh`) | `bash` + Python (`python3`, `python`, or `py -3`) |

## Further Reading

- **[docs/architecture.md](docs/architecture.md)** — Design, runtime model, what gets deployed
- **[docs/configuration.md](docs/configuration.md)** — Token economy, output filters, review capabilities
- **[docs/cli-reference.md](docs/cli-reference.md)** — Complete CLI command reference
- **[docs/work-example.md](docs/work-example.md)** — Task lifecycle walkthrough
- **[CHANGELOG.md](CHANGELOG.md)** — Full changelog