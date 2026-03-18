![Octopus Agent Orchestrator](Image.png)

# Octopus Agent Orchestrator

Deterministic task orchestration for AI coding agents.
Deploys canonical rules, mandatory quality gates, and token-usage optimization into any project — works with Claude, Codex, Copilot, Gemini, Windsurf, Junie, and Antigravity.

**[Quick Start](#quick-start)** · **[User Guide](HOW_TO.md)** · **[CLI Reference](docs/cli-reference.md)** · **[Architecture](docs/architecture.md)** · **[Configuration](docs/configuration.md)** · **[Work Example](docs/work-example.md)** · **[Changelog](CHANGELOG.md)**

## Quick Start

```powershell
# 1. Install
npm install octopus-agent-orchestrator

# 2. Bootstrap into your project
octopus

# 3. Give AGENT_INIT_PROMPT.md to your coding agent
#    Agent asks 6 setup questions -> writes init-answers.json -> runs install + verify

# 4. Start working
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
| **Dual-Runtime Gates** | PowerShell + Bash/Python — works on Windows, macOS, Linux |
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
| `octopus` | Bootstrap bundle into project |
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

## Documentation

| Document | Description |
|---|---|
| **[HOW_TO.md](HOW_TO.md)** | Step-by-step user guide |
| **[docs/cli-reference.md](docs/cli-reference.md)** | Complete CLI command reference |
| **[docs/architecture.md](docs/architecture.md)** | Design, runtime model, deployed files |
| **[docs/configuration.md](docs/configuration.md)** | Token economy, output filters, review capabilities |
| **[docs/work-example.md](docs/work-example.md)** | Task lifecycle walkthrough |
| **[AGENT_INIT_PROMPT.md](AGENT_INIT_PROMPT.md)** | Setup prompt for coding agents |
| **[CHANGELOG.md](CHANGELOG.md)** | Full changelog |
| **[MANIFEST.md](MANIFEST.md)** | Bundle file manifest |

## Recent Changes

- Shared utility library (`scripts/lib/common.ps1`) extracted from 6 control-plane scripts.
- Compact Command Hints added to agent rules for token-efficient CLI usage.
- E2E smoke tests covering full install/reinit/uninstall lifecycle matrix.
- Token-economy defaults aligned: `enabled=true` with `enabled_depths=[1,2]`.
- LF line endings enforced for pre-commit hook and bash artifacts on all platforms.
- Parser-aware gate compaction and review-context artifacts for token-economy mode.
- Added update workflow with version check and optional auto-apply from git.
- Added `scripts/reinit.ps1` for changing init answers without full reinstall.
- Added `scripts/uninstall.ps1` for removing deployed orchestrator with keep/delete choices.
- Added npm package CLI with `octopus`, `oao`, `octopus-agent-orchestrator` aliases.

## Important Notes

- Run initialization through `AGENT_INIT_PROMPT.md` — do not call `scripts/install.ps1` directly.
- npm CLI commands wrap canonical PowerShell control-plane scripts.
- Top-level `scripts/*.sh` are thin `pwsh` wrappers; `live/scripts/agent-gates/*.sh` are real bash+python implementations.
- Installer is non-destructive for existing project files outside managed blocks.
- Commit message format is project-defined; conventional commits are optional.
- For detailed deployment, lifecycle, and configuration information, see the **[docs/](docs/)** directory.

## License

MIT License. See `LICENSE`.

## Author

- Dmytro Shubchynskyi
- Email: d.shubchynskyi@gmail.com
- LinkedIn: https://www.linkedin.com/in/shubchynskyi