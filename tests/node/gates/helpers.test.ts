import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePath,
    toPosix,
    resolveTaskId,
    parseBool,
    stringSha256,
    normalizeRootPrefixes,
    testPathPrefix,
    toStringArray
} from '../../../src/gates/helpers';

describe('gates/helpers', () => {
    describe('normalizePath', () => {
        it('converts backslashes to forward slashes', () => {
            assert.equal(normalizePath('foo\\bar\\baz'), 'foo/bar/baz');
        });
        it('strips leading ./', () => {
            assert.equal(normalizePath('./src/index.ts'), 'src/index.ts');
        });
        it('trims whitespace', () => {
            assert.equal(normalizePath('  foo/bar  '), 'foo/bar');
        });
        it('returns empty for null', () => {
            assert.equal(normalizePath(null), '');
        });
        it('collapses duplicate slashes', () => {
            assert.equal(normalizePath('foo//bar///baz'), 'foo/bar/baz');
        });
    });

    describe('toPosix', () => {
        it('converts backslashes', () => {
            assert.equal(toPosix('C:\\Users\\test'), 'C:/Users/test');
        });
        it('returns empty for null', () => {
            assert.equal(toPosix(null), '');
        });
    });

    describe('resolveTaskId', () => {
        it('returns explicit task ID when provided', () => {
            assert.equal(resolveTaskId('T-001', ''), 'T-001');
        });
        it('extracts from output path hint when explicit is empty', () => {
            assert.equal(resolveTaskId('', '/reviews/T-001-preflight.json'), 'T-001');
        });
        it('returns null when both are empty', () => {
            assert.equal(resolveTaskId('', ''), null);
        });
        it('strips -preflight suffix from hint', () => {
            assert.equal(resolveTaskId('', 'task-42-preflight.json'), 'task-42');
        });
    });

    describe('parseBool', () => {
        it('parses true values', () => {
            assert.equal(parseBool('true'), true);
            assert.equal(parseBool('yes'), true);
            assert.equal(parseBool('1'), true);
            assert.equal(parseBool('да'), true);
            assert.equal(parseBool(true), true);
        });
        it('parses false values', () => {
            assert.equal(parseBool('false'), false);
            assert.equal(parseBool('no'), false);
            assert.equal(parseBool('0'), false);
            assert.equal(parseBool('нет'), false);
            assert.equal(parseBool(false), false);
        });
        it('returns default for null', () => {
            assert.equal(parseBool(null, true), true);
            assert.equal(parseBool(null, false), false);
        });
    });

    describe('stringSha256', () => {
        it('returns a 64-char lowercase hex string', () => {
            const hash = stringSha256('hello');
            assert.equal(hash!.length, 64);
            assert.match(hash!, /^[a-f0-9]{64}$/);
        });
        it('returns null for null input', () => {
            assert.equal(stringSha256(null), null);
        });
        it('produces deterministic output', () => {
            assert.equal(stringSha256('test'), stringSha256('test'));
        });
    });

    describe('normalizeRootPrefixes', () => {
        it('ensures trailing slash and sorts', () => {
            const result = normalizeRootPrefixes(['src', 'app/', 'frontend']);
            assert.deepEqual(result, ['app/', 'frontend/', 'src/']);
        });
        it('deduplicates', () => {
            const result = normalizeRootPrefixes(['src/', 'src/']);
            assert.deepEqual(result, ['src/']);
        });
        it('handles empty input', () => {
            assert.deepEqual(normalizeRootPrefixes([]), []);
        });
    });

    describe('testPathPrefix', () => {
        it('matches prefix case-insensitively', () => {
            assert.equal(testPathPrefix('src/foo.ts', ['src/']), true);
            assert.equal(testPathPrefix('SRC/foo.ts', ['src/']), true);
        });
        it('returns false when no prefix matches', () => {
            assert.equal(testPathPrefix('lib/foo.ts', ['src/']), false);
        });
    });

    describe('toStringArray', () => {
        it('converts a single string', () => {
            assert.deepEqual(toStringArray('hello'), ['hello']);
        });
        it('converts an array', () => {
            assert.deepEqual(toStringArray(['a', 'b', null, '']), ['a', 'b']);
        });
        it('returns empty for null', () => {
            assert.deepEqual(toStringArray(null), []);
        });
        it('trims when option set', () => {
            assert.deepEqual(toStringArray(['  a  ', '  b  '], { trimValues: true }), ['a', 'b']);
        });
    });
});
