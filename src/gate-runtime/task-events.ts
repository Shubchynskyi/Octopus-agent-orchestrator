import { stringSha256 } from './hash';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const MAX_LOCK_RETRIES = 500;
const LOCK_CONTENTION_WARN_THRESHOLD = 10;

// Grace period before treating a lock with missing/corrupt metadata as stale.
// A freshly-created lock directory may lack owner.json for a brief instant
// between mkdirSync and writeFileSync; only reclaim it after this threshold.
const LOCK_METADATA_GRACE_MS = 2000;

interface LockOptions {
    timeoutMs?: unknown;
    retryMs?: unknown;
    staleMs?: unknown;
}

interface LockHandle {
    lockPath: string;
}

interface LockOwnerMetadata {
    pid: number | null;
    hostname: string | null;
    created_at_utc: string | null;
    metadata_status: 'missing' | 'invalid_json' | 'invalid_shape' | 'ok';
}

interface LockInspectionResult {
    exists: boolean;
    ageMs: number | null;
    metadata: LockOwnerMetadata;
    ownerAlive: boolean | null;
    staleReason: 'owner_dead' | 'age_exceeded' | null;
}

interface TaskEventAppendState {
    matching_events: number;
    parse_errors: number;
    last_integrity_sequence: number | null;
    last_event_sha256: string | null;
}

interface InspectTaskEventResult {
    source_path: string;
    status: string;
    events_scanned: number;
    matching_events: number;
    parse_errors: number;
    task_id_mismatches: number;
    legacy_event_count: number;
    integrity_event_count: number;
    first_integrity_sequence: number | null;
    last_integrity_sequence: number | null;
    duplicate_event_hashes: string[];
    violations: string[];
}

interface AppendTaskEventOptions {
    actor?: string;
    passThru?: boolean;
    eventsRoot?: string;
    lockTimeoutMs?: unknown;
    lockRetryMs?: unknown;
    lockStaleMs?: unknown;
    preWriteDelayMs?: unknown;
}

interface TaskEventIntegrity {
    schema_version: number;
    task_sequence: number;
    prev_event_sha256: string | null;
    event_sha256?: string;
}

interface TaskEvent {
    timestamp_utc: string;
    task_id: string;
    event_type: string;
    outcome: string;
    actor: string;
    message: string;
    details: unknown;
    integrity?: TaskEventIntegrity;
}

interface AppendTaskEventResult {
    task_event_log_path: string;
    all_tasks_log_path: string;
    integrity: TaskEventIntegrity | null;
    warnings: string[];
    lock_telemetry?: {
        task_lock_retries: number;
        task_lock_elapsed_ms: number;
        aggregate_lock_retries: number;
        aggregate_lock_elapsed_ms: number;
    };
}

export type TaskEventAppendResult = AppendTaskEventResult;
export type TaskEventLockStatus = 'ACTIVE' | 'STALE';

export interface TaskEventLockHealth {
    lock_name: string;
    lock_path: string;
    scope: 'aggregate' | 'task';
    task_id: string | null;
    status: TaskEventLockStatus;
    age_ms: number | null;
    owner_pid: number | null;
    owner_hostname: string | null;
    owner_created_at_utc: string | null;
    owner_alive: boolean | null;
    owner_metadata_status: LockOwnerMetadata['metadata_status'];
    stale_reason: LockInspectionResult['staleReason'];
    remediation: string;
}

export interface TaskEventLockScanResult {
    lock_root: string;
    subsystem_scope_note: string;
    locks: TaskEventLockHealth[];
    active_count: number;
    stale_count: number;
}

export interface TaskEventLockCleanupResult {
    lock_root: string;
    dry_run: boolean;
    removed_locks: string[];
    removable_stale_locks: string[];
    retained_live_locks: string[];
    failed_locks: string[];
    warnings: string[];
}

function toPositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMsAsync(milliseconds: number): Promise<void> {
    if (!milliseconds || milliseconds <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function writeLockMetadata(lockPath: string): void {
    const metadataPath = path.join(lockPath, 'owner.json');
    const payload = {
        pid: process.pid,
        hostname: os.hostname(),
        created_at_utc: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function readLockMetadata(lockPath: string): LockOwnerMetadata {
    const metadataPath = path.join(lockPath, 'owner.json');
    let rawContent = '';
    try {
        const stats = fs.statSync(metadataPath);
        if (!stats.isFile()) {
            return {
                pid: null,
                hostname: null,
                created_at_utc: null,
                metadata_status: 'missing'
            };
        }
        rawContent = fs.readFileSync(metadataPath, 'utf8');
    } catch (error: unknown) {
        const errorCode = error != null && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
        if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR' || errorCode === 'EISDIR') {
            return {
                pid: null,
                hostname: null,
                created_at_utc: null,
                metadata_status: 'missing'
            };
        }
        return {
            pid: null,
            hostname: null,
            created_at_utc: null,
            metadata_status: 'missing'
        };
    }

    try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        const pidValue = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0
            ? parsed.pid
            : null;
        const hostnameValue = typeof parsed.hostname === 'string' && parsed.hostname.trim()
            ? parsed.hostname.trim()
            : null;
        const createdAtValue = typeof parsed.created_at_utc === 'string' && parsed.created_at_utc.trim()
            ? parsed.created_at_utc.trim()
            : null;
        const metadataStatus = pidValue || hostnameValue || createdAtValue
            ? 'ok'
            : 'invalid_shape';
        return {
            pid: pidValue,
            hostname: hostnameValue,
            created_at_utc: createdAtValue,
            metadata_status: metadataStatus
        };
    } catch {
        return {
            pid: null,
            hostname: null,
            created_at_utc: null,
            metadata_status: 'invalid_json'
        };
    }
}

function isProcessLikelyAlive(pid: number | null): boolean | null {
    if (!pid || !Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        const errorCode = error != null && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
        if (errorCode === 'EPERM') {
            return true;
        }
        if (errorCode === 'ESRCH') {
            return false;
        }
        return null;
    }
}

function normalizeHostname(hostname: string | null): string | null {
    const trimmed = typeof hostname === 'string' ? hostname.trim() : '';
    return trimmed ? trimmed.toLowerCase() : null;
}

function isCurrentHostOwner(hostname: string | null): boolean | null {
    const ownerHost = normalizeHostname(hostname);
    if (!ownerHost) {
        return null;
    }
    return ownerHost === normalizeHostname(os.hostname());
}

function removeLockPath(lockPath: string): void {
    fs.rmSync(lockPath, { recursive: true, force: true });
}

function inspectLock(lockPath: string, staleMs: number): LockInspectionResult {
    const metadata = readLockMetadata(lockPath);
    let ageMs: number | null = null;
    try {
        const stats = fs.statSync(lockPath);
        ageMs = Math.max(0, Date.now() - stats.mtimeMs);
    } catch {
        return {
            exists: false,
            ageMs: null,
            metadata,
            ownerAlive: null,
            staleReason: null
        };
    }

    const ownerHostMatchesCurrent = isCurrentHostOwner(metadata.hostname);
    const ownerAlive = ownerHostMatchesCurrent === false
        ? null
        : isProcessLikelyAlive(metadata.pid);
    if (ownerAlive === false) {
        return {
            exists: true,
            ageMs,
            metadata,
            ownerAlive,
            staleReason: 'owner_dead'
        };
    }

    // Lock directory exists but owner metadata is missing, corrupt, or lacks
    // a usable PID for liveness verification. Only reclaim after a grace period
    // so a just-created lock whose metadata write is in flight is not prematurely
    // removed by a concurrent acquirer. Checking pid===null covers all cases:
    // missing owner.json, invalid JSON, invalid shape, and partial-but-parseable
    // metadata that lacks the PID field.
    if (metadata.pid === null
        && ownerHostMatchesCurrent !== false
        && ageMs !== null && ageMs >= LOCK_METADATA_GRACE_MS) {
        return {
            exists: true,
            ageMs,
            metadata,
            ownerAlive: null,
            staleReason: 'owner_dead'
        };
    }

    if (staleMs > 0
        && ageMs >= staleMs
        && ownerAlive !== true
        && ownerHostMatchesCurrent !== false) {
        return {
            exists: true,
            ageMs,
            metadata,
            ownerAlive,
            staleReason: 'age_exceeded'
        };
    }

    return {
        exists: true,
        ageMs,
        metadata,
        ownerAlive,
        staleReason: null
    };
}

function formatLockDiagnostic(lockPath: string, inspection: LockInspectionResult, timeoutMs: number, waitedMs: number): string {
    const ageText = typeof inspection.ageMs === 'number' ? `${inspection.ageMs}ms` : 'unknown';
    const ownerPidText = inspection.metadata.pid !== null ? String(inspection.metadata.pid) : 'unknown';
    const ownerAliveText = inspection.ownerAlive === null ? 'unknown' : (inspection.ownerAlive ? 'yes' : 'no');
    const ownerHostText = inspection.metadata.hostname || 'unknown';
    const createdAtText = inspection.metadata.created_at_utc || 'unknown';
    const staleReasonText = inspection.staleReason || 'none';
    return [
        `Timed out acquiring file lock: ${lockPath}`,
        `waited_ms=${waitedMs}`,
        `timeout_ms=${timeoutMs}`,
        `lock_age_ms=${ageText}`,
        `owner_pid=${ownerPidText}`,
        `owner_alive=${ownerAliveText}`,
        `owner_hostname=${ownerHostText}`,
        `owner_created_at_utc=${createdAtText}`,
        `owner_metadata_status=${inspection.metadata.metadata_status}`,
        `stale_reason=${staleReasonText}`
    ].join('; ');
}

function tryRemoveStaleLock(lockPath: string, staleMs: number): { removed: boolean; inspection: LockInspectionResult } {
    const inspection = inspectLock(lockPath, staleMs);
    if (!inspection.exists || !inspection.staleReason) {
        return { removed: false, inspection };
    }

    // Atomically rename the stale lock to avoid a TOCTOU race where a
    // concurrent recoverer could remove a freshly re-acquired valid lock.
    // Only the process that succeeds at the rename proceeds with cleanup.
    const tempPath = lockPath + '.stale-' + process.pid + '-' + Date.now();
    try {
        fs.renameSync(lockPath, tempPath);
    } catch {
        return { removed: false, inspection };
    }

    try {
        removeLockPath(tempPath);
    } catch {
        // Best-effort cleanup of the renamed stale directory.
    }

    return { removed: true, inspection };
}

interface AcquireLockTelemetry {
    retries: number;
    elapsedMs: number;
}

export function acquireFilesystemLock(lockPath: string, options: LockOptions = {}): { handle: LockHandle; telemetry: AcquireLockTelemetry } {
    const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    const staleMs = toPositiveInteger(options.staleMs, DEFAULT_LOCK_STALE_MS);
    const startedAt = Date.now();
    let lastInspection: LockInspectionResult = inspectLock(lockPath, staleMs);

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            try {
                writeLockMetadata(lockPath);
            } catch (metadataError: unknown) {
                // Remove the lock directory so a failed metadata write does
                // not leave an orphaned lock without ownership information.
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw metadataError;
            }
            const elapsedMs = Date.now() - startedAt;
            return { handle: { lockPath }, telemetry: { retries: 0, elapsedMs } };
        } catch (error: unknown) {
            const errCode = error != null && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined;
            if (errCode !== 'EEXIST') {
                throw error;
            }

            const staleAttempt = tryRemoveStaleLock(lockPath, staleMs);
            lastInspection = staleAttempt.inspection;
            if (staleAttempt.removed) {
                continue;
            }

            const waitedMs = Date.now() - startedAt;
            throw new Error(
                formatLockDiagnostic(lockPath, lastInspection, timeoutMs, waitedMs)
                + '; retries=0; wait_strategy=immediate_fail'
            );
        }
    }
}

