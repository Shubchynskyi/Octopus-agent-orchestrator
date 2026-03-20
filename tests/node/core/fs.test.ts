const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pathExists, readTextFile, writeTextFile } = require('../../../src/core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../../../src/core/json.ts');

test('writeTextFile creates parent directories and normalizes line endings', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-node-foundation-'));

    try {
        const targetPath = path.join(tempRoot, 'nested', 'file.txt');
        writeTextFile(targetPath, 'alpha\r\nbeta\r\n', { newline: '\n', trailingNewline: true });

        assert.equal(pathExists(targetPath), true);
        assert.equal(readTextFile(targetPath), 'alpha\nbeta\n');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('writeJsonFile persists deterministic JSON with a trailing newline', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-node-foundation-'));

    try {
        const targetPath = path.join(tempRoot, 'config.json');
        writeJsonFile(targetPath, { enabled: true, depths: [1, 2] });

        assert.deepEqual(readJsonFile(targetPath), { enabled: true, depths: [1, 2] });
        assert.match(fs.readFileSync(targetPath, 'utf8'), /\n$/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
