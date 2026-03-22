/**
 * Registry of public Node gate commands used by the CLI surface.
 */

const GATE_COMMANDS = Object.freeze([
    'validate-manifest',
    'compile-gate',
    'completion-gate',
    'classify-change',
    'build-scoped-diff',
    'build-review-context',
    'doc-impact-gate',
    'required-reviews-check',
    'log-task-event',
    'task-events-summary',
    'human-commit'
]);

function getAllShimmedGateNames() {
    return GATE_COMMANDS.slice();
}

module.exports = {
    GATE_COMMANDS,
    getAllShimmedGateNames
};
