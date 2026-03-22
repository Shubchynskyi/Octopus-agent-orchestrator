const {
    getStatusSnapshot,
    formatStatusSnapshot
} = require('../../validators/status.ts');

const {
    buildBannerText,
    COMMAND_SUMMARY,
    normalizePathValue,
    padRight,
    printBanner,
    printStatus
} = require('./cli-helpers.ts');

// ---------------------------------------------------------------------------
// Pure-function output builder (testable without stdout capture)
// ---------------------------------------------------------------------------

/**
 * Build the full overview text as a string.
 * Mirrors printOverview() but returns a string instead of writing to stdout.
 */
function buildOverviewOutput(packageJson, targetRoot) {
    if (targetRoot === undefined) targetRoot = normalizePathValue('.');
    const snapshot = getStatusSnapshot(targetRoot);
    const lines = [];
    lines.push('OCTOPUS_OVERVIEW');
    lines.push(buildBannerText(packageJson, 'Workspace overview', targetRoot));
    lines.push(formatStatusSnapshot(snapshot, { heading: 'OCTOPUS_STATUS' }));
    lines.push('');
    lines.push('Available Commands');
    for (const [name, description] of COMMAND_SUMMARY) {
        lines.push(`  ${padRight(name, 10)} ${description}`);
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Side-effecting handler (writes to stdout)
// ---------------------------------------------------------------------------

/**
 * Print the workspace overview to stdout.
 * Matches bin/octopus.js printOverview() output contract:
 *   - OCTOPUS_OVERVIEW marker
 *   - Banner
 *   - OCTOPUS_STATUS block
 *   - Available Commands
 */
function printOverview(packageJson, targetRoot) {
    if (targetRoot === undefined) targetRoot = normalizePathValue('.');
    const snapshot = getStatusSnapshot(targetRoot);
    console.log('OCTOPUS_OVERVIEW');
    printBanner(packageJson, 'Workspace overview', targetRoot);
    printStatus(snapshot, { heading: 'OCTOPUS_STATUS' });
}

/**
 * CLI handler: called when octopus is invoked with no arguments.
 */
function handleOverview(packageJson, targetRoot) {
    printOverview(packageJson, targetRoot);
}

module.exports = {
    buildOverviewOutput,
    handleOverview,
    printOverview
};
