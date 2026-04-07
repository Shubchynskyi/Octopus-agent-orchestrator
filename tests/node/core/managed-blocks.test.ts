import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildManagedBlock,
    removeManagedBlock,
    upsertManagedBlock
} from '../../../src/core/managed-blocks';

const START_MARKER = '<!-- managed-start -->';
const END_MARKER = '<!-- managed-end -->';

test('buildManagedBlock emits the expected marker envelope', () => {
    assert.equal(
        buildManagedBlock(START_MARKER, END_MARKER, ['one', 'two']),
        '<!-- managed-start -->\none\ntwo\n<!-- managed-end -->'
    );
});

test('upsertManagedBlock replaces an existing managed block in-place', () => {
    const initial = 'before\n<!-- managed-start -->\nold\n<!-- managed-end -->\nafter\n';
    const updated = upsertManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['new']
    });

    assert.equal(updated, 'before\n<!-- managed-start -->\nnew\n<!-- managed-end -->\nafter\n');
});

test('removeManagedBlock strips the managed section and keeps surrounding text stable', () => {
    const initial = 'before\n<!-- managed-start -->\nmanaged\n<!-- managed-end -->\nafter\n';
    const updated = removeManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER
    });

    assert.equal(updated, 'before\nafter\n');
});

test('upsertManagedBlock appends block when no managed section exists', () => {
    const result = upsertManagedBlock('existing content\n', {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['added']
    });
    assert.equal(result, 'existing content\n<!-- managed-start -->\nadded\n<!-- managed-end -->\n');
});

test('upsertManagedBlock creates block from empty content', () => {
    const result = upsertManagedBlock('', {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['fresh']
    });
    assert.equal(result, '<!-- managed-start -->\nfresh\n<!-- managed-end -->\n');
});

test('upsertManagedBlock creates block from whitespace-only content', () => {
    const result = upsertManagedBlock('   \n  \n', {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['fresh']
    });
    assert.equal(result, '<!-- managed-start -->\nfresh\n<!-- managed-end -->\n');
});

test('upsertManagedBlock replaces multi-line managed block', () => {
    const initial = 'header\n<!-- managed-start -->\nline1\nline2\nline3\n<!-- managed-end -->\nfooter\n';
    const result = upsertManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['replaced']
    });
    assert.equal(result, 'header\n<!-- managed-start -->\nreplaced\n<!-- managed-end -->\nfooter\n');
});

test('removeManagedBlock returns content unchanged when no managed block exists', () => {
    const content = 'no managed block here\n';
    const result = removeManagedBlock(content, {
        startMarker: START_MARKER,
        endMarker: END_MARKER
    });
    assert.equal(result, 'no managed block here\n');
});

test('removeManagedBlock handles block at start of content', () => {
    const initial = '<!-- managed-start -->\nmanaged\n<!-- managed-end -->\nafter\n';
    const result = removeManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER
    });
    assert.equal(result, 'after\n');
});

test('removeManagedBlock handles block at end of content', () => {
    const initial = 'before\n<!-- managed-start -->\nmanaged\n<!-- managed-end -->\n';
    const result = removeManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER
    });
    assert.equal(result, 'before\n');
});

test('upsertManagedBlock handles CRLF newline option', () => {
    const result = upsertManagedBlock('', {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        blockLines: ['crlf'],
        newline: '\r\n'
    });
    assert.equal(result, '<!-- managed-start -->\r\ncrlf\r\n<!-- managed-end -->\r\n');
});

test('removeManagedBlock handles CRLF input', () => {
    const initial = 'before\r\n<!-- managed-start -->\r\nmanaged\r\n<!-- managed-end -->\r\nafter\r\n';
    const result = removeManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        newline: '\r\n'
    });
    assert.equal(result, 'before\r\nafter\r\n');
});

test('removeManagedBlock collapses triple newlines at removal site', () => {
    const initial = 'before\n\n<!-- managed-start -->\nmanaged\n<!-- managed-end -->\n\nafter\n';
    const result = removeManagedBlock(initial, {
        startMarker: START_MARKER,
        endMarker: END_MARKER
    });
    assert.ok(!result.includes('\n\n\n'), 'should not contain triple newlines');
});

test('upsertManagedBlock with markers containing regex-special characters', () => {
    const start = '<!-- [start] ($) -->';
    const end = '<!-- [end] ($) -->';
    const initial = `header\n${start}\nold\n${end}\nfooter\n`;
    const result = upsertManagedBlock(initial, {
        startMarker: start,
        endMarker: end,
        blockLines: ['new']
    });
    assert.equal(result, `header\n${start}\nnew\n${end}\nfooter\n`);
});
