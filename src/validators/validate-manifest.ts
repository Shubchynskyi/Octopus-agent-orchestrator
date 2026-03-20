const path = require('node:path');

const { pathExists, readTextFile } = require('../core/fs.ts');

/**
 * Parse list items from MANIFEST.md content.
 * Matches lines like "- path/to/file".
 */
function parseManifestItems(content) {
    const items = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const match = line.match(/^\s*-\s+(.+?)\s*$/);
        if (match) {
            const value = match[1].trim();
            if (value) {
                items.push(value);
            }
        }
    }

    return items;
}

/**
 * Validate a MANIFEST.md file for duplicate entries.
 * Preserves exact parity with live/scripts/agent-gates/validate-manifest.ps1.
 *
 * Returns { passed, manifestPath, entriesChecked, duplicates }.
 */
function validateManifest(manifestPath) {
    const resolvedPath = path.resolve(manifestPath);

    if (!pathExists(resolvedPath)) {
        throw new Error(`Manifest not found: ${resolvedPath}`);
    }

    const content = readTextFile(resolvedPath);
    const items = parseManifestItems(content);

    if (items.length === 0) {
        throw new Error(`No manifest list items found in: ${resolvedPath}`);
    }

    const seen = {};
    const duplicates = [];

    for (const item of items) {
        const key = item.toLowerCase().replace(/\\/g, '/');
        if (key in seen) {
            duplicates.push(item);
            continue;
        }
        seen[key] = item;
    }

    return {
        passed: duplicates.length === 0,
        manifestPath: resolvedPath,
        entriesChecked: items.length,
        duplicates
    };
}

/**
 * Format manifest validation result as diagnostic output lines.
 * Matches the output format of validate-manifest.ps1.
 */
function formatManifestResult(result) {
    const lines = [];

    if (!result.passed) {
        lines.push('MANIFEST_VALIDATION_FAILED');
        lines.push(`ManifestPath: ${result.manifestPath}`);
        lines.push('Duplicate entries:');
        for (const dup of result.duplicates) {
            lines.push(`- ${dup}`);
        }
    } else {
        lines.push('MANIFEST_VALIDATION_PASSED');
        lines.push(`ManifestPath: ${result.manifestPath}`);
        lines.push(`EntriesChecked: ${result.entriesChecked}`);
    }

    return lines.join('\n');
}

module.exports = {
    formatManifestResult,
    parseManifestItems,
    validateManifest
};
