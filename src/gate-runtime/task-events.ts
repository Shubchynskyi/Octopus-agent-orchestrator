const { stringSha256 } = require('./hash.ts');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_STALE_MS = 30000;
const LOCK_SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMs(milliseconds) {
    if (!milliseconds || milliseconds <= 0) {
        return;
    }
    Atomics.wait(LOCK_SLEEP_ARRAY, 0, 0, milliseconds);
}

function writeLockMetadata(lockPath) {
    const metadataPath = path.join(lockPath, 'owner.json');
    const payload = {
        pid: process.pid,
        hostname: os.hostname(),
        created_at_utc: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function removeLockPath(lockPath) {
    fs.rmSync(lockPath, { recursive: true, force: true });
}

function tryRemoveStaleLock(lockPath, staleMs) {
    if (!staleMs || staleMs <= 0) {
        return false;
    }

    try {
        const stats = fs.statSync(lockPath);
        const ageMs = Date.now() - stats.mtimeMs;
        if (ageMs < staleMs) {
            return false;
        }
    } catch {
        return false;
    }

    try {
        removeLockPath(lockPath);
        return true;
    } catch {
        return false;
    }
}

function acquireFilesystemLock(lockPath, options = {}) {
    const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    const retryMs = toPositiveInteger(options.retryMs, DEFAULT_LOCK_RETRY_MS);
    const staleMs = toPositiveInteger(options.staleMs, DEFAULT_LOCK_STALE_MS);
    const startedAt = Date.now();

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            writeLockMetadata(lockPath);
            return { lockPath };
        } catch (error) {
            if (!error || error.code !== 'EEXIST') {
                throw error;
            }

            if (tryRemoveStaleLock(lockPath, staleMs)) {
                continue;
            }

            if ((Date.now() - startedAt) >= timeoutMs) {
                throw new Error(`Timed out acquiring file lock: ${lockPath}`);
            }

            sleepMs(retryMs);
        }
    }
}

function releaseFilesystemLock(lockHandle) {
    if (!lockHandle || !lockHandle.lockPath) {
        return;
    }
    removeLockPath(lockHandle.lockPath);
}

