import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_BUNDLE_NAME } from '../core/constants';
import {
    LIFECYCLE_OPERATION_LOCK_DIR_NAME,
    removePathRecursive,
    validateTargetRoot,
    withLifecycleOperationLock
} from './common';
import {
    cleanupStaleTaskEventLocks,
    scanTaskEventLocks
} from '../gate-runtime/task-events';

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
// GC allowlist — only these runtime subdirectories are eligible for cleanup.
// Anything not on this list is never touched by gc/clean.
// ---------------------------------------------------------------------------

export const GC_ALLOWLIST: readonly string[] = Object.freeze([
    'backups',
    'bundle-backups',
    'task-events',
    'reviews',
    'update-rollbacks',
    'update-reports',
    'isolation-sandbox',
    'stale-locks'
]);

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

export interface GcResult extends CleanupResult {
    staleLocksCleaned: number;
    isolationSandboxCleaned: boolean;
    categories: Record<string, { count: number; bytes: number }>;
}

interface ProcessCleanupCandidatesResult {
    removed: CleanupItem[];
    skipped: CleanupItem[];
    errors: Array<{ path: string; message: string }>;
    totalFreedBytes: number;
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

function fileMtimeMs(filePath: string): number {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return 0;
    }
}

function maxGroupMtime(dir: string, files: string[]): number {
    let max = 0;
    for (const file of files) {
        const mtime = fileMtimeMs(path.join(dir, file));
        if (mtime > max) max = mtime;
    }
    return max;
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT';
}

