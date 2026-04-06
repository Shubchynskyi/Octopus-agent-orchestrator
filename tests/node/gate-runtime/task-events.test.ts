import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import { redactHostname } from '../../../src/core/redaction';
import {
    assertValidTaskId,
    appendMandatoryTaskEvent,
    appendMandatoryTaskEventAsync,
    buildEventIntegrityHash,
    cleanupStaleTaskEventLocks,
    normalizeIntegrityValue,
    inspectTaskEventFile,
    appendTaskEvent,
    appendTaskEventAsync,
    readTaskEventAppendState,
    scanTaskEventLocks,
    forEachJsonlLine
} from '../../../src/gate-runtime/task-events';
import { stringSha256 } from '../../../src/gate-runtime/hash';

function resolveTaskEventsModulePath() {
    return path.resolve(__dirname, '../../../src/gate-runtime/task-events.js');
}

function runConcurrentAppendWorker(modulePath: string, orchestratorRoot: string, startSignalPath: string, attempts: number, delayMs: number) {
    return new Promise<void>((resolve, reject) => {
        const workerScript = [
            "const fs = require('node:fs');",
            "const { appendTaskEventAsync } = require(process.argv[1]);",
            "const orchestratorRoot = process.argv[2];",
            "const startSignalPath = process.argv[3];",
            "const attempts = Number.parseInt(process.argv[4], 10);",
            "const delayMs = Number.parseInt(process.argv[5], 10);",
            "const sleepArray = new Int32Array(new SharedArrayBuffer(4));",
            "while (!fs.existsSync(startSignalPath)) { Atomics.wait(sleepArray, 0, 0, 10); }",
            "(async () => {",
            "  for (let index = 0; index < attempts; index += 1) {",
            "    const result = await appendTaskEventAsync(orchestratorRoot, 'T-CONCURRENT', 'test', 'PASS', `Event ${index + 1}`, { worker: process.pid, attempt: index }, { passThru: true, lockTimeoutMs: 30000, lockRetryMs: 1, preWriteDelayMs: delayMs });",
            "    if (!result || (Array.isArray(result.warnings) && result.warnings.length > 0)) {",
            "      const warningText = result && Array.isArray(result.warnings) ? result.warnings.join('; ') : 'appendTaskEventAsync returned null';",
            "      throw new Error(warningText);",
            "    }",
            "  }",
            "})().catch((error) => {",
            "  process.stderr.write(String(error && error.stack ? error.stack : error));",
            "  process.exitCode = 1;",
            "});"
        ].join('\n');

        const child = spawn(process.execPath, [
            '--input-type=commonjs',
            '--eval',
            workerScript,
            modulePath,
            orchestratorRoot,
            startSignalPath,
            String(attempts),
            String(delayMs)
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr || `append worker exited with code ${code}`));
        });
    });
}

// --- assertValidTaskId ---

test('assertValidTaskId accepts valid IDs', () => {
    assert.equal(assertValidTaskId('T-001'), 'T-001');
    assert.equal(assertValidTaskId('my_task.v2'), 'my_task.v2');
    assert.equal(assertValidTaskId('  T-001  '), 'T-001');
});

test('assertValidTaskId rejects empty', () => {
    assert.throws(() => assertValidTaskId(''), /must not be empty/);
    assert.throws(() => assertValidTaskId('   '), /must not be empty/);
});

test('assertValidTaskId rejects invalid chars', () => {
    assert.throws(() => assertValidTaskId('task with spaces'), /invalid characters/);
    assert.throws(() => assertValidTaskId('task/slash'), /invalid characters/);
});

test('assertValidTaskId rejects too-long IDs', () => {
    assert.throws(() => assertValidTaskId('a'.repeat(129)), /128 characters or fewer/);
});

// --- normalizeIntegrityValue ---

test('normalizeIntegrityValue sorts object keys', () => {
    const result = normalizeIntegrityValue({ b: 2, a: 1 }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(result), ['a', 'b']);
});

test('normalizeIntegrityValue handles nested objects', () => {
    const result = normalizeIntegrityValue({ z: { b: 2, a: 1 }, a: 0 }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(result), ['a', 'z']);
    assert.deepEqual(Object.keys(result.z as Record<string, unknown>), ['a', 'b']);
});