export async function acquireFilesystemLockAsync(lockPath: string, options: LockOptions = {}): Promise<{ handle: LockHandle; telemetry: AcquireLockTelemetry }> {
    const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    const retryMs = toPositiveInteger(options.retryMs, DEFAULT_LOCK_RETRY_MS);
    const staleMs = toPositiveInteger(options.staleMs, DEFAULT_LOCK_STALE_MS);
    const startedAt = Date.now();
    let lastInspection: LockInspectionResult = inspectLock(lockPath, staleMs);
    let retries = 0;
    let contentionWarned = false;

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            try {
                writeLockMetadata(lockPath);
            } catch (metadataError: unknown) {
                // Remove the lock directory so a failed metadata write does
                // not leave an orphaned lock without ownership information.
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw metadataError;
            }
            const elapsedMs = Date.now() - startedAt;
            return { handle: { lockPath }, telemetry: { retries, elapsedMs } };
        } catch (error: unknown) {
            const errCode = error != null && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined;
            if (errCode !== 'EEXIST') {
                throw error;
            }

            const staleAttempt = tryRemoveStaleLock(lockPath, staleMs);
            lastInspection = staleAttempt.inspection;
            if (staleAttempt.removed) {
                continue;
            }

            retries += 1;

            if (!contentionWarned && retries >= LOCK_CONTENTION_WARN_THRESHOLD) {
                contentionWarned = true;
                const elapsedMs = Date.now() - startedAt;
                process.stderr.write(
                    `WARNING: lock contention on ${lockPath} (retries=${retries}, elapsed_ms=${elapsedMs})\n`
                );
            }

            if (retries >= MAX_LOCK_RETRIES) {
                const elapsedMs = Date.now() - startedAt;
                throw new Error(
                    formatLockDiagnostic(lockPath, lastInspection, timeoutMs, elapsedMs)
                    + `; retries=${retries}; max_retries=${MAX_LOCK_RETRIES}`
                );
            }

            const waitedMs = Date.now() - startedAt;
            if (waitedMs >= timeoutMs) {
                throw new Error(
                    formatLockDiagnostic(lockPath, lastInspection, timeoutMs, waitedMs)
                    + `; retries=${retries}`
                );
            }

            await sleepMsAsync(retryMs);
        }
    }
}

export function releaseFilesystemLock(lockHandle: LockHandle | null): void {
    if (!lockHandle || !lockHandle.lockPath) {
        return;
    }
    removeLockPath(lockHandle.lockPath);
}

function classifyLockName(entryName: string): { scope: 'aggregate' | 'task'; taskId: string | null } | null {
    if (entryName === '.all-tasks.lock') {
        return { scope: 'aggregate', taskId: null };
    }
    const taskMatch = entryName.match(/^\.(.+)\.lock$/);
    if (!taskMatch || !taskMatch[1]) {
        return null;
    }
    return {
        scope: 'task',
        taskId: taskMatch[1]
    };
}

function buildLockRemediation(entryName: string, inspection: LockInspectionResult): string {
    if (inspection.staleReason) {
        return [
            `Run 'octopus doctor --target-root "." --cleanup-stale-locks --dry-run' first, then rerun without '--dry-run' if the candidate list looks correct.`,
            'Only runtime/task-events/*.lock is cleaned automatically; runtime/reviews/ is not part of the lock subsystem.'
        ].join(' ');
    }

    const ownerPidText = inspection.metadata.pid !== null ? String(inspection.metadata.pid) : 'unknown';
    return [
        `Wait for the owning process to release '${entryName}' or terminate PID ${ownerPidText} safely if it is hung.`,
        'Do not delete live locks manually. runtime/reviews/ is not part of the lock subsystem.'
    ].join(' ');
}

