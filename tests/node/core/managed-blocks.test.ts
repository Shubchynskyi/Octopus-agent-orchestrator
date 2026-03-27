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