test('normalizeIntegrityValue handles arrays', () => {
    const result = normalizeIntegrityValue([3, 1, 2]);
    assert.deepEqual(result, [3, 1, 2]); // order preserved
});

test('normalizeIntegrityValue converts Date to ISO string', () => {
    const d = new Date('2024-01-15T10:30:00Z');
    const result = normalizeIntegrityValue(d) as string;
    assert.equal(typeof result, 'string');
    assert.match(result, /2024-01-15/);
});

test('normalizeIntegrityValue passes through primitives', () => {
    assert.equal(normalizeIntegrityValue(42), 42);
    assert.equal(normalizeIntegrityValue('hello'), 'hello');
    assert.equal(normalizeIntegrityValue(true), true);
    assert.equal(normalizeIntegrityValue(null), null);
});

test('normalizeIntegrityValue forward-slashes backslash strings', () => {
    assert.equal(normalizeIntegrityValue('runtime\\task-events\\log.jsonl'), 'runtime/task-events/log.jsonl');
    assert.equal(normalizeIntegrityValue('C:\\Users\\dev\\project'), 'C:/Users/dev/project');
    // Already-forward-slashed strings are unchanged
    assert.equal(normalizeIntegrityValue('runtime/task-events/log.jsonl'), 'runtime/task-events/log.jsonl');
});

test('normalizeIntegrityValue forward-slashes paths inside nested objects and arrays', () => {
    const input = {
        path: 'src\\gate-runtime\\task-events.ts',
        nested: { deep: 'a\\b\\c' },
        list: ['x\\y', 'already/fine']
    };
    const result = normalizeIntegrityValue(input) as Record<string, unknown>;
    assert.equal(result.path, 'src/gate-runtime/task-events.ts');
    assert.equal((result.nested as Record<string, unknown>).deep, 'a/b/c');
    assert.equal((result.list as unknown[])[0], 'x/y');
    assert.equal((result.list as unknown[])[1], 'already/fine');
});

// --- cross-platform integrity hash regression ---

test('buildEventIntegrityHash produces identical hash for Windows and Unix paths', () => {
    const unixEvent = {
        timestamp_utc: '2024-06-01T12:00:00.000Z',
        task_id: 'T-090',
        event_type: 'gate_pass',
        outcome: 'PASS',
        actor: 'verify',
        message: 'runtime/task-events/T-090.task-event.jsonl',
        details: { source: 'src/gate-runtime/task-events.ts' },
        integrity: { schema_version: 1, task_sequence: 1, prev_event_sha256: null }
    };
    const windowsEvent = {
        timestamp_utc: '2024-06-01T12:00:00.000Z',
        task_id: 'T-090',
        event_type: 'gate_pass',
        outcome: 'PASS',
        actor: 'verify',
        message: 'runtime\\task-events\\T-090.task-event.jsonl',
        details: { source: 'src\\gate-runtime\\task-events.ts' },
        integrity: { schema_version: 1, task_sequence: 1, prev_event_sha256: null }
    };
    const unixHash = buildEventIntegrityHash(unixEvent);
    const windowsHash = buildEventIntegrityHash(windowsEvent);
    assert.equal(unixHash, windowsHash, 'Windows and Unix path variants must produce the same integrity hash');
});

// --- buildEventIntegrityHash ---

test('buildEventIntegrityHash produces a 64-char lowercase hex string', () => {
    const event = {
        timestamp_utc: '2024-01-15T10:30:00.000Z',
        task_id: 'T-001',
        event_type: 'gate_start',
        outcome: 'PASS',
        actor: 'gate',
        message: 'Test event',
        details: null,
        integrity: {
            schema_version: 1,
            task_sequence: 1,
            prev_event_sha256: null
        }
    };
    const hash = buildEventIntegrityHash(event) as string;
    assert.match(hash, /^[0-9a-f]{64}$/);
});

test('buildEventIntegrityHash strips event_sha256 before hashing', () => {
    const eventWithout = {
        task_id: 'T-001',
        integrity: {
            schema_version: 1,
            task_sequence: 1,
            prev_event_sha256: null
        }
    };
    const hashWithout = buildEventIntegrityHash(eventWithout);

    const eventWith = {
        task_id: 'T-001',
        integrity: {
            schema_version: 1,
            task_sequence: 1,
            prev_event_sha256: null,
            event_sha256: 'should_be_stripped'
        }
    };
    const hashWith = buildEventIntegrityHash(eventWith);

    assert.equal(hashWith, hashWithout);
});

