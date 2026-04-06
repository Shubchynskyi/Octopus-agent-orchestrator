import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { redactHostname as redactHostnameValue } from '../core/redaction';

// ---------------------------------------------------------------------------
// Root boundary helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
    return path.resolve(p);
}

/**
 * Resolve the real filesystem path, following symlinks and junctions.
 * When the full path does not exist yet, walks up to the deepest existing
 * ancestor, resolves that with `realpathSync`, then re-appends the
 * non-existing tail segments. This ensures that any intermediate junction
 * or symlink that redirects outside the permitted root is detected.
 */
export function resolveRealPath(p: string): string {
    const resolved = path.resolve(p);
    try {
        return fs.realpathSync(resolved);
    } catch {
        // Path does not exist – walk up to the deepest existing ancestor.
        const tail: string[] = [];
        let current = resolved;
        for (;;) {
            const parent = path.dirname(current);
            if (parent === current) {
                // Reached the filesystem root without finding an existing dir.
                return path.join(current, ...tail);
            }
            tail.unshift(path.basename(current));
            current = parent;
            try {
                const realParent = fs.realpathSync(current);
                return path.join(realParent, ...tail);
            } catch {
                // Keep walking up.
            }
        }
    }
}

export function isSubpath(parent: string, child: string): boolean {
    const p = normalizePath(parent).toLowerCase();
    const c = normalizePath(child).toLowerCase();
    if (p === c) return true; // allow exact equality
    return c.startsWith(p + path.sep);
}

export function ensureWithinRoot(root: string, candidate: string, description = 'Path'): string {
    const resolved = normalizePath(candidate);
    const resolvedRoot = normalizePath(root);
    if (!isSubpath(resolvedRoot, resolved)) {
        throw new Error(`${description} '${candidate}' resolves outside permitted root '${root}'`);
    }
    // Symlink / junction-aware check: resolve the real filesystem paths so
    // that a junction pointing outside the root is caught even when the
    // lexical path appears to be inside the root.
    const realCandidate = resolveRealPath(resolved);
    const realRoot = resolveRealPath(resolvedRoot);
    if (!isSubpath(realRoot, realCandidate)) {
        throw new Error(
            `${description} '${candidate}' escapes permitted root '${root}' via symlink or junction`
        );
    }
    return resolved;
}

export function ensureRelativeSafe(rel: string, description = 'Relative path'): void {
    if (path.isAbsolute(rel)) {
        throw new Error(`${description} must be relative, absolute path provided: ${rel}`);
    }
    const norm = path.normalize(rel);
    if (norm.split(path.sep).includes('..')) {
        throw new Error(`${description} contains parent path traversal: ${rel}`);
    }
}


type JsonObject = Record<string, unknown>;

export interface RollbackRecord {
    relativePath: string;
    existed: boolean;
    pathType: string;
}

export interface SyncBackupMetadata extends JsonObject {
    preexistingMap: Record<string, unknown>;
}

export interface UpdateSentinelMetadata extends JsonObject {
    startedAt?: string;
    fromVersion?: string;
    toVersion?: string;
}

