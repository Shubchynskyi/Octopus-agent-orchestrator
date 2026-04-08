# Changelog

## 2.4.3
- added golden snapshot tests for token economy, compaction, and completion behavior: `tests/node/gate-runtime/golden-snapshots.test.ts` locks down `buildOutputTelemetry` output shape and savings invariants, `formatVisibleSavingsLine` format contract, `buildBudgetForecast` deterministic structure and arithmetic, `formatBudgetForecastText` line format, `buildBudgetComparison` shape, `resolveRiskAwareDepth` risk-level compression profiles, `resolveCompressionProfile` risk-tier mapping, `compactMarkdownContent` strip modes and metrics, `normalizeErrorSignature` path normalization, and `groupMatchingLines`/`formatGroupedLines` deduplication format; `tests/node/gates/golden-snapshots.test.ts` locks down `STAGE_SEQUENCE_ORDER` constant, `collectOrderedTimelineEvents` JSONL parsing and entry shape, `validateStageSequence` evidence shape and violation detection, `getCompileCommandProfile` 20-command classification matrix, `getCompileCommands` markdown extraction, and `getCompileFailureStrategyConfig` per-strategy pattern validity
- extended scoped diff from file-level to hunk-level filtering: `build-scoped-diff` gate now supports `--hunk-level` flag that parses unified diff output into per-file blocks with per-hunk granularity and filters hunks whose changed lines (additions/deletions) or hunk header function context match trigger regexes; files whose path matches triggers retain all hunks; binary/mode-only blocks (no hunks) are included when the file path matches; non-path-matched files keep only relevant hunks; metadata artifact includes `hunk_level` flag and `hunk_filter` object with `total_hunks`, `included_hunks`, `total_file_blocks`, `included_file_blocks`, and `hunk_level_filtered` for downstream telemetry; added `parseUnifiedDiff`, `extractFilePathFromDiffLine`, `filterHunksInBlock`, `reassembleDiff`, and `filterDiffByHunks` exports in `gate-runtime/scoped-diff`
- made `strip_code_blocks` context-aware: when enabled, `compactMarkdownContent` now classifies each code block as illustrative or structural based on preceding context (example labels, heading text, inline phrases like "e.g.", "for example", "such as", "like so", "for instance"); only illustrative code blocks are stripped while structural ones (commands, configuration, API references) are retained; added `retained_structural_code_blocks` counter to `CompactMarkdownResult` and `ReviewContextSourceFile`
- replaced flat max-match output in compile, test, and lint failure parsers with error grouping and deduplication: matching lines are now grouped by normalized error signature (file paths and line/column numbers stripped) so that repeated errors (e.g., the same TS2345 across dozens of files) appear as `[N×] representative line` instead of N flat entries; `CompactSummary` headers now include group and match counts; `grouping` metadata (`total_matches`, `unique_groups`, per-group `count`) is surfaced in both `ParserResult` and `FilterProfileResult` for downstream telemetry; added `normalizeErrorSignature`, `groupMatchingLines`, and `formatGroupedLines` exports
- expanded noisy-command audit patterns from 16 to 36 covering new categories: package managers (pip/yarn/pnpm install), build tools (mvn/gradle verbose, cargo build/test -v, dotnet build/test diagnostic), network (curl without -s, wget without -q), file listing (find without -maxdepth, tree without -L, ls -R), system (bare env/printenv), interactive pagers (less/more), container tooling (docker ps/images, kubectl describe/get), and infrastructure (terraform plan); each new pattern includes compact-equivalent guidance and category tags for downstream grouping
- propagated compact-command protocol reference into redirect entrypoints (`buildRedirectManagedBlock`), provider orchestrator bridges (`buildProviderOrchestratorAgentContent` for full and Antigravity compact), shared start-task router (`buildSharedStartTaskWorkflowContent`), and GitHub skill bridge agents (`buildGitHubSkillBridgeAgentContent`); every agent surface now references `40-commands.md` compact protocol (`scan -> inspect -> debug`) so providers entering through any bridge path inherit the compact-command contract
- enforced compact-command protocol in gate execution helpers: `executeCommandAsync` and `executeCommand` now produce a `command_policy_audit` on every invocation using `auditGateCommand`; compile-gate evidence includes `command_policy_audits` and `command_policy_warning_count` for measurable compactness telemetry
- expanded noisy-command audit patterns from 3 to 16 covering git (diff/log/status/show/stash), containers (docker logs/kubectl logs), testing (pytest/jest/vitest/go test), search (rg/grep/cat), and package managers (npm install/npm ls); each pattern now records a `matched_categories` array for downstream grouping
- added `auditGateCommand` helper for lifecycle-required gate commands with automatic justification that suppresses warnings for gate-driven executions
- exported `CommandCompactnessAudit` and `AuditCommandOptions` interfaces for typed consumption by gate and CLI modules
- added token-budget-based adaptive filtering profiles: output-filters now support a `budget_profiles` section with ordered tiers (`tight`, `moderate`, `generous`); when `budgetTokens` is passed to `applyOutputFilterProfile`, the matching tier auto-overrides `passthrough_ceiling_max_lines`, `fail_tail_lines`, `max_matches`, `max_parser_lines`, and `truncate_line_max_chars` so gate output scales with actual token budget
- added `resolveBudgetTier` export for standalone tier resolution from config and token count
- updated `outputFiltersSchema` to validate the new `budget_profiles` object with tier items
- added risk-aware depth auto-promotion: `classify-change` now computes the effective depth from risk triggers (`computeEffectiveDepth`) instead of relying on manual caller-supplied values; FULL_PATH forces minimum depth 2, db/security/refactor triggers force minimum depth 2, and security/infra triggers prefer depth 3
- added compression profile auto-resolution: `resolveCompressionProfile` adapts token-economy compression settings per risk level — high-risk (security/infra) disables all stripping and compaction, medium-risk (db/refactor/api/performance) preserves examples but disables code-block stripping, low-risk uses base config as-is
- added `resolveRiskAwareDepth` combining depth promotion and compression resolution into a single call, emitted as `risk_aware_depth` in the preflight artifact
- added preflight token-budget forecasting: `classify-change` now emits a `budget_forecast` object in the preflight artifact that estimates per-review and compile-gate token costs using scope-aware heuristics, and a `depth_escalation` record that captures requested-vs-effective depth with trigger reasons
- added requested-vs-effective depth and budget comparison to `octopus stats`: per-task output now shows depth escalation state, budget forecast totals, and a forecast-vs-actual accuracy ratio when both forecast and actual token data are available
- added `octopus stats` command for token-overhead and runtime analytics per task (`--task-id T-XXX`) or across all tasks; displays event counts, wall-clock duration, gate pass/fail tallies, path mode, required reviews, changed files summary, and token-economy savings with per-source breakdown; supports `--json` for machine-readable output
- added portable JSON Schema (draft-07) for `init-answers.json` via `initAnswersSchema` in `config-schemas.ts`; the schema covers all serialized fields (`AssistantLanguage`, `AssistantBrevity`, `SourceOfTruth`, `EnforceNoAutoCommit`, `ClaudeOrchestratorFullAccess`, `TokenEconomyEnabled`, `CollectedVia`, optional `ActiveAgentFiles`) with enum constraints for provider names, brevity values, collection methods, and boolean-like string literals; external tooling can consume the schema via the `$id` URI `octopus-agent-orchestrator/init-answers.schema.json`
- added `octopus.config.json` root config manifest and portable JSON Schema definitions (draft-07) for all managed config files (`review-capabilities`, `token-economy`, `paths`, `output-filters`, `skill-packs`, `isolation-mode`); added `validate-config` gate for schema + runtime validation with `--compact` CI mode; added `scripts/validate-config.cjs` CI script; `octopus.config.json` is now materialized to `live/config/` on init/reinit/update and checked in workspace layout validation
- added `--json` flag to `status`, `doctor`, `update`, `update git`, `check-update`, `rollback`, and `uninstall` commands for machine-readable JSON output; when `--json` is passed, the full result object is emitted as pretty-printed JSON to stdout instead of human-readable text, enabling CI pipelines and local automation to parse command results programmatically
- added `octopus debug env` subcommand for fast operator triage: collects Node version, platform, architecture, OS release, hostname (redacted), CPU/memory info, shell, bundle presence, live version, and triage-relevant environment variables; supports `--json` for machine-readable output and `--target-root` for non-cwd workspaces
- replaced regex-based `[\s\S]*?` span matching in `upsertManagedBlock()` and `removeManagedBlock()` with `indexOf`/`slice` marker search via `findManagedSpan()`, eliminating per-call regex compilation and backtracking cost on large files; removed the local `escapeRegex()` helper that was only needed for the regex approach; added edge-case tests for empty/whitespace input, CRLF handling, block-at-boundary positions, and markers containing regex-special characters
- replaced recursive `readdirRecursiveFiles()`, `readdirRecursiveDirs()`, `copyPathRecursive()` in lifecycle helpers and `collectFilesRecursive()` in project-discovery with iterative stack-based traversals, eliminating `push(...recursiveCall)` spread allocations and call-stack depth risk on deep directory trees
- reworked `spawnStreamed()` and `spawnShellCommand()` buffering from string concatenation to chunk-array accumulation, reducing string churn on high-volume output; added `stdoutTruncated` and `stderrTruncated` boolean fields to `SpawnStreamedResult` so callers can detect when output exceeded `maxBuffer` instead of silently losing data; callbacks (`onStdout`/`onStderr`) continue to fire for all chunks regardless of buffer state
- tightened `doc-impact-gate` semanticsto fail closed: only `DOCS_UPDATED` and `NO_DOC_UPDATES` are accepted, and `NO_DOC_UPDATES` now rejects contradictory `docs_updated`, `behavior_changed=true`, and `changelog_updated=true` combinations
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
