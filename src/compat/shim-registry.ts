/**
 * Registry of legacy entrypoints that are shimmed to Node implementations.
 *
 * Each entry maps a legacy script to its Node CLI command and backing
 * TypeScript module.  The registry is consumed by:
 *   - compatibility tests (to verify coverage)
 *   - documentation generators
 *   - the shim preamble snippets embedded in .ps1 / .sh files
 */

const LIFECYCLE_SHIMS = Object.freeze([
    { script: 'scripts/setup.ps1', command: 'setup', tsModule: 'src/cli/commands/setup.ts' },
    { script: 'scripts/install.ps1', command: 'install', tsModule: 'src/materialization/install.ts' },
    { script: 'scripts/init.ps1', command: 'init', tsModule: 'src/materialization/init.ts' },
    { script: 'scripts/reinit.ps1', command: 'reinit', tsModule: 'src/materialization/reinit.ts' },
    { script: 'scripts/verify.ps1', command: 'verify', tsModule: 'src/validators/verify.ts' },
    { script: 'scripts/check-update.ps1', command: 'check-update', tsModule: 'src/lifecycle/check-update.ts' },
    { script: 'scripts/update.ps1', command: 'update', tsModule: 'src/lifecycle/update.ts' },
    { script: 'scripts/uninstall.ps1', command: 'uninstall', tsModule: 'src/lifecycle/uninstall.ts' }
]);

const GATE_SHIMS = Object.freeze([
    { script: 'template/scripts/agent-gates/validate-manifest.ps1', gate: 'validate-manifest', tsModule: 'src/validators/validate-manifest.ts' },
    { script: 'template/scripts/agent-gates/compile-gate.ps1', gate: 'compile-gate', tsModule: 'src/gates/compile-gate.ts' },
    { script: 'template/scripts/agent-gates/completion-gate.ps1', gate: 'completion-gate', tsModule: 'src/gates/completion.ts' },
    { script: 'template/scripts/agent-gates/classify-change.ps1', gate: 'classify-change', tsModule: 'src/gates/classify-change.ts' },
    { script: 'template/scripts/agent-gates/build-scoped-diff.ps1', gate: 'build-scoped-diff', tsModule: 'src/gates/build-scoped-diff.ts' },
    { script: 'template/scripts/agent-gates/build-review-context.ps1', gate: 'build-review-context', tsModule: 'src/gates/build-review-context.ts' },
    { script: 'template/scripts/agent-gates/doc-impact-gate.ps1', gate: 'doc-impact-gate', tsModule: 'src/gates/doc-impact.ts' },
    { script: 'template/scripts/agent-gates/required-reviews-check.ps1', gate: 'required-reviews-check', tsModule: 'src/gates/required-reviews-check.ts' },
    { script: 'template/scripts/agent-gates/task-events-summary.ps1', gate: 'task-events-summary', tsModule: 'src/gates/task-events-summary.ts' }
]);

/**
 * Look up a lifecycle shim entry by script basename.
 */
function getLifecycleShim(scriptBasename) {
    return LIFECYCLE_SHIMS.find(function (s) {
        return s.script === scriptBasename || s.script.endsWith('/' + scriptBasename);
    }) || null;
}

/**
 * Look up a gate shim entry by script basename.
 */
function getGateShim(scriptBasename) {
    return GATE_SHIMS.find(function (s) {
        return s.script === scriptBasename || s.script.endsWith('/' + scriptBasename);
    }) || null;
}

/**
 * Return all script paths that have a Node shim.
 */
function getAllShimmedScripts() {
    return LIFECYCLE_SHIMS.map(function (s) { return s.script; })
        .concat(GATE_SHIMS.map(function (s) { return s.script; }));
}

/**
 * Return all gate names that have a Node shim.
 */
function getAllShimmedGateNames() {
    return GATE_SHIMS.map(function (s) { return s.gate; });
}

module.exports = {
    LIFECYCLE_SHIMS,
    GATE_SHIMS,
    getLifecycleShim,
    getGateShim,
    getAllShimmedScripts,
    getAllShimmedGateNames
};
