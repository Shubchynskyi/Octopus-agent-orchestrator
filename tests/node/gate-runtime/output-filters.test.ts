const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    applyOutputFilterOperation,
    applyOutputFilterProfile,
    applyPassthroughCeiling,
    resolveFilterInt,
    resolveFilterStr,
    selectHeadLines,
    selectTailLines,
    selectMatchingLines,
    getCompileFailureStrategyConfig
} = require('../../../src/gate-runtime/output-filters.ts');

// --- resolveFilterInt ---

test('resolveFilterInt resolves plain integer', () => {
    assert.equal(resolveFilterInt(42, null, 'test'), 42);
});

test('resolveFilterInt resolves integer string', () => {
    assert.equal(resolveFilterInt('42', null, 'test'), 42);
});

test('resolveFilterInt resolves context_key', () => {
    assert.equal(resolveFilterInt({ context_key: 'my_val' }, { my_val: 100 }, 'test'), 100);
});

test('resolveFilterInt throws for missing context key', () => {
    assert.throws(
        () => resolveFilterInt({ context_key: 'missing' }, {}, 'test'),
        /references missing context key/
    );
});

test('resolveFilterInt throws for boolean', () => {
    assert.throws(() => resolveFilterInt(true, null, 'test'), /must resolve to integer/);
});

test('resolveFilterInt enforces minimum', () => {
    assert.throws(() => resolveFilterInt(-1, null, 'test', 0), /must resolve to integer >= 0/);
});

// --- resolveFilterStr ---

test('resolveFilterStr resolves plain string', () => {
    assert.equal(resolveFilterStr('hello', null, 'test'), 'hello');
});

test('resolveFilterStr resolves context_key', () => {
    assert.equal(resolveFilterStr({ context_key: 'name' }, { name: 'world' }, 'test'), 'world');
});

test('resolveFilterStr throws for null value', () => {
    assert.throws(() => resolveFilterStr(null, null, 'test'), /non-empty string/);
});

test('resolveFilterStr allows empty when option set', () => {
    assert.equal(resolveFilterStr(null, null, 'test', { allowEmpty: true }), '');
});

// --- selectHeadLines / selectTailLines ---

test('selectHeadLines returns first N lines', () => {
    assert.deepEqual(selectHeadLines(['a', 'b', 'c', 'd'], 2), ['a', 'b']);
});

test('selectTailLines returns last N lines', () => {
    assert.deepEqual(selectTailLines(['a', 'b', 'c', 'd'], 2), ['c', 'd']);
});

test('selectHeadLines returns empty for count 0', () => {
    assert.deepEqual(selectHeadLines(['a', 'b'], 0), []);
});

test('selectTailLines returns empty for count 0', () => {
    assert.deepEqual(selectTailLines(['a', 'b'], 0), []);
});

// --- selectMatchingLines ---

test('selectMatchingLines filters by regex', () => {
    const lines = ['error: foo', 'info: bar', 'error: baz'];
    assert.deepEqual(selectMatchingLines(lines, ['^error']), ['error: foo', 'error: baz']);
});

test('selectMatchingLines respects limit', () => {
    const lines = ['error: 1', 'error: 2', 'error: 3'];
    assert.deepEqual(selectMatchingLines(lines, ['^error'], { limit: 2 }), ['error: 1', 'error: 2']);
});

// --- applyOutputFilterOperation ---

test('strip_ansi removes ANSI escape sequences', () => {
    const lines = ['\x1B[31merror\x1B[0m: something', 'clean line'];
    const result = applyOutputFilterOperation(lines, { type: 'strip_ansi' });
    assert.deepEqual(result, ['error: something', 'clean line']);
});

test('regex_replace replaces patterns', () => {
    const lines = ['timestamp: 2024-01-15T10:30:00Z message'];
    const result = applyOutputFilterOperation(lines, {
        type: 'regex_replace',
        pattern: '\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z',
        replacement: '<TIMESTAMP>'
    });
    assert.deepEqual(result, ['timestamp: <TIMESTAMP> message']);
});

test('drop_lines_matching drops matched lines', () => {
    const lines = ['keep this', 'DEBUG: drop this', 'keep this too'];
    const result = applyOutputFilterOperation(lines, {
        type: 'drop_lines_matching',
        pattern: '^DEBUG:'
    });
    assert.deepEqual(result, ['keep this', 'keep this too']);
});

test('keep_lines_matching keeps only matched lines', () => {
    const lines = ['error: important', 'info: noise', 'error: also important'];
    const result = applyOutputFilterOperation(lines, {
        type: 'keep_lines_matching',
        pattern: '^error:'
    });
    assert.deepEqual(result, ['error: important', 'error: also important']);
});

