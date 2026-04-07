import { ensureTrailingLineEnding, normalizeLineEndings } from './line-endings';

export interface ManagedBlockOptions {
    startMarker: string;
    endMarker: string;
    blockLines?: string[];
    newline?: string;
}

export function buildManagedBlock(startMarker: string, endMarker: string, blockLines: string | string[], newline: string = '\n'): string {
    const lines = Array.isArray(blockLines) ? blockLines.map((line) => String(line)) : [String(blockLines)];
    return [startMarker, ...lines, endMarker].join(newline);
}

/**
 * Find the span covering `startMarker...endMarker` inside `text`.
 * Returns `{ start, end }` indices or `undefined` when the markers are absent.
 * The span includes an optional leading `\n` before the start marker and an
 * optional trailing `\n` after the end marker so callers can slice cleanly.
 */
function findManagedSpan(text: string, startMarker: string, endMarker: string, includePeripheralNewlines: boolean): { start: number; end: number } | undefined {
    const startIdx = text.indexOf(startMarker);
    if (startIdx === -1) return undefined;

    const endIdx = text.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) return undefined;

    let spanStart = startIdx;
    let spanEnd = endIdx + endMarker.length;

    if (includePeripheralNewlines) {
        if (spanStart > 0 && text[spanStart - 1] === '\n') spanStart--;
        if (spanEnd < text.length && text[spanEnd] === '\n') spanEnd++;
    }

    return { start: spanStart, end: spanEnd };
}

export function upsertManagedBlock(content: string, options: ManagedBlockOptions): string {
    const newline = options.newline || '\n';
    const normalized = normalizeLineEndings(content || '', '\n');
    const block = buildManagedBlock(options.startMarker, options.endMarker, options.blockLines || [], '\n');
    let result: string;

    const span = findManagedSpan(normalized, options.startMarker, options.endMarker, false);
    if (span) {
        result = normalized.slice(0, span.start) + block + normalized.slice(span.end);
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

    const span = findManagedSpan(normalized, options.startMarker, options.endMarker, true);
    if (!span) return normalizeLineEndings(normalized, newline);

    const result = (normalized.slice(0, span.start) + '\n' + normalized.slice(span.end))
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n/, '');

    return normalizeLineEndings(result, newline);
}

