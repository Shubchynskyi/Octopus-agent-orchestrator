import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_BUNDLE_NAME } from '../core/constants';
import {
    removePathRecursive,
    validateTargetRoot,
    withLifecycleOperationLock
} from './common';

// ---------------------------------------------------------------------------
// Retention policy defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_MAX_BACKUPS = 20;
const DEFAULT_MAX_TASK_EVENTS = 50;
const DEFAULT_MAX_REVIEWS = 100;
const DEFAULT_MAX_UPDATE_REPORTS = 10;
const DEFAULT_MAX_UPDATE_ROLLBACKS = 5;
const DEFAULT_MAX_BUNDLE_BACKUPS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
    maxAgeDays: number;
    maxBackups: number;
    maxTaskEvents: number;
    maxReviews: number;
    maxUpdateReports: number;
    maxUpdateRollbacks: number;
    maxBundleBackups: number;
}

export interface CleanupItem {
    /** Absolute path that would be (or was) removed. */
    path: string;
    /** Category label, e.g. `backups`, `task-events`, `reviews`. */
    category: string;
    /** Reason for removal, e.g. `age`, `count`. */
    reason: string;
    /** Size in bytes (file) or aggregate for directory; 0 when stat unavailable. */
    sizeBytes: number;
}

export interface CleanupResult {
    targetRoot: string;
    dryRun: boolean;
    retentionPolicy: RetentionPolicy;
    removed: CleanupItem[];
    skipped: CleanupItem[];
    errors: Array<{ path: string; message: string }>;
    totalFreedBytes: number;
    result: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function directoryEntries(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    try {
        return fs.readdirSync(dirPath).sort();
    } catch {
        return [];
    }
}

function dirSizeBytes(dirPath: string): number {
    let total = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                total += dirSizeBytes(fullPath);
            } else {
                try {
                    total += fs.statSync(fullPath).size;
                } catch {
                    // Skip unreadable files
                }
            }
        }
    } catch {
        // Empty or inaccessible
    }
    return total;
}

function fileSizeBytes(filePath: string): number {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

/**
 * Parse a timestamp-named entry (e.g. `20260402-123132-106`) into a Date.
 * Returns null if the name does not match the expected format.
 */
function parseTimestampName(name: string): Date | null {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})$/.exec(name);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, ms] = match;
    return new Date(
        Number(year), Number(month) - 1, Number(day),
        Number(hour), Number(minute), Number(second), Number(ms)
    );
}

/**
 * Parse an update-rollback or update-report entry name (e.g. `update-20260329-004954`).
 */
function parseUpdateTimestampName(name: string): Date | null {
    const match = /^update-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
        Number(year), Number(month) - 1, Number(day),
        Number(hour), Number(minute), Number(second)
    );
}

// ---------------------------------------------------------------------------
// Category collectors
// ---------------------------------------------------------------------------

function collectTimestampedDirs(
    dirPath: string,
    category: string,
    maxCount: number,
    maxAgeDays: number,
    now: Date
): CleanupItem[] {
    const entries = directoryEntries(dirPath);
    const items: CleanupItem[] = [];
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    // Collect entries that are either too old or exceed count limit.
    // Entries are sorted chronologically (oldest first by naming convention).
    const excessCount = Math.max(0, entries.length - maxCount);

    for (let i = 0; i < entries.length; i++) {
        const entryName = entries[i];
        const entryPath = path.join(dirPath, entryName);
        const entryDate = parseTimestampName(entryName);

        let reason: string | null = null;
        if (i < excessCount) {
            reason = 'count';
        } else if (entryDate && entryDate < cutoff) {
            reason = 'age';
        }

        if (reason) {
            const sizeBytes = fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory()
                ? dirSizeBytes(entryPath)
                : fileSizeBytes(entryPath);
            items.push({ path: entryPath, category, reason, sizeBytes });
        }
    }

    return items;
}

