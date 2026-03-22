![Octopus Agent Orchestrator](Image.png)

# Octopus Agent Orchestrator

Deterministic task orchestration for AI coding agents.
Deploys canonical rules, mandatory quality gates, and token-usage optimization into any project — works with Claude, Codex, Copilot, Gemini, Windsurf, Junie, and Antigravity.

**[Quick Start](#quick-start)** · **[User Guide](HOW_TO.md)** · **[CLI Reference](docs/cli-reference.md)** · **[Architecture](docs/architecture.md)** · **[Configuration](docs/configuration.md)** · **[Work Example](docs/work-example.md)** · **[Changelog](CHANGELOG.md)**

## Quick Start

```powershell
# 1. Easiest first-run
npx -y octopus-agent-orchestrator setup

# 2. Then give AGENT_INIT_PROMPT.md to your coding agent
#    Agent reuses existing init answers, only normalizes language if needed,
#    fills project context, and reruns checks

# 3. Start working
#    "Execute task T-001 depth=2"
```

## Key Features

| Feature | Description |
|---|---|
| **7 Provider Bridges** | Claude, Codex, Copilot, Gemini, Windsurf, Junie, Antigravity — single canonical rule set |
| **Mandatory Quality Gates** | Preflight → Compile → Review → Doc-Impact → Completion |
| **Token Economy** | Reviewer-context compaction, scoped diffs, gate output filtering — saves 60–100% on green builds |
| **Task Lifecycle** | `TODO → IN_PROGRESS → IN_REVIEW → DONE` with hash-chain integrity |
| **9 Review Types** | code, db, security, refactor, api, test, performance, infra, dependency |
| **Node Runtime** | Public CLI and gate flows run through the Node/TypeScript router with no shell runtime dependency |
| **Compact Command Hints** | Agent rules teach efficient CLI flags for everyday commands |

## Supported Providers

| Provider | Entrypoint | Bridge Profile |
|---|---|---|
| Claude | `CLAUDE.md` | `.claude/settings.local.json` |
| Codex | `AGENTS.md` | — |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/agents/*.md` |
| Gemini | `GEMINI.md` | — |
| Windsurf | `.windsurf/rules/rules.md` | `.windsurf/agents/orchestrator.md` |
| Junie | `.junie/guidelines.md` | `.junie/agents/orchestrator.md` |
| Antigravity | `.antigravity/rules.md` | `.antigravity/agents/orchestrator.md` |

## CLI Commands

| Command | Description |
|---|---|
| `octopus` | Safe overview: help + current project status |
| `octopus setup` | First-run CLI onboarding without requiring an agent for the 6 answers |
| `octopus status` | Short project status snapshot |
| `octopus doctor` | Run verify + manifest validation from existing answers |
| `octopus bootstrap` | Bundle-only deploy without install |
| `octopus install` | Deploy/refresh orchestrator (requires init-answers.json) |
| `octopus init` | Re-materialize `live/` from existing answers |
| `octopus reinit` | Change init answers without full reinstall |
| `octopus update` | Check for updates and optionally apply |
| `octopus uninstall` | Remove orchestrator with keep/delete choices |

Aliases: `octopus`, `oao`, `octopus-agent-orchestrator`

Full reference: **[docs/cli-reference.md](docs/cli-reference.md)**

## Version

- Package: `octopus-agent-orchestrator`
- Current: `1.0.8` (source: `VERSION`)
- npm: `npm install octopus-agent-orchestrator`

## Runtime Baseline

- **Node.js 20 LTS is the only required runtime** for the public CLI, lifecycle commands, and gate commands.
- Root `tsconfig.json` extends `tsconfig.node-foundation.json`, so editors like IntelliJ IDEA or WebStorm can discover the repository without custom setup.

## Documentation

| Document | Description |
|---|---|
| **[HOW_TO.md](HOW_TO.md)** | Step-by-step user guide |
| **[docs/cli-reference.md](docs/cli-reference.md)** | Complete CLI command reference |
| **[docs/architecture.md](docs/architecture.md)** | Design, runtime model, deployed files |
| **[docs/configuration.md](docs/configuration.md)** | Token economy, output filters, review capabilities |
| **[docs/node-platform-foundation.md](docs/node-platform-foundation.md)** | Node 20 M1 foundation, validators, and build/test skeleton |
| **[docs/work-example.md](docs/work-example.md)** | Task lifecycle walkthrough |
| **[AGENT_INIT_PROMPT.md](AGENT_INIT_PROMPT.md)** | Setup prompt for coding agents |
| **[CHANGELOG.md](CHANGELOG.md)** | Full changelog |
| **[MANIFEST.md](MANIFEST.md)** | Bundle file manifest |

## Recent Changes

- Stabilized the Node gate router for scoped diff, review-context, task-event summary, and completion flows.
- Added root `tsconfig.json` for standard editor/IDE TypeScript discovery and included it in the published package surface.
- Full `template/scripts/tests` baseline now completes cleanly without noisy PowerShell progress output from temp workspace helpers.
- Compact Command Hints added to agent rules for token-efficient CLI usage.
- E2E smoke tests covering full install/reinit/uninstall lifecycle matrix.
- Token-economy defaults aligned: `enabled=true` with `enabled_depths=[1,2]`.
- LF line endings enforced for pre-commit hook and bash artifacts on all platforms.
- Parser-aware gate compaction and review-context artifacts for token-economy mode.
- Added update workflow with version check and optional auto-apply from git.
- Completed the runtime cutover to a Node-only lifecycle and gate surface.
- Added npm package CLI with `octopus`, `oao`, `octopus-agent-orchestrator` aliases.

## Important Notes

- `octopus setup` can collect the 6 init answers itself and write `runtime/init-answers.json` without an agent.
- After CLI setup, use `AGENT_INIT_PROMPT.md` so the agent reuses existing init answers, only clarifies language when it cannot recognize it confidently, fills project-specific context, and finishes project-level verification.
- `octopus` without arguments is now non-destructive and only prints overview/help.
- The public CLI owns the validated runtime surface for lifecycle commands and gate routes.
- Root `tsconfig.json` is the editor-facing entrypoint and simply extends `tsconfig.node-foundation.json`.
- Installer is non-destructive for existing project files outside managed blocks.
- Commit message format is project-defined; conventional commits are optional.
- For detailed deployment, lifecycle, and configuration information, see the `docs/` directory.

## License

MIT License. See `LICENSE`.

## Author

- Dmytro Shubchynskyi
- Email: d.shubchynskyi@gmail.com
- LinkedIn: https://www.linkedin.com/in/shubchynskyi