export interface UninstallSentinelMetadata extends JsonObject {
    startedAt?: string;
    operation?: string;
    rollbackSnapshotPath?: string;
    timestamp?: string;
    skipBackups?: boolean;
    keepPrimaryEntrypoint?: boolean;
    keepTaskFile?: boolean;
    keepRuntimeArtifacts?: boolean;
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const ROLLBACK_RECORDS_FILE_NAME = 'rollback-records.json';
export const SYNC_BACKUP_METADATA_FILE_NAME = 'sync-backup-metadata.json';
export const UPDATE_SENTINEL_FILE_NAME = '.update-in-progress';
export const UNINSTALL_SENTINEL_FILE_NAME = '.uninstall-in-progress';
export const LIFECYCLE_OPERATION_LOCK_DIR_NAME = '.lifecycle-operation.lock';
export const LIFECYCLE_OPERATION_LOCK_OWNER_FILE_NAME = 'owner.json';

interface LifecycleOperationLockMetadata extends JsonObject {
    pid: number | null;
    hostname: string | null;
    operation: string | null;
    acquired_at_utc: string | null;
    target_root: string | null;
}

interface LifecycleOperationLockInspection {
    exists: boolean;
    ownerAlive: boolean | null;
    metadata: LifecycleOperationLockMetadata;
}

export interface LifecycleLockTelemetry {
    elapsedMs: number;
    staleLockRecovered: boolean;
    queueWaitMs: number;
}

// Grace period before treating a lifecycle lock with missing/corrupt metadata
// as reclaimable. Mirrors LOCK_METADATA_GRACE_MS from gate-runtime/task-events
// to prevent SIGKILL-orphaned lock directories from blocking forever.
const LIFECYCLE_LOCK_METADATA_GRACE_MS = 2000;

const ACTIVE_LIFECYCLE_OPERATION_LOCKS = new Map<string, number>();

let lastLifecycleLockTelemetry: LifecycleLockTelemetry | null = null;

export function getLastLifecycleLockTelemetry(): LifecycleLockTelemetry | null {
    return lastLifecycleLockTelemetry;
}

// ---------------------------------------------------------------------------
// Version comparison used by update flows.
// ---------------------------------------------------------------------------

export function compareVersionStrings(current: string, latest: string): number {
    const normalize = (v: string): string => String(v).trim().replace(/^[vV]/, '');
    const a = normalize(current);
    const b = normalize(latest);

    // Separate core version from prerelease and build metadata.
    // Build metadata (+…) is always ignored per SemVer §10.
    const splitVersion = (value: string): { core: string; prerelease: string } => {
        const noBuild = value.split('+')[0];
        const dashIdx = noBuild.indexOf('-');
        if (dashIdx === -1) return { core: noBuild, prerelease: '' };
        return { core: noBuild.slice(0, dashIdx), prerelease: noBuild.slice(dashIdx + 1) };
    };

    const aParts = splitVersion(a);
    const bParts = splitVersion(b);

    const parseSegments = (value: string): number[] =>
        value.split('.').map((segment: string) => {
            const match = segment.match(/^(\d+)/);
            return match ? Number(match[1]) : 0;
        });

    const aSegs = parseSegments(aParts.core);
    const bSegs = parseSegments(bParts.core);
    const maxLen = Math.max(aSegs.length, bSegs.length);

    for (let i = 0; i < maxLen; i++) {
        const av = i < aSegs.length ? aSegs[i] : 0;
        const bv = i < bSegs.length ? bSegs[i] : 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }

    // Core versions equal — compare prerelease per SemVer §11.
    // A version with prerelease has lower precedence than the release version.
    const aPre = aParts.prerelease;
    const bPre = bParts.prerelease;
    if (aPre && !bPre) return -1;
    if (!aPre && bPre) return 1;
    if (aPre && bPre) {
        const aIds = aPre.split('.');
        const bIds = bPre.split('.');
        const len = Math.min(aIds.length, bIds.length);
        for (let i = 0; i < len; i++) {
            const ai = aIds[i];
            const bi = bIds[i];
            if (ai === bi) continue;
            const aIsNum = /^\d+$/.test(ai);
            const bIsNum = /^\d+$/.test(bi);
            if (aIsNum && bIsNum) {
                const diff = Number(ai) - Number(bi);
                if (diff < 0) return -1;
                if (diff > 0) return 1;
            } else if (aIsNum) {
                return -1;
            } else if (bIsNum) {
                return 1;
            } else {
                if (ai < bi) return -1;
                if (ai > bi) return 1;
            }
        }
        if (aIds.length < bIds.length) return -1;
        if (aIds.length > bIds.length) return 1;
    }

    return 0;
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

let lastTimestampMs = 0;

export function getTimestamp(): string {
    const currentMs = Date.now();
    const effectiveMs = currentMs <= lastTimestampMs ? lastTimestampMs + 1 : currentMs;
    lastTimestampMs = effectiveMs;

    const now = new Date(effectiveMs);
    const pad2 = (n: number): string => String(n).padStart(2, '0');
    const pad3 = (n: number): string => String(n).padStart(3, '0');
    return (
        `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-` +
        `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}-` +
        `${pad3(now.getMilliseconds())}`
    );
}

function getErrorCode(error: unknown): string {
    return error != null && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
}

function isProcessLikelyAlive(pid: number | null): boolean | null {
    if (!pid || !Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'EPERM') {
            return true;
        }
        if (errorCode === 'ESRCH') {
            return false;
        }
        return null;
    }
}

function readLifecycleOperationLockMetadata(lockPath: string): LifecycleOperationLockMetadata {
    const ownerPath = path.join(lockPath, LIFECYCLE_OPERATION_LOCK_OWNER_FILE_NAME);
    try {
        const raw = fs.readFileSync(ownerPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            pid: typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null,
            hostname: typeof parsed.hostname === 'string' && parsed.hostname.trim() ? parsed.hostname.trim() : null,
            operation: typeof parsed.operation === 'string' && parsed.operation.trim() ? parsed.operation.trim() : null,
            acquired_at_utc: typeof parsed.acquired_at_utc === 'string' && parsed.acquired_at_utc.trim()
                ? parsed.acquired_at_utc.trim()
                : null,
            target_root: typeof parsed.target_root === 'string' && parsed.target_root.trim() ? parsed.target_root.trim() : null
        };
    } catch {
        return {
            pid: null,
            hostname: null,
            operation: null,
            acquired_at_utc: null,
            target_root: null
        };
    }
}

function inspectLifecycleOperationLock(lockPath: string): LifecycleOperationLockInspection {
    if (!fs.existsSync(lockPath)) {
        return {
            exists: false,
            ownerAlive: null,
            metadata: {
                pid: null,
                hostname: null,
                operation: null,
                acquired_at_utc: null,
                target_root: null
            }
        };
    }
    const metadata = readLifecycleOperationLockMetadata(lockPath);

    // If metadata is missing, corrupt, or lacks a usable PID (partial write from
    // SIGKILL between mkdir and full metadata write), check lock directory age.
    // After the grace period, treat as dead owner so the lock can be reclaimed
    // instead of blocking forever. The PID is the key field for liveness checks;
    // metadata with hostname but no PID cannot be verified and should be treated
    // the same as fully missing metadata.
    if (metadata.pid === null) {
        try {
            const stats = fs.statSync(lockPath);
            const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
            if (ageMs >= LIFECYCLE_LOCK_METADATA_GRACE_MS) {
                return { exists: true, ownerAlive: false, metadata };
            }
        } catch {
            // statSync failed — lock may have been removed concurrently
        }
        return { exists: true, ownerAlive: null, metadata };
    }

    const localHost = os.hostname();
    const sameHost = metadata.hostname !== null && metadata.hostname === localHost;
    return {
        exists: true,
        ownerAlive: sameHost ? isProcessLikelyAlive(metadata.pid) : null,
        metadata
    };
}

function writeLifecycleOperationLockMetadata(lockPath: string, targetRoot: string, operation: string): void {
    const ownerPath = path.join(lockPath, LIFECYCLE_OPERATION_LOCK_OWNER_FILE_NAME);
    const payload: LifecycleOperationLockMetadata = {
        pid: process.pid,
        hostname: os.hostname(),
        operation,
        acquired_at_utc: new Date().toISOString(),
        target_root: targetRoot
    };
    fs.writeFileSync(ownerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export function getLifecycleOperationLockPath(targetRoot: string): string {
    const normalizedTarget = path.resolve(targetRoot);
    return path.join(normalizedTarget, 'Octopus-agent-orchestrator', 'runtime', LIFECYCLE_OPERATION_LOCK_DIR_NAME);
}

function acquireLifecycleOperationLock(targetRoot: string, operation: string): { release: () => void; telemetry: LifecycleLockTelemetry } {
    const startedAt = Date.now();
    const normalizedTarget = path.resolve(targetRoot);
    const heldCount = ACTIVE_LIFECYCLE_OPERATION_LOCKS.get(normalizedTarget) || 0;
    if (heldCount > 0) {
        ACTIVE_LIFECYCLE_OPERATION_LOCKS.set(normalizedTarget, heldCount + 1);
        return {
            release: function releaseNestedLock() {
                const currentCount = ACTIVE_LIFECYCLE_OPERATION_LOCKS.get(normalizedTarget) || 0;
                if (currentCount <= 1) {
                    ACTIVE_LIFECYCLE_OPERATION_LOCKS.delete(normalizedTarget);
                } else {
                    ACTIVE_LIFECYCLE_OPERATION_LOCKS.set(normalizedTarget, currentCount - 1);
                }
            },
            telemetry: { elapsedMs: Date.now() - startedAt, staleLockRecovered: false, queueWaitMs: 0 }
        };
    }

    let staleLockRecovered = false;
    const lockPath = getLifecycleOperationLockPath(normalizedTarget);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
        fs.mkdirSync(lockPath);
    } catch (error: unknown) {
        const errorCode = getErrorCode(error);
        if (errorCode !== 'EEXIST') {
            throw error;
        }

        const inspection = inspectLifecycleOperationLock(lockPath);
        if (inspection.exists && inspection.ownerAlive === false) {
            // Atomically rename the stale lock to avoid a TOCTOU race where a
            // concurrent recoverer could remove a freshly re-acquired valid lock.
            // Only the process that succeeds at the rename proceeds with cleanup.
            const tempPath = lockPath + '.stale-' + process.pid + '-' + Date.now();
            try {
                fs.renameSync(lockPath, tempPath);
            } catch {
                throw error;
            }
            fs.rmSync(tempPath, { recursive: true, force: true });
            fs.mkdirSync(lockPath);
            staleLockRecovered = true;
        } else {
            const ownerPid = inspection.metadata.pid != null ? String(inspection.metadata.pid) : 'unknown';
            const ownerHost = redactHostnameValue(inspection.metadata.hostname) || 'unknown';
            const ownerOperation = inspection.metadata.operation || 'unknown';
            throw new Error(
                `Another lifecycle operation is already running for '${normalizedTarget}' ` +
                `(operation='${ownerOperation}', pid=${ownerPid}, host=${ownerHost}, lock='${lockPath}').`
            );
        }
    }

    try {
        writeLifecycleOperationLockMetadata(lockPath, normalizedTarget, operation);
    } catch (error: unknown) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
    }

    ACTIVE_LIFECYCLE_OPERATION_LOCKS.set(normalizedTarget, 1);
    const elapsedMs = Date.now() - startedAt;
    if (staleLockRecovered) {
        process.stderr.write(
            `LIFECYCLE_LOCK_STALE_RECOVERED: target=${normalizedTarget}; operation=${operation}; elapsed_ms=${elapsedMs}\n`
        );
    }
    return {
        release: function releaseLock() {
            const currentCount = ACTIVE_LIFECYCLE_OPERATION_LOCKS.get(normalizedTarget) || 0;
            if (currentCount <= 1) {
                ACTIVE_LIFECYCLE_OPERATION_LOCKS.delete(normalizedTarget);
                fs.rmSync(lockPath, { recursive: true, force: true });
                return;
            }
            ACTIVE_LIFECYCLE_OPERATION_LOCKS.set(normalizedTarget, currentCount - 1);
        },
        telemetry: { elapsedMs, staleLockRecovered, queueWaitMs: 0 }
    };
}

export function withLifecycleOperationLock<T>(targetRoot: string, operation: string, callback: () => T): T {
    const { release, telemetry } = acquireLifecycleOperationLock(targetRoot, operation);
    lastLifecycleLockTelemetry = telemetry;
    try {
        return callback();
    } finally {
        release();
    }
}

const LIFECYCLE_ASYNC_QUEUES = new Map<string, Promise<void>>();

export async function withLifecycleOperationLockAsync<T>(
    targetRoot: string,
    operation: string,
    callback: () => Promise<T>
): Promise<T> {
    const normalizedTarget = path.resolve(targetRoot);
    const queueStartedAt = Date.now();

    // Serialize concurrent async callers targeting the same root.
    // Without this gate, the synchronous ACTIVE_LIFECYCLE_OPERATION_LOCKS
    // re-entrancy check lets independent async operations bypass the
    // filesystem lock when another async holder has yielded.
    // Note: this does NOT support async re-entrancy (nested async calls
    // for the same target will deadlock). Use the sync variant for nesting.
    let previous = LIFECYCLE_ASYNC_QUEUES.get(normalizedTarget);
    while (previous) {
        await previous;
        previous = LIFECYCLE_ASYNC_QUEUES.get(normalizedTarget);
    }

    const queueWaitMs = Date.now() - queueStartedAt;
    let resolveQueue!: () => void;
    const queueEntry = new Promise<void>((r) => { resolveQueue = r; });
    LIFECYCLE_ASYNC_QUEUES.set(normalizedTarget, queueEntry);

    let release: (() => void) | null = null;
    try {
        const lockResult = acquireLifecycleOperationLock(targetRoot, operation);
        release = lockResult.release;
        lastLifecycleLockTelemetry = { ...lockResult.telemetry, queueWaitMs };
        return await callback();
    } finally {
        if (release) {
            release();
        }
        if (LIFECYCLE_ASYNC_QUEUES.get(normalizedTarget) === queueEntry) {
            LIFECYCLE_ASYNC_QUEUES.delete(normalizedTarget);
        }
        resolveQueue();
    }
}

// ---------------------------------------------------------------------------
// Recursive file copy / directory helpers
// ---------------------------------------------------------------------------

export function copyPathRecursive(sourcePath: string, destinationPath: string): void {
    const stats = fs.lstatSync(sourcePath);
    const parentDir = path.dirname(destinationPath);
    if (parentDir) fs.mkdirSync(parentDir, { recursive: true });

    if (stats.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        for (const entry of fs.readdirSync(sourcePath)) {
            copyPathRecursive(path.join(sourcePath, entry), path.join(destinationPath, entry));
        }
        return;
    }
    fs.copyFileSync(sourcePath, destinationPath);
}

export function removePathRecursive(targetPath: string): void {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

export function readdirRecursiveFiles(dirPath: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dirPath)) return results;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...readdirRecursiveFiles(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

export function readdirRecursiveDirs(dirPath: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dirPath)) return results;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(full);
            results.push(...readdirRecursiveDirs(full));
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// Bundle sync items
// ---------------------------------------------------------------------------

export const BUNDLE_SYNC_ITEMS = Object.freeze([
    '.gitattributes',
    'bin',
    'dist',
    'package.json',
    'src',
    'template',
    'README.md',
    'HOW_TO.md',
    'MANIFEST.md',
    'AGENT_INIT_PROMPT.md',
    'CHANGELOG.md',
    'LICENSE',
    'VERSION'
]);

// ---------------------------------------------------------------------------
// Rollback snapshot (mirrors New-RollbackSnapshot / Restore-RollbackSnapshot)
// ---------------------------------------------------------------------------

export function createRollbackSnapshot(
    rootPath: string,
    snapshotRoot: string,
    relativePaths: readonly string[]
): RollbackRecord[] {
    const unique = [...new Set(relativePaths)].sort();
    const records: RollbackRecord[] = [];

    for (const rel of unique) {
        // Defensive checks: ensure relative paths are safe and remain under rootPath
        if (!rel || rel === '.') continue;
        ensureRelativeSafe(rel, 'Rollback relativePath');

        const targetPath = path.join(rootPath, rel);
        ensureWithinRoot(rootPath, targetPath, 'Rollback target');

        const exists = fs.existsSync(targetPath);
        let pathType = 'missing';
        if (exists) {
            const stats = fs.lstatSync(targetPath);
            pathType = stats.isDirectory() ? 'directory' : 'file';
            const snapshotPath = path.join(snapshotRoot, rel);
            fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
            copyPathRecursive(targetPath, snapshotPath);
        }
        records.push({ relativePath: rel, existed: exists, pathType });
    }

    return records;
}

export function getRollbackRecordsPath(snapshotRoot: string): string {
    return path.join(snapshotRoot, ROLLBACK_RECORDS_FILE_NAME);
}

export function writeRollbackRecords(snapshotRoot: string, records: readonly RollbackRecord[]): string {
    const recordsPath = getRollbackRecordsPath(snapshotRoot);
    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2), 'utf8');
    return recordsPath;
}

