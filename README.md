![Octopus Agent Orchestrator](https://raw.githubusercontent.com/Shubchynskyi/Octopus-agent-orchestrator/master/Image.png)

# Octopus Agent Orchestrator

Deterministic task orchestration for AI coding agents.
Deploys canonical rules, mandatory quality gates, and token-usage optimization into any project — works with Claude, Codex, Copilot, Gemini, Qwen, Windsurf, Junie, and Antigravity.

**[Quick Start](#quick-start)** · **[User Guide](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/HOW_TO.md)** · **[CLI Reference](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)** · **[Architecture](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/architecture.md)** · **[Configuration](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/configuration.md)** · **[Work Example](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/work-example.md)** · **[Changelog](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/CHANGELOG.md)**

## Quick Start

```shell
# 1. Install the CLI once
npm install -g octopus-agent-orchestrator

# 2. Run setup through the global command
octopus setup

# 3. Then give AGENT_INIT_PROMPT.md to your coding agent
#    Agent reuses existing init answers, explicitly confirms active agent files,
#    fills project context, offers optional skill packs, and finishes with octopus agent-init

# 4. After octopus agent-init passes, start working
#    "Execute task T-001 depth=2"
```

Temporary fallback without global install:

```shell
npx -y octopus-agent-orchestrator setup
```

`npx` runs the package once and does not keep `octopus` or `oao` in your `PATH`.
If you want persistent commands, install globally.

## Key Features

| Feature | Description |
|---|---|
| **8 Supported Providers** | Claude, Codex, Copilot, Gemini, Qwen, Windsurf, Junie, Antigravity — single canonical rule set |
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
| Gemini | `GEMINI.md` | — |
| Qwen | `QWEN.md` | optional `.qwen/settings.json` context bootstrap |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/agents/*.md` |
| Windsurf | `.windsurf/rules/rules.md` | `.windsurf/agents/orchestrator.md` |
| Junie | `.junie/guidelines.md` | `.junie/agents/orchestrator.md` |
| Antigravity | `.antigravity/rules.md` | `.antigravity/agents/orchestrator.md` |

## CLI Commands

| Command | Description |
|---|---|
| `octopus` | Safe overview: help + current project status |
| `octopus setup` | First-run CLI onboarding without requiring an agent for the 6 answers |
| `octopus agent-init` | Hard code-level gate that finalizes agent onboarding |
| `octopus status` | Short project status snapshot |
| `octopus doctor` | Run verify + manifest validation from existing answers |
| `octopus bootstrap` | Bundle-only deploy without install |
| `octopus install` | Deploy/refresh orchestrator (requires init-answers.json) |
| `octopus init` | Re-materialize `live/` from existing answers |
| `octopus reinit` | Change init answers without full reinstall |
| `octopus check-update` | Compare current deployment with a newer npm package or local source |
| `octopus update` | Apply the update workflow directly (`--dry-run` for preview) |
| `octopus update git` | Apply or preview an update from a git repo or local clone |
| `octopus rollback` | Roll back to a specific version or restore from the latest rollback snapshot |
| `octopus uninstall` | Remove orchestrator with keep/delete choices |
| `octopus skills` | List, suggest, add, remove, and validate optional built-in skill packs |

Aliases: `octopus`, `oao`, `octopus-agent-orchestrator`

Full reference: **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)**

## Version

- Package: `octopus-agent-orchestrator`
- Current version source of truth: `VERSION`
- Package manifest versions: `package.json`, `package-lock.json`
- Recommended CLI install: `npm install -g octopus-agent-orchestrator`
- Recommended first command: `octopus setup`
- One-off fallback without install: `npx -y octopus-agent-orchestrator setup`
- Install locally only if you want repo-local binaries in `node_modules/.bin`: `npm install octopus-agent-orchestrator`

## Runtime Baseline

- **Node.js 20 LTS is the only required runtime** for the public CLI, lifecycle commands, and gate commands.
- **Compile-first runtime contract:** `src/**/*.ts` is the source of truth, `src/bin/octopus.ts` compiles into the public `bin/octopus.js` launcher, and that launcher executes compiled JavaScript from `dist/src/**/*.js` or the staged `.node-build/src/**/*.js` test build. Raw `src/**/*.ts` files are never executed directly.
- **Strict TypeScript means compiler-enforced typing across all maintained code paths:** `tsconfig.build.json` runs `strict:true` for `src/**/*.ts`, and the wider repo graph (`tsconfig.node-foundation.json` / `tsconfig.tests.json`) covers `src/**/*.ts`, `tests/node/**/*.ts`, and `scripts/node-foundation/**/*.ts`.
- **Release validation is explicit:** `npm run validate:release` proves `build -> test -> pack -> install/invoke` for the published CLI contract.
- Root `tsconfig.json` extends `tsconfig.node-foundation.json`, so editors like IntelliJ IDEA or WebStorm can discover the repository without custom setup.

## Documentation

| Document | Description |
|---|---|
| **[HOW_TO.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/HOW_TO.md)** | Step-by-step user guide |
| **[docs/cli-reference.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/cli-reference.md)** | Complete CLI command reference |
| **[docs/architecture.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/architecture.md)** | Design, runtime model, deployed files |
| **[docs/configuration.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/configuration.md)** | Token economy, output filters, review capabilities |
| **[docs/node-platform-foundation.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/node-platform-foundation.md)** | Node foundation, execution model, validators, and build/test skeleton |
| **[docs/work-example.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/docs/work-example.md)** | Task lifecycle walkthrough |
| **[AGENT_INIT_PROMPT.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/AGENT_INIT_PROMPT.md)** | Setup prompt for coding agents |
| **[CHANGELOG.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/CHANGELOG.md)** | Full changelog |
| **[MANIFEST.md](https://github.com/Shubchynskyi/Octopus-agent-orchestrator/blob/master/MANIFEST.md)** | Bundle file manifest |

## Recent Changes

- Completed the final TS-only source transition: `src/bin/octopus.ts` now owns the public CLI launcher and `bin/octopus.js` is build-generated only.
- Source installs now self-build through `npm prepare`, so the generated launcher and compiled runtime are materialized before execution.
- Packaging tests now build in isolated fixture repositories, removing cross-test races on shared `dist/` state.
- Stabilized the Node gate router for scoped diff, review-context, task-event summary, and completion flows.
- Added root `tsconfig.json` for standard editor/IDE TypeScript discovery and included it in the published package surface.
- Full `tests/node/**` baseline now completes cleanly without temp workspace helper noise.
- Compact Command Hints added to agent rules for token-efficient CLI usage.
- E2E smoke tests covering full install/reinit/uninstall lifecycle matrix.
- Token-economy defaults aligned: `enabled=true` with `enabled_depths=[1,2]`.
- LF line endings enforced for pre-commit hook and bash artifacts on all platforms.
- Parser-aware gate compaction and review-context artifacts for token-economy mode.
- Added update workflow with version check and npm-based update source resolution.
- Completed the runtime cutover to a Node-only lifecycle and gate surface.
- Added npm package CLI with `octopus`, `oao`, `octopus-agent-orchestrator` aliases.

## Important Notes

- `octopus setup` can collect the 6 init answers itself and write `runtime/init-answers.json` without an agent.
- After CLI setup, use `AGENT_INIT_PROMPT.md` so the agent reuses existing init answers, clarifies language when it cannot recognize it confidently, explicitly confirms which agent entrypoint files are actively used, fills project-specific context, optionally manages built-in skill packs, and finishes with the hard `octopus agent-init` gate.
- Optional skills are discovered from the compact `live/config/skills-index.json` index. After the user selects a built-in pack, it should be installed into `live/skills/**` without reading the full optional `SKILL.md` immediately. Full optional skill files should be opened only later, when the selected skill is actually activated for a task or a hard activation rule requires it.
- `octopus` without arguments is now non-destructive and only prints overview/help.
- The public CLI owns the validated runtime surface for lifecycle commands and gate routes.
- `bin/octopus.js` is a generated launcher compiled from `src/bin/octopus.ts`; repository builds run from `dist/src/**/*.js`, tests can stage `.node-build/src/**/*.js`, and packaged installs invoke the same compiled contract from `node_modules`.
- Root `tsconfig.json` is the editor-facing entrypoint and simply extends `tsconfig.node-foundation.json`.
- Installer is non-destructive for existing project files outside managed blocks.
- Commit message format is project-defined; conventional commits are optional.
- For detailed deployment, lifecycle, and configuration information, see the `docs/` directory.

## License

Apache License 2.0. See `LICENSE`.

## Author

- Dmytro Shubchynskyi
- Email: d.shubchynskyi@gmail.com
- LinkedIn: https://www.linkedin.com/in/shubchynskyi
