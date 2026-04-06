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
    ensureWithinRoot,
    ensureRelativeSafe,
    isSubpath,
} from '../../../src/lifecycle/common';
import {
    resolveRollbackSnapshotPath,
} from '../../../src/lifecycle/rollback';

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

    // -----------------------------------------------------------------------
    // Exported boundary helper coverage
    // -----------------------------------------------------------------------

    it('ensureWithinRoot rejects paths outside root', () => {
        const dir = mkTmpDir();
        try {
            assert.throws(
                () => ensureWithinRoot(dir, path.join(dir, '..', 'escape'), 'Test'),
                /resolves outside permitted root/
            );
            const inside = ensureWithinRoot(dir, path.join(dir, 'child'), 'Test');
            assert.ok(inside.startsWith(path.resolve(dir)));
        } finally {
            removePathRecursive(dir);
        }
    });

    it('ensureRelativeSafe rejects absolute and traversal paths', () => {
        assert.throws(() => ensureRelativeSafe('/etc/passwd', 'Test'), /must be relative/);
        assert.throws(() => ensureRelativeSafe('../escape', 'Test'), /parent path traversal/);
        assert.doesNotThrow(() => ensureRelativeSafe('safe/child.txt', 'Test'));
    });

    it('isSubpath accepts same-path and children, rejects siblings', () => {
        const parent = path.resolve('/a/b');
        assert.equal(isSubpath(parent, parent), true);
        assert.equal(isSubpath(parent, path.join(parent, 'child')), true);
        assert.equal(isSubpath(parent, path.resolve('/a/c')), false);
        assert.equal(isSubpath(parent, path.resolve('/a')), false);
    });

    // -----------------------------------------------------------------------
    // resolveRollbackSnapshotPath ownership boundary
    // -----------------------------------------------------------------------

    it('resolveRollbackSnapshotPath rejects absolute path outside target', () => {
        const dir = mkTmpDir();
        try {
            const outsidePath = path.resolve(dir, '..', 'evil-snapshot');
            assert.throws(
                () => resolveRollbackSnapshotPath(dir, outsidePath),
                /resolves outside permitted root/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('resolveRollbackSnapshotPath rejects relative traversal', () => {
        const dir = mkTmpDir();
        try {
            assert.throws(
                () => resolveRollbackSnapshotPath(dir, '../escape'),
                /resolves outside permitted root/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('resolveRollbackSnapshotPath accepts path within target root', () => {
        const dir = mkTmpDir();
        try {
            const snapshotDir = path.join(
                dir, 'Octopus-agent-orchestrator', 'runtime',
                'update-rollbacks', 'update-20260401-010101'
            );
            fs.mkdirSync(snapshotDir, { recursive: true });
            const result = resolveRollbackSnapshotPath(dir, snapshotDir);
            assert.ok(result.startsWith(path.resolve(dir)));
        } finally {
            removePathRecursive(dir);
        }
    });
});
