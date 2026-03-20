# Node Runtime Migration Plan

## Executive Summary

This repository can move to a single Node runtime, but it should not be treated as a simple CLI rewrite.

Today the product runtime is split across:
- `bin/octopus.js` as the npm CLI router
- `scripts/*.ps1` as the canonical control-plane
- `scripts/*.sh` as thin `pwsh` wrappers
- `live/scripts/agent-gates/*.ps1` as PowerShell gate implementations
- `live/scripts/agent-gates/*.sh` as real bash + Python gate implementations

The migration is feasible and strategically correct if the goal is:
- one required runtime
- one implementation of lifecycle logic
- one test stack
- identical behavior across Windows, macOS, and Linux

The migration is not a low-risk refactor. It is a staged platform migration and should be executed as a major roadmap item with parity gates.

## Recommendation

Recommended direction:
- Move to Node 20 LTS as the only required runtime.
- Author all new Node migration code in TypeScript.
- Use strangler migration, not a big-bang rewrite.
- Keep user-facing CLI commands, artifacts, managed files, and rule contracts stable.
- Treat PowerShell, bash, and Python as compatibility layers first, then deprecate, then remove.

Not recommended:
- rewriting install/init/update/uninstall and gate runtime all at once;
- changing product behavior during the runtime migration;
- introducing a new runtime and a new behavior model in the same phase.

## Current-State Facts

Observed in the repository:
- `package.json` exposes `octopus`, `oao`, and `octopus-agent-orchestrator` through `bin/octopus.js`.
- `bin/octopus.js` routes `setup`, `install`, `init`, `doctor`, `reinit`, `update`, and `uninstall` to PowerShell scripts.
- top-level `scripts/*.sh` are compatibility shims that prefer `node bin/octopus.js <command>` and fall back to `pwsh`.
- gate `.sh` files are not wrappers; they are real bash + Python implementations.
- architecture and CLI docs explicitly describe the current runtime split.

Practical implication:
- the project is already Node-fronted, but not Node-core.
- runtime consolidation is realistic because a CLI boundary already exists.
- parity work is large because the current behavioral core lives outside Node.

## Migration Goals

Target state:
- one primary runtime: Node 20 LTS;
- one CLI surface: `octopus`;
- one behavioral core under a single source tree;
- one cross-platform test model;
- same commands, artifacts, contracts, and task workflow as today.

Success means:
- PowerShell, bash, and Python are no longer mandatory dependencies;
- current workspace lifecycle remains behaviorally identical;
- gate outputs, task-event behavior, config shapes, and managed-block semantics remain stable;
- existing workspaces can update without destructive surprises.

## Non-Negotiable Invariants

The migration must preserve these product contracts:

### CLI and UX
- command names and aliases
- flag names and their meanings
- overview/setup/bootstrap/install/init/reinit/doctor/update/uninstall flow

### Workspace Surface
- `Octopus-agent-orchestrator/live/**`
- `runtime/init-answers.json`
- `runtime/reviews/**`
- `runtime/task-events/**`
- `runtime/update-reports/**`
- `runtime/bundle-backups/**`

### Managed File Semantics
- root entrypoints and redirects
- provider bridge files
- managed blocks in `.gitignore`
- managed blocks in `.git/hooks/pre-commit`
- managed entries in `.qwen/settings.json`
- managed entries in `.claude/settings.local.json`

### Config and Artifact Shapes
- `review-capabilities.json`
- `paths.json`
- `token-economy.json`
- `output-filters.json`
- review-context artifacts
- compile evidence artifacts
- task-event hash-chain fields

### Lifecycle Semantics
- install/materialization rules
- reinit partial-refresh rules
- update backup and rollback rules
- uninstall keep/delete rules
- mandatory gate ordering

## Migration Principles

1. Parity before improvement.
2. No big-bang rewrite.
3. One phase, one runtime boundary change.
4. Read-mostly and validator flows before destructive lifecycle flows.
5. Keep old entrypoints alive as shims until Node parity is proven.
6. Do not mix platform migration with broad product redesign.

## Recommended Runtime Baseline

Recommended baseline:
- Node 20 LTS

Why:
- modern `fs`, streams, path handling, and process APIs;
- long support window;
- better fit for a single-runtime CLI platform.

Required preparatory work:
- align repository documentation and package engine policy to a single Node baseline before the migration starts.

## Proposed Target Architecture

```text
src/
  cli/
    index.ts
    commands/
      overview.ts
      setup.ts
      status.ts
      doctor.ts
      bootstrap.ts
      install.ts
      init.ts
      reinit.ts
      verify.ts
      update.ts
      uninstall.ts
  core/
    paths.ts
    fs.ts
    process.ts
    manifest.ts
    managed-blocks.ts
    init-answers.ts
    config-normalizers.ts
    materialize.ts
    entrypoints.ts
    providers.ts
    update.ts
    backups.ts
    uninstall.ts
    rollback.ts
  gates/
    classify-change.ts
    compile-gate.ts
    build-scoped-diff.ts
    build-review-context.ts
    required-reviews-check.ts
    doc-impact-gate.ts
    completion-gate.ts
    task-events.ts
    task-events-summary.ts
    validate-manifest.ts
  compat/
    ps1-shims/
    sh-shims/
tests/
```

