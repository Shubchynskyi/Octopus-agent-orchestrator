const path = require('node:path');

const { ensureDirectory } = require('./fs.ts');
const { ensureTrailingLineEnding } = require('./line-endings.ts');

function parseJsonText(text, sourceLabel = 'JSON input') {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in ${sourceLabel}: ${error.message}`);
    }
}

function readJsonFile(filePath) {
    const fs = require('node:fs');
    return parseJsonText(fs.readFileSync(filePath, 'utf8'), filePath);
}

function formatJson(value, options = {}) {
    const indent = options.indent ?? 2;
    const newline = options.newline || '\n';
    return ensureTrailingLineEnding(JSON.stringify(value, null, indent), newline);
}

function writeJsonFile(filePath, value, options = {}) {
    const fs = require('node:fs');
    ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, formatJson(value, options), 'utf8');
    return filePath;
}

module.exports = {
    formatJson,
    parseJsonText,
    readJsonFile,
    writeJsonFile
};