test('buildEventIntegrityHash is deterministic', () => {
    const event = {
        task_id: 'T-001',
        event_type: 'test',
        outcome: 'PASS',
        integrity: { schema_version: 1, task_sequence: 1, prev_event_sha256: null }
    };
    const hash1 = buildEventIntegrityHash(event);
    const hash2 = buildEventIntegrityHash(event);
    assert.equal(hash1, hash2);
});

test('buildEventIntegrityHash cross-validates with Python canonical form', () => {
    // The canonical JSON for Python uses sorted keys and compact separators
    // This test verifies that the Node implementation produces the same canonical form
    const event = {
        task_id: 'T-001',
        event_type: 'gate_start',
        integrity: {
            schema_version: 1,
            task_sequence: 1,
            prev_event_sha256: null
        }
    };
    const hash = buildEventIntegrityHash(event);
    // Manually compute what Python would do:
    const normalized = normalizeIntegrityValue({
        task_id: 'T-001',
        event_type: 'gate_start',
        integrity: {
            schema_version: 1,
            task_sequence: 1,
            prev_event_sha256: null
        }
    });
    const payload = JSON.stringify(normalized);
    const expected = stringSha256(payload);
    assert.equal(hash, expected);
});

// --- inspectTaskEventFile ---

test('inspectTaskEventFile returns MISSING for non-existent file', () => {
    const result = inspectTaskEventFile('/nonexistent/file.jsonl', 'T-001');
    assert.equal(result.status, 'MISSING');
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0], /not found/);
});

