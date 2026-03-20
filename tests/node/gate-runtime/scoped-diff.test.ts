const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildScopedDiffMetadata,
    convertToGitPathspecs
} = require('../../../src/gate-runtime/scoped-diff.ts');

// --- buildScopedDiffMetadata ---

test('buildScopedDiffMetadata returns scoped diff when matches exist', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'security',
        changedFiles: ['src/auth.py', 'README.md', 'src/db.py'],
        triggerRegexes: ['src/.*\\.py$'],
        scopedDiffText: 'diff --git a/src/auth.py\n+line\n',
        fullDiffText: 'full diff text\n'
    });

    assert.equal(result.review_type, 'security');
    assert.equal(result.matched_files_count, 2);
    assert.deepEqual(result.matched_files, ['src/auth.py', 'src/db.py']);
    assert.equal(result.fallback_to_full_diff, false);
    assert.ok(result.output_diff_text.includes('src/auth.py'));
});

test('buildScopedDiffMetadata falls back to full diff when no matches', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'db',
        changedFiles: ['README.md'],
        triggerRegexes: ['src/.*\\.py$'],
        scopedDiffText: '',
        fullDiffText: 'full diff\n'
    });

    assert.equal(result.matched_files_count, 0);
    assert.equal(result.fallback_to_full_diff, true);
    assert.equal(result.output_diff_text, 'full diff\n');
});

test('buildScopedDiffMetadata falls back when scoped diff empty', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'security',
        changedFiles: ['src/auth.py'],
        triggerRegexes: ['src/.*\\.py$'],
        scopedDiffText: '',
        fullDiffText: 'full diff\n'
    });

    assert.equal(result.matched_files_count, 1);
    assert.equal(result.fallback_to_full_diff, true);
});

test('buildScopedDiffMetadata throws for missing reviewType', () => {
    assert.throws(
        () => buildScopedDiffMetadata({ triggerRegexes: ['test'] }),
        /reviewType is required/
    );
});

test('buildScopedDiffMetadata throws for empty triggerRegexes', () => {
    assert.throws(
        () => buildScopedDiffMetadata({ reviewType: 'db', triggerRegexes: [] }),
        /No trigger regexes/
    );
});

test('buildScopedDiffMetadata deduplicates and sorts changed files', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'security',
        changedFiles: ['src/b.py', 'src/a.py', 'src/b.py'],
        triggerRegexes: ['src/.*\\.py$'],
        scopedDiffText: 'diff text\n',
        fullDiffText: 'full diff\n'
    });

    assert.deepEqual(result.matched_files, ['src/a.py', 'src/b.py']);
});

test('buildScopedDiffMetadata normalizes backslashes in paths', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'db',
        changedFiles: ['src\\db\\models.py'],
        triggerRegexes: ['src/db/'],
        scopedDiffText: 'diff\n',
        fullDiffText: 'full\n'
    });

    assert.deepEqual(result.matched_files, ['src/db/models.py']);
});

test('buildScopedDiffMetadata counts lines correctly', () => {
    const result = buildScopedDiffMetadata({
        reviewType: 'security',
        changedFiles: ['src/auth.py'],
        triggerRegexes: ['src/'],
        scopedDiffText: 'line1\nline2\nline3\n',
        fullDiffText: 'full\n'
    });

    assert.equal(result.scoped_diff_line_count, 4);
    assert.equal(result.output_diff_line_count, 4);
});

// --- convertToGitPathspecs ---

test('convertToGitPathspecs returns empty for empty input', () => {
    assert.deepEqual(convertToGitPathspecs([], '/repo', '/repo'), []);
    assert.deepEqual(convertToGitPathspecs(null, '/repo', '/repo'), []);
});

test('convertToGitPathspecs passes through when roots match', () => {
    assert.deepEqual(
        convertToGitPathspecs(['src/a.ts', 'lib/b.ts'], '/repo', '/repo'),
        ['src/a.ts', 'lib/b.ts']
    );
});

test('convertToGitPathspecs strips git root prefix', () => {
    const result = convertToGitPathspecs(
        ['Octopus-agent-orchestrator/src/a.ts', 'src/b.ts'],
        '/workspace',
        '/workspace/Octopus-agent-orchestrator'
    );
    assert.deepEqual(result, ['src/a.ts', 'src/b.ts']);
});

test('convertToGitPathspecs normalizes backslashes', () => {
    const result = convertToGitPathspecs(
        ['Octopus-agent-orchestrator\\src\\a.ts'],
        '/workspace',
        '/workspace/Octopus-agent-orchestrator'
    );
    assert.deepEqual(result, ['src/a.ts']);
});
