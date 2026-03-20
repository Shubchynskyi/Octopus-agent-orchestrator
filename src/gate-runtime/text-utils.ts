/**
 * Convert any value to a string array, matching Python/PS gate_utils.to_string_array.
 */
function toStringArray(value, options = {}) {
    const trimValues = options.trimValues || false;

    if (value == null) {
        return [];
    }

    if (typeof value === 'string') {
        const text = trimValues ? value.trim() : value;
        return (text && text.trim()) ? [text] : [];
    }

    if (Array.isArray(value)) {
        const result = [];
        for (const item of value) {
            if (item == null) {
                continue;
            }
            let text = String(item);
            if (trimValues) {
                text = text.trim();
            }
            if (!text || !text.trim()) {
                continue;
            }
            result.push(text);
        }
        return result;
    }

    const text = trimValues ? String(value).trim() : String(value);
    return (text && text.trim()) ? [text] : [];
}

/**
 * Count total characters of lines joined by newlines, matching Python count_text_chars.
 */
function countTextChars(lines) {
    const normalized = toStringArray(lines);
    if (normalized.length === 0) {
        return 0;
    }
    let total = 0;
    for (const line of normalized) {
        total += line.length;
    }
    total += Math.max(normalized.length - 1, 0);
    return total;
}

/**
 * Test if a path matches any of the provided regex patterns.
 */
function matchAnyRegex(pathValue, regexes, options = {}) {
    const skipInvalid = options.skipInvalidRegex || false;
    const context = options.invalidRegexContext || '';

    for (const pattern of regexes) {
        if (!pattern) {
            continue;
        }
        try {
            if (new RegExp(pattern).test(pathValue)) {
                return true;
            }
        } catch (err) {
            if (!skipInvalid) {
                throw err;
            }
            const ctxStr = context ? ` for ${context}` : '';
            process.stderr.write(`WARNING: invalid regex '${pattern}'${ctxStr}: ${err.message}\n`);
        }
    }
    return false;
}

module.exports = { toStringArray, countTextChars, matchAnyRegex };