function buildTaskEventLockHealth(lockRoot: string, entryName: string, inspection: LockInspectionResult): TaskEventLockHealth | null {
    const parsed = classifyLockName(entryName);
    if (!parsed) {
        return null;
    }
    return {
        lock_name: entryName,
        lock_path: path.join(lockRoot, entryName).replace(/\\/g, '/'),
        scope: parsed.scope,
        task_id: parsed.taskId,
        status: inspection.staleReason ? 'STALE' : 'ACTIVE',
        age_ms: inspection.ageMs,
        owner_pid: inspection.metadata.pid,
        owner_hostname: inspection.metadata.hostname,
        owner_created_at_utc: inspection.metadata.created_at_utc,
        owner_alive: inspection.ownerAlive,
        owner_metadata_status: inspection.metadata.metadata_status,
        stale_reason: inspection.staleReason,
        remediation: buildLockRemediation(entryName, inspection)
    };
}

function getTaskEventsRoot(orchestratorRoot: string): string {
    return path.join(orchestratorRoot, 'runtime', 'task-events');
}

function listTaskEventLockEntries(lockRoot: string): string[] {
    if (!fs.existsSync(lockRoot) || !fs.statSync(lockRoot).isDirectory()) {
        return [];
    }
    return fs.readdirSync(lockRoot)
        .filter(function (entryName: string) {
            if (!entryName.startsWith('.') || !entryName.endsWith('.lock')) {
                return false;
            }
            const fullPath = path.join(lockRoot, entryName);
            try {
                return fs.statSync(fullPath).isDirectory();
            } catch {
                return false;
            }
        })
        .sort();
}

export function scanTaskEventLocks(orchestratorRoot: string, options: LockOptions = {}): TaskEventLockScanResult {
    const staleMs = toPositiveInteger(options.staleMs, DEFAULT_LOCK_STALE_MS);
    const lockRoot = getTaskEventsRoot(orchestratorRoot);
    const locks: TaskEventLockHealth[] = [];

    for (const entryName of listTaskEventLockEntries(lockRoot)) {
        const inspection = inspectLock(path.join(lockRoot, entryName), staleMs);
        if (!inspection.exists) {
            continue;
        }
        const lockHealth = buildTaskEventLockHealth(lockRoot, entryName, inspection);
        if (lockHealth) {
            locks.push(lockHealth);
        }
    }

    return {
        lock_root: lockRoot.replace(/\\/g, '/'),
        subsystem_scope_note: 'Only runtime/task-events/*.lock participates in the task-event lock subsystem. runtime/reviews/ is never cleaned by these diagnostics.',
        locks,
        active_count: locks.filter((lock) => lock.status === 'ACTIVE').length,
        stale_count: locks.filter((lock) => lock.status === 'STALE').length
    };
}

export function cleanupStaleTaskEventLocks(
    orchestratorRoot: string,
    options: LockOptions & { dryRun?: boolean } = {}
): TaskEventLockCleanupResult {
    const dryRun = options.dryRun === true;
    const lockRoot = getTaskEventsRoot(orchestratorRoot);
    const removableStaleLocks: string[] = [];
    const retainedLiveLocks: string[] = [];
    const removedLocks: string[] = [];
    const failedLocks: string[] = [];
    const warnings: string[] = [];

    const inspection = scanTaskEventLocks(orchestratorRoot, options);
    for (const lock of inspection.locks) {
        if (lock.status === 'STALE') {
            removableStaleLocks.push(lock.lock_name);
            if (!dryRun) {
                try {
                    removeLockPath(path.join(lockRoot, lock.lock_name));
                    removedLocks.push(lock.lock_name);
                } catch (error: unknown) {
                    failedLocks.push(lock.lock_name);
                    warnings.push(`Failed to remove stale lock '${lock.lock_name}': ${getErrorMessage(error)}`);
                }
            }
        } else {
            retainedLiveLocks.push(lock.lock_name);
        }
    }

    return {
        lock_root: lockRoot.replace(/\\/g, '/'),
        dry_run: dryRun,
        removed_locks: removedLocks,
        removable_stale_locks: removableStaleLocks,
        retained_live_locks: retainedLiveLocks,
        failed_locks: failedLocks,
        warnings
    };
}

function withFilesystemLock<T>(lockPath: string, options: LockOptions, callback: () => T): { result: T; telemetry: AcquireLockTelemetry } {
    const { handle, telemetry } = acquireFilesystemLock(lockPath, options);
    try {
        return { result: callback(), telemetry };
    } finally {
        releaseFilesystemLock(handle);
    }
}

async function withFilesystemLockAsync<T>(lockPath: string, options: LockOptions, callback: () => Promise<T> | T): Promise<{ result: T; telemetry: AcquireLockTelemetry }> {
    const { handle, telemetry } = await acquireFilesystemLockAsync(lockPath, options);
    try {
        return { result: await callback(), telemetry };
    } finally {
        releaseFilesystemLock(handle);
    }
}