export function readRollbackRecords(snapshotRoot: string): RollbackRecord[] {
    const recordsPath = getRollbackRecordsPath(snapshotRoot);
    if (!fs.existsSync(recordsPath)) {
        throw new Error(`Rollback records file not found: ${recordsPath}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
    } catch (_error) {
        throw new Error(`Rollback records file is not valid JSON: ${recordsPath}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error(`Rollback records file must contain an array: ${recordsPath}`);
    }

    return parsed.map((record: unknown, index: number): RollbackRecord => {
        const recordObject = isJsonObject(record) ? record : null;
        const relativePath = typeof recordObject?.relativePath === 'string'
            ? recordObject.relativePath.trim()
            : '';
        if (!relativePath) {
            throw new Error(`Rollback record at index ${index} is missing relativePath.`);
        }
        ensureRelativeSafe(relativePath, `Rollback record at index ${index} relativePath`);

        return {
            relativePath,
            existed: Boolean(recordObject?.existed),
            pathType: typeof recordObject?.pathType === 'string' && recordObject.pathType
                ? recordObject.pathType
                : 'missing'
        };
    });
}

export function getSyncBackupMetadataPath(backupRoot: string): string {
    return path.join(backupRoot, SYNC_BACKUP_METADATA_FILE_NAME);
}

export function writeSyncBackupMetadata(backupRoot: string, metadata: SyncBackupMetadata): string {
    const metadataPath = getSyncBackupMetadataPath(backupRoot);
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    return metadataPath;
}

export function readSyncBackupMetadata(backupRoot: string): SyncBackupMetadata {
    const metadataPath = getSyncBackupMetadataPath(backupRoot);
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Sync backup metadata file not found: ${metadataPath}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (_error) {
        throw new Error(`Sync backup metadata file is not valid JSON: ${metadataPath}`);
    }

    const parsedObject = isJsonObject(parsed) ? parsed : null;
    const preexistingMap = parsedObject && isJsonObject(parsedObject.preexistingMap)
        ? parsedObject.preexistingMap
        : null;
    if (!preexistingMap || Array.isArray(preexistingMap)) {
        throw new Error(`Sync backup metadata is missing preexistingMap: ${metadataPath}`);
    }
    for (const key of Object.keys(preexistingMap)) {
        ensureRelativeSafe(key, 'Sync backup metadata key');
    }

    return {
        ...(parsedObject ?? {}),
        preexistingMap
    };
}

export function restoreRollbackSnapshot(
    rootPath: string,
    snapshotRoot: string,
    records: readonly RollbackRecord[]
): void {
    for (const record of records) {
        const rel = record.relativePath;
        if (!rel) continue;
        ensureRelativeSafe(rel, 'Rollback record.relativePath');

        const targetPath = path.join(rootPath, rel);
        ensureWithinRoot(rootPath, targetPath, 'Rollback restore target');
        const snapshotPath = path.join(snapshotRoot, rel);
        const shouldExist = record.existed;

        if (shouldExist) {
            if (!fs.existsSync(snapshotPath)) {
                throw new Error(`Rollback snapshot entry missing for '${rel}': ${snapshotPath}`);
            }
            removePathRecursive(targetPath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            copyPathRecursive(snapshotPath, targetPath);
            continue;
        }

        removePathRecursive(targetPath);
    }
}

// ---------------------------------------------------------------------------
// Copy-DirectoryContentMerge (mirrors the PS function exactly)
// ---------------------------------------------------------------------------

export function copyDirectoryContentMerge(
    sourceDirectory: string,
    destinationDirectory: string,
    skipDestinationFiles?: readonly string[] | null
): void {
    if (!fs.existsSync(destinationDirectory)) {
        fs.mkdirSync(destinationDirectory, { recursive: true });
    }

    const skipSet = new Set(
        (skipDestinationFiles ?? []).map((filePath: string) => path.resolve(filePath).toLowerCase())
    );

    const sourceRoot = path.resolve(sourceDirectory);
    const destRoot = path.resolve(destinationDirectory);
    const expectedDestFiles = new Set<string>();

    for (const sourceFile of readdirRecursiveFiles(sourceDirectory)) {
        const rel = path.relative(sourceRoot, sourceFile);
        if (!rel || rel === '.') continue;

        // Guard against any unexpected traversal from source
        if (rel.split(path.sep).includes('..')) {
            throw new Error(`Source contains upward-relative paths: ${rel}`);
        }

        const destFile = path.resolve(path.join(destinationDirectory, rel));
        // Ensure the computed destination file remains under destinationDirectory
        ensureWithinRoot(destRoot, destFile, 'Destination file');

        expectedDestFiles.add(destFile.toLowerCase());

        if (skipSet.has(destFile.toLowerCase())) continue;

        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(sourceFile, destFile);
    }

    // Remove files that are no longer in source
    for (const destFile of readdirRecursiveFiles(destinationDirectory)) {
        const destFull = path.resolve(destFile).toLowerCase();
        if (skipSet.has(destFull)) continue;
        if (!expectedDestFiles.has(destFull)) {
            // extra safety: ensure removal target is under destination root
            ensureWithinRoot(destRoot, destFile, 'Removal target');
            fs.rmSync(destFile, { force: true });
        }
    }

    // Remove empty directories bottom-up
    const dirs = readdirRecursiveDirs(destinationDirectory).sort((a: string, b: string) => b.length - a.length);
    for (const dir of dirs) {
        const dirFull = path.resolve(dir).toLowerCase();
        if (skipSet.has(dirFull)) continue;
        try {
            // ensure directory under destRoot
            ensureWithinRoot(destRoot, dir, 'Directory to prune');
            const entries = fs.readdirSync(dir);
            if (entries.length === 0) fs.rmdirSync(dir);
        } catch (_e) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// Restore-SyncedItemsFromBackup (mirrors the PS function)
// ---------------------------------------------------------------------------

export function restoreSyncedItemsFromBackup(
    targetBundleRoot: string,
    backupRoot: string,
    preexistingMap: Record<string, unknown>,
    runningScriptPath: string | null
): void {
    const resolvedTargetRoot = path.resolve(targetBundleRoot);
    for (const item of Object.keys(preexistingMap)) {
        if (!item) continue;
        // ensure item name is safe
        ensureRelativeSafe(item, 'Synced item key');

        const destinationPath = path.join(targetBundleRoot, item);
        ensureWithinRoot(resolvedTargetRoot, destinationPath, 'Synced destination');
        const preexisting = Boolean(preexistingMap[item]);

        if (preexisting) {
            const backupPath = path.join(backupRoot, item);
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Missing backup entry for '${item}': ${backupPath}`);
            }

            const isNodeRuntimeDir = item.toLowerCase() === 'src';
            if (isNodeRuntimeDir && fs.existsSync(backupPath) && fs.lstatSync(backupPath).isDirectory()) {
                if (!fs.existsSync(destinationPath) || !fs.lstatSync(destinationPath).isDirectory()) {
                    removePathRecursive(destinationPath);
                    fs.mkdirSync(destinationPath, { recursive: true });
                }
                const skipPaths = runningScriptPath ? [path.resolve(runningScriptPath)] : [];
                copyDirectoryContentMerge(backupPath, destinationPath, skipPaths);
                continue;
            }

            removePathRecursive(destinationPath);
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            copyPathRecursive(backupPath, destinationPath);
            continue;
        }

        removePathRecursive(destinationPath);
    }
}

// ---------------------------------------------------------------------------
// Sync working-tree bundle items into a deployed workspace.
// ---------------------------------------------------------------------------

export function syncWorkingTreeBundleItems(
    sourceBundleRoot: string,
    targetBundleRoot: string,
    relativeItems: readonly string[]
): void {
    const unique = [...new Set(relativeItems)].sort();
    const resolvedTargetRoot = path.resolve(targetBundleRoot);
    for (const item of unique) {
        if (!item) continue;
        ensureRelativeSafe(item, 'Sync item');
        const sourcePath = path.join(sourceBundleRoot, item);
        if (!fs.existsSync(sourcePath)) continue;

        const destinationPath = path.join(targetBundleRoot, item);
        ensureWithinRoot(resolvedTargetRoot, destinationPath, 'Sync destination');
        removePathRecursive(destinationPath);
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        copyPathRecursive(sourcePath, destinationPath);
    }
}

// ---------------------------------------------------------------------------
// Validate target root
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Update sentinel (marks an in-progress update to detect interrupted runs)
// ---------------------------------------------------------------------------

export function getUpdateSentinelPath(bundleRoot: string): string {
    return path.join(bundleRoot, 'runtime', UPDATE_SENTINEL_FILE_NAME);
}

export function writeUpdateSentinel(bundleRoot: string, metadata: UpdateSentinelMetadata): string {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, JSON.stringify(metadata, null, 2), 'utf8');
    return sentinelPath;
}

export function removeUpdateSentinel(bundleRoot: string): void {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    if (fs.existsSync(sentinelPath)) {
        fs.rmSync(sentinelPath, { force: true });
    }
}

export function readUpdateSentinel(bundleRoot: string): UpdateSentinelMetadata | null {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    if (!fs.existsSync(sentinelPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(sentinelPath, 'utf8')) as UpdateSentinelMetadata;
    } catch (_error) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Uninstall sentinel (marks an in-progress uninstall to detect interrupted runs)
// ---------------------------------------------------------------------------

export function getUninstallSentinelPath(targetRoot: string): string {
    return path.join(targetRoot, UNINSTALL_SENTINEL_FILE_NAME);
}

export function writeUninstallSentinel(targetRoot: string, metadata: UninstallSentinelMetadata): string {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    fs.writeFileSync(sentinelPath, JSON.stringify(metadata, null, 2), 'utf8');
    return sentinelPath;
}

export function readUninstallSentinel(targetRoot: string): UninstallSentinelMetadata | null {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    if (!fs.existsSync(sentinelPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(sentinelPath, 'utf8')) as UninstallSentinelMetadata;
    } catch (_error) {
        return null;
    }
}

export function removeUninstallSentinel(targetRoot: string): void {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    if (fs.existsSync(sentinelPath)) {
        fs.rmSync(sentinelPath, { force: true });
    }
}

// ---------------------------------------------------------------------------
// Validate target root
// ---------------------------------------------------------------------------

export function validateTargetRoot(targetRoot: string, bundleRoot: string): string {
    const normalizedTarget = path.resolve(targetRoot);
    const normalizedBundle = path.resolve(bundleRoot);
    if (normalizedTarget.toLowerCase() === normalizedBundle.toLowerCase()) {
        throw new Error(
            `TargetRoot points to orchestrator bundle directory '${bundleRoot}'. Use the project root parent directory instead.`
        );
    }
    return normalizedTarget;
}
