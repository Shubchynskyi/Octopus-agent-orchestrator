import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    createRollbackSnapshot,
    restoreRollbackSnapshot,
    restoreSyncedItemsFromBackup,
    syncWorkingTreeBundleItems,
    removePathRecursive,
} from '../../../src/lifecycle/common';

function mkTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'oao-lifecycle-boundary-'));
}

describe('boundary validation', () => {
    it('createRollbackSnapshot rejects traversal and absolute paths', () => {
        const dir = mkTmpDir();
        try {
            const snapshotRoot = path.join(dir, '_snapshot');
            assert.throws(() => createRollbackSnapshot(dir, snapshotRoot, ['../evil.txt']), /parent path traversal/);
            assert.throws(() => createRollbackSnapshot(dir, snapshotRoot, [path.resolve('/etc/passwd')]), /must be relative/);
        } finally {
            removePathRecursive(dir);
        }
    });

    it('restoreRollbackSnapshot rejects bad records', () => {
        const dir = mkTmpDir();
        try {
            const snapshotRoot = path.join(dir, '_snapshot');
            const records = [{ relativePath: '../bad', existed: true, pathType: 'file' }];
            assert.throws(() => restoreRollbackSnapshot(dir, snapshotRoot, records), /parent path traversal/);
        } finally {
            removePathRecursive(dir);
        }
    });

    it('restoreSyncedItemsFromBackup rejects bad item keys', () => {
        const dir = mkTmpDir();
        try {
            const bundleRoot = path.join(dir, 'bundle');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const backupRoot = path.join(dir, 'backup');
            fs.mkdirSync(backupRoot, { recursive: true });
            const badMap: Record<string, unknown> = { '../secrets': true };
            assert.throws(() => restoreSyncedItemsFromBackup(bundleRoot, backupRoot, badMap, null), /parent path traversal/);
        } finally {
            removePathRecursive(dir);
        }
    });

    it('syncWorkingTreeBundleItems rejects bad item names', () => {
        const dir = mkTmpDir();
        try {
            const src = path.join(dir, 'src');
            fs.mkdirSync(src, { recursive: true });
            const dst = path.join(dir, 'dst');
            fs.mkdirSync(dst, { recursive: true });
            assert.throws(() => syncWorkingTreeBundleItems(src, dst, ['../bad']), /parent path traversal/);
        } finally {
            removePathRecursive(dir);
        }
    });
});