function toTrimmedString(value: unknown): string {
    return value ? String(value).trim() : '';
}

function toTrimmedLowerCaseString(value: unknown): string {
    return value ? String(value).trim().toLowerCase() : '';
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Normalize a value for integrity hashing.
 * - Dicts: sorted keys, recursively normalized
 * - Arrays: recursively normalized
 * - Dates: ISO 8601 UTC
 * - Paths (strings with backslashes): forward-slashed
 * - Everything else: pass-through
 *
 * Matches Python _normalize_integrity_value semantics.
 */
export function normalizeIntegrityValue(value: unknown): unknown {
    if (value == null) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(normalizeIntegrityValue);
    }

    if (typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        for (const key of keys) {
            sorted[key] = normalizeIntegrityValue(obj[key]);
        }
        return sorted;
    }

    if (typeof value === 'string' && value.includes('\\')) {
        return value.replace(/\\/g, '/');
    }

    return value;
}

/**
 * Compute the SHA-256 integrity hash of a task event object.
 * Strips event_sha256 from the integrity sub-object before hashing
 * to allow self-referential integrity verification.
 *
 * Matches Python build_event_integrity_hash exactly.
 */
export function buildEventIntegrityHash(eventObj: Record<string, unknown>): string | null {
    const normalizedEvent: Record<string, unknown> = Object.assign({}, eventObj);
    const integrity = normalizedEvent.integrity;
    if (integrity && typeof integrity === 'object') {
        const normalizedIntegrity: Record<string, unknown> = Object.assign({}, integrity as Record<string, unknown>);
        delete normalizedIntegrity.event_sha256;
        normalizedEvent.integrity = normalizedIntegrity;
    }

    const canonicalPayload = JSON.stringify(normalizeIntegrityValue(normalizedEvent));
    return stringSha256(canonicalPayload);
}

/**
 * Parse a task ID, validating format. Matches Python assert_valid_task_id.
 */
export function assertValidTaskId(value: unknown): string {
    if (!value || !String(value).trim()) {
        throw new Error('TaskId must not be empty.');
    }
    const taskId = String(value).trim();
    if (taskId.length > 128) {
        throw new Error('TaskId must be 128 characters or fewer.');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(taskId)) {
        throw new Error(`TaskId '${taskId}' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$`);
    }
    return taskId;
}

/**
 * Read the last non-empty line from a JSONL file (fast path).
 * Matches Python _read_last_non_empty_line.
 */
