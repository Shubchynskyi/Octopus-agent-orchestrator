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
    resolveRealPath,
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

// ---------------------------------------------------------------------------
// resolveRealPath unit tests
// ---------------------------------------------------------------------------

describe('resolveRealPath', () => {
    it('returns realpath for an existing path', () => {
        const dir = mkTmpDir();
        try {
            const real = resolveRealPath(dir);
            assert.equal(real, fs.realpathSync(path.resolve(dir)));
        } finally {
            removePathRecursive(dir);
        }
    });

    it('resolves deepest existing ancestor for a non-existent tail', () => {
        const dir = mkTmpDir();
        try {
            const nonExistent = path.join(dir, 'does', 'not', 'exist');
            const result = resolveRealPath(nonExistent);
            const realDir = fs.realpathSync(path.resolve(dir));
            assert.equal(result, path.join(realDir, 'does', 'not', 'exist'));
        } finally {
            removePathRecursive(dir);
        }
    });
});

// ---------------------------------------------------------------------------
// Symlink / junction escape detection
// ---------------------------------------------------------------------------

function canCreateSymlinks(): boolean {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-symtest-'));
    try {
        const target = path.join(dir, 'target');
        const link = path.join(dir, 'link');
        fs.mkdirSync(target);
        fs.symlinkSync(target, link, 'junction');
        return true;
    } catch {
        return false;
    } finally {
        removePathRecursive(dir);
    }
}

const symlinkSupported = canCreateSymlinks();

describe('symlink/junction escape detection', { skip: !symlinkSupported && 'Symlinks/junctions not supported' }, () => {
    it('ensureWithinRoot rejects junction that escapes root', () => {
        const dir = mkTmpDir();
        try {
            const root = path.join(dir, 'root');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });
            fs.writeFileSync(path.join(outside, 'secret.txt'), 'sensitive');

            // Create junction inside root that points outside root
            const junction = path.join(root, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            // Lexically the path looks inside root, but realpath resolves outside
            const candidate = path.join(root, 'escape', 'secret.txt');
            assert.throws(
                () => ensureWithinRoot(root, candidate, 'Junction test'),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('ensureWithinRoot rejects junction with non-existent tail', () => {
        const dir = mkTmpDir();
        try {
            const root = path.join(dir, 'root');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });

            const junction = path.join(root, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            // Even when the tail file doesn't exist, the junction should be caught
            const candidate = path.join(root, 'escape', 'new-file.txt');
            assert.throws(
                () => ensureWithinRoot(root, candidate, 'Junction non-existent test'),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('ensureWithinRoot accepts symlink that stays within root', () => {
        const dir = mkTmpDir();
        try {
            const root = path.join(dir, 'root');
            const subdir = path.join(root, 'real');
            fs.mkdirSync(subdir, { recursive: true });
            fs.writeFileSync(path.join(subdir, 'ok.txt'), 'safe');

            // Symlink inside root pointing to another location inside root
            const link = path.join(root, 'link');
            fs.symlinkSync(subdir, link, 'junction');

            const candidate = path.join(root, 'link', 'ok.txt');
            const result = ensureWithinRoot(root, candidate, 'Safe junction test');
            assert.ok(result);
        } finally {
            removePathRecursive(dir);
        }
    });

    it('createRollbackSnapshot rejects junction escape in target root', () => {
        const dir = mkTmpDir();
        try {
            const root = path.join(dir, 'root');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });
            fs.writeFileSync(path.join(outside, 'secret.txt'), 'data');

            const junction = path.join(root, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            const snapshotRoot = path.join(dir, 'snapshot');
            assert.throws(
                () => createRollbackSnapshot(root, snapshotRoot, ['escape/secret.txt']),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('restoreRollbackSnapshot rejects junction escape', () => {
        const dir = mkTmpDir();
        try {
            const root = path.join(dir, 'root');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });

            const junction = path.join(root, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            const snapshotRoot = path.join(dir, 'snapshot');
            const records = [{ relativePath: 'escape/file.txt', existed: false, pathType: 'missing' }];
            assert.throws(
                () => restoreRollbackSnapshot(root, snapshotRoot, records),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('syncWorkingTreeBundleItems rejects junction escape in destination', () => {
        const dir = mkTmpDir();
        try {
            const src = path.join(dir, 'src');
            const escapeDir = path.join(src, 'escape');
            fs.mkdirSync(escapeDir, { recursive: true });
            fs.writeFileSync(path.join(escapeDir, 'payload.txt'), 'payload');

            const dst = path.join(dir, 'dst');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(dst, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });

            // Create junction inside dst pointing outside
            const junction = path.join(dst, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            // Syncing 'escape/payload.txt' should be caught since junction escapes dst
            assert.throws(
                () => syncWorkingTreeBundleItems(src, dst, ['escape/payload.txt']),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });

    it('restoreSyncedItemsFromBackup rejects junction escape in target', () => {
        const dir = mkTmpDir();
        try {
            const bundleRoot = path.join(dir, 'bundle');
            const outside = path.join(dir, 'outside');
            fs.mkdirSync(bundleRoot, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });

            const junction = path.join(bundleRoot, 'escape');
            fs.symlinkSync(outside, junction, 'junction');

            const backupRoot = path.join(dir, 'backup');
            fs.mkdirSync(backupRoot, { recursive: true });

            const preexistingMap = { 'escape/data': true };
            assert.throws(
                () => restoreSyncedItemsFromBackup(bundleRoot, backupRoot, preexistingMap, null),
                /symlink or junction/
            );
        } finally {
            removePathRecursive(dir);
        }
    });
});
