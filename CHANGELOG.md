# Changelog

## Unreleased
- hardened filesystem lock crash safety: `acquireFilesystemLock` and `acquireFilesystemLockAsync` now clean up the lock directory when the owner-metadata write fails between `mkdirSync` and `writeFileSync`, preventing orphaned locks without ownership information
- hardened stale-lock detection: `inspectLock` now treats lock directories with missing or corrupt `owner.json` metadata as stale (`staleReason: 'owner_dead'`) instead of waiting for the age-based timeout, enabling immediate reclamation of crash-orphaned locks
- fixed concurrent async lifecycle lock bypass: `withLifecycleOperationLockAsync` now serializes independent async callers targeting the same root via a per-target promise queue, preventing the synchronous re-entrancy shortcut from letting concurrent async operations skip the filesystem lock
- added unit tests for core filesystem lock primitives (`acquireFilesystemLock`, `acquireFilesystemLockAsync`, `releaseFilesystemLock`, `scanTaskEventLocks`, `cleanupStaleTaskEventLocks`) covering acquire/release lifecycle, stale-lock reclamation for missing metadata and dead PIDs, lock contention behavior, and dry-run cleanup
- added unit tests for lifecycle operation lock primitives (`withLifecycleOperationLock`, `withLifecycleOperationLockAsync`) covering synchronous re-entrancy, concurrent async serialization, dead-process lock recovery, and error-path lock release
- fixed lifecycle lock to mirror grace-period recovery for SIGKILL-orphaned metadata: `inspectLifecycleOperationLock` now checks the lock directory age when metadata is missing or corrupt, reclaiming the lock after a 2-second grace period instead of blocking forever until the 30-second stale timeout
- fixed TOCTOU race in concurrent dead-process lock recovery: both `tryRemoveStaleLock` (task-events) and `acquireLifecycleOperationLock` (lifecycle) now use atomic rename instead of direct remove when reclaiming stale locks, preventing a concurrent recoverer from deleting a freshly re-acquired valid lock
- added tests for lifecycle lock grace-period recovery covering SIGKILL-orphaned locks (missing metadata aged past grace period), corrupt metadata recovery, partial metadata (hostname-only, no PID) recovery, and within-grace-period rejection; added test for TOCTOU-safe stale recovery verifying no leftover temporary directories; added test for task-event lock partial-metadata (invalid_shape) recovery

## 2.4.2
- expanded the shared `start-task` router so root entrypoints and provider bridges now converge on the same orchestration checklist instead of relying on uneven provider-specific wording
- materialized `.agents/workflows/start-task.md` as the common thin-router control layer and updated templates/docs/tests to keep root-entrypoint providers and provider-native bridges aligned
- fixed uninstall to remove the managed `.agents/` router directory when only orchestrator-managed content remained, and to restore `.gitignore` from initialization backup while ensuring uninstall-backup ignore entries (`Octopus-agent-orchestrator-uninstall-backups/` and `Octopus-agent-orchestrator-uninstall-backups/**`) are always present after uninstall

## 2.4.1
- fixed `completion-gate` timeline parsing so one corrupted JSONL line no longer truncates the rest of the task timeline; later valid events are still processed and invalid lines are reported as parse errors instead of aborting the scan
- expanded the managed `.gitignore` baseline written during install/setup so all supported agent entrypoints and provider bridge directories are ignored from the start, preventing later agent-file additions from showing up as unexpected tracked files
- added interactive prompting and `--active-agent-files` support to the `reinit` command, aligning it with the `setup` onboarding flow and allowing intentional changes to active agent entrypoints in existing workspaces
- strengthened orchestration rules: mandatory gate/tooling failures now force an immediate `BLOCKED` status, requiring detailed infrastructure failure reporting; explicitly stated that mandatory gates cannot be waived by user preferences regarding rebuilds or tests
- hardened required-review routing on delegation-capable providers: review receipts now carry reviewer execution metadata, same-agent fallback is rejected for Codex/Claude/Copilot, conditional providers require an explicit fallback reason, and review-context artifacts publish provider-aware routing policy for reviewer launch