function readLastNonEmptyLine(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim()) {
                return lines[i];
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Fast-path: read append state from last event line.
 * Matches Python _read_task_event_append_state_fast.
 */
export function readTaskEventAppendStateFast(taskFilePath: string, taskId: string): TaskEventAppendState | null {
    const rawLine = readLastNonEmptyLine(taskFilePath);
    if (!rawLine || !rawLine.trim()) {
        return null;
    }

    let event: Record<string, unknown>;
    try {
        event = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
        return null;
    }

    const eventTaskId = toTrimmedString(event.task_id);
    if (eventTaskId && eventTaskId !== taskId) {
        return null;
    }

    const integrity = event.integrity;
    if (!integrity || typeof integrity !== 'object') {
        return null;
    }

    const integrityRecord = integrity as Record<string, unknown>;
    const sequence = integrityRecord.task_sequence;
    const eventSha256 = toTrimmedLowerCaseString(integrityRecord.event_sha256);
    if (typeof sequence !== 'number' || sequence <= 0 || !eventSha256) {
        return null;
    }

    return {
        matching_events: sequence,
        parse_errors: 0,
        last_integrity_sequence: sequence,
        last_event_sha256: eventSha256
    };
}

/**
 * Full-scan: read append state by parsing all events.
 * Matches Python _read_task_event_append_state.
 */
export function readTaskEventAppendState(taskFilePath: string, taskId: string): TaskEventAppendState {
    const state: TaskEventAppendState = {
        matching_events: 0,
        parse_errors: 0,
        last_integrity_sequence: null,
        last_event_sha256: null
    };

    try {
        if (!fs.existsSync(taskFilePath) || !fs.statSync(taskFilePath).isFile()) {
            return state;
        }
    } catch {
        return state;
    }

    const fastState = readTaskEventAppendStateFast(taskFilePath, taskId);
    if (fastState != null) {
        return fastState;
    }

    let content: string;
    try {
        content = fs.readFileSync(taskFilePath, 'utf8');
    } catch {
        return state;
    }

    for (const rawLine of content.split('\n')) {
        if (!rawLine.trim()) {
            continue;
        }

        let event: Record<string, unknown>;
        try {
            event = JSON.parse(rawLine) as Record<string, unknown>;
        } catch {
            state.parse_errors++;
            continue;
        }

        const eventTaskId = toTrimmedString(event.task_id);
        if (eventTaskId && eventTaskId !== taskId) {
            continue;
        }

        state.matching_events++;
        const integrity = event.integrity;
        if (!integrity || typeof integrity !== 'object') {
            continue;
        }

        const integrityRecord = integrity as Record<string, unknown>;
        const sequence = integrityRecord.task_sequence;
        const eventSha256 = toTrimmedLowerCaseString(integrityRecord.event_sha256);
        if (typeof sequence === 'number' && sequence > 0 && eventSha256) {
            state.last_integrity_sequence = sequence;
            state.last_event_sha256 = eventSha256;
        }
    }

    return state;
}

/**
 * Inspect a task event file for integrity violations.
 * Matches Python inspect_task_event_file exactly.
 */
export function inspectTaskEventFile(taskEventFile: string, taskId: string): InspectTaskEventResult {

    const result: InspectTaskEventResult = {
        source_path: String(taskEventFile).replace(/\\/g, '/'),
        status: 'UNKNOWN',
        events_scanned: 0,
        matching_events: 0,
        parse_errors: 0,
        task_id_mismatches: 0,
        legacy_event_count: 0,
        integrity_event_count: 0,
        first_integrity_sequence: null,
        last_integrity_sequence: null,
        duplicate_event_hashes: [],
        violations: []
    };

    try {
        if (!fs.existsSync(taskEventFile) || !fs.statSync(taskEventFile).isFile()) {
            result.status = 'MISSING';
            result.violations.push(`Task events file not found: ${result.source_path}`);
            return result;
        }
    } catch {
        result.status = 'MISSING';
        result.violations.push(`Task events file not found: ${result.source_path}`);
        return result;
    }

    let content: string;
    try {
        content = fs.readFileSync(taskEventFile, 'utf8');
    } catch {
        result.status = 'MISSING';
        result.violations.push(`Task events file not found: ${result.source_path}`);
        return result;
    }

    let lastEventHash: string | null = null;
    let expectedSequence: number | null = null;
    let integrityStarted = false;
    const seenHashes = new Set<string>();

    const lines = content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const rawLine = lines[lineIndex];
        if (!rawLine.trim()) {
            continue;
        }

        const lineNumber = lineIndex + 1;
        result.events_scanned++;

        let event: Record<string, unknown>;
        try {
            event = JSON.parse(rawLine) as Record<string, unknown>;
        } catch {
            result.parse_errors++;
            result.violations.push(`Task timeline contains invalid JSON at line ${lineNumber}.`);
            continue;
        }

        const eventTaskId = toTrimmedString(event.task_id);
        if (eventTaskId && eventTaskId !== taskId) {
            result.task_id_mismatches++;
            result.violations.push(
                `Task timeline contains foreign task_id '${eventTaskId}' at line ${lineNumber}.`
            );
            continue;
        }

        result.matching_events++;
        const integrity = event.integrity;
        if (!integrity || typeof integrity !== 'object') {
            if (integrityStarted) {
                result.violations.push(
                    `Task timeline contains legacy/unverified event after integrity chain start at line ${lineNumber}.`
                );
            } else {
                result.legacy_event_count++;
            }
            continue;
        }

        const integrityRecord = integrity as Record<string, unknown>;
        const schemaVersion = integrityRecord.schema_version;
        const taskSequence = integrityRecord.task_sequence;
        let prevEventSha256 = integrityRecord.prev_event_sha256;
        const eventSha256 = toTrimmedLowerCaseString(integrityRecord.event_sha256);

        if (schemaVersion !== 1) {
            result.violations.push(
                `Task timeline integrity schema mismatch at line ${lineNumber}: expected 1, got '${schemaVersion}'.`
            );
            continue;
        }
        if (typeof taskSequence !== 'number' || taskSequence <= 0) {
            result.violations.push(`Task timeline has invalid task_sequence at line ${lineNumber}.`);
            continue;
        }
        if (prevEventSha256 != null && !String(prevEventSha256).trim()) {
            prevEventSha256 = null;
        }
        if (!eventSha256) {
            result.violations.push(`Task timeline missing event_sha256 at line ${lineNumber}.`);
            continue;
        }

        if (!integrityStarted) {
            integrityStarted = true;
            expectedSequence = result.legacy_event_count + 1;
            if (prevEventSha256 != null) {
                result.violations.push(
                    `Task timeline first integrity event must have null prev_event_sha256 (line ${lineNumber}).`
                );
            }
        }

        if (taskSequence !== expectedSequence) {
            result.violations.push(
                `Task timeline sequence mismatch at line ${lineNumber}: expected ${expectedSequence}, got ${taskSequence}.`
            );
        }

        const expectedPrevHash = lastEventHash;
        const normalizedPrevHash = prevEventSha256 != null
            ? String(prevEventSha256).trim().toLowerCase()
            : null;
        if (normalizedPrevHash !== expectedPrevHash) {
            result.violations.push(
                `Task timeline prev_event_sha256 mismatch at line ${lineNumber}.`
            );
        }

        const recalculatedHash = buildEventIntegrityHash(event);
        if (recalculatedHash !== eventSha256) {
            result.violations.push(
                `Task timeline event_sha256 mismatch at line ${lineNumber}.`
            );
        }

        if (seenHashes.has(eventSha256)) {
            result.duplicate_event_hashes.push(eventSha256);
            result.violations.push(
                `Task timeline duplicate/replayed event detected at line ${lineNumber}.`
            );
        }
        seenHashes.add(eventSha256);

        result.integrity_event_count++;
        if (result.first_integrity_sequence == null) {
            result.first_integrity_sequence = taskSequence;
        }
        result.last_integrity_sequence = taskSequence;
        lastEventHash = eventSha256;
        expectedSequence = taskSequence + 1;
    }

    if (result.violations.length > 0) {
        result.status = 'FAILED';
    } else if (result.matching_events === 0) {
        result.status = 'EMPTY';
    } else if (result.integrity_event_count === 0) {
        result.status = 'LEGACY_ONLY';
    } else if (result.legacy_event_count > 0) {
        result.status = 'PASS_WITH_LEGACY_PREFIX';
    } else {
        result.status = 'PASS';
    }

    return result;
}