The exact folder names can change, but the separation should remain:
- CLI routing
- reusable core services
- gate runtime
- temporary compatibility shims

## Migration Phases

## M0. Contract Freeze

Goal:
- create an executable definition of current behavior before rewriting runtime internals.

Deliverables:
- `docs/node-migration-contract.md`
- command/flag inventory
- managed-file inventory
- lifecycle scenario inventory
- golden examples for:
  - overview
  - bootstrap
  - setup
  - install from existing init answers
  - init
  - reinit
  - doctor
  - verify success/failure
  - update with backup report
  - uninstall with keep/delete branches

Entry criteria:
- current release branch is stable enough to baseline behavior.

Exit criteria:
- all core scenarios are reproducible in tests and stored as parity references.

Risk if skipped:
- later Node behavior will drift in small but expensive ways.

## M1. Node Platform Foundation

Goal:
- introduce the Node core and test/build skeleton without changing product behavior.

Deliverables:
- Node project structure
- build pipeline for the new runtime
- TypeScript-first source policy for new Node modules
- internal utility modules:
  - path resolution
  - file IO
  - line-ending normalization
  - JSON read/write
  - markdown/template helpers
  - managed-block editing primitives
- explicit schemas or validators for core config/runtime payloads

Entry criteria:
- M0 contract freeze complete.

Exit criteria:
- new Node core exists and can be tested independently.
- no lifecycle command is yet forced through Node implementation.

Risk:
- introducing TypeScript/build tooling and runtime migration at the same time can increase complexity. Keep this phase platform-only.

## M2. Read-Mostly Validation Layer

Goal:
- port low-destructive, high-signal commands first.

Recommended scope:
- `verify`
- `status`
- `doctor`
- `validate-manifest`

Why first:
- they encode most product contracts;
- they provide the safety net for later destructive phases.

Deliverables:
- Node implementations for the commands above
- parity tests against golden outputs and failure diagnostics

Exit criteria:
- Node `verify` becomes the reference validator for subsequent phases.

Go/No-Go rule:
- do not start install/materialization rewrite before Node `verify` is trusted.

## M3. Shared Gate Runtime Library

Goal:
- move the non-shell-specific gate engine into Node before porting each gate entrypoint.

Recommended scope:
- output filters
- token telemetry
- compactness audit
- task-event append/integrity logic
- review-context compaction helpers
- scoped-diff helper logic
- manifest/path utilities used by gates

Why here:
- current gate logic is duplicated across PowerShell and Python;
- this phase removes the biggest long-term duplication pressure.

Exit criteria:
- one Node implementation exists for gate helper logic;
- parity tests pass against current PowerShell/Python behavior for core helper cases.

## M4. Safe User-Facing Lifecycle Commands

Goal:
- port commands that are user-facing and operationally important, but still lower-risk than install/update/uninstall.

Recommended scope:
- `overview`
- `setup`
- `bootstrap`

Deliverables:
- Node prompt layer
- non-interactive flag handling
- init-answer writing and validation
- bundle deploy/sync primitives for bootstrap/setup

Exit criteria:
- first-run user workflow can run end-to-end in Node without calling PowerShell for these commands.

Risk:
- setup currently bridges into install and validation; do not collapse too much logic into one phase.

## M5. Materialization and Re-Materialization

Goal:
- port the main write-heavy workspace construction logic.

Recommended scope:
- `install`
- `init`
- `reinit`

Required parity areas:
- live materialization
- source-of-truth selection
- redirect entrypoints
- provider bridge materialization
- managed settings insertion
- pre-commit hook managed block
- `.gitignore` managed entries
- reinit limited-refresh semantics

Exit criteria:
- Node materialization produces byte-stable or contract-stable output for golden scenarios.

No-Go rule:
- do not move to update/uninstall until keep/delete and partial-refresh semantics are proven.

## M6. Destructive Lifecycle Phase

Goal:
- port the highest-risk file mutation flows.

Recommended scope:
- `update`
- `check-update`
- `uninstall`

Required parity areas:
- bundle sync
- update reports
- bundle backups
- rollback behavior
- uninstall preservation choices
- managed-block stripping only

Required tests:
- interrupted update
- partial sync failure
- locked file behavior
- rollback validation
- uninstall keep/delete matrix

Exit criteria:
- destructive lifecycle is parity-tested on all supported OSes.

## M7. Gate Entrypoint Migration

