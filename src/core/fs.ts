const fs = require('node:fs');
const path = require('node:path');

const { ensureTrailingLineEnding, normalizeLineEndings } = require('./line-endings.ts');

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

function pathExists(targetPath) {
    return fs.existsSync(targetPath);
}

function readTextFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeTextFile(filePath, content, options = {}) {
    const newline = options.newline || '\n';
    const trailingNewline = options.trailingNewline === true;
    const directoryPath = path.dirname(filePath);
    ensureDirectory(directoryPath);

    let text = normalizeLineEndings(content, newline);
    if (trailingNewline) {
        text = ensureTrailingLineEnding(text, newline);
    }

    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
}

module.exports = {
    ensureDirectory,
    pathExists,
    readTextFile,
    writeTextFile
};
