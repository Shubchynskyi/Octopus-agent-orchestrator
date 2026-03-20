# Node Platform Foundation — M1 / M2

## Goal

Phase `M1` establishes the reusable Node foundation for the runtime migration without changing the active lifecycle behavior.

Phase `M2` ports the read-only validators (`verify`, `status`, `doctor`, `validate-manifest`) to Node TypeScript, giving the staged runtime a safety net before destructive lifecycle commands are migrated.

This phase is intentionally platform-only:

- the package baseline moves to **Node 20 LTS**;
- `src/` becomes the home for reusable **TypeScript** Node modules;
- runtime/config artifacts get explicit validators;
- build/test commands exist for the new foundation;
- `bin/octopus.js` still delegates lifecycle work to the canonical PowerShell scripts.

## Runtime Policy

- `package.json` now requires `Node.js >=20.0.0`.
- The npm CLI remains the public entrypoint: `octopus`, `oao`, `octopus-agent-orchestrator`.
- PowerShell, bash, and Python are still compatibility runtimes until later migration phases remove them.
- `docs/node-migration-contract.md` remains the historical `M0` freeze and must keep the shipped pre-M1 floor visible.
- New Node migration code is authored in **TypeScript only**.

## Source Layout

| Path | Role |
|---|---|
| `src/cli/index.ts` | Exposes the staged Node foundation descriptor while the legacy CLI stays active |
| `src/core/constants.ts` | Shared constants mirrored from the existing CLI surface |
| `src/core/paths.ts` | Cross-platform path normalization and repo-boundary helpers |
| `src/core/fs.ts` | File IO primitives with deterministic line-ending handling |
| `src/core/json.ts` | JSON read/write helpers with clear parse failures |
| `src/core/line-endings.ts` | Line-ending detection and normalization helpers |
| `src/core/templates.ts` | Placeholder/token helpers for future materialization work |
| `src/core/managed-blocks.ts` | Managed-block insert/replace/remove primitives |
| `src/schemas/init-answers.ts` | Canonical validator/normalizer for `runtime/init-answers.json` |
| `src/schemas/config-artifacts.ts` | Validators for managed config artifacts |
| `src/runtime/loaders.ts` | File loaders that combine JSON IO with validators |
| `src/validators/index.ts` | Barrel export for all M2 validation modules |
| `src/validators/validate-manifest.ts` | MANIFEST.md duplicate detection (parity with `validate-manifest.ps1`) |
| `src/validators/workspace-layout.ts` | Required-path lists, managed config checks, gitignore checks, version checks |
| `src/validators/status.ts` | Read-only workspace status snapshot (parity with `getStatusSnapshot()` in `bin/octopus.js`) |
| `src/validators/verify.ts` | Full workspace verification (parity with `scripts/verify.ps1` read-only checks) |
| `src/validators/doctor.ts` | Combined verify + manifest validation (parity with `handleDoctor()` in `bin/octopus.js`) |
| `tests/node/**` | Node-native unit tests for the new foundation |
| `tsconfig.node-foundation.json` | Editor/tooling contract for the staged TypeScript foundation |

## Validator Strategy

This repository now uses **explicit in-repo validators** for the staged TypeScript foundation instead of introducing an extra schema dependency during `M1`.

Why:

- no new package-install dependency is required to build or test the foundation;
- validators stay close to the existing PowerShell contract logic;
- later phases can tighten or swap the implementation without changing the public surface.

Current validator scope:

- init-answer enums and boolean-like values;
- tracked managed config artifacts under `template/config/*.json`;
- context-aware output-filter parser shapes;
- normalization for arrays, integers, and canonical entrypoint selections.

### M2 Validation Core

`T-068` ports the read-only safety-net validators to Node:

- **validate-manifest**: duplicate detection in `MANIFEST.md` (parity with `validate-manifest.ps1`);
- **workspace-layout**: required-path checking, managed config JSON parse validation, version contract checks, gitignore entry detection, rule file and template placeholder checks;
- **status**: read-only workspace health snapshot with init-answers reading, entrypoint resolution, and staged progress (parity with `getStatusSnapshot()`/`printStatus()` in `bin/octopus.js`);
- **verify**: comprehensive verification running all violation-category checks from `scripts/verify.ps1` including init-answers, version, config, rules, commands, TASK.md, entrypoint, and gitignore validation;
- **doctor**: combined verify + manifest validation with pass/fail diagnostic output (parity with `handleDoctor()` in `bin/octopus.js`).

## Build and Test Skeleton

### `npm run build:node-foundation`

Builds the staged Node foundation by:

1. loading the staged `.ts` modules through a CommonJS loader shim that works on Node 20;
2. validating source modules under `src/**/*.ts`;
3. copying staged source and tests into `.node-build/` as runnable `.js` files;
4. writing `.node-build/node-foundation-manifest.json`.

Output marker: `NODE_FOUNDATION_BUILD_OK`

### `npm run test:node-foundation`

Runs the Node-native test harness by:

1. rebuilding the staged foundation;
2. executing the copied `tests/node/**/*.test.js` suite through `node --test`.

Output marker: `NODE_FOUNDATION_TEST_OK`

### Why the build stages `.js`

The repository does not yet ship a dedicated TypeScript compiler toolchain. To keep the **Node 20** baseline intact, `M1` stores authored source as `.ts`, then stages `.js` files into `.node-build/` by rewriting only local `.ts` specifiers.

This keeps the source TypeScript-only while avoiding a runtime dependency on an unavailable external compiler during the transition.

## Intentional Non-Goals

`M1`/`M2` does **not**:

- reroute `bin/octopus.js` to the new Node modules;
- replace `scripts/*.ps1` or `scripts/*.sh`;
- change managed-file behavior;
- change install/init/reinit/update/uninstall semantics.

Those transitions begin in later migration phases after the foundation is proven.

## Handoff to Later Phases

- `T-068` reuses the new validators and IO/path helpers for `verify`, `status`, `doctor`, and `validate-manifest`.
- `T-069` and later phases can extend `src/core/*` instead of recreating cross-platform primitives.
- `M0` contract tests remain the parity guardrail while the new Node tests prove the staged implementation can evolve independently.
