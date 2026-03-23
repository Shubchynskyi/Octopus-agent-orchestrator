# Changelog

## Unreleased

## 2.0.0

- fixed packaged CLI drift so `bin/octopus.js` matches the current Node runtime behavior
- fixed `setup` to keep CLI-collected workspaces in agent handoff state until `AGENT_INIT_PROMPT.md` is executed
- fixed packaged `setup` to create only the selected canonical entrypoint by default
- added packaged lifecycle regression coverage for `setup -> uninstall` with legacy file restoration
- added hard `agent-init` state tracking so workspace readiness is blocked until active agent files, project rules, skills prompt, verify, and manifest validation are all recorded in code
- added `octopus skills suggest` and compact `live/config/skills-index.json` for code-driven optional-skill recommendations
- added manifest-based built-in domain packs and optional skill scaffolds for future expansion
- refreshed README/HOW_TO/CLI/architecture/configuration docs for the hard `agent-init` gate and Node-only runtime

## 1.0.8

- completed the Node-only runtime migration
- removed legacy shell lifecycle entrypoints and gate wrappers
- aligned bootstrap, install, init, reinit, verify, update, uninstall, and gate flows on `bin/octopus.js`
- reduced the deployed bundle surface to `bin/`, `src/`, `template/`, and core docs
- refreshed contract tests and documentation for the Node-only runtime

## Current Direction

- Node.js 20 LTS is the only runtime baseline
- lifecycle commands and gates run only through the Node CLI
- `scripts/node-foundation/*` remains only as repository build/test infrastructure
