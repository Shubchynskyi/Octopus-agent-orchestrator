function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listTemplateTokens(text) {
    const tokens = new Set();
    const pattern = /\{\{([A-Z0-9_]+)\}\}/g;
    const source = String(text);
    let match = pattern.exec(source);

    while (match) {
        tokens.add(match[1]);
        match = pattern.exec(source);
    }

    return [...tokens];
}

function replaceTemplateTokens(text, replacements) {
    let result = String(text);

    for (const [key, value] of Object.entries(replacements)) {
        const pattern = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
        result = result.replace(pattern, String(value));
    }

    return result;
}

module.exports = {
    listTemplateTokens,
    replaceTemplateTokens
};
