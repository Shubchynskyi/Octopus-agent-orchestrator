const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isPathInsideRoot,
    normalizeRelativePath,
    resolvePathInsideRoot
} = require('../../../src/core/paths.ts');

test('normalizeRelativePath canonicalizes separators for repo-relative paths', () => {
    assert.equal(normalizeRelativePath('.\\src\\core\\paths.ts'), 'src/core/paths.ts');
});

test('isPathInsideRoot respects platform-specific case sensitivity', () => {
    assert.equal(isPathInsideRoot('C:\\Repo', 'c:\\repo\\src\\index.ts', 'win32'), true);
    assert.equal(isPathInsideRoot('/repo', '/Repo/src/index.ts', 'linux'), false);
});

test('resolvePathInsideRoot rejects path traversal outside the root', () => {
    assert.throws(
        () => resolvePathInsideRoot('/repo', '../outside.txt', 'linux'),
        /escapes root/
    );
});
