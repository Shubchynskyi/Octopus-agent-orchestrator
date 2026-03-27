import { ensureTrailingLineEnding, normalizeLineEndings } from './line-endings';

export interface ManagedBlockOptions {
    startMarker: string;
    endMarker: string;
    blockLines?: string[];
    newline?: string;
}

function escapeRegex(text: string): string {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildManagedBlock(startMarker: string, endMarker: string, blockLines: string | string[], newline: string = '\n'): string {
    const lines = Array.isArray(blockLines) ? blockLines.map((line) => String(line)) : [String(blockLines)];
    return [startMarker, ...lines, endMarker].join(newline);
}

export function upsertManagedBlock(content: string, options: ManagedBlockOptions): string {
    const newline = options.newline || '\n';
    const normalized = normalizeLineEndings(content || '', '\n');
    const block = buildManagedBlock(options.startMarker, options.endMarker, options.blockLines || [], '\n');
    const pattern = new RegExp(`${escapeRegex(options.startMarker)}\\n?[\\s\\S]*?${escapeRegex(options.endMarker)}`, 'm');
    let result: string;

    if (pattern.test(normalized)) {
        result = normalized.replace(pattern, block);
    } else if (normalized.trim().length === 0) {
        result = block;
    } else {
        result = ensureTrailingLineEnding(normalized, '\n') + block;
    }

    return ensureTrailingLineEnding(normalizeLineEndings(result, newline), newline);
}

export function removeManagedBlock(content: string, options: ManagedBlockOptions): string {
    const newline = options.newline || '\n';
    const normalized = normalizeLineEndings(content || '', '\n');
    const pattern = new RegExp(`\\n?${escapeRegex(options.startMarker)}\\n?[\\s\\S]*?${escapeRegex(options.endMarker)}\\n?`, 'm');
    const result = normalized
        .replace(pattern, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n/, '');

    return normalizeLineEndings(result, newline);
}