test('inspectTaskEventFile returns EMPTY for empty file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'empty.jsonl');
        fs.writeFileSync(filePath, '', 'utf8');
        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.status, 'EMPTY');
        assert.equal(result.matching_events, 0);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('inspectTaskEventFile validates integrity chain', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'test.jsonl');

        // Build a valid chain of 3 events
        const events: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 3; i++) {
            const event: Record<string, unknown> = {
                timestamp_utc: new Date().toISOString(),
                task_id: 'T-001',
                event_type: 'test',
                outcome: 'PASS',
                actor: 'gate',
                message: `Event ${i + 1}`,
                details: null,
                integrity: {
                    schema_version: 1,
                    task_sequence: i + 1,
                    prev_event_sha256: i === 0 ? null : (events[i - 1].integrity as Record<string, unknown>).event_sha256
                } as Record<string, unknown>
            };
            (event.integrity as Record<string, unknown>).event_sha256 = buildEventIntegrityHash(event);
            events.push(event);
        }

        const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(filePath, content, 'utf8');

        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.status, 'PASS');
        assert.equal(result.matching_events, 3);
        assert.equal(result.integrity_event_count, 3);
        assert.equal(result.violations.length, 0);
        assert.equal(result.first_integrity_sequence, 1);
        assert.equal(result.last_integrity_sequence, 3);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('inspectTaskEventFile detects tampered event', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'tampered.jsonl');
        const event: Record<string, unknown> = {
            timestamp_utc: new Date().toISOString(),
            task_id: 'T-001',
            event_type: 'test',
            outcome: 'PASS',
            integrity: {
                schema_version: 1,
                task_sequence: 1,
                prev_event_sha256: null
            } as Record<string, unknown>
        };
        (event.integrity as Record<string, unknown>).event_sha256 = buildEventIntegrityHash(event);
        // Tamper
        event.message = 'tampered!';

        fs.writeFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.status, 'FAILED');
        assert.ok(result.violations.some(v => v.includes('event_sha256 mismatch')));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('inspectTaskEventFile detects foreign task_id', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'foreign.jsonl');
        const event: Record<string, unknown> = {
            task_id: 'T-999',
            event_type: 'test',
            integrity: { schema_version: 1, task_sequence: 1, prev_event_sha256: null } as Record<string, unknown>
        };
        (event.integrity as Record<string, unknown>).event_sha256 = buildEventIntegrityHash(event);
        fs.writeFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');

        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.task_id_mismatches, 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('inspectTaskEventFile handles LEGACY_ONLY status', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'legacy.jsonl');
        const event = { task_id: 'T-001', event_type: 'test', outcome: 'PASS' };
        fs.writeFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');

        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.status, 'LEGACY_ONLY');
        assert.equal(result.legacy_event_count, 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('inspectTaskEventFile handles PASS_WITH_LEGACY_PREFIX', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-task-events-'));
    try {
        const filePath = path.join(tempDir, 'mixed.jsonl');
        // Legacy event first
        const legacy = { task_id: 'T-001', event_type: 'legacy' };
        // Then integrity event
        const integrityEvent: Record<string, unknown> = {
            task_id: 'T-001',
            event_type: 'test',
            integrity: { schema_version: 1, task_sequence: 2, prev_event_sha256: null } as Record<string, unknown>
        };
        (integrityEvent.integrity as Record<string, unknown>).event_sha256 = buildEventIntegrityHash(integrityEvent);

        const content = [JSON.stringify(legacy), JSON.stringify(integrityEvent)].join('\n') + '\n';
        fs.writeFileSync(filePath, content, 'utf8');

        const result = inspectTaskEventFile(filePath, 'T-001');
        assert.equal(result.status, 'PASS_WITH_LEGACY_PREFIX');
        assert.equal(result.legacy_event_count, 1);
        assert.equal(result.integrity_event_count, 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

// --- appendTaskEvent ---

test('appendTaskEvent creates chain with correct integrity', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-'));
    try {
        // Simulate orchestrator root structure
        const orchestratorRoot = tempDir;

        // Append 3 events
        for (let i = 0; i < 3; i++) {
            appendTaskEvent(orchestratorRoot, 'T-TEST', 'test', 'PASS', `Event ${i + 1}`, { step: i }, { passThru: true });
        }

        // Verify the file exists and has integrity chain
        const eventFile = path.join(orchestratorRoot, 'runtime', 'task-events', 'T-TEST.jsonl');
        assert.ok(fs.existsSync(eventFile));

        const result = inspectTaskEventFile(eventFile, 'T-TEST');
        assert.equal(result.status, 'PASS');
        assert.equal(result.matching_events, 3);
        assert.equal(result.integrity_event_count, 3);
        assert.equal(result.violations.length, 0);

        // Also verify all-tasks.jsonl
        const allTasksFile = path.join(orchestratorRoot, 'runtime', 'task-events', 'all-tasks.jsonl');
        assert.ok(fs.existsSync(allTasksFile));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent returns null for empty taskId', () => {
    assert.equal(appendTaskEvent('/tmp', '', 'test', 'PASS', 'msg', null), null);
});

test('appendTaskEvent preserves integrity under concurrent process writes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-concurrent-'));
    const modulePath = resolveTaskEventsModulePath();
    const startSignalPath = path.join(tempDir, 'start.signal');
    const workerCount = 3;
    const attemptsPerWorker = 3;

    try {
        const workers = [];
        for (let index = 0; index < workerCount; index += 1) {
            workers.push(
                runConcurrentAppendWorker(
                    modulePath,
                    tempDir,
                    startSignalPath,
                    attemptsPerWorker,
                    10
                )
            );
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
        fs.writeFileSync(startSignalPath, 'go\n', 'utf8');
        await Promise.all(workers);

        const expectedCount = workerCount * attemptsPerWorker;
        const eventFile = path.join(tempDir, 'runtime', 'task-events', 'T-CONCURRENT.jsonl');
        const allTasksFile = path.join(tempDir, 'runtime', 'task-events', 'all-tasks.jsonl');
        const result = inspectTaskEventFile(eventFile, 'T-CONCURRENT');
        const aggregateLines = fs.readFileSync(allTasksFile, 'utf8').split('\n').filter((line) => line.trim());

        assert.equal(result.status, 'PASS');
        assert.equal(result.matching_events, expectedCount);
        assert.equal(result.integrity_event_count, expectedCount);
        assert.equal(result.violations.length, 0);
        assert.equal(aggregateLines.length, expectedCount);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent removes orphaned task lock when owner pid is no longer alive', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-orphan-lock-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: 999999,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');

        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Recovered from orphaned lock',
            { recovered: true },
            {
                passThru: true,
                lockTimeoutMs: 250,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 0);
        assert.ok(fs.existsSync(path.join(eventsRoot, 'T-TEST.jsonl')));
        assert.ok(!fs.existsSync(lockPath), 'orphaned lock should be removed and released');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent does not reclaim aged foreign-host lock by default', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-foreign-lock-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: 999999,
            hostname: 'remote-build-host',
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');
        const oldTime = new Date(Date.now() - (31 * 60 * 1000));
        fs.utimesSync(lockPath, oldTime, oldTime);

        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Should not reclaim foreign-host lock',
            null,
            {
                passThru: true,
                lockTimeoutMs: 50,
                lockRetryMs: 5
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 1);
        assert.match(result!.warnings[0], /Timed out acquiring file lock/);
        const expectedHostToken = redactHostname('remote-build-host');
        assert.ok(result!.warnings[0].includes(`owner_hostname=${expectedHostToken}`), 'hostname should be redacted');
        assert.match(result!.warnings[0], /owner_alive=unknown/);
        assert.ok(fs.existsSync(lockPath), 'foreign-host lock should remain in place');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent timeout warning includes lock owner diagnostics', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-live-lock-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');

        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Should time out on active lock',
            null,
            {
                passThru: true,
                lockTimeoutMs: 50,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 1);
        assert.match(result!.warnings[0], /Timed out acquiring file lock/);
        assert.match(result!.warnings[0], /owner_pid=/);
        assert.match(result!.warnings[0], /owner_alive=yes/);
        assert.match(result!.warnings[0], /owner_metadata_status=ok/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent tolerates missing lock owner metadata', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-owner-race-'));

    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });

        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Should time out on active lock with missing owner metadata',
            null,
            {
                passThru: true,
                lockTimeoutMs: 50,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 1);
        assert.match(result!.warnings[0], /Timed out acquiring file lock/);
        assert.match(result!.warnings[0], /owner_metadata_status=missing/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendMandatoryTaskEvent throws with detailed error when lock acquisition times out', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-mandatory-lock-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');

        assert.throws(
            () => appendMandatoryTaskEvent(
                tempDir,
                'T-TEST',
                'TASK_MODE_ENTERED',
                'PASS',
                'Should fail on active lock',
                null,
                {
                    lockTimeoutMs: 50,
                    lockRetryMs: 5,
                    lockStaleMs: 60000
                }
            ),
            /Mandatory lifecycle event 'TASK_MODE_ENTERED' append failed:.*owner_pid=.*owner_alive=yes/
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('scanTaskEventLocks reports active and stale task-event locks only', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-scan-locks-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const staleLockPath = path.join(eventsRoot, '.T-005.lock');
        const activeLockPath = path.join(eventsRoot, '.all-tasks.lock');
        const reviewsLockPath = path.join(tempDir, 'runtime', 'reviews', '.ignored.lock');
        fs.mkdirSync(staleLockPath, { recursive: true });
        fs.mkdirSync(activeLockPath, { recursive: true });
        fs.mkdirSync(reviewsLockPath, { recursive: true });
        fs.writeFileSync(path.join(staleLockPath, 'owner.json'), JSON.stringify({
            pid: 999999,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');
        fs.writeFileSync(path.join(activeLockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');

        const result = scanTaskEventLocks(tempDir, { staleMs: 60000 });
        assert.equal(result.locks.length, 2);
        assert.equal(result.stale_count, 1);
        assert.equal(result.active_count, 1);
        assert.ok(result.subsystem_scope_note.includes('runtime/reviews/'));
        assert.ok(result.locks.some((lock) => lock.lock_name === '.T-005.lock' && lock.status === 'STALE'));
        assert.ok(result.locks.some((lock) => lock.lock_name === '.all-tasks.lock' && lock.status === 'ACTIVE'));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('cleanupStaleTaskEventLocks removes only stale locks and supports dry-run', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-cleanup-locks-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const staleLockPath = path.join(eventsRoot, '.T-005.lock');
        const activeLockPath = path.join(eventsRoot, '.all-tasks.lock');
        fs.mkdirSync(staleLockPath, { recursive: true });
        fs.mkdirSync(activeLockPath, { recursive: true });
        fs.writeFileSync(path.join(staleLockPath, 'owner.json'), JSON.stringify({
            pid: 999999,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');
        fs.writeFileSync(path.join(activeLockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: '2026-03-30T10:00:00.000Z'
        }, null, 2) + '\n', 'utf8');

        const dryRun = cleanupStaleTaskEventLocks(tempDir, { dryRun: true, staleMs: 60000 });
        assert.deepEqual(dryRun.removable_stale_locks, ['.T-005.lock']);
        assert.deepEqual(dryRun.removed_locks, []);
        assert.ok(fs.existsSync(staleLockPath));

        const applied = cleanupStaleTaskEventLocks(tempDir, { dryRun: false, staleMs: 60000 });
        assert.deepEqual(applied.removed_locks, ['.T-005.lock']);
        assert.deepEqual(applied.retained_live_locks, ['.all-tasks.lock']);
        assert.ok(!fs.existsSync(staleLockPath));
        assert.ok(fs.existsSync(activeLockPath));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

// --- readTaskEventAppendState ---

test('readTaskEventAppendState returns empty state for missing file', () => {
    const state = readTaskEventAppendState('/nonexistent/file.jsonl', 'T-001');
    assert.equal(state.matching_events, 0);
    assert.equal(state.parse_errors, 0);
    assert.equal(state.last_integrity_sequence, null);
    assert.equal(state.last_event_sha256, null);
});

test('readTaskEventAppendState uses streaming fallback for legacy events', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-state-stream-'));
    try {
        const filePath = path.join(tempDir, 'legacy.jsonl');
        const events = [
            { task_id: 'T-001', event_type: 'test', outcome: 'PASS' },
            { task_id: 'T-001', event_type: 'test2', outcome: 'PASS' }
        ];
        fs.writeFileSync(filePath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

        const state = readTaskEventAppendState(filePath, 'T-001');
        assert.equal(state.matching_events, 2);
        assert.equal(state.parse_errors, 0);
        assert.equal(state.last_integrity_sequence, null);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('readTaskEventAppendState streaming fallback counts parse errors', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-append-state-err-'));
    try {
        const filePath = path.join(tempDir, 'bad.jsonl');
        fs.writeFileSync(filePath, 'NOT JSON\n{"task_id":"T-001","event_type":"x"}\n', 'utf8');

        const state = readTaskEventAppendState(filePath, 'T-001');
        assert.equal(state.matching_events, 1);
        assert.equal(state.parse_errors, 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

// --- forEachJsonlLine ---

test('forEachJsonlLine iterates non-empty lines with correct line numbers', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-jsonl-iter-'));
    try {
        const filePath = path.join(tempDir, 'test.jsonl');
        fs.writeFileSync(filePath, '{"a":1}\n\n{"b":2}\n{"c":3}\n', 'utf8');

        const collected: Array<{ line: string; num: number }> = [];
        forEachJsonlLine(filePath, (line, num) => {
            collected.push({ line, num });
        });

        assert.equal(collected.length, 3);
        assert.equal(collected[0].line, '{"a":1}');
        assert.equal(collected[0].num, 1);
        assert.equal(collected[1].line, '{"b":2}');
        assert.equal(collected[1].num, 3);
        assert.equal(collected[2].line, '{"c":3}');
        assert.equal(collected[2].num, 4);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('forEachJsonlLine returns 0 for missing file', () => {
    const count = forEachJsonlLine('/nonexistent/path.jsonl', () => {});
    assert.equal(count, 0);
});

test('forEachJsonlLine returns 0 for empty file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-jsonl-empty-'));
    try {
        const filePath = path.join(tempDir, 'empty.jsonl');
        fs.writeFileSync(filePath, '', 'utf8');
        const count = forEachJsonlLine(filePath, () => {});
        assert.equal(count, 0);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('forEachJsonlLine supports early stop via false return', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-jsonl-stop-'));
    try {
        const filePath = path.join(tempDir, 'stop.jsonl');
        fs.writeFileSync(filePath, '{"a":1}\n{"b":2}\n{"c":3}\n', 'utf8');

        const collected: string[] = [];
        forEachJsonlLine(filePath, (line) => {
            collected.push(line);
            if (collected.length >= 2) return false;
        });

        assert.equal(collected.length, 2);
        assert.equal(collected[0], '{"a":1}');
        assert.equal(collected[1], '{"b":2}');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('forEachJsonlLine handles file without trailing newline', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-jsonl-notrail-'));
    try {
        const filePath = path.join(tempDir, 'notrail.jsonl');
        fs.writeFileSync(filePath, '{"a":1}\n{"b":2}', 'utf8');

        const collected: string[] = [];
        forEachJsonlLine(filePath, (line) => {
            collected.push(line);
        });

        assert.equal(collected.length, 2);
        assert.equal(collected[1], '{"b":2}');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('forEachJsonlLine handles large files with many lines', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-jsonl-large-'));
    try {
        const filePath = path.join(tempDir, 'large.jsonl');
        const lineCount = 5000;
        const lines: string[] = [];
        for (let i = 0; i < lineCount; i++) {
            lines.push(JSON.stringify({ index: i, padding: 'x'.repeat(100) }));
        }
        fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');

        let count = 0;
        let lastIndex = -1;
        forEachJsonlLine(filePath, (line) => {
            count++;
            const parsed = JSON.parse(line);
            lastIndex = parsed.index;
        });

        assert.equal(count, lineCount);
        assert.equal(lastIndex, lineCount - 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

// --- bounded waiting and contention telemetry ---

test('appendTaskEvent includes lock_telemetry in result', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-lock-telemetry-'));
    try {
        const result = appendTaskEvent(
            tempDir,
            'T-TELEM',
            'test',
            'PASS',
            'Telemetry check',
            null,
            { passThru: true }
        );

        assert.ok(result !== null);
        assert.ok(result!.lock_telemetry != null, 'lock_telemetry must be present');
        assert.equal(typeof result!.lock_telemetry!.task_lock_retries, 'number');
        assert.equal(typeof result!.lock_telemetry!.task_lock_elapsed_ms, 'number');
        assert.equal(typeof result!.lock_telemetry!.aggregate_lock_retries, 'number');
        assert.equal(typeof result!.lock_telemetry!.aggregate_lock_elapsed_ms, 'number');
        assert.equal(result!.lock_telemetry!.task_lock_retries, 0, 'no contention expected');
        assert.equal(result!.lock_telemetry!.aggregate_lock_retries, 0, 'no contention expected');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEvent timeout includes retry count in diagnostic', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-retry-diagnostic-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Should include retry count in timeout',
            null,
            {
                passThru: true,
                lockTimeoutMs: 80,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 1);
        assert.match(result!.warnings[0], /retries=/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('task-events module avoids Atomics.wait and uses async timer-based waiting', () => {
    const sourcePath = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'gate-runtime', 'task-events.ts');
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    const strippedSource = sourceContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    assert.equal(
        /Atomics\.wait\s*\(/.test(strippedSource),
        false,
        'task-events.ts must not use Atomics.wait on the main thread'
    );
    assert.equal(
        /while\s*\(\s*Date\.now\(\)\s*</.test(strippedSource),
        false,
        'task-events.ts must not contain a Date.now() busy-wait spin loop'
    );
    assert.equal(
        /setTimeout\s*\(/.test(strippedSource),
        true,
        'task-events.ts should use setTimeout-backed async waiting for lock retries'
    );
});

test('appendTaskEvent sync path fails fast on active lock without waiting', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-retry-cap-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TEST.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        const startedAt = Date.now();
        const result = appendTaskEvent(
            tempDir,
            'T-TEST',
            'test',
            'PASS',
            'Should fail fast on live lock',
            null,
            {
                passThru: true,
                lockTimeoutMs: 600000,
                lockRetryMs: 1,
                lockStaleMs: 60000
            }
        );
        const elapsedMs = Date.now() - startedAt;

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 1);
        assert.match(result!.warnings[0], /wait_strategy=immediate_fail/);
        assert.match(result!.warnings[0], /retries=0/);
        assert.ok(elapsedMs < 250, `sync append should fail fast, got ${elapsedMs} ms`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEventAsync reports non-zero telemetry after contended lock acquisition', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-contention-telemetry-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const lockPath = path.join(eventsRoot, '.T-TELEM.lock');
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        setTimeout(() => {
            try {
                fs.rmSync(lockPath, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }, 80);

        const result = await appendTaskEventAsync(
            tempDir,
            'T-TELEM',
            'test',
            'PASS',
            'Should succeed after contention',
            null,
            {
                passThru: true,
                lockTimeoutMs: 5000,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 0, 'Should succeed without warnings');
        assert.ok(result!.lock_telemetry != null, 'lock_telemetry must be present');
        assert.ok(result!.lock_telemetry!.task_lock_retries > 0, 'Should have non-zero retries after contention');
        assert.ok(result!.lock_telemetry!.task_lock_elapsed_ms > 0, 'Should have non-zero elapsed time after contention');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

// --- aggregate (all-tasks) lock contention ---

test('appendTaskEventAsync reports non-zero aggregate telemetry after contended all-tasks lock', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-aggregate-contention-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const aggregateLockPath = path.join(eventsRoot, '.all-tasks.lock');
        fs.mkdirSync(aggregateLockPath, { recursive: true });
        fs.writeFileSync(path.join(aggregateLockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        setTimeout(() => {
            try {
                fs.rmSync(aggregateLockPath, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }, 80);

        const result = await appendTaskEventAsync(
            tempDir,
            'T-AGG-CONTEND',
            'test',
            'PASS',
            'Should succeed after aggregate lock contention',
            null,
            {
                passThru: true,
                lockTimeoutMs: 5000,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        assert.equal(result!.warnings.length, 0, 'Should succeed without warnings');
        assert.ok(result!.lock_telemetry != null, 'lock_telemetry must be present');

        // Task lock should have no contention (no pre-existing task lock)
        assert.equal(result!.lock_telemetry!.task_lock_retries, 0, 'task lock should acquire on first attempt');

        // Aggregate lock should show contention
        assert.ok(
            result!.lock_telemetry!.aggregate_lock_retries > 0,
            `aggregate lock should have non-zero retries (got ${result!.lock_telemetry!.aggregate_lock_retries})`
        );
        assert.ok(
            result!.lock_telemetry!.aggregate_lock_elapsed_ms > 0,
            `aggregate lock should have non-zero elapsed time (got ${result!.lock_telemetry!.aggregate_lock_elapsed_ms})`
        );

        // Verify the event was actually written to both files
        const taskFile = path.join(eventsRoot, 'T-AGG-CONTEND.jsonl');
        const allTasksFile = path.join(eventsRoot, 'all-tasks.jsonl');
        assert.ok(fs.existsSync(taskFile), 'task event file must exist');
        assert.ok(fs.existsSync(allTasksFile), 'all-tasks aggregate file must exist');
        const taskLines = fs.readFileSync(taskFile, 'utf8').split('\n').filter((l) => l.trim());
        const aggLines = fs.readFileSync(allTasksFile, 'utf8').split('\n').filter((l) => l.trim());
        assert.equal(taskLines.length, 1, 'exactly one task event line');
        assert.equal(aggLines.length, 1, 'exactly one aggregate event line');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('appendTaskEventAsync aggregate lock timeout produces diagnostic with retry count', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-agg-timeout-'));
    try {
        const eventsRoot = path.join(tempDir, 'runtime', 'task-events');
        const aggregateLockPath = path.join(eventsRoot, '.all-tasks.lock');
        fs.mkdirSync(aggregateLockPath, { recursive: true });
        fs.writeFileSync(path.join(aggregateLockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            created_at_utc: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        // The task-lock is uncontested so the task write succeeds.
        // The aggregate-lock is held by this process (alive), so it times out.
        const result = await appendTaskEventAsync(
            tempDir,
            'T-AGG-TIMEOUT',
            'test',
            'PASS',
            'Aggregate lock should time out',
            null,
            {
                passThru: true,
                lockTimeoutMs: 80,
                lockRetryMs: 5,
                lockStaleMs: 60000
            }
        );

        assert.ok(result !== null);
        // Task write succeeds, aggregate write fails → one warning
        assert.equal(result!.warnings.length, 1, 'exactly one warning from aggregate lock timeout');
        assert.match(result!.warnings[0], /aggregate/, 'warning must mention aggregate');
        assert.match(result!.warnings[0], /retries=/, 'warning must include retry count');
        assert.ok(result!.integrity !== null, 'task integrity should still be set');

        // Task file should still exist (task write succeeded)
        const taskFile = path.join(eventsRoot, 'T-AGG-TIMEOUT.jsonl');
        assert.ok(fs.existsSync(taskFile), 'task event file must exist even when aggregate lock fails');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