function collectUpdateNamedDirs(
    dirPath: string,
    category: string,
    maxCount: number,
    maxAgeDays: number,
    now: Date
): CleanupItem[] {
    const entries = directoryEntries(dirPath);
    const items: CleanupItem[] = [];
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    const excessCount = Math.max(0, entries.length - maxCount);

    for (let i = 0; i < entries.length; i++) {
        const entryName = entries[i];
        const entryPath = path.join(dirPath, entryName);
        const entryDate = parseUpdateTimestampName(entryName);

        let reason: string | null = null;
        if (i < excessCount) {
            reason = 'count';
        } else if (entryDate && entryDate < cutoff) {
            reason = 'age';
        }

        if (reason) {
            const isDir = fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory();
            const sizeBytes = isDir ? dirSizeBytes(entryPath) : fileSizeBytes(entryPath);
            items.push({ path: entryPath, category, reason, sizeBytes });
        }
    }

    return items;
}

/**
 * Collect stale review artifacts for completed tasks, keeping a capped set.
 * We identify review artifacts by their `T-xxx-` prefix pattern and group
 * by task id. Oldest groups exceeding the cap are collected.
 */
function collectReviewArtifacts(
    reviewsDir: string,
    maxReviews: number,
    maxAgeDays: number,
    now: Date
): CleanupItem[] {
    if (!fs.existsSync(reviewsDir)) return [];
    const items: CleanupItem[] = [];
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    let entries: string[];
    try {
        entries = fs.readdirSync(reviewsDir).sort();
    } catch {
        return [];
    }

    // Group files by task-id prefix
    const taskGroups = new Map<string, string[]>();
    for (const entry of entries) {
        const match = /^(T-\d+)-/.exec(entry);
        if (match) {
            const taskId = match[1];
            const group = taskGroups.get(taskId) || [];
            group.push(entry);
            taskGroups.set(taskId, group);
        }
    }

    // Sort task ids by their numeric part (oldest = lowest number first)
    const sortedTaskIds = Array.from(taskGroups.keys()).sort((a, b) => {
        const numA = parseInt(a.replace('T-', ''), 10);
        const numB = parseInt(b.replace('T-', ''), 10);
        return numA - numB;
    });

    const excessTaskCount = Math.max(0, sortedTaskIds.length - maxReviews);

    for (let i = 0; i < excessTaskCount; i++) {
        const taskId = sortedTaskIds[i];
        const files = taskGroups.get(taskId) || [];
        for (const file of files) {
            const filePath = path.join(reviewsDir, file);
            items.push({
                path: filePath,
                category: 'reviews',
                reason: 'count',
                sizeBytes: fileSizeBytes(filePath)
            });
        }
    }

    // Also collect aged files from remaining tasks
    for (let i = excessTaskCount; i < sortedTaskIds.length; i++) {
        const taskId = sortedTaskIds[i];
        const files = taskGroups.get(taskId) || [];
        for (const file of files) {
            const filePath = path.join(reviewsDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.mtime < cutoff) {
                    items.push({
                        path: filePath,
                        category: 'reviews',
                        reason: 'age',
                        sizeBytes: stat.size
                    });
                }
            } catch {
                // Skip unreadable
            }
        }
    }

    return items;
}

/**
 * Collect task-event JSONL files exceeding the cap.
 * Sorted by task-id number; oldest excess are collected.
 * `all-tasks.jsonl` is never collected.
 */
function collectTaskEventFiles(
    eventsDir: string,
    maxTaskEvents: number,
    maxAgeDays: number,
    now: Date
): CleanupItem[] {
    if (!fs.existsSync(eventsDir)) return [];
    const items: CleanupItem[] = [];
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    let entries: string[];
    try {
        entries = fs.readdirSync(eventsDir).filter(e => e.endsWith('.jsonl') && e !== 'all-tasks.jsonl').sort();
    } catch {
        return [];
    }

    const excessCount = Math.max(0, entries.length - maxTaskEvents);

    for (let i = 0; i < entries.length; i++) {
        const entryName = entries[i];
        const entryPath = path.join(eventsDir, entryName);

        let reason: string | null = null;
        if (i < excessCount) {
            reason = 'count';
        } else {
            try {
                const stat = fs.statSync(entryPath);
                if (stat.mtime < cutoff) {
                    reason = 'age';
                }
            } catch {
                // Skip
            }
        }

        if (reason) {
            items.push({
                path: entryPath,
                category: 'task-events',
                reason,
                sizeBytes: fileSizeBytes(entryPath)
            });
        }
    }

    return items;
}

