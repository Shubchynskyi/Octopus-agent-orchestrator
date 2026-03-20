function detectLineEnding(text) {
    return String(text).includes('\r\n') ? '\r\n' : '\n';
}

function normalizeLineEndings(text, newline = '\n') {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, newline);
}

function ensureTrailingLineEnding(text, newline = '\n') {
    const normalized = normalizeLineEndings(text, newline);
    return normalized.endsWith(newline) ? normalized : `${normalized}${newline}`;
}

module.exports = {
    detectLineEnding,
    ensureTrailingLineEnding,
    normalizeLineEndings
};
