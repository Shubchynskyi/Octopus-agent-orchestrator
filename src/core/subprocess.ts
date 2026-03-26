const childProcess = require('node:child_process');

// ---------------------------------------------------------------------------
// Default timeout constants (milliseconds)
// ---------------------------------------------------------------------------

const DEFAULT_GIT_TIMEOUT_MS = 60_000;         // 60 s for routine git ops
const DEFAULT_GIT_CLONE_TIMEOUT_MS = 300_000;  // 5 min for clone/fetch
const DEFAULT_NPM_TIMEOUT_MS = 300_000;        // 5 min for npm operations
const DEFAULT_COMPILE_TIMEOUT_MS = 600_000;    // 10 min for compile/test/lint

// ---------------------------------------------------------------------------
// spawnStreamed – async subprocess with streaming, timeout & cancellation
// ---------------------------------------------------------------------------

/**
 * Spawn a child process with streamed output, explicit timeout, and
 * AbortController-based cancellation.
 *
 * @param {string} command  Executable path or name
 * @param {string[]} args   Arguments
 * @param {object} [options]
 * @param {string}        [options.cwd]
 * @param {number}        [options.timeoutMs]      Max runtime in ms (0 = unlimited)
 * @param {AbortSignal}   [options.signal]         External cancellation signal
 * @param {boolean}       [options.shell]          Run through the system shell
 * @param {object}        [options.env]            Env overrides (merged with process.env)
 * @param {Function}      [options.onStdout]       (chunk: string) => void
 * @param {Function}      [options.onStderr]       (chunk: string) => void
 * @param {boolean}       [options.inheritStdio]   Use stdio: 'inherit' (interactive)
 * @param {number}        [options.maxBuffer]      Max buffered bytes (default 50 MB)
 * @returns {Promise<SpawnStreamedResult>}
 *
 * @typedef {object} SpawnStreamedResult
 * @property {number}  exitCode
 * @property {string}  stdout
 * @property {string}  stderr
 * @property {boolean} timedOut
 * @property {boolean} cancelled
 */
function spawnStreamed(command, args, options) {
    const opts = options || {};
    const cwd = opts.cwd || process.cwd();
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 0;
    const signal = opts.signal || null;
    const maxBuffer = opts.maxBuffer || 50 * 1024 * 1024;
    const inheritStdio = opts.inheritStdio || false;

    return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) {
            return resolve({
                exitCode: 1,
                stdout: '',
                stderr: '',
                timedOut: false,
                cancelled: true
            });
        }

        let settled = false;
        let timedOut = false;
        let cancelled = false;
        let timeoutHandle = null;
        let stdoutBuf = '';
        let stderrBuf = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;

        const spawnOpts = {
            cwd,
            windowsHide: true,
            stdio: inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe']
        };
        if (opts.shell) {
            spawnOpts.shell = true;
        }
        if (opts.env) {
            spawnOpts.env = { ...process.env, ...opts.env };
        }

        const child = childProcess.spawn(command, args, spawnOpts);

        function cleanup() {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        }

        function killChild() {
            try {
                if (process.platform === 'win32') {
                    // On Windows, child.kill() sends SIGTERM which may not kill the
                    // process tree. Use taskkill for a reliable tree-kill.
                    try {
                        childProcess.execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                            stdio: 'ignore',
                            windowsHide: true,
                            timeout: 5000
                        });
                    } catch (_e) {
                        child.kill('SIGKILL');
                    }
                } else {
                    child.kill('SIGTERM');
                    // Follow up with SIGKILL after a grace period
                    setTimeout(function () {
                        try { child.kill('SIGKILL'); } catch (_e) { /* already exited */ }
                    }, 3000);
                }
            } catch (_e) {
                // Child already exited
            }
        }

        function settle(result) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        }

        function onAbort() {
            if (settled) return;
            cancelled = true;
            killChild();
        }

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        if (timeoutMs > 0) {
            timeoutHandle = setTimeout(function () {
                if (settled) return;
                timedOut = true;
                killChild();
            }, timeoutMs);
        }

        child.once('error', function (error) {
            cleanup();
            if (settled) return;
            settled = true;
            if (error && error.code === 'ENOENT') {
                reject(new Error(`'${command}' is required but was not found in PATH.`));
            } else {
                reject(error);
            }
        });

        if (!inheritStdio) {
            if (child.stdout) {
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', function (chunk) {
                    const len = Buffer.byteLength(chunk, 'utf8');
                    if (stdoutBytes + len <= maxBuffer) {
                        stdoutBuf += chunk;
                        stdoutBytes += len;
                    }
                    if (opts.onStdout) {
                        opts.onStdout(chunk);
                    }
                });
            }
            if (child.stderr) {
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', function (chunk) {
                    const len = Buffer.byteLength(chunk, 'utf8');
                    if (stderrBytes + len <= maxBuffer) {
                        stderrBuf += chunk;
                        stderrBytes += len;
                    }
                    if (opts.onStderr) {
                        opts.onStderr(chunk);
                    }
                });
            }
        }

        child.once('close', function (code) {
            settle({
                exitCode: code == null ? 1 : code,
                stdout: stdoutBuf,
                stderr: stderrBuf,
                timedOut,
                cancelled
            });
        });
    });
}

// ---------------------------------------------------------------------------
// spawnSyncWithTimeout – thin wrapper adding timeout to spawnSync
// ---------------------------------------------------------------------------

/**
 * Synchronous spawn with an explicit timeout and consistent option defaults.
 * Returns the same shape as child_process.spawnSync.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]   All spawnSync options plus `timeoutMs`.
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function spawnSyncWithTimeout(command, args, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || 0;
    const passThrough = { ...opts };
    delete passThrough.timeoutMs;

    if (timeoutMs > 0) {
        passThrough.timeout = timeoutMs;
    }
    if (passThrough.windowsHide === undefined) {
        passThrough.windowsHide = true;
    }

    const result = childProcess.spawnSync(command, args, passThrough);

    // spawnSync sets result.signal === 'SIGTERM' on timeout
    if (result.error && result.error.code === 'ETIMEDOUT') {
        result.timedOut = true;
    } else if (result.signal === 'SIGTERM' && timeoutMs > 0) {
        result.timedOut = true;
    } else {
        result.timedOut = false;
    }

    return result;
}

module.exports = {
    DEFAULT_COMPILE_TIMEOUT_MS,
    DEFAULT_GIT_CLONE_TIMEOUT_MS,
    DEFAULT_GIT_TIMEOUT_MS,
    DEFAULT_NPM_TIMEOUT_MS,
    spawnStreamed,
    spawnSyncWithTimeout
};
