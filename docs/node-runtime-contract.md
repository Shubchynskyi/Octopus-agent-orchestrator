# Node Runtime Contract

Version source: VERSION
Frozen: 2026-03-27

This document captures the current Node-only runtime surface.

## Public Surface

- CLI aliases: `octopus`, `oao`, `octopus-agent-orchestrator`
- Entrypoint: generated `bin/octopus.js` (compiled from `src/bin/octopus.ts`)
- Runtime baseline: `Node.js >=20.0.0`

## Execution Modes

- Source-repository mode: run `npm run build`, which compiles `src/bin/octopus.ts` into `bin/octopus.js`; that launcher then resolves compiled `dist/src/**/*.js`.
- Source-install mode: `npm install` from a source checkout runs `prepare`, which builds the generated launcher and compiled runtime before first use.
- Test-staged mode: Node foundation tests may stage `.node-build/src/**/*.js`, and `bin/octopus.js` can resolve that compiled output when `dist/` is intentionally absent in the fixture.
- Packaged-install mode: under `node_modules`, `bin/octopus.js` resolves only compiled `dist/src/**/*.js`.
- Raw `src/**/*.ts` files are compile-time inputs only; direct `.ts` execution is not part of the supported runtime contract.
- Public CLI commands, gate names, and verification markers are the same in both modes.

## Command Inventory

Lifecycle commands:

```text
setup, agent-init, status, doctor, bootstrap, install, init, reinit, verify, check-update, update, rollback, uninstall, skills
```

Additional public routes:

```text
update git
gate <name>
```

Zero-argument invocation prints the safe overview. Unknown first positional falls through to `bootstrap`.

`Workspace ready` is blocked by `runtime/agent-init-state.json` until the hard `agent-init` gate passes.

## Source-of-Truth Values

| SourceOfTruth | Canonical Entrypoint |
|---|---|
| Claude | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Gemini | `GEMINI.md` |
| Qwen | `QWEN.md` |
| GitHubCopilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/rules.md` |
| Junie | `.junie/guidelines.md` |
| Antigravity | `.antigravity/rules.md` |

## Init Answers Contract

`runtime/init-answers.json` keeps:

- `AssistantLanguage`
- `AssistantBrevity`
- `SourceOfTruth`
- `EnforceNoAutoCommit`
- `ClaudeOrchestratorFullAccess`
- `TokenEconomyEnabled`
- `CollectedVia`
- optional `ActiveAgentFiles`

Allowed brevity values:

```text
concise, detailed
```

Allowed `CollectedVia` values:

```text
AGENT_INIT_PROMPT.md, CLI_INTERACTIVE, CLI_NONINTERACTIVE
```

## Deployed Bundle Surface

The deployed bundle keeps:

```text
.gitattributes
bin/
dist/
src/
template/
AGENT_INIT_PROMPT.md
CHANGELOG.md
HOW_TO.md
LICENSE
MANIFEST.md
README.md
VERSION
package.json
```

The runtime materializes:

- `live/config/**`
- `live/docs/**`
- `live/skills/**`
- `live/project-discovery.md`
- `live/source-inventory.md`
- `live/init-report.md`
- `live/USAGE.md`
- `live/version.json`
- `runtime/reviews/**`
- `runtime/task-events/**`

## Gate Inventory

Canonical gate surface:

```text
node Octopus-agent-orchestrator/bin/octopus.js gate <name>
```

Shipped gates:

- `enter-task-mode`
- `classify-change`
- `compile-gate`
- `required-reviews-check`
- `doc-impact-gate`
- `completion-gate`
- `build-scoped-diff`
- `build-review-context`
- `log-task-event`
- `task-events-summary`
- `validate-manifest`
- `human-commit`

## Verification Markers

- Overview marker: `OCTOPUS_OVERVIEW`
- Bootstrap success: `OCTOPUS_BOOTSTRAP_OK`
- Setup success: `OCTOPUS_SETUP`
- Status marker: `OCTOPUS_STATUS`
- Verify success: `Verification: PASS`
- Verify failure tail: `Verification failed. Resolve listed issues and rerun.`

## Validation

Contract coverage lives in:

- strict runtime build config: `tsconfig.build.json`
- strict test/build-harness config: `tsconfig.tests.json`
- `tests/node/**`
- `npm test`
- `npm run validate:release`

`TypeScript` in this repository means compiler-enforced strict typing across the runtime (`src/**`), Node test suite (`tests/node/**`), and supporting build/test scripts (`scripts/node-foundation/**`). `npm run validate:release` proves the public release path as `build -> test -> pack -> install/invoke`.