function withFilesystemLock(lockPath, options, callback) {
    const lockHandle = acquireFilesystemLock(lockPath, options);
    try {
        return callback();
    } finally {
        releaseFilesystemLock(lockHandle);
    }
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
function normalizeIntegrityValue(value) {
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
        const sorted = {};
        const keys = Object.keys(value).sort();
        for (const key of keys) {
            sorted[String(key)] = normalizeIntegrityValue(value[key]);
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
function buildEventIntegrityHash(eventObj) {
    const normalizedEvent = Object.assign({}, eventObj);
    const integrity = normalizedEvent.integrity;
    if (integrity && typeof integrity === 'object') {
        const normalizedIntegrity = Object.assign({}, integrity);
        delete normalizedIntegrity.event_sha256;
        normalizedEvent.integrity = normalizedIntegrity;
    }

    const canonicalPayload = JSON.stringify(normalizeIntegrityValue(normalizedEvent));
    return stringSha256(canonicalPayload);
}

/**
 * Parse a task ID, validating format. Matches Python assert_valid_task_id.
 */
function assertValidTaskId(value) {
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
function readLastNonEmptyLine(filePath) {
    const fs = require('node:fs');
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
function readTaskEventAppendStateFast(taskFilePath, taskId) {
    const rawLine = readLastNonEmptyLine(taskFilePath);
    if (!rawLine || !rawLine.trim()) {
        return null;
    }

    let event;
    try {
        event = JSON.parse(rawLine);
    } catch {
        return null;
    }

    const eventTaskId = String(event.task_id || '').trim();
    if (eventTaskId && eventTaskId !== taskId) {
        return null;
    }

    const integrity = event.integrity;
    if (!integrity || typeof integrity !== 'object') {
        return null;
    }

    const sequence = integrity.task_sequence;
    const eventSha256 = String(integrity.event_sha256 || '').trim().toLowerCase();
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
function readTaskEventAppendState(taskFilePath, taskId) {
    const fs = require('node:fs');
    const state = {
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

    let content;
    try {
        content = fs.readFileSync(taskFilePath, 'utf8');
    } catch {
        return state;
    }

    for (const rawLine of content.split('\n')) {
        if (!rawLine.trim()) {
            continue;
        }

        let event;
        try {
            event = JSON.parse(rawLine);
        } catch {
            state.parse_errors++;
            continue;
        }

        const eventTaskId = String(event.task_id || '').trim();
        if (eventTaskId && eventTaskId !== taskId) {
            continue;
        }

        state.matching_events++;
        const integrity = event.integrity;
        if (!integrity || typeof integrity !== 'object') {
            continue;
        }

        const sequence = integrity.task_sequence;
        const eventSha256 = String(integrity.event_sha256 || '').trim().toLowerCase();
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
function inspectTaskEventFile(taskEventFile, taskId) {
    const fs = require('node:fs');

    const result = {
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

    let content;
    try {
        content = fs.readFileSync(taskEventFile, 'utf8');
    } catch {
        result.status = 'MISSING';
        result.violations.push(`Task events file not found: ${result.source_path}`);
        return result;
    }

    let lastEventHash = null;
    let expectedSequence = null;
    let integrityStarted = false;
    const seenHashes = new Set();

    const lines = content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const rawLine = lines[lineIndex];
        if (!rawLine.trim()) {
            continue;
        }

        const lineNumber = lineIndex + 1;
        result.events_scanned++;

        let event;
        try {
            event = JSON.parse(rawLine);
        } catch {
            result.parse_errors++;
            result.violations.push(`Task timeline contains invalid JSON at line ${lineNumber}.`);
            continue;
        }

        const eventTaskId = String(event.task_id || '').trim();
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

        const schemaVersion = integrity.schema_version;
        const taskSequence = integrity.task_sequence;
        let prevEventSha256 = integrity.prev_event_sha256;
        const eventSha256 = String(integrity.event_sha256 || '').trim().toLowerCase();

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
function appendTaskEvent(repoRoot, taskId, eventType, outcome, message, details, options = {}) {
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
    const lockOptions = {
        timeoutMs: options.lockTimeoutMs,
        retryMs: options.lockRetryMs,
        staleMs: options.lockStaleMs
    };

    const event = {
        timestamp_utc: new Date().toISOString(),
        task_id: safeTaskId,
        event_type: eventType,
        outcome: outcome,
        actor: actor,
        message: message,
        details: details
    };

    const result = {
        task_event_log_path: taskFilePath.replace(/\\/g, '/'),
        all_tasks_log_path: allTasksPath.replace(/\\/g, '/'),
        integrity: null,
        warnings: []
    };

    let line = null;
    try {
        fs.mkdirSync(eventsRoot, { recursive: true });

        withFilesystemLock(taskLockPath, lockOptions, function () {
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
            event.integrity.event_sha256 = buildEventIntegrityHash(event);
            line = JSON.stringify(event);

            const preWriteDelayMs = toPositiveInteger(options.preWriteDelayMs, 0);
            if (preWriteDelayMs > 0) {
                sleepMs(preWriteDelayMs);
            }

            fs.appendFileSync(taskFilePath, line + '\n', 'utf8');
            result.integrity = Object.assign({}, event.integrity);
        });
    } catch (err) {
        const warning = `task-event append failed: ${err.message || err}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
        return passThru ? result : null;
    }

    try {
        withFilesystemLock(aggregateLockPath, lockOptions, function () {
            fs.appendFileSync(allTasksPath, (line || '') + '\n', 'utf8');
        });
    } catch (err) {
        const warning = `task-event aggregate append failed: ${err.message || err}`;
        result.warnings.push(warning);
        process.stderr.write(`WARNING: ${warning}\n`);
    }

    return passThru ? result : null;
}

module.exports = {
    appendTaskEvent,
    assertValidTaskId,
    buildEventIntegrityHash,
    inspectTaskEventFile,
    normalizeIntegrityValue,
    readTaskEventAppendState,
    readTaskEventAppendStateFast
};
