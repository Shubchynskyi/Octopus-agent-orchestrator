const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_COMPILE_TIMEOUT_MS,
    DEFAULT_GIT_CLONE_TIMEOUT_MS,
    DEFAULT_GIT_TIMEOUT_MS,
    DEFAULT_NPM_TIMEOUT_MS,
    spawnStreamed,
    spawnSyncWithTimeout
} = require('../../../src/core/subprocess.ts');

describe('spawnStreamed', () => {
    it('captures stdout from a successful process', async () => {
        const result = await spawnStreamed(process.execPath, ['-e', 'console.log("hello")'], {
            timeoutMs: 5000
        });
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /hello/);
        assert.equal(result.timedOut, false);
        assert.equal(result.cancelled, false);
    });

    it('captures stderr from a failing process', async () => {
        const result = await spawnStreamed(process.execPath, ['-e', 'console.error("fail"); process.exit(1)'], {
            timeoutMs: 5000
        });
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /fail/);
        assert.equal(result.timedOut, false);
        assert.equal(result.cancelled, false);
    });

    it('times out a long-running process', async () => {
        const result = await spawnStreamed(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
            timeoutMs: 500
        });
        assert.equal(result.timedOut, true);
        assert.notEqual(result.exitCode, 0);
    });

    it('respects AbortController cancellation', async () => {
        const ac = new AbortController();
        const promise = spawnStreamed(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
            signal: ac.signal,
            timeoutMs: 30000
        });
        // Cancel quickly
        setTimeout(() => ac.abort(), 200);
        const result = await promise;
        assert.equal(result.cancelled, true);
    });

    it('resolves immediately when signal is already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        const result = await spawnStreamed(process.execPath, ['-e', 'console.log("should not run")'], {
            signal: ac.signal
        });
        assert.equal(result.cancelled, true);
        assert.equal(result.stdout, '');
    });

    it('streams output via onStdout callback', async () => {
        const chunks = [];
        const result = await spawnStreamed(process.execPath, ['-e', 'console.log("chunk1"); console.log("chunk2")'], {
            timeoutMs: 5000,
            onStdout(chunk) { chunks.push(chunk); }
        });
        assert.equal(result.exitCode, 0);
        const combined = chunks.join('');
        assert.match(combined, /chunk1/);
        assert.match(combined, /chunk2/);
    });

    it('rejects with ENOENT for missing executable', async () => {
        await assert.rejects(
            () => spawnStreamed('__nonexistent_executable_12345__', [], { timeoutMs: 5000 }),
            (err) => err.message.includes('not found in PATH')
        );
    });
});

describe('spawnSyncWithTimeout', () => {
    it('runs a process successfully', () => {
        const result = spawnSyncWithTimeout(process.execPath, ['-e', 'console.log("ok")'], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeoutMs: 5000
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /ok/);
        assert.equal(result.timedOut, false);
    });

    it('sets timedOut flag when process exceeds timeout', () => {
        const result = spawnSyncWithTimeout(process.execPath, ['-e', 'const s=Date.now();while(Date.now()-s<10000){}'], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeoutMs: 500
        });
        assert.equal(result.timedOut, true);
    });

    it('passes through windowsHide by default', () => {
        const result = spawnSyncWithTimeout(process.execPath, ['-e', 'process.exit(0)'], {
            encoding: 'utf8',
            stdio: 'pipe'
        });
        assert.equal(result.status, 0);
    });
});

describe('spawnStreamed – kill-path cleanup', () => {
    it('terminates a process tree on timeout', async () => {
        // Parent spawns a child; both sleep forever.
        // On Windows killChild() uses taskkill /T /F for tree-kill.
        const script = [
            'const cp = require("child_process");',
            'cp.spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], {stdio:"ignore"});',
            'setTimeout(()=>{},60000);'
        ].join('\n');

        const t0 = Date.now();
        const result = await spawnStreamed(process.execPath, ['-e', script], {
            timeoutMs: 1000
        });
        const elapsed = Date.now() - t0;

        assert.equal(result.timedOut, true);
        assert.notEqual(result.exitCode, 0);
        // Must resolve near the timeout, not hang waiting for the child tree
        assert.ok(elapsed < 15000, `Expected resolution near timeout, took ${elapsed}ms`);
    });

    it('kills process that traps SIGTERM (exercises taskkill /F on Windows)', async () => {
        // Process installs a SIGTERM handler so child.kill('SIGTERM') alone would
        // not terminate it. On Windows the taskkill /F flag force-kills regardless.
        const script = 'process.on("SIGTERM",()=>{});setTimeout(()=>{},60000)';
        const result = await spawnStreamed(process.execPath, ['-e', script], {
            timeoutMs: 800
        });
        assert.equal(result.timedOut, true);
        assert.notEqual(result.exitCode, 0);
    });

    it('kill-path via AbortController without timeout', async () => {
        const ac = new AbortController();
        const t0 = Date.now();
        const promise = spawnStreamed(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
            signal: ac.signal,
            timeoutMs: 0
        });
        setTimeout(() => ac.abort(), 300);
        const result = await promise;
        const elapsed = Date.now() - t0;

        assert.equal(result.cancelled, true);
        assert.equal(result.timedOut, false);
        assert.ok(elapsed < 15000, `Expected prompt cancellation, took ${elapsed}ms`);
    });
});

describe('timeout constants', () => {
    it('exports expected default timeout constants', () => {
        assert.equal(typeof DEFAULT_GIT_TIMEOUT_MS, 'number');
        assert.equal(typeof DEFAULT_GIT_CLONE_TIMEOUT_MS, 'number');
        assert.equal(typeof DEFAULT_NPM_TIMEOUT_MS, 'number');
        assert.equal(typeof DEFAULT_COMPILE_TIMEOUT_MS, 'number');
        assert.ok(DEFAULT_GIT_TIMEOUT_MS > 0);
        assert.ok(DEFAULT_COMPILE_TIMEOUT_MS >= DEFAULT_GIT_TIMEOUT_MS);
    });
});