function processCleanupCandidates(candidates: CleanupItem[], dryRun: boolean): ProcessCleanupCandidatesResult {
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

        if (!fs.existsSync(item.path)) {
            continue;
        }

        try {
            const stat = fs.statSync(item.path);
            if (stat.isDirectory()) {
                removePathRecursive(item.path);
            } else {
                fs.unlinkSync(item.path);
            }
            removed.push(item);
            totalFreedBytes += item.sizeBytes;
        } catch (error: unknown) {
            if (isNotFoundError(error)) {
                continue;
            }
            errors.push({
                path: item.path,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return {
        removed,
        skipped,
        errors,
        totalFreedBytes
    };
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
 * by task id. Groups are ranked by most-recent file mtime (real filesystem
 * freshness); the least recently modified groups exceeding the cap are
 * collected. Tie-breaks on task-id number for determinism.
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

    // Sort task groups by most-recent file mtime (least recently modified
    // first) so count-based eviction removes stale groups before active ones,
    // regardless of task-id numbering. Tie-break on task-id for determinism.
    const sortedTaskIds = Array.from(taskGroups.keys()).sort((a, b) => {
        const mtimeA = maxGroupMtime(reviewsDir, taskGroups.get(a) || []);
        const mtimeB = maxGroupMtime(reviewsDir, taskGroups.get(b) || []);
        if (mtimeA !== mtimeB) return mtimeA - mtimeB;
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
 * Sorted by file modification time (least recently modified first) so
 * count-based eviction targets stale files before active ones.
 * Tie-breaks on filename for determinism. `all-tasks.jsonl` is never collected.
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
        entries = fs.readdirSync(eventsDir).filter(e => e.endsWith('.jsonl') && e !== 'all-tasks.jsonl');
    } catch {
        return [];
    }

    // Sort by file mtime (least recently modified first) so count-based
    // eviction targets stale files before active ones. Tie-break on filename.
    entries.sort((a, b) => {
        const mtimeA = fileMtimeMs(path.join(eventsDir, a));
        const mtimeB = fileMtimeMs(path.join(eventsDir, b));
        if (mtimeA !== mtimeB) return mtimeA - mtimeB;
        return a.localeCompare(b);
    });

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
    const now = new Date();
    const candidates = collectStandardCandidates(runtimeDir, policy, now);
    const {
        removed,
        skipped,
        errors,
        totalFreedBytes
    } = processCleanupCandidates(candidates, dryRun);

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

// ---------------------------------------------------------------------------
// Isolation sandbox collector
// ---------------------------------------------------------------------------

function collectIsolationSandbox(
    runtimeDir: string,
    maxAgeDays: number,
    now: Date
): CleanupItem[] {
    const sandboxDir = path.join(runtimeDir, '.isolation-sandbox');
    if (!fs.existsSync(sandboxDir)) return [];

    const items: CleanupItem[] = [];
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    let entries: string[];
    try {
        entries = fs.readdirSync(sandboxDir);
    } catch {
        return [];
    }

    for (const entry of entries) {
        const entryPath = path.join(sandboxDir, entry);
        try {
            const stat = fs.statSync(entryPath);
            if (stat.mtime < cutoff) {
                const sizeBytes = stat.isDirectory()
                    ? dirSizeBytes(entryPath)
                    : stat.size;
                items.push({
                    path: entryPath,
                    category: 'isolation-sandbox',
                    reason: 'age',
                    sizeBytes
                });
            }
        } catch {
            // Skip unreadable entries
        }
    }

    return items;
}

// ---------------------------------------------------------------------------
// Stale lifecycle lock collector
// ---------------------------------------------------------------------------

function collectStaleLifecycleLock(
    runtimeDir: string
): CleanupItem[] {
    const items: CleanupItem[] = [];
    if (!fs.existsSync(runtimeDir)) return items;

    // Only collect .stale-* remnants left by crash recovery.
    // Live lock dirs are never collected — the lifecycle lock subsystem
    // handles them. We only clean orphaned rename targets.
    let siblings: string[];
    try {
        siblings = fs.readdirSync(runtimeDir);
    } catch {
        return items;
    }

    const staleLockPattern = new RegExp(
        '^' + LIFECYCLE_OPERATION_LOCK_DIR_NAME.replace(/\./g, '\\.') + '\\.stale-'
    );

    for (const sibling of siblings) {
        if (!staleLockPattern.test(sibling)) continue;
        const stalePath = path.join(runtimeDir, sibling);
        try {
            const stat = fs.statSync(stalePath);
            const sizeBytes = stat.isDirectory()
                ? dirSizeBytes(stalePath)
                : stat.size;
            items.push({
                path: stalePath,
                category: 'stale-locks',
                reason: 'orphaned',
                sizeBytes
            });
        } catch {
            // Skip unreadable
        }
    }

    return items;
}

function collectStaleTaskEventLockCandidates(bundleRoot: string): CleanupItem[] {
    const taskEventsDir = path.join(bundleRoot, 'runtime', 'task-events');
    const inspection = scanTaskEventLocks(bundleRoot);

    return inspection.locks
        .filter((lock) => lock.status === 'STALE')
        .map((lock) => {
            const lockPath = path.join(taskEventsDir, lock.lock_name);
            let sizeBytes = 0;
            try {
                const stat = fs.statSync(lockPath);
                sizeBytes = stat.isDirectory() ? dirSizeBytes(lockPath) : stat.size;
            } catch {
                // Leave at zero when the candidate disappears or cannot be read.
            }
            return {
                path: lockPath,
                category: 'task-events',
                reason: 'stale-lock',
                sizeBytes
            };
        });
}

// ---------------------------------------------------------------------------
// GC options and entry point — dry-run by default, allowlist-safe
// ---------------------------------------------------------------------------

export interface GcOptions {
    targetRoot: string;
    bundleRoot: string;
    /** When true, actually delete files. Default false (dry-run). */
    confirm?: boolean;
    retentionPolicy?: Partial<RetentionPolicy>;
    /** Restrict gc to specific categories from GC_ALLOWLIST. */
    categories?: string[];
}

/**
 * Build per-category summary from a list of cleanup items.
 */
function buildCategorySummary(items: CleanupItem[]): Record<string, { count: number; bytes: number }> {
    const summary: Record<string, { count: number; bytes: number }> = {};
    for (const item of items) {
        const entry = summary[item.category] || { count: 0, bytes: 0 };
        entry.count += 1;
        entry.bytes += item.sizeBytes;
        summary[item.category] = entry;
    }
    return summary;
}

/**
 * Validate requested gc categories against the allowlist.
 * Throws if any category is not in GC_ALLOWLIST.
 */
export function validateGcCategories(categories: string[]): void {
    for (const cat of categories) {
        if (!GC_ALLOWLIST.includes(cat)) {
            throw new Error(
                `Unknown gc category '${cat}'. Allowed: ${GC_ALLOWLIST.join(', ')}`
            );
        }
    }
}

/**
 * Run gc with dry-run by default. This extends `runCleanup` with:
 * - dry-run default (pass `confirm: true` to delete)
 * - isolation-sandbox cleanup (age-based)
 * - stale lifecycle lock cleanup (orphaned .stale-* remnants)
 * - stale task-event lock cleanup (delegated to task-events subsystem)
 * - per-category summary
 * - allowlist enforcement
 */
export function runGc(options: GcOptions): GcResult {
    const { targetRoot, bundleRoot, confirm = false } = options;
    validateTargetRoot(targetRoot, bundleRoot);

    if (options.categories && options.categories.length > 0) {
        validateGcCategories(options.categories);
    }

    const policy: RetentionPolicy = {
        ...buildDefaultRetentionPolicy(),
        ...options.retentionPolicy
    };

    const dryRun = !confirm;
    const filterCategories = options.categories && options.categories.length > 0
        ? new Set(options.categories)
        : null;

    const runtimeDir = path.join(bundleRoot, 'runtime');
    const now = new Date();

    // Standard cleanup candidates
    const standardCandidates = collectStandardCandidates(runtimeDir, policy, now);

    // New gc-extended categories
    const isolationItems = collectIsolationSandbox(runtimeDir, policy.maxAgeDays, now);
    const staleLockItems = collectStaleLifecycleLock(runtimeDir);
    const shouldCleanTaskEventLocks = !filterCategories || filterCategories.has('task-events');
    const taskEventLockCandidates = shouldCleanTaskEventLocks
        ? collectStaleTaskEventLockCandidates(bundleRoot)
        : [];

    let allCandidates = [
        ...standardCandidates,
        ...isolationItems,
        ...staleLockItems
    ];

    // Apply category filter
    if (filterCategories) {
        allCandidates = allCandidates.filter(item => filterCategories.has(item.category));
    }

    const {
        removed,
        skipped,
        errors,
        totalFreedBytes: standardFreedBytes
    } = processCleanupCandidates(allCandidates, dryRun);
    let totalFreedBytes = standardFreedBytes;

    // Task-event stale lock cleanup (delegated to subsystem)
    let staleLocksCleaned = 0;
    if (shouldCleanTaskEventLocks) {
        try {
            const lockResult = cleanupStaleTaskEventLocks(bundleRoot, { dryRun });
            const taskEventLockItems = new Map(
                taskEventLockCandidates.map((item) => [path.basename(item.path), item])
            );
            const effectiveTaskEventLocks = (dryRun
                ? lockResult.removable_stale_locks
                : lockResult.removed_locks)
                .map((lockName) => taskEventLockItems.get(lockName))
                .filter((item): item is CleanupItem => item != null);

            staleLocksCleaned = dryRun
                ? lockResult.removable_stale_locks.length
                : lockResult.removed_locks.length;
            totalFreedBytes += effectiveTaskEventLocks.reduce((sum, item) => sum + item.sizeBytes, 0);
            if (dryRun) {
                skipped.push(...effectiveTaskEventLocks);
            } else {
                removed.push(...effectiveTaskEventLocks);
            }
        } catch {
            // Best-effort; task-event lock subsystem errors are non-fatal for gc
        }
    }

    const actionItems = dryRun ? skipped : removed;
    const isolationSandboxCleaned = actionItems.some(
        item => item.category === 'isolation-sandbox'
    );

    return {
        targetRoot,
        dryRun,
        retentionPolicy: policy,
        removed,
        skipped,
        errors,
        totalFreedBytes,
        result: errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
        staleLocksCleaned,
        isolationSandboxCleaned,
        categories: buildCategorySummary(actionItems)
    };
}

/**
 * Run gc under a lifecycle operation lock.
 */
export function runGcWithLock(options: GcOptions): GcResult {
    return withLifecycleOperationLock(options.targetRoot, 'gc', () => runGc(options));
}

// ---------------------------------------------------------------------------
// Internal: shared candidate collection for standard retention categories
// ---------------------------------------------------------------------------

function collectStandardCandidates(
    runtimeDir: string,
    policy: RetentionPolicy,
    now: Date
): CleanupItem[] {
    const backupsDir = path.join(runtimeDir, 'backups');
    const taskEventsDir = path.join(runtimeDir, 'task-events');
    const reviewsDir = path.join(runtimeDir, 'reviews');
    const updateReportsDir = path.join(runtimeDir, 'update-reports');
    const updateRollbacksDir = path.join(runtimeDir, 'update-rollbacks');
    const bundleBackupsDir = path.join(runtimeDir, 'bundle-backups');

    return [
        ...collectTimestampedDirs(backupsDir, 'backups', policy.maxBackups, policy.maxAgeDays, now),
        ...collectTimestampedDirs(bundleBackupsDir, 'bundle-backups', policy.maxBundleBackups, policy.maxAgeDays, now),
        ...collectTaskEventFiles(taskEventsDir, policy.maxTaskEvents, policy.maxAgeDays, now),
        ...collectReviewArtifacts(reviewsDir, policy.maxReviews, policy.maxAgeDays, now),
        ...collectUpdateNamedDirs(updateRollbacksDir, 'update-rollbacks', policy.maxUpdateRollbacks, policy.maxAgeDays, now),
        ...collectUpdateNamedDirs(updateReportsDir, 'update-reports', policy.maxUpdateReports, policy.maxAgeDays, now)
    ];
}
