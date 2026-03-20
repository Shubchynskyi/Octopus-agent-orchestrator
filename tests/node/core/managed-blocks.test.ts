const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildManagedBlock,
    removeManagedBlock,
    upsertManagedBlock
} = require('../../../src/core/managed-blocks.ts');

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
