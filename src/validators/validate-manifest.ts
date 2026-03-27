import * as path from 'node:path';
import { pathExists, readTextFile } from '../core/fs';
import { isPathInsideRoot } from '../core/paths';

export interface ManifestValidationResult {
    passed: boolean;
    manifestPath: string;
    entriesChecked: number;
    duplicates: string[];
}

/**
 * Parse list items from MANIFEST.md content.
 * Matches lines like "- path/to/file".
 */
export function parseManifestItems(content: string): string[] {
    const items: string[] = [];
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
 * Canonical Node-only manifest validation implementation.
 *
 * When targetRoot is provided, rejects manifest paths that resolve
 * outside the repository root before any file read.
 *
 * Returns { passed, manifestPath, entriesChecked, duplicates }.
 */
export function validateManifest(manifestPath: string, targetRoot?: string): ManifestValidationResult {
    const resolvedPath = path.resolve(manifestPath);

    if (targetRoot) {
        const resolvedRoot = path.resolve(String(targetRoot));
        if (!isPathInsideRoot(resolvedRoot, resolvedPath)) {
            throw new Error("ManifestPath must resolve inside TargetRoot '" + resolvedRoot + "'. Resolved path: " + resolvedPath);
        }
    }

    if (!pathExists(resolvedPath)) {
        throw new Error(`Manifest not found: ${resolvedPath}`);
    }

    const content = readTextFile(resolvedPath);
    const items = parseManifestItems(content);

    if (items.length === 0) {
        throw new Error(`No manifest list items found in: ${resolvedPath}`);
    }

    const seen: Record<string, string> = {};
    const duplicates: string[] = [];

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
 * Stable machine-readable diagnostic format for the Node CLI.
 */
export function formatManifestResult(result: ManifestValidationResult): string {
    const lines: string[] = [];

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
