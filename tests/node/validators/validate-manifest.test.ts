const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    parseManifestItems,
    validateManifest,
    formatManifestResult
} = require('../../../src/validators/validate-manifest.ts');

test('parseManifestItems extracts list items from markdown', () => {
    const content = [
        '# MANIFEST',
        '',
        '- bin/octopus.js',
        '- src/index.ts',
        '  - src/validators/verify.ts',
        'Not a list item',
        '- package.json',
        ''
    ].join('\n');

    const items = parseManifestItems(content);
    assert.deepEqual(items, [
        'bin/octopus.js',
        'src/index.ts',
        'src/validators/verify.ts',
        'package.json'
    ]);
});

test('parseManifestItems returns empty array for no list items', () => {
    const items = parseManifestItems('# MANIFEST\n\nNo items here.\n');
    assert.deepEqual(items, []);
});

test('validateManifest passes for unique entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '- file-a.txt\n- file-b.txt\n- file-c.txt\n', 'utf8');

    try {
        const result = validateManifest(manifestPath);
        assert.equal(result.passed, true);
        assert.equal(result.entriesChecked, 3);
        assert.deepEqual(result.duplicates, []);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateManifest detects duplicate entries (case-insensitive, slash-normalized)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(
        manifestPath,
        '- src/index.ts\n- src\\index.ts\n- src/validators/verify.ts\n',
        'utf8'
    );

    try {
        const result = validateManifest(manifestPath);
        assert.equal(result.passed, false);
        assert.equal(result.entriesChecked, 3);
        assert.equal(result.duplicates.length, 1);
        assert.equal(result.duplicates[0], 'src\\index.ts');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateManifest throws for missing file', () => {
    assert.throws(
        () => validateManifest('/nonexistent/MANIFEST.md'),
        /Manifest not found/
    );
});

test('validateManifest throws for empty manifest', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '# Empty manifest\n\n', 'utf8');

    try {
        assert.throws(
            () => validateManifest(manifestPath),
            /No manifest list items found/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatManifestResult for passing result', () => {
    const result = {
        passed: true,
        manifestPath: '/tmp/MANIFEST.md',
        entriesChecked: 5,
        duplicates: []
    };

    const output = formatManifestResult(result);
    assert.ok(output.includes('MANIFEST_VALIDATION_PASSED'));
    assert.ok(output.includes('EntriesChecked: 5'));
});

test('formatManifestResult for failing result', () => {
    const result = {
        passed: false,
        manifestPath: '/tmp/MANIFEST.md',
        entriesChecked: 3,
        duplicates: ['file-dup.txt']
    };

    const output = formatManifestResult(result);
    assert.ok(output.includes('MANIFEST_VALIDATION_FAILED'));
    assert.ok(output.includes('Duplicate entries:'));
    assert.ok(output.includes('- file-dup.txt'));
});

test('validateManifest produces stable Node CLI markers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-parity-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '- alpha\n- beta\n- gamma\n', 'utf8');

    try {
        const result = validateManifest(manifestPath);
        const output = formatManifestResult(result);
        assert.ok(output.includes('MANIFEST_VALIDATION_PASSED'));
        assert.ok(output.includes('EntriesChecked: 3'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateManifest works against the real repo MANIFEST.md', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const manifestPath = path.join(repoRoot, 'MANIFEST.md');

    if (!fs.existsSync(manifestPath)) {
        return;
    }

    const result = validateManifest(manifestPath, repoRoot);
    assert.equal(result.passed, true, `Real MANIFEST.md has duplicates: ${result.duplicates.join(', ')}`);
    assert.ok(result.entriesChecked > 0, 'Real MANIFEST.md should have entries');
});

test('validateManifest rejects manifest path outside targetRoot', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-boundary-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '- file-a.txt\n', 'utf8');
    const fakeRoot = path.join(tmpDir, 'nested');
    fs.mkdirSync(fakeRoot, { recursive: true });

    try {
        assert.throws(
            () => validateManifest(manifestPath, fakeRoot),
            /ManifestPath must resolve inside TargetRoot/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateManifest accepts manifest path inside targetRoot', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-boundary-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '- file-a.txt\n- file-b.txt\n', 'utf8');

    try {
        const result = validateManifest(manifestPath, tmpDir);
        assert.equal(result.passed, true);
        assert.equal(result.entriesChecked, 2);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateManifest skips boundary check when targetRoot is not provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-boundary-'));
    const manifestPath = path.join(tmpDir, 'MANIFEST.md');
    fs.writeFileSync(manifestPath, '- item-a\n', 'utf8');

    try {
        const result = validateManifest(manifestPath);
        assert.equal(result.passed, true);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