/**
 * Append a task event with integrity chain, matching Python append_task_event.
 * Uses filesystem lock directories to serialize per-task chain writes.
 */
export function appendTaskEvent(
    repoRoot: string,
    taskId: string,
    eventType: string,
    outcome: string,
    message: string,
    details: unknown,
    options: AppendTaskEventOptions = {}
): AppendTaskEventResult | null {
    const actor = options.actor || 'gate';
    const passThru = options.passThru || false;
    const eventsRoot = options.eventsRoot
        ? path.resolve(String(options.eventsRoot))
        : path.join(repoRoot, 'runtime', 'task-events');

    if (!taskId) {
        return null;
    }

    const safeTaskId = assertValidTaskId(taskId);
    const taskFilePath = path.join(eventsRoot, `${safeTaskId}.jsonl`);
    const allTasksPath = path.join(eventsRoot, 'all-tasks.jsonl');
    const taskLockPath = path.join(eventsRoot, `.${safeTaskId}.lock`);
    const aggregateLockPath = path.join(eventsRoot, '.all-tasks.lock');
    const lockOptions: LockOptions = {
        timeoutMs: options.lockTimeoutMs,
        retryMs: options.lockRetryMs,
        staleMs: options.lockStaleMs
    };

    const event: TaskEvent = {
        timestamp_utc: new Date().toISOString(),
        task_id: safeTaskId,
        event_type: eventType,
        outcome: outcome,
        actor: actor,
        message: message,
        details: details
    };

    const result: AppendTaskEventResult = {
        task_event_log_path: taskFilePath.replace(/\\/g, '/'),
        all_tasks_log_path: allTasksPath.replace(/\\/g, '/'),
        integrity: null,
        warnings: [],
        lock_telemetry: {
            task_lock_retries: 0,
            task_lock_elapsed_ms: 0,
            aggregate_lock_retries: 0,
            aggregate_lock_elapsed_ms: 0
        }
    };

    let line: string | null = null;
    try {
        fs.mkdirSync(eventsRoot, { recursive: true });

        const taskLockResult = withFilesystemLock(taskLockPath, lockOptions, function (): void {
            const appendState = readTaskEventAppendState(taskFilePath, safeTaskId);
            const previousSequence = appendState.last_integrity_sequence;
            const previousHash = appendState.last_event_sha256;
            const nextSequence = (typeof previousSequence === 'number')
                ? (previousSequence + 1)
                : (appendState.matching_events + 1);

            event.integrity = {
                schema_version: 1,
                task_sequence: nextSequence,
                prev_event_sha256: previousHash
            };
            const eventForHash: Record<string, unknown> = { ...event };
            const eventSha256 = buildEventIntegrityHash(eventForHash);
            if (eventSha256 == null) {
                throw new Error('Failed to build event integrity hash.');
            }
            event.integrity.event_sha256 = eventSha256;
            const serializedLine = JSON.stringify(event);
            line = serializedLine;

            fs.appendFileSync(taskFilePath, serializedLine + '\n', 'utf8');
            result.integrity = Object.assign({}, event.integrity);
        });
        if (result.lock_telemetry) {
            result.lock_telemetry.task_lock_retries = taskLockResult.telemetry.retries;
            result.lock_telemetry.task_lock_elapsed_ms = taskLockResult.telemetry.elapsedMs;
        }
    } catch (err: unknown) {
        const warning = `task-event append failed: ${getErrorMessage(err)}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
        return passThru ? result : null;
    }

    try {
        const aggLockResult = withFilesystemLock(aggregateLockPath, lockOptions, function (): void {
            fs.appendFileSync(allTasksPath, (line || '') + '\n', 'utf8');
        });
        if (result.lock_telemetry) {
            result.lock_telemetry.aggregate_lock_retries = aggLockResult.telemetry.retries;
            result.lock_telemetry.aggregate_lock_elapsed_ms = aggLockResult.telemetry.elapsedMs;
        }
    } catch (err: unknown) {
        const warning = `task-event aggregate append failed: ${getErrorMessage(err)}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
    }

    return passThru ? result : null;
}

