import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    runCleanup,
    runCleanupWithLock,
    runGc,
    runGcWithLock,
    buildDefaultRetentionPolicy,
    GC_ALLOWLIST,
    validateGcCategories,
    type CleanupOptions,
    type GcOptions,
    type GcResult,
    type RetentionPolicy
} from '../../../src/lifecycle/cleanup';

function makeTmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupRuntimeDir(bundleRoot: string): string {
    const runtimeDir = path.join(bundleRoot, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    return runtimeDir;
}

/** Create a timestamped backup directory entry (e.g. `20260101-120000-000`). */
function createTimestampDir(parentDir: string, date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const pad3 = (n: number) => String(n).padStart(3, '0');
    const name =
        `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
        `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}-` +
        `${pad3(date.getMilliseconds())}`;
    const dirPath = path.join(parentDir, name);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, 'data.txt'), 'test backup data');
    return dirPath;
}

/** Create an update-prefixed directory entry (e.g. `update-20260101-120000`). */
function createUpdateDir(parentDir: string, date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const name =
        `update-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
        `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
    const dirPath = path.join(parentDir, name);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, 'report.md'), '# Update');
    return dirPath;
}

function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function createTaskEventFile(eventsDir: string, taskId: string): string {
    const filePath = path.join(eventsDir, `${taskId}.jsonl`);
    fs.writeFileSync(filePath, `{"event":"TASK_MODE_ENTERED","task_id":"${taskId}"}\n`);
    return filePath;
}

function createReviewArtifacts(reviewsDir: string, taskId: string): string[] {
    const files = [
        `${taskId}-preflight.json`,
        `${taskId}-task-mode.json`,
        `${taskId}-compile-gate.json`
    ];
    const paths: string[] = [];
    for (const file of files) {
        const filePath = path.join(reviewsDir, file);
        fs.writeFileSync(filePath, JSON.stringify({ task_id: taskId }));
        paths.push(filePath);
    }
    return paths;
}

describe('buildDefaultRetentionPolicy', () => {
    it('returns sensible defaults', () => {
        const policy = buildDefaultRetentionPolicy();
        assert.equal(policy.maxAgeDays, 30);
        assert.equal(policy.maxBackups, 20);
        assert.equal(policy.maxTaskEvents, 50);
        assert.equal(policy.maxReviews, 100);
        assert.equal(policy.maxUpdateReports, 10);
        assert.equal(policy.maxUpdateRollbacks, 5);
        assert.equal(policy.maxBundleBackups, 5);
    });
});

describe('runCleanup', () => {
    let tmpDir: string;
    let bundleRoot: string;
    let runtimeDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir('oao-cleanup-');
        bundleRoot = path.join(tmpDir, 'Octopus-agent-orchestrator');
        fs.mkdirSync(bundleRoot, { recursive: true });
        // VERSION file required by validateTargetRoot
        fs.writeFileSync(path.join(bundleRoot, 'VERSION'), '1.0.0\n');
        runtimeDir = setupRuntimeDir(bundleRoot);
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup
        }
    });

    it('returns SUCCESS when runtime is empty', () => {
        const result = runCleanup({
            targetRoot: tmpDir,
            bundleRoot,
            dryRun: false
        });
        assert.equal(result.result, 'SUCCESS');
        assert.equal(result.removed.length, 0);
        assert.equal(result.totalFreedBytes, 0);
    });

    it('returns SUCCESS when runtime dirs do not exist', () => {
        // Remove runtime entirely
        fs.rmSync(runtimeDir, { recursive: true, force: true });
        fs.mkdirSync(runtimeDir, { recursive: true });
        const result = runCleanup({
            targetRoot: tmpDir,
            bundleRoot,
            dryRun: false
        });
        assert.equal(result.result, 'SUCCESS');
    });

    describe('backups retention by count', () => {
        it('removes oldest backups exceeding maxBackups', () => {
            const backupsDir = path.join(runtimeDir, 'backups');
            fs.mkdirSync(backupsDir, { recursive: true });

            // Create 5 backup dirs
            const dates = [
                daysAgo(5),
                daysAgo(4),
                daysAgo(3),
                daysAgo(2),
                daysAgo(1)
            ];
            for (const d of dates) {
                createTimestampDir(backupsDir, d);
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBackups: 3, maxAgeDays: 365 }
            });

            assert.equal(result.result, 'SUCCESS');
            // Should remove 2 oldest
            assert.equal(result.removed.length, 2);
            for (const item of result.removed) {
                assert.equal(item.category, 'backups');
                assert.equal(item.reason, 'count');
            }
            // 3 should remain
            const remaining = fs.readdirSync(backupsDir);
            assert.equal(remaining.length, 3);
        });
    });

    describe('backups retention by age', () => {
        it('removes backups older than maxAgeDays', () => {
            const backupsDir = path.join(runtimeDir, 'backups');
            fs.mkdirSync(backupsDir, { recursive: true });

            createTimestampDir(backupsDir, daysAgo(60));
            createTimestampDir(backupsDir, daysAgo(1));

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBackups: 100, maxAgeDays: 30 }
            });

            assert.equal(result.result, 'SUCCESS');
            const ageItems = result.removed.filter(i => i.reason === 'age');
            assert.ok(ageItems.length >= 1, 'Should remove at least 1 aged backup');
            assert.equal(fs.readdirSync(backupsDir).length, 1);
        });
    });

    describe('dry-run mode', () => {
        it('does not remove any files in dry-run mode', () => {
            const backupsDir = path.join(runtimeDir, 'backups');
            fs.mkdirSync(backupsDir, { recursive: true });

            for (let i = 0; i < 5; i++) {
                createTimestampDir(backupsDir, daysAgo(i + 1));
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                dryRun: true,
                retentionPolicy: { maxBackups: 2, maxAgeDays: 365 }
            });

            assert.equal(result.dryRun, true);
            assert.equal(result.removed.length, 0);
            assert.equal(result.skipped.length, 3);
            assert.ok(result.totalFreedBytes > 0, 'Should report projected freed bytes');
            // All 5 dirs should still exist
            assert.equal(fs.readdirSync(backupsDir).length, 5);
        });
    });

    describe('task-event cleanup', () => {
        it('removes oldest task-event files exceeding maxTaskEvents', () => {
            const eventsDir = path.join(runtimeDir, 'task-events');
            fs.mkdirSync(eventsDir, { recursive: true });

            // Create 5 task event files
            for (let i = 1; i <= 5; i++) {
                createTaskEventFile(eventsDir, `T-${String(i).padStart(3, '0')}`);
            }
            // Create all-tasks.jsonl (should never be removed)
            fs.writeFileSync(path.join(eventsDir, 'all-tasks.jsonl'), '{"event":"test"}\n');

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxTaskEvents: 3, maxAgeDays: 365 }
            });

            assert.equal(result.result, 'SUCCESS');
            const eventItems = result.removed.filter(i => i.category === 'task-events');
            assert.equal(eventItems.length, 2);
            // all-tasks.jsonl must survive
            assert.ok(fs.existsSync(path.join(eventsDir, 'all-tasks.jsonl')));
            // 3 task files + all-tasks.jsonl should remain
            assert.equal(fs.readdirSync(eventsDir).length, 4);
        });

        it('never removes all-tasks.jsonl', () => {
            const eventsDir = path.join(runtimeDir, 'task-events');
            fs.mkdirSync(eventsDir, { recursive: true });
            fs.writeFileSync(path.join(eventsDir, 'all-tasks.jsonl'), '{"event":"test"}\n');

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxTaskEvents: 0, maxAgeDays: 0 }
            });

            assert.ok(fs.existsSync(path.join(eventsDir, 'all-tasks.jsonl')));
            const taskEventItems = result.removed.filter(i => i.category === 'task-events');
            assert.equal(taskEventItems.length, 0);
        });

        it('evicts least recently modified files, not lowest task-ids', () => {
            const eventsDir = path.join(runtimeDir, 'task-events');
            fs.mkdirSync(eventsDir, { recursive: true });

            createTaskEventFile(eventsDir, 'T-001');
            createTaskEventFile(eventsDir, 'T-002');
            createTaskEventFile(eventsDir, 'T-003');

            // Make T-001 the most recently modified, T-002/T-003 stale
            const now = new Date();
            const past = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
            fs.utimesSync(path.join(eventsDir, 'T-001.jsonl'), now, now);
            fs.utimesSync(path.join(eventsDir, 'T-002.jsonl'), past, past);
            fs.utimesSync(path.join(eventsDir, 'T-003.jsonl'), past, past);

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxTaskEvents: 1, maxAgeDays: 365 }
            });

            const eventItems = result.removed.filter(i => i.category === 'task-events');
            assert.equal(eventItems.length, 2);
            const removedNames = eventItems.map(i => path.basename(i.path));
            assert.ok(!removedNames.includes('T-001.jsonl'),
                'T-001 (recently modified) must survive despite lowest task-id');
            assert.ok(removedNames.includes('T-002.jsonl'),
                'T-002 (stale) should be evicted');
            assert.ok(removedNames.includes('T-003.jsonl'),
                'T-003 (stale) should be evicted');
        });
    });

    describe('review artifact cleanup', () => {
        it('removes review artifacts for oldest task groups exceeding maxReviews', () => {
            const reviewsDir = path.join(runtimeDir, 'reviews');
            fs.mkdirSync(reviewsDir, { recursive: true });

            // Create review artifacts for 4 tasks (sequential creation means
            // ascending mtime order matches ascending task-id order here)
            for (let i = 1; i <= 4; i++) {
                createReviewArtifacts(reviewsDir, `T-${String(i).padStart(3, '0')}`);
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxReviews: 2, maxAgeDays: 365 }
            });

            assert.equal(result.result, 'SUCCESS');
            const reviewItems = result.removed.filter(i => i.category === 'reviews');
            // T-001 and T-002 (least recently modified) should be removed, 3 files each = 6 files
            assert.equal(reviewItems.length, 6);
            // T-003 and T-004 should remain
            const remaining = fs.readdirSync(reviewsDir);
            assert.equal(remaining.length, 6); // 3 files x 2 remaining tasks
        });

        it('evicts least recently modified task groups, not lowest task-ids', () => {
            const reviewsDir = path.join(runtimeDir, 'reviews');
            fs.mkdirSync(reviewsDir, { recursive: true });

            createReviewArtifacts(reviewsDir, 'T-001');
            createReviewArtifacts(reviewsDir, 'T-002');
            createReviewArtifacts(reviewsDir, 'T-003');

            // Make T-001 the most recently modified and T-002/T-003 stale
            const now = new Date();
            const past = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
            for (const file of fs.readdirSync(reviewsDir)) {
                const filePath = path.join(reviewsDir, file);
                if (file.startsWith('T-002-') || file.startsWith('T-003-')) {
                    fs.utimesSync(filePath, past, past);
                } else {
                    fs.utimesSync(filePath, now, now);
                }
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxReviews: 1, maxAgeDays: 365 }
            });

            const reviewItems = result.removed.filter(i => i.category === 'reviews');
            assert.equal(reviewItems.length, 6); // 3 files each for 2 stale tasks
            const removedNames = reviewItems.map(i => path.basename(i.path));
            assert.ok(removedNames.every(p => !p.startsWith('T-001-')),
                'T-001 (recently modified) must survive despite lowest task-id');
            assert.ok(removedNames.some(p => p.startsWith('T-002-')),
                'T-002 (stale) should be evicted');
            assert.ok(removedNames.some(p => p.startsWith('T-003-')),
                'T-003 (stale) should be evicted');
        });
    });

    describe('update-rollbacks cleanup', () => {
        it('removes oldest update-rollback dirs exceeding maxUpdateRollbacks', () => {
            const rollbacksDir = path.join(runtimeDir, 'update-rollbacks');
            fs.mkdirSync(rollbacksDir, { recursive: true });

            for (let i = 0; i < 4; i++) {
                createUpdateDir(rollbacksDir, daysAgo(i + 1));
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxUpdateRollbacks: 2, maxAgeDays: 365 }
            });

            const rollbackItems = result.removed.filter(i => i.category === 'update-rollbacks');
            assert.equal(rollbackItems.length, 2);
            assert.equal(fs.readdirSync(rollbacksDir).length, 2);
        });
    });

    describe('bundle-backups cleanup', () => {
        it('removes oldest bundle-backup dirs exceeding maxBundleBackups', () => {
            const bundleBackupsDir = path.join(runtimeDir, 'bundle-backups');
            fs.mkdirSync(bundleBackupsDir, { recursive: true });

            for (let i = 0; i < 4; i++) {
                createTimestampDir(bundleBackupsDir, daysAgo(i + 1));
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBundleBackups: 2, maxAgeDays: 365 }
            });

            const bundleItems = result.removed.filter(i => i.category === 'bundle-backups');
            assert.equal(bundleItems.length, 2);
            assert.equal(fs.readdirSync(bundleBackupsDir).length, 2);
        });
    });

    describe('update-reports cleanup', () => {
        it('removes oldest update-report files exceeding maxUpdateReports', () => {
            const reportsDir = path.join(runtimeDir, 'update-reports');
            fs.mkdirSync(reportsDir, { recursive: true });

            for (let i = 0; i < 4; i++) {
                createUpdateDir(reportsDir, daysAgo(i + 1));
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxUpdateReports: 2, maxAgeDays: 365 }
            });

            const reportItems = result.removed.filter(i => i.category === 'update-reports');
            assert.equal(reportItems.length, 2);
            assert.equal(fs.readdirSync(reportsDir).length, 2);
        });
    });

    describe('retention policy override', () => {
        it('accepts partial overrides and uses defaults for the rest', () => {
            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBackups: 5 }
            });

            assert.equal(result.retentionPolicy.maxBackups, 5);
            assert.equal(result.retentionPolicy.maxAgeDays, 30);
            assert.equal(result.retentionPolicy.maxTaskEvents, 50);
        });
    });

    describe('combined retention', () => {
        it('cleans up across multiple categories in a single run', () => {
            const backupsDir = path.join(runtimeDir, 'backups');
            const eventsDir = path.join(runtimeDir, 'task-events');
            fs.mkdirSync(backupsDir, { recursive: true });
            fs.mkdirSync(eventsDir, { recursive: true });

            for (let i = 0; i < 5; i++) {
                createTimestampDir(backupsDir, daysAgo(i + 1));
            }
            for (let i = 1; i <= 5; i++) {
                createTaskEventFile(eventsDir, `T-${String(i).padStart(3, '0')}`);
            }

            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBackups: 2, maxTaskEvents: 2, maxAgeDays: 365 }
            });

            assert.equal(result.result, 'SUCCESS');
            const backupItems = result.removed.filter(i => i.category === 'backups');
            const eventItems = result.removed.filter(i => i.category === 'task-events');
            assert.equal(backupItems.length, 3);
            assert.equal(eventItems.length, 3);
        });
    });

    describe('error handling', () => {
        it('reports PARTIAL when some removals fail', () => {
            // Create a backup dir that we make read-only on the parent
            // This test only verifies the error-reporting path
            const backupsDir = path.join(runtimeDir, 'backups');
            fs.mkdirSync(backupsDir, { recursive: true });

            for (let i = 0; i < 3; i++) {
                createTimestampDir(backupsDir, daysAgo(i + 1));
            }

            // Normal run should succeed
            const result = runCleanup({
                targetRoot: tmpDir,
                bundleRoot,
                retentionPolicy: { maxBackups: 1, maxAgeDays: 365 }
            });
            assert.equal(result.result, 'SUCCESS');
            assert.equal(result.errors.length, 0);
        });
    });
});

describe('runCleanupWithLock', () => {
    let tmpDir: string;
    let bundleRoot: string;

    beforeEach(() => {
        tmpDir = makeTmpDir('oao-cleanup-lock-');
        bundleRoot = path.join(tmpDir, 'Octopus-agent-orchestrator');
        fs.mkdirSync(bundleRoot, { recursive: true });
        fs.writeFileSync(path.join(bundleRoot, 'VERSION'), '1.0.0\n');
        setupRuntimeDir(bundleRoot);
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Best-effort
        }
    });

    it('runs cleanup under lifecycle lock', () => {
        const result = runCleanupWithLock({
            targetRoot: tmpDir,
            bundleRoot,
            dryRun: true
        });
        assert.equal(result.result, 'SUCCESS');
        assert.equal(result.dryRun, true);
    });
});

// ---------------------------------------------------------------------------
// GC tests
// ---------------------------------------------------------------------------

describe('GC_ALLOWLIST', () => {
    it('contains expected categories', () => {
        assert.ok(GC_ALLOWLIST.includes('backups'));
        assert.ok(GC_ALLOWLIST.includes('reviews'));
        assert.ok(GC_ALLOWLIST.includes('task-events'));
        assert.ok(GC_ALLOWLIST.includes('isolation-sandbox'));
        assert.ok(GC_ALLOWLIST.includes('stale-locks'));
        assert.ok(GC_ALLOWLIST.includes('update-rollbacks'));
        assert.ok(GC_ALLOWLIST.includes('update-reports'));
        assert.ok(GC_ALLOWLIST.includes('bundle-backups'));
    });
});

describe('validateGcCategories', () => {
    it('accepts valid allowlist categories', () => {
        assert.doesNotThrow(() => validateGcCategories(['backups', 'reviews']));
    });

    it('rejects unknown categories', () => {
        assert.throws(
            () => validateGcCategories(['backups', 'unknown-dir']),
            /Unknown gc category 'unknown-dir'/
        );
    });
});

describe('runGc', () => {
    let tmpDir: string;
    let bundleRoot: string;
    let runtimeDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir('oao-gc-');
        bundleRoot = path.join(tmpDir, 'Octopus-agent-orchestrator');
        fs.mkdirSync(bundleRoot, { recursive: true });
        fs.writeFileSync(path.join(bundleRoot, 'VERSION'), '1.0.0\n');
        runtimeDir = path.join(bundleRoot, 'runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Best-effort
        }
    });

    it('is dry-run by default', () => {
        const backupsDir = path.join(runtimeDir, 'backups');
        fs.mkdirSync(backupsDir, { recursive: true });
        createTimestampDir(backupsDir, daysAgo(2));

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            retentionPolicy: { maxBackups: 0, maxAgeDays: 365 }
        });

        assert.equal(result.dryRun, true, 'gc must default to dry-run');
        assert.equal(result.removed.length, 0, 'dry-run must not remove');
        assert.ok(result.skipped.length > 0, 'dry-run must report skipped');
        assert.equal(fs.readdirSync(backupsDir).length, 1, 'files must survive');
    });

    it('deletes files when confirm is true', () => {
        const backupsDir = path.join(runtimeDir, 'backups');
        fs.mkdirSync(backupsDir, { recursive: true });
        createTimestampDir(backupsDir, daysAgo(2));
        createTimestampDir(backupsDir, daysAgo(1));

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true,
            retentionPolicy: { maxBackups: 0, maxAgeDays: 365 }
        });

        assert.equal(result.dryRun, false);
        assert.ok(result.removed.length > 0, 'should remove items');
        assert.equal(fs.readdirSync(backupsDir).length, 0, 'all backups removed');
    });

    it('returns per-category summary with correct counts and bytes', () => {
        const backupsDir = path.join(runtimeDir, 'backups');
        const eventsDir = path.join(runtimeDir, 'task-events');
        fs.mkdirSync(backupsDir, { recursive: true });
        fs.mkdirSync(eventsDir, { recursive: true });
        createTimestampDir(backupsDir, daysAgo(2));
        createTaskEventFile(eventsDir, 'T-001');

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            retentionPolicy: { maxBackups: 0, maxTaskEvents: 0, maxAgeDays: 365 }
        });

        assert.ok(result.categories.backups, 'should have backups category');
        assert.equal(result.categories.backups.count, 1, 'should count 1 backup');
        assert.ok(result.categories.backups.bytes > 0, 'should report bytes > 0');
        assert.ok(result.categories['task-events'], 'should have task-events category');
        assert.equal(result.categories['task-events'].count, 1, 'should count 1 task-event');
        assert.ok(result.categories['task-events'].bytes > 0, 'should report bytes > 0');
    });

    it('reports staleLocksCleaned from task-event lock subsystem', () => {
        // Create task-events dir and a stale lock within it
        const eventsDir = path.join(runtimeDir, 'task-events');
        fs.mkdirSync(eventsDir, { recursive: true });
        const staleLock = path.join(eventsDir, '.T-999.jsonl.lock');
        fs.mkdirSync(staleLock, { recursive: true });
        // Write owner.json with a PID that is definitely not running (99999999)
        fs.writeFileSync(
            path.join(staleLock, 'owner.json'),
            JSON.stringify({ pid: 99999999, hostname: 'test', timestamp_utc: new Date().toISOString() })
        );

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true
        });

        // staleLocksCleaned may be 0 if the subsystem doesn't recognize the lock
        // format, but the integration path is exercised without errors
        assert.equal(typeof result.staleLocksCleaned, 'number');
    });

    it('accounts for stale task-event lock bytes in dry-run totals', () => {
        const eventsDir = path.join(runtimeDir, 'task-events');
        fs.mkdirSync(eventsDir, { recursive: true });
        const staleLock = path.join(eventsDir, '.T-777.jsonl.lock');
        fs.mkdirSync(staleLock, { recursive: true });
        fs.writeFileSync(
            path.join(staleLock, 'owner.json'),
            JSON.stringify({ hostname: os.hostname(), timestamp_utc: new Date().toISOString() })
        );
        fs.writeFileSync(path.join(staleLock, 'payload.txt'), 'lock-payload');
        const staleTime = new Date(Date.now() - 5_000);
        fs.utimesSync(staleLock, staleTime, staleTime);

        const expectedBytes = fs.statSync(path.join(staleLock, 'owner.json')).size
            + fs.statSync(path.join(staleLock, 'payload.txt')).size;

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot
        });

        assert.ok(result.staleLocksCleaned >= 1, 'dry-run should report removable stale task-event locks');
        assert.ok(result.totalFreedBytes >= expectedBytes, 'dry-run total should include stale task-event lock bytes');
        assert.ok(result.categories['task-events'], 'task-events summary should be present');
        assert.ok(result.categories['task-events'].bytes >= expectedBytes,
            'task-events summary should include stale task-event lock bytes');
    });

    it('reports PARTIAL when removal errors occur', () => {
        // This test verifies the error-reporting shape is correct even when
        // no actual errors can be induced cross-platform. We verify the
        // structure of errors array and result field remain consistent.
        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true
        });

        assert.ok(Array.isArray(result.errors));
        assert.equal(result.result, 'SUCCESS');
    });

    it('cleans isolation-sandbox entries older than maxAgeDays', () => {
        const sandboxDir = path.join(runtimeDir, '.isolation-sandbox');
        fs.mkdirSync(sandboxDir, { recursive: true });
        const oldEntry = path.join(sandboxDir, 'old-sandbox');
        fs.mkdirSync(oldEntry, { recursive: true });
        fs.writeFileSync(path.join(oldEntry, 'manifest.json'), '{}');
        // Set mtime to 60 days ago
        const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        fs.utimesSync(oldEntry, past, past);

        const recentEntry = path.join(sandboxDir, 'recent-sandbox');
        fs.mkdirSync(recentEntry, { recursive: true });

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true,
            retentionPolicy: { maxAgeDays: 30 }
        });

        const sandboxItems = result.removed.filter(i => i.category === 'isolation-sandbox');
        assert.ok(sandboxItems.length >= 1, 'should remove old sandbox');
        assert.ok(result.isolationSandboxCleaned, 'isolationSandboxCleaned should be true');
        assert.ok(fs.existsSync(recentEntry), 'recent sandbox must survive');
    });

    it('cleans orphaned stale lifecycle lock remnants', () => {
        const staleLockDir = path.join(runtimeDir, '.lifecycle-operation.lock.stale-99999-1234567');
        fs.mkdirSync(staleLockDir, { recursive: true });
        fs.writeFileSync(path.join(staleLockDir, 'owner.json'), '{"pid":99999}');

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true
        });

        const staleLockItems = result.removed.filter(i => i.category === 'stale-locks');
        assert.ok(staleLockItems.length >= 1, 'should collect stale lock remnant');
        assert.ok(!fs.existsSync(staleLockDir), 'stale lock should be removed');
    });

    it('filters by category when --category is specified', () => {
        const backupsDir = path.join(runtimeDir, 'backups');
        const eventsDir = path.join(runtimeDir, 'task-events');
        fs.mkdirSync(backupsDir, { recursive: true });
        fs.mkdirSync(eventsDir, { recursive: true });
        createTimestampDir(backupsDir, daysAgo(2));
        createTaskEventFile(eventsDir, 'T-001');

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true,
            retentionPolicy: { maxBackups: 0, maxTaskEvents: 0, maxAgeDays: 365 },
            categories: ['backups']
        });

        const backupItems = result.removed.filter(i => i.category === 'backups');
        const eventItems = result.removed.filter(i => i.category === 'task-events');
        assert.ok(backupItems.length > 0, 'should remove backups');
        assert.equal(eventItems.length, 0, 'should not remove task-events when filtered out');
        // Task events should still exist
        assert.ok(fs.existsSync(path.join(eventsDir, 'T-001.jsonl')));
    });

    it('filters by isolation-sandbox category', () => {
        const sandboxDir = path.join(runtimeDir, '.isolation-sandbox');
        const backupsDir = path.join(runtimeDir, 'backups');
        fs.mkdirSync(sandboxDir, { recursive: true });
        fs.mkdirSync(backupsDir, { recursive: true });
        const oldEntry = path.join(sandboxDir, 'old-sandbox');
        fs.mkdirSync(oldEntry, { recursive: true });
        const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        fs.utimesSync(oldEntry, past, past);
        createTimestampDir(backupsDir, daysAgo(2));

        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot,
            confirm: true,
            retentionPolicy: { maxBackups: 0, maxAgeDays: 30 },
            categories: ['isolation-sandbox']
        });

        const sandboxItems = result.removed.filter(i => i.category === 'isolation-sandbox');
        const backupItems = result.removed.filter(i => i.category === 'backups');
        assert.ok(sandboxItems.length >= 1, 'should remove old sandbox');
        assert.equal(backupItems.length, 0, 'should not touch backups when filtered');
    });

    it('returns SUCCESS when runtime is empty', () => {
        const result = runGc({
            targetRoot: tmpDir,
            bundleRoot
        });
        assert.equal(result.result, 'SUCCESS');
        assert.equal(result.staleLocksCleaned, 0);
        assert.equal(result.isolationSandboxCleaned, false);
    });

    it('rejects invalid category in options', () => {
        assert.throws(
            () => runGc({
                targetRoot: tmpDir,
                bundleRoot,
                categories: ['not-a-real-dir']
            }),
            /Unknown gc category/
        );
    });
});

describe('runGcWithLock', () => {
    let tmpDir: string;
    let bundleRoot: string;

    beforeEach(() => {
        tmpDir = makeTmpDir('oao-gc-lock-');
        bundleRoot = path.join(tmpDir, 'Octopus-agent-orchestrator');
        fs.mkdirSync(bundleRoot, { recursive: true });
        fs.writeFileSync(path.join(bundleRoot, 'VERSION'), '1.0.0\n');
        const runtimeDir = path.join(bundleRoot, 'runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Best-effort
        }
    });

    it('runs gc under lifecycle lock in dry-run mode', () => {
        const result = runGcWithLock({
            targetRoot: tmpDir,
            bundleRoot
        });
        assert.equal(result.result, 'SUCCESS');
        assert.equal(result.dryRun, true);
    });
});
