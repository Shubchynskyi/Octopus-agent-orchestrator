import { getStatusSnapshot, formatStatusSnapshot } from '../../validators/status';
import {
    buildBannerText,
    COMMAND_SUMMARY,
    normalizePathValue,
    padRight,
    PackageJsonLike,
    printBanner,
    printCommandSummary,
    printStatus,
    resolveWorkspaceDisplayVersion
} from './cli-helpers';

// ---------------------------------------------------------------------------
// Pure-function output builder (testable without stdout capture)
// ---------------------------------------------------------------------------

/**
 * Build the full overview text as a string.
 * Mirrors printOverview() but returns a string instead of writing to stdout.
 */
export function buildOverviewOutput(packageJson: PackageJsonLike, targetRoot?: string): string {
    if (targetRoot === undefined) targetRoot = normalizePathValue('.');
    const snapshot = getStatusSnapshot(targetRoot);
    const lines = [];
    lines.push('OCTOPUS_OVERVIEW');
    lines.push(buildBannerText(packageJson, 'Workspace overview', targetRoot, {
        versionOverride: resolveWorkspaceDisplayVersion(targetRoot, packageJson.version)
    }));
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
export function printOverview(packageJson: PackageJsonLike, targetRoot?: string): void {
    if (targetRoot === undefined) targetRoot = normalizePathValue('.');
    const snapshot = getStatusSnapshot(targetRoot);
    console.log('OCTOPUS_OVERVIEW');
    printBanner(packageJson, 'Workspace overview', targetRoot, {
        versionOverride: resolveWorkspaceDisplayVersion(targetRoot, packageJson.version)
    });
    printStatus(snapshot, { heading: 'OCTOPUS_STATUS' });
    printCommandSummary();
}

/**
 * CLI handler: called when octopus is invoked with no arguments.
 */
export function handleOverview(packageJson: PackageJsonLike, targetRoot?: string): void {
    printOverview(packageJson, targetRoot);
}