test('truncate_line_length truncates long lines', () => {
    const lines = ['short', 'this is a very long line that should be truncated'];
    const result = applyOutputFilterOperation(lines, {
        type: 'truncate_line_length',
        max_chars: 10,
        suffix: '...'
    });
    assert.deepEqual(result, ['short', 'this is...']);
});

test('head returns first N lines', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const result = applyOutputFilterOperation(lines, { type: 'head', count: 2 });
    assert.deepEqual(result, ['a', 'b']);
});

test('tail returns last N lines', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const result = applyOutputFilterOperation(lines, { type: 'tail', count: 2 });
    assert.deepEqual(result, ['c', 'd']);
});

test('max_total_lines with tail strategy', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const result = applyOutputFilterOperation(lines, {
        type: 'max_total_lines',
        max_lines: 3,
        strategy: 'tail'
    });
    assert.deepEqual(result, ['c', 'd', 'e']);
});

test('max_total_lines with head strategy', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const result = applyOutputFilterOperation(lines, {
        type: 'max_total_lines',
        max_lines: 3,
        strategy: 'head'
    });
    assert.deepEqual(result, ['a', 'b', 'c']);
});

test('max_total_lines zero returns empty', () => {
    const result = applyOutputFilterOperation(['a', 'b'], {
        type: 'max_total_lines',
        max_lines: 0
    });
    assert.deepEqual(result, []);
});

test('unsupported operation type throws', () => {
    assert.throws(
        () => applyOutputFilterOperation(['a'], { type: 'nonexistent' }),
        /Unsupported filter operation type/
    );
});

test('missing type throws', () => {
    assert.throws(
        () => applyOutputFilterOperation(['a'], {}),
        /requires non-empty `type`/
    );
});

// --- applyPassthroughCeiling ---

test('applyPassthroughCeiling passes through when under limit', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const result = applyPassthroughCeiling(lines, null, 'test');
    assert.equal(result.length, 10);
});

test('applyPassthroughCeiling truncates when over limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const result = applyPassthroughCeiling(lines, null, 'test');
    assert.equal(result.length, 61); // 60 + 1 header
    assert.match(result[0], /\[passthrough-ceiling\]/);
});

test('applyPassthroughCeiling respects config override', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const config = { passthrough_ceiling: { max_lines: 10, strategy: 'head' } };
    const result = applyPassthroughCeiling(lines, config, 'test');
    assert.equal(result.length, 11); // 10 + 1 header
    assert.match(result[0], /strategy=head/);
});

// --- getCompileFailureStrategyConfig ---

test('getCompileFailureStrategyConfig returns known strategies', () => {
    for (const name of ['maven', 'gradle', 'node', 'cargo', 'dotnet', 'go']) {
        const config = getCompileFailureStrategyConfig(name);
        assert.ok(config.display_name);
        assert.ok(config.full_patterns.length > 0);
        assert.ok(config.degraded_patterns.length > 0);
    }
});

test('getCompileFailureStrategyConfig returns generic for unknown', () => {
    const config = getCompileFailureStrategyConfig('unknown');
    assert.equal(config.display_name, 'generic-compile');
});

// --- applyOutputFilterProfile ---

test('applyOutputFilterProfile returns passthrough for empty profile name', () => {
    const result = applyOutputFilterProfile(['a', 'b'], null, '');
    assert.equal(result.filter_mode, 'passthrough');
    assert.deepEqual(result.lines, ['a', 'b']);
});

test('applyOutputFilterProfile returns fallback for missing config', () => {
    const result = applyOutputFilterProfile(['a', 'b'], '/nonexistent.json', 'test');
    assert.equal(result.fallback_mode, 'missing_config_passthrough');
});

test('applyOutputFilterProfile applies profile from config file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-filters-'));
    try {
        const configPath = path.join(tempDir, 'output-filters.json');
        fs.writeFileSync(configPath, JSON.stringify({
            version: 1,
            profiles: {
                test_profile: {
                    description: 'Test profile',
                    operations: [
                        { type: 'drop_lines_matching', pattern: '^DEBUG:' }
                    ]
                }
            }
        }), 'utf8');

        const lines = ['DEBUG: noise', 'error: important', 'DEBUG: more noise'];
        const result = applyOutputFilterProfile(lines, configPath, 'test_profile');
        assert.equal(result.filter_mode, 'profile:test_profile');
        assert.deepEqual(result.lines, ['error: important']);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('applyOutputFilterProfile returns fallback for missing profile', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-filters-'));
    try {
        const configPath = path.join(tempDir, 'output-filters.json');
        fs.writeFileSync(configPath, JSON.stringify({
            version: 1,
            profiles: {}
        }), 'utf8');

        const result = applyOutputFilterProfile(['a'], configPath, 'nonexistent');
        assert.equal(result.fallback_mode, 'missing_profile_passthrough');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
