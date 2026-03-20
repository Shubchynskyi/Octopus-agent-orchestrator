const { ensureTrailingLineEnding, normalizeLineEndings } = require('./line-endings.ts');

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildManagedBlock(startMarker, endMarker, blockLines, newline = '\n') {
    const lines = Array.isArray(blockLines) ? blockLines.map((line) => String(line)) : [String(blockLines)];
    return [startMarker, ...lines, endMarker].join(newline);
}

function upsertManagedBlock(content, options) {
    const newline = options.newline || '\n';
    const normalized = normalizeLineEndings(content || '', '\n');
    const block = buildManagedBlock(options.startMarker, options.endMarker, options.blockLines || [], '\n');
    const pattern = new RegExp(`${escapeRegex(options.startMarker)}\\n?[\\s\\S]*?${escapeRegex(options.endMarker)}`, 'm');
    let result;

    if (pattern.test(normalized)) {
        result = normalized.replace(pattern, block);
    } else if (normalized.trim().length === 0) {
        result = block;
    } else {
        result = ensureTrailingLineEnding(normalized, '\n') + block;
    }

    return ensureTrailingLineEnding(normalizeLineEndings(result, newline), newline);
}

function removeManagedBlock(content, options) {
    const newline = options.newline || '\n';
    const normalized = normalizeLineEndings(content || '', '\n');
    const pattern = new RegExp(`\\n?${escapeRegex(options.startMarker)}\\n?[\\s\\S]*?${escapeRegex(options.endMarker)}\\n?`, 'm');
    const result = normalized
        .replace(pattern, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n/, '');

    return normalizeLineEndings(result, newline);
}

module.exports = {
    buildManagedBlock,
    removeManagedBlock,
    upsertManagedBlock
};