## 2.4.0
- changed workspace-facing banners (`status`, `doctor`, `overview`, `setup`, `agent-init`) to display the deployed project/bundle version instead of the launcher package version, preventing global CLI drift from misreporting the active workspace version
- changed the `node_modules` / global `octopus` launcher into a delegating router: when run inside a workspace that already has a source checkout or deployed bundle, it now forwards execution to that local project CLI instead of running stale packaged lifecycle logic
- changed `update git` to materialize a runnable bundle from raw git source before sync/apply: the git clone now installs dependencies, runs the source build, syncs compiled runtime artifacts including `dist/`, and fails early with build diagnostics instead of leaving a partial update
- changed `setup --no-prompt` and refresh flows to preserve previously selected `ActiveAgentFiles` by default instead of collapsing workspaces back to a single canonical entrypoint during update/self-hosted refresh
- added source-vs-bundle parity detection to explicitly warn and fail-fast when a self-hosted `bin/octopus.js` source checkout runs against a stale deployed runtime bundle
- raised the project runtime baseline from `Node.js 20 LTS` to `Node.js 24 LTS` across package engines, CLI/runtime constants, CI workflows, live/template skill metadata, and operator docs
- updated GitHub Actions workflow dependencies to current major tags for `actions/checkout`, `actions/setup-node`, and `actions/upload-artifact`, removing stale-action warnings from IDE validation
- fixed the OSV security workflow to use the upstream reusable workflow entrypoint from `google/osv-scanner-action@v2.3.0`; the repository root is not a runnable step-action and broke GitHub Actions job setup with a missing top-level `runs:` section
- fixed the CI smoke workflow to build the staged `.node-build` test graph before invoking `pack-smoke.test.js`; the smoke step previously assumed `.node-build/tests/**` existed after `npm run build`, which is not true
- fixed lifecycle smoke for the TS-only repository layout: CI now installs from the already-built checkout and exercises git-based update separately, instead of trying to install from a raw `file://` clone that lacks generated `bin/` and `dist/` artifacts
- made the concurrent task-event integrity test less timing-sensitive under shared CI runner load while preserving multiprocess lock/integrity coverage
- opted GitHub Actions workflows into `Node.js 24` for JavaScript-based actions ahead of the hosted-runner cutoff, removing the Node 20 deprecation warning while keeping the project runtime itself on Node 20

## 2.3.7

- enforced a hard atomic consistency invariant for the deployed bundle during `update` and `reinit`: the lifecycle now validates the presence of `bin`, `dist`, `package.json`, `VERSION`, and `template` artifacts after sync and before completion
- enhanced `detectSourceBundleParity` to detect structurally incomplete or old bundles in self-hosted mode, preventing execution of stale runtime code
- added automatic rollback on bundle invariant violation during the update pipeline
- added comprehensive unit tests for bundle invariants and lifecycle consistency gates

## 2.3.6

- fixed self-hosted provider bridge and live rule examples to use `node bin/octopus.js` in the source checkout instead of the deployed bundle path; this avoids running stale materialized workspace code during local orchestrator development
- fixed GitHub Actions lifecycle smoke to clone the current workflow branch during `file://` install tests, preventing PR and branch runs from silently validating the repository default branch instead of the checked-out code under test
- documented the CI/runtime contract in `README.md` and `docs/node-platform-foundation.md` so release validation and cross-platform smoke coverage are visible from the main docs surface

## 2.3.5

- hardened task-event lock recovery: `enter-task-mode` and other gate timeline writes now inspect lock owner metadata, immediately reclaim orphaned `.lock` directories when the recorded PID is dead, and emit timeout diagnostics with lock age plus owner details instead of generic file-lock timeouts
- hardened mandatory gate-event handling: task-mode, rule-pack, preflight, compile, review, doc-impact, and completion paths now fail hard when their required lifecycle timeline events cannot be appended, and `enter-task-mode` rolls back its freshly written artifact instead of leaving a poisoned partial state behind
- added operator diagnostics for blocked/stalled work: `octopus doctor explain <FAILURE_ID>` now prints remediation steps for known failure codes, and `octopus status why-blocked` analyses `TASK.md`, timelines, and failed gates to explain why active tasks cannot progress
- added task-event lock health and safe cleanup: `octopus doctor` now reports `runtime/task-events/*.lock` owner metadata, stale-vs-live assessment, and remediation guidance, while `octopus doctor --cleanup-stale-locks [--dry-run]` removes only proven-stale task-event locks and explicitly excludes `runtime/reviews/` from the lock subsystem

## 2.3.4

