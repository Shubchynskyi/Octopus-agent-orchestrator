# Octopus Agent Orchestrator: User How-To

Step-by-step guide for project owners. For CLI command details see **[docs/cli-reference.md](docs/cli-reference.md)**.

## 1. One-Command Setup

```powershell
npx -y octopus-agent-orchestrator setup
```

Equivalent aliases: `oao`, `octopus-agent-orchestrator`.

This path:
- deploys `./Octopus-agent-orchestrator/`;
- asks or accepts the 6 init answers;
- writes `runtime/init-answers.json`;
- runs install;
- validates manifest;
- leaves full project-specific verification for the setup agent or later `octopus doctor`.

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

Only if answers are still missing, the agent will ask you the missing questions and may also ask one optional preference question about which agent entrypoint files you actively use:

| # | Question | Options |
|---|---|---|
| 1 | Assistant response language | Any language (e.g. English, Russian) |
| 2 | Default response brevity | `concise` or `detailed` |
| Optional | Active agent files | Multiple values such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` |
| 3 | Source-of-truth entrypoint | Claude, Codex, Gemini, GitHubCopilot, Windsurf, Junie, Antigravity |
| 4 | Hard no-auto-commit guard | `yes` or `no` |
| 5 | Claude full access to orchestrator | `yes` or `no` |
| 6 | Token economy enabled | `yes` or `no` |

After handoff, the agent:
1. Reuses `Octopus-agent-orchestrator/runtime/init-answers.json` if it is already complete.
2. Normalizes `AssistantLanguage` and asks for clarification only if it cannot confidently recognize the language.
3. Runs install only when primary initialization is incomplete or answers were actually missing.
4. Fills project context from `live/project-discovery.md`.
5. Runs verification and manifest validation.
6. Returns `Usage Instructions` in your selected language.
7. Offers to add specialist skills.

## 4. Expected Result

After successful setup:

- ✅ Root entrypoints exist and route correctly (selected source-of-truth has full index, others redirect).
- ✅ Provider bridge profiles exist (`.github/agents/*.md`, `.windsurf/agents/`, etc.).
- ✅ Canonical rules at `Octopus-agent-orchestrator/live/docs/agent-rules/`.
- ✅ Gate scripts at `Octopus-agent-orchestrator/live/scripts/agent-gates/`.
- ✅ Config files at `Octopus-agent-orchestrator/live/config/`.
- ✅ `verify.ps1` and `validate-manifest.ps1` pass.
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
octopus doctor --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/scripts/verify.ps1 -TargetRoot "." -SourceOfTruth "<provider>" -InitAnswersPath "Octopus-agent-orchestrator/runtime/init-answers.json"
pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/validate-manifest.ps1 -ManifestPath Octopus-agent-orchestrator/MANIFEST.md
```

**Provider values:** `Claude`, `Codex`, `Gemini`, `GitHubCopilot`, `Windsurf`, `Junie`, `Antigravity`.

Gate scripts also have Bash alternatives — see **[docs/cli-reference.md](docs/cli-reference.md)** for full reference.

## 8. Change Init Answers (Reinit)

Change language, brevity, source-of-truth, or other init answers without reinstalling:

```powershell
octopus reinit --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

See **[docs/cli-reference.md](docs/cli-reference.md#octopus-reinit)** for details.

## 9. Update Existing Deployment

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