export async function appendTaskEventAsync(
    repoRoot: string,
    taskId: string,
    eventType: string,
    outcome: string,
    message: string,
    details: unknown,
    options: AppendTaskEventOptions = {}
): Promise<AppendTaskEventResult | null> {
    const actor = options.actor || 'gate';
    const passThru = options.passThru || false;
    const eventsRoot = options.eventsRoot
        ? path.resolve(String(options.eventsRoot))
        : path.join(repoRoot, 'runtime', 'task-events');

    if (!taskId) {
        return null;
    }

    const safeTaskId = assertValidTaskId(taskId);
    const taskFilePath = path.join(eventsRoot, `${safeTaskId}.jsonl`);
    const allTasksPath = path.join(eventsRoot, 'all-tasks.jsonl');
    const taskLockPath = path.join(eventsRoot, `.${safeTaskId}.lock`);
    const aggregateLockPath = path.join(eventsRoot, '.all-tasks.lock');
    const lockOptions: LockOptions = {
        timeoutMs: options.lockTimeoutMs,
        retryMs: options.lockRetryMs,
        staleMs: options.lockStaleMs
    };

    const event: TaskEvent = {
        timestamp_utc: new Date().toISOString(),
        task_id: safeTaskId,
        event_type: eventType,
        outcome: outcome,
        actor: actor,
        message: message,
        details: details
    };

    const result: AppendTaskEventResult = {
        task_event_log_path: taskFilePath.replace(/\\/g, '/'),
        all_tasks_log_path: allTasksPath.replace(/\\/g, '/'),
        integrity: null,
        warnings: [],
        lock_telemetry: {
            task_lock_retries: 0,
            task_lock_elapsed_ms: 0,
            aggregate_lock_retries: 0,
            aggregate_lock_elapsed_ms: 0
        }
    };

    let line: string | null = null;
    try {
        fs.mkdirSync(eventsRoot, { recursive: true });

        const taskLockResult = await withFilesystemLockAsync(taskLockPath, lockOptions, async function (): Promise<void> {
            const appendState = readTaskEventAppendState(taskFilePath, safeTaskId);
            const previousSequence = appendState.last_integrity_sequence;
            const previousHash = appendState.last_event_sha256;
            const nextSequence = (typeof previousSequence === 'number')
                ? (previousSequence + 1)
                : (appendState.matching_events + 1);

            event.integrity = {
                schema_version: 1,
                task_sequence: nextSequence,
                prev_event_sha256: previousHash
            };
            const eventForHash: Record<string, unknown> = { ...event };
            const eventSha256 = buildEventIntegrityHash(eventForHash);
            if (eventSha256 == null) {
                throw new Error('Failed to build event integrity hash.');
            }
            event.integrity.event_sha256 = eventSha256;
            const serializedLine = JSON.stringify(event);
            line = serializedLine;

            const preWriteDelayMs = toPositiveInteger(options.preWriteDelayMs, 0);
            if (preWriteDelayMs > 0) {
                await sleepMsAsync(preWriteDelayMs);
            }

            fs.appendFileSync(taskFilePath, serializedLine + '\n', 'utf8');
            result.integrity = Object.assign({}, event.integrity);
        });
        if (result.lock_telemetry) {
            result.lock_telemetry.task_lock_retries = taskLockResult.telemetry.retries;
            result.lock_telemetry.task_lock_elapsed_ms = taskLockResult.telemetry.elapsedMs;
        }
    } catch (err: unknown) {
        const warning = `task-event append failed: ${getErrorMessage(err)}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
        return passThru ? result : null;
    }

    try {
        const aggLockResult = await withFilesystemLockAsync(aggregateLockPath, lockOptions, async function (): Promise<void> {
            fs.appendFileSync(allTasksPath, (line || '') + '\n', 'utf8');
        });
        if (result.lock_telemetry) {
            result.lock_telemetry.aggregate_lock_retries = aggLockResult.telemetry.retries;
            result.lock_telemetry.aggregate_lock_elapsed_ms = aggLockResult.telemetry.elapsedMs;
        }
    } catch (err: unknown) {
        const warning = `task-event aggregate append failed: ${getErrorMessage(err)}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
    }

    return passThru ? result : null;
}

export function appendMandatoryTaskEvent(
    repoRoot: string,
    taskId: string,
    eventType: string,
    outcome: string,
    message: string,
    details: unknown,
    options: AppendTaskEventOptions = {}
): TaskEventAppendResult {
    const result = appendTaskEvent(
        repoRoot,
        taskId,
        eventType,
        outcome,
        message,
        details,
        {
            ...options,
            passThru: true
        }
    );

    if (!result) {
        throw new Error(`Mandatory lifecycle event '${eventType}' append failed without diagnostics.`);
    }
    if (result.warnings.length > 0) {
        throw new Error(
            `Mandatory lifecycle event '${eventType}' append failed: ${result.warnings.join(' | ')}`
        );
    }
    return result;
}

export async function appendMandatoryTaskEventAsync(
    repoRoot: string,
    taskId: string,
    eventType: string,
    outcome: string,
    message: string,
    details: unknown,
    options: AppendTaskEventOptions = {}
): Promise<TaskEventAppendResult> {
    const result = await appendTaskEventAsync(
        repoRoot,
        taskId,
        eventType,
        outcome,
        message,
        details,
        {
            ...options,
            passThru: true
        }
    );

    if (!result) {
        throw new Error(`Mandatory lifecycle event '${eventType}' append failed without diagnostics.`);
    }
    if (result.warnings.length > 0) {
        throw new Error(
            `Mandatory lifecycle event '${eventType}' append failed: ${result.warnings.join(' | ')}`
        );
    }
    return result;
}