- hardened update trust bypass flow: ordinary update/check-update/update git paths now ignore the legacy `OCTOPUS_UPDATE_TRUST_OVERRIDE` environment variable, require explicit `--trust-override --no-prompt` for non-allowlisted sources, and record trust override usage in CLI output plus update reports
- hardened zero-diff noop guard: `required-reviews-check` gate now blocks when preflight detects zero-diff (clean tree) unless an audited no-op artifact exists, preventing clean-tree preflights from drifting toward task completion without produced changes
- tightened zero-diff orchestration handling: a clean-tree `preflight` is now treated as baseline-only evidence, and task completion requires either a real produced diff or an audited no-op artifact recorded through the gate flow
- added audited no-op gate support and completion evidence checks so implementation tasks can no longer drift from `preflight` directly to `DONE` without explicit proof of “already done” / “no changes required”
- hardened subprocess shell usage: `spawnStreamed` no longer exposes general-purpose shell execution, and Windows shell semantics are confined to a dedicated internal batch-file helper with regression coverage against runtime-cast `shell: true` and crafted command-injection-style arguments
- documented the zero-diff contract in CLI/runtime/workflow docs, including the `gate record-no-op` escape hatch and the rule that clean-tree preflight is baseline-only, not completion evidence
- finished lifecycle path-boundary hardening by validating rollback/sync metadata before destructive restore operations, including rejection of traversal/absolute-path entries in `rollback-records.json` and `sync-backup-metadata.json`
- expanded lifecycle regression coverage for malicious relative paths and corrupted rollback/sync metadata to keep copy/remove/restore flows root-confined
- finished `MANIFEST.md` path-safety hardening: manifest validation now rejects unsafe and non-normalized entries with machine-readable diagnostics and enforces `OUTSIDE_ROOT` both against explicit `targetRoot` and, by default, against the directory containing the manifest itself
- added a repo-level release version parity guard: `validate:release` now fails early when `VERSION`, `package.json`, top-level `package-lock.json.version`, or `package-lock.json packages[""].version` diverge

## 2.3.3

- added explicit `enter-task-mode` gate and hard task-mode evidence enforcement so compile, review, and completion gates fail when code execution starts without a declared `TASK.md` orchestration boundary
- added explicit `load-rule-pack` gate and downstream rule-pack evidence enforcement so preflight, compile, review, and completion gates now require proof that canonical workflow/risk-specific rule files were actually loaded for the task
- tightened completion enforcement for code-changing tasks: completion now requires ordered lifecycle evidence (`PREFLIGHT_CLASSIFIED`, `IMPLEMENTATION_STARTED`, `REVIEW_PHASE_STARTED`), real review-skill telemetry (`SKILL_SELECTED`, `SKILL_REFERENCE_LOADED`), and required review artifacts instead of verdict-only proxy evidence
- expanded automatic task timeline emission and observability: task-mode/preflight/implementation/review routing/status transitions are auto-recorded in `runtime/task-events`, and `status` / `doctor` now surface incomplete timelines explicitly
- added full Qwen root-entrypoint support: `Qwen` is now a canonical source-of-truth option mapped to `QWEN.md`, with active-entrypoint normalization, bootstrap/install/uninstall coverage, and `.qwen/settings.json` synchronization to the current canonical entrypoint plus `TASK.md`
- hardened ordinary `update` / `check-update --apply` for existing workspaces by running built-in live-rule contract migrations before verify/manifest, so stale mandatory rule snippets are auto-repaired during update instead of breaking `doctor` afterward
- finished the TypeScript-only source contract: the public CLI launcher is now generated from `src/bin/octopus.ts`, and hand-written tracked `bin/octopus.js` source is gone
- added `prepare` plus build-path sync so source checkouts and package builds materialize the generated launcher consistently before execution
- aligned `typecheck` with the full maintained TypeScript graph used by the runtime, Node tests, and build/test harness
- reduced hot-path recompilation by splitting lightweight helper compilation (`build:scripts`) from the wider staged test/runtime graph
- stabilized packaging tests by isolating publish-runtime and pack smoke builds in fixture repos instead of racing on the shared repository `dist/`
- cleaned repo ignores/docs to match the current compile-first Node/TypeScript contract

### Additional 2.3.3 notes

- synchronized release metadata on `2.3.3`, including the root `package-lock.json` version/license fields with `package.json`, `VERSION`, and `LICENSE`
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
