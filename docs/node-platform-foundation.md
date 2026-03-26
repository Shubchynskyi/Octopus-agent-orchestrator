# Node Platform Foundation

## Goal

This document records the TypeScript/Node foundation that now backs the active runtime.

- baseline: **Node 20 LTS**
- source of behavior: **`src/**/*.ts`**
- public router: **`bin/octopus.js`**
- validation and gate logic run through the same Node runtime

## Source Layout

| Path | Role |
|---|---|
| `src/cli/index.ts` | Foundation descriptor for the active Node runtime |
| `src/core/*.ts` | Shared constants, fs/path helpers, template utilities |
| `src/materialization/*.ts` | Install/init materialization logic |
| `src/lifecycle/*.ts` | Bootstrap, install, reinit, update, uninstall flows |
| `src/validators/*.ts` | Status, verify, doctor, manifest validation |
| `src/gates/*.ts` | Gate implementations and task-event summaries |
| `src/gate-runtime/*.ts` | Shared gate runtime helpers |
| `tests/node/**` | Node-native unit and integration coverage |
| `scripts/node-foundation/*.ts` | Build/test harness for staged `.node-build/` output |
| `tsconfig.json` | Editor-facing entrypoint |
| `tsconfig.node-foundation.json` | Tooling contract for the Node foundation |

## Execution Model

- In the source repository, `bin/octopus.js` executes JS-compatible `src/**/*.ts` files directly by mapping `.ts` loading onto the Node `.js` loader.
- In packaged installs under `node_modules`, `bin/octopus.js` switches to compiled `dist/src/**/*.js`.
- `scripts/node-foundation/build.ts` produces `.node-build/` for staged contract tests and `dist/` for the published-package runtime.

## Validator Strategy

Validation stays in-repo and TypeScript-first:

- init-answer validation
- managed config validation
- workspace layout checks
- manifest duplicate detection
- doctor and verify aggregation

## Build and Test

### `npm run build:node-foundation`

Stages the TypeScript runtime into `.node-build/` and prints `NODE_FOUNDATION_BUILD_OK`.

### `npm run test:node-foundation`

Rebuilds the staged runtime and executes `tests/node/**/*.test.js`, then prints `NODE_FOUNDATION_TEST_OK`.

## Current Runtime State

- `bin/octopus.js` is the active runtime router.
- Lifecycle commands and gates are Node-only.
- Historical shell wrappers have been removed from the runtime surface.

## Repository Branch Note

- `master` and `dev` are the active heads for the current Node runtime line.
- `feat/node-runtime-migration` may still appear in clones or remotes as a historical alias that points to the same head; it is not a separate maintained runtime track.