Goal:
- eliminate PowerShell and bash/python gate runtimes as behavioral implementations.

Recommended scope:
- `classify-change`
- `compile-gate`
- `build-scoped-diff`
- `build-review-context`
- `required-reviews-check`
- `doc-impact-gate`
- `completion-gate`
- `task-events`
- `task-events-summary`
- `validate-manifest`

Implementation rules:
- use `spawn(file, args, { shell: false })`, not shell-string interpolation;
- stream stdout/stderr;
- preserve structured parser -> degraded parser -> passthrough logic.

Exit criteria:
- gate `.ps1` and `.sh` files can become wrappers to Node.

## M8. Compatibility Release

Goal:
- keep old entrypoints, but route them to Node implementations.

Deliverables:
- `scripts/*.ps1` wrappers to Node
- `scripts/*.sh` wrappers to Node
- `live/scripts/agent-gates/*.ps1` wrappers to Node
- `live/scripts/agent-gates/*.sh` wrappers to Node

Why:
- reduces breakage for existing automation, docs, and deployed workspaces;
- allows one full release cycle of compatibility.

Exit criteria:
- all old runtime entrypoints are compatibility shims only.

## M9. Deprecation and Removal

Goal:
- remove PowerShell, bash, and Python as required runtimes after parity is proven in the field.

Deliverables:
- deprecation notice release
- major release removing old implementations
- docs cleanup
- runtime requirements simplified to Node only

Exit criteria:
- Node is the only required runtime;
- compatibility shim removal is complete.

## Test Strategy

The migration should be test-first and parity-first.

### 1. Golden Lifecycle Tests
- bootstrap
- setup
- install
- init
- reinit
- doctor
- verify
- update
- uninstall

These should validate file trees, file contents, and runtime artifact outputs.

### 2. Contract Tests
- `init-answers.json`
- config shapes
- review-context artifacts
- compile evidence artifacts
- task-events integrity chain
- managed block shapes

### 3. Cross-Platform Integration Matrix
- Windows
- macOS
- Linux

### 4. Gate Parser Parity Tests
- compile success
- compile failure
- test failure
- lint failure
- degraded parser path
- passthrough fallback path

### 5. Destructive Scenario Tests
- interrupted update
- partial update failure
- locked-file update rollback
- uninstall with preserve runtime
- uninstall with delete everything managed

## Risk Register

Highest-risk areas:
- managed block editing
- line endings
- hook executable semantics
- path separator and case-sensitivity behavior
- path-inside-root validation
- quoting and child-process argument passing
- update rollback semantics
- uninstall keep/delete semantics
- task-event integrity and lock behavior
- parser parity for noisy tool output

Migration rule:
- each of these areas must have dedicated parity tests before the old implementation is removed.

## Recommended Work Breakdown

Suggested migration backlog:

### Epic A. Contract and Platform
- freeze lifecycle contracts
- add Node project structure
- align Node baseline and docs
- add schema/validator layer

### Epic B. Validation Core
- port verify
- port validate-manifest
- port status
- port doctor

### Epic C. Shared Runtime Helpers
- path/fs/process helpers
- managed-block editing
- output filters
- telemetry
- task-events
- review-context helpers

### Epic D. User Workflow
- overview
- setup
- bootstrap

### Epic E. Materialization
- install
- init
- reinit

### Epic F. Destructive Lifecycle
- update
- check-update
- uninstall
- rollback tests

### Epic G. Gate Runtime
- classify-change
- compile-gate
- build-scoped-diff
- build-review-context
- required-reviews-check
- doc-impact-gate
- completion-gate
- task-events summary

### Epic H. Compatibility and Removal
- wrapper release
- deprecation release
- major cleanup release

## Decision Gates

Use these explicit go/no-go checkpoints:

### Gate 1
Do not start major runtime rewrite without M0 golden contracts.

### Gate 2
Do not rewrite destructive lifecycle flows before Node `verify` is trusted.

### Gate 3
Do not remove PowerShell/Python implementations before:
- OS matrix is green;
- destructive scenario matrix is green;
- wrapper release has shipped;
- at least one release cycle of compatibility has passed.

## Resourcing Guidance

This should be treated as a platform project, not a side refactor.

Recommended staffing model:
- one owner for control-plane parity;
- one owner for gate-runtime parity;
- one owner for test/golden-contract infrastructure.

Doing this as ad hoc opportunistic cleanup during feature delivery will increase regression risk.

## Final Recommendation

Yes, migrate toward a pure Node runtime.

But do it only under these conditions:
- parity-first migration;
- contract freeze before rewrite;
- wrappers before removals;
- destructive flows late in the plan;
- major-version framing for final runtime simplification.

If the project needs near-term feature velocity more than runtime simplification, do not start the full migration immediately.
If the project needs lower operational complexity and cross-platform consistency, this migration is worth doing and should be run as a dedicated roadmap track.