// ---------------------------------------------------------------------------
// Core cleanup
// ---------------------------------------------------------------------------

export function buildDefaultRetentionPolicy(): RetentionPolicy {
    return {
        maxAgeDays: DEFAULT_MAX_AGE_DAYS,
        maxBackups: DEFAULT_MAX_BACKUPS,
        maxTaskEvents: DEFAULT_MAX_TASK_EVENTS,
        maxReviews: DEFAULT_MAX_REVIEWS,
        maxUpdateReports: DEFAULT_MAX_UPDATE_REPORTS,
        maxUpdateRollbacks: DEFAULT_MAX_UPDATE_ROLLBACKS,
        maxBundleBackups: DEFAULT_MAX_BUNDLE_BACKUPS
    };
}

export interface CleanupOptions {
    targetRoot: string;
    bundleRoot: string;
    dryRun?: boolean;
    retentionPolicy?: Partial<RetentionPolicy>;
}

export function runCleanup(options: CleanupOptions): CleanupResult {
    const { targetRoot, bundleRoot, dryRun = false } = options;
    validateTargetRoot(targetRoot, bundleRoot);

    const policy: RetentionPolicy = {
        ...buildDefaultRetentionPolicy(),
        ...options.retentionPolicy
    };

    const runtimeDir = path.join(bundleRoot, 'runtime');
    const backupsDir = path.join(runtimeDir, 'backups');
    const taskEventsDir = path.join(runtimeDir, 'task-events');
    const reviewsDir = path.join(runtimeDir, 'reviews');
    const updateReportsDir = path.join(runtimeDir, 'update-reports');
    const updateRollbacksDir = path.join(runtimeDir, 'update-rollbacks');
    const bundleBackupsDir = path.join(runtimeDir, 'bundle-backups');

    const now = new Date();

    // Collect all candidates
    const candidates: CleanupItem[] = [
        ...collectTimestampedDirs(backupsDir, 'backups', policy.maxBackups, policy.maxAgeDays, now),
        ...collectTimestampedDirs(bundleBackupsDir, 'bundle-backups', policy.maxBundleBackups, policy.maxAgeDays, now),
        ...collectTaskEventFiles(taskEventsDir, policy.maxTaskEvents, policy.maxAgeDays, now),
        ...collectReviewArtifacts(reviewsDir, policy.maxReviews, policy.maxAgeDays, now),
        ...collectUpdateNamedDirs(updateRollbacksDir, 'update-rollbacks', policy.maxUpdateRollbacks, policy.maxAgeDays, now),
        ...collectUpdateNamedDirs(updateReportsDir, 'update-reports', policy.maxUpdateReports, policy.maxAgeDays, now)
    ];

    const removed: CleanupItem[] = [];
    const skipped: CleanupItem[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    let totalFreedBytes = 0;

    for (const item of candidates) {
        if (dryRun) {
            skipped.push(item);
            totalFreedBytes += item.sizeBytes;
            continue;
        }

        try {
            if (fs.existsSync(item.path)) {
                const stat = fs.statSync(item.path);
                if (stat.isDirectory()) {
                    removePathRecursive(item.path);
                } else {
                    fs.unlinkSync(item.path);
                }
            }
            removed.push(item);
            totalFreedBytes += item.sizeBytes;
        } catch (error: unknown) {
            errors.push({
                path: item.path,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return {
        targetRoot,
        dryRun,
        retentionPolicy: policy,
        removed,
        skipped,
        errors,
        totalFreedBytes,
        result: errors.length > 0 ? 'PARTIAL' : 'SUCCESS'
    };
}

/**
 * Run cleanup under a lifecycle operation lock.
 */
export function runCleanupWithLock(options: CleanupOptions): CleanupResult {
    return withLifecycleOperationLock(options.targetRoot, 'cleanup', () => runCleanup(options));
}
