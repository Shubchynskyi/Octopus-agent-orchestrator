# Changelog

## Unreleased

## 2.3.2

- finished the TypeScript-only source contract: the public CLI launcher is now generated from `src/bin/octopus.ts`, and hand-written tracked `bin/octopus.js` source is gone
- added `prepare` plus build-path sync so source checkouts and package builds materialize the generated launcher consistently before execution
- aligned `typecheck` with the full maintained TypeScript graph used by the runtime, Node tests, and build/test harness
- reduced hot-path recompilation by splitting lightweight helper compilation (`build:scripts`) from the wider staged test/runtime graph
- stabilized packaging tests by isolating publish-runtime and pack smoke builds in fixture repos instead of racing on the shared repository `dist/`
- cleaned repo ignores/docs to match the current compile-first Node/TypeScript contract

## 2.3.1

- synchronized release metadata on `2.3.1`, including the root `package-lock.json` version/license fields with `package.json`, `VERSION`, and `LICENSE`
- clarified the compile-first runtime execution model: source-repo usage runs through compiled runtime output, and packaged installs under `node_modules` use compiled `dist/src/**/*.js`
- refreshed internal token-economy planning docs to describe the current Node-only runtime instead of obsolete PowerShell or shell/Python implementation paths
- documented `feat/node-runtime-migration` as a historical branch alias rather than a separate active runtime line

## 2.3.0

- added durable `project-memory` contract, generated project-memory summary, and lifecycle-safe preservation across install/update/reinit/uninstall flows
- hardened lifecycle/update behavior with trust enforcement, streamed subprocesses, richer diagnostics, task-event hash normalization, deferred `VERSION` restore safety, and LF-preserving uninstall hook cleanup
- aligned CLI contracts for `update` / `update git`, added signal-aware temp-root cleanup, and improved top-level failure markers for automation
- added real `npm pack -> install -> invoke` release smoke coverage plus stronger compat, contract-smoke, lifecycle, and packaging tests
- refreshed release docs and manifest ownership contracts, added walkthrough docs, and distilled skill-authoring guidance into the `skill-builder` references
- removed the remaining PowerShell/Pester compatibility traces from the public runtime surface so execution is unambiguously Node-only
- normalized release/install/update docs to version-safe placeholders, replaced packaged local doc links with GitHub links, and renamed the runtime contract doc to `docs/node-runtime-contract.md`
- isolated the `npm pack -> install -> invoke` smoke test from shared repo build state to make release validation deterministic

## 2.2.0

- added public `octopus update git` for explicit git-based update acquisition and `octopus rollback` for restoring the previous deployed version
- fixed `update` / `check-update --apply` to run the full update lifecycle after bundle sync and persist rollback metadata for reliable rollback
- fixed npm-facing package docs: absolute README links and image, repository metadata in `package.json`, and clearer `npx -y octopus-agent-orchestrator setup` guidance
- refreshed CLI/HOW_TO/run-methods/node-runtime-contract docs for npm-first installs, git update testing, rollback behavior, and the current package version

## 2.1.0

- added npm-based `check-update` / `update` source resolution with local `--package-spec` and `--source-path` testing overrides
- expanded optional skill-pack source templates across AI, polyglot backend, data/database, docs/process, frontend-web, and quality/architecture domains
- improved packaged CLI help and update documentation for npm-first installation and upgrade workflows

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

- established the Node-only runtime baseline
- removed legacy shell lifecycle entrypoints and gate wrappers
- aligned bootstrap, install, init, reinit, verify, update, uninstall, and gate flows on `bin/octopus.js`
- reduced the deployed bundle surface to `bin/`, `src/`, `template/`, and core docs
- refreshed contract tests and documentation for the Node-only runtime

## Current Direction

- Node.js 20 LTS is the only runtime baseline
- lifecycle commands and gates run only through the Node CLI
- `scripts/node-foundation/*` remains only as repository build/test infrastructure
