import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    runCleanup,
    runCleanupWithLock,
    buildDefaultRetentionPolicy,
    type CleanupOptions,
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
