const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILD_ROOT_LOCK_TIMEOUT_MS = 120000;
const BUILD_ROOT_LOCK_RETRY_MS = 100;
const BUILD_ROOT_LOCK_STALE_MS = 15 * 60 * 1000;
const BUILD_ROOT_LOCK_OWNER_FILENAME = 'owner.json';

function getErrorCode(error) {
    return error != null && typeof error === 'object' && 'code' in error
        ? String(error.code || '')
        : '';
}

function sleepSync(milliseconds) {
    if (!milliseconds || milliseconds <= 0) {
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isProcessLikelyAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return null;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'ESRCH') {
            return false;
        }
        if (errorCode === 'EPERM') {
            return true;
        }
        return null;
    }
}

function readBuildRootLockOwner(lockPath) {
    try {
        const raw = fs.readFileSync(path.join(lockPath, BUILD_ROOT_LOCK_OWNER_FILENAME), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed != null && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'ENOENT') {
            return null;
        }
        return null;
    }
}

function buildRootLockIsStale(lockPath) {
    let stats;
    try {
        stats = fs.statSync(lockPath);
    } catch (error) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'ENOENT') {
            return false;
        }
        throw error;
    }

    const owner = readBuildRootLockOwner(lockPath);
    const lockAgeMs = Math.max(0, Date.now() - stats.mtimeMs);
    const localHostname = os.hostname();
    let ownerAlive = null;

    if (owner != null && Number.isInteger(owner.pid) && owner.pid > 0) {
        if (typeof owner.hostname !== 'string' || owner.hostname.length === 0 || owner.hostname === localHostname) {
            ownerAlive = isProcessLikelyAlive(owner.pid);
        } else {
            return false;
        }
    }

    if (ownerAlive === false) {
        return true;
    }

    return lockAgeMs >= BUILD_ROOT_LOCK_STALE_MS && ownerAlive !== true;
}

function tryRemoveStaleBuildRootLock(lockPath) {
    if (!buildRootLockIsStale(lockPath)) {
        return false;
    }

    try {
        fs.rmSync(lockPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        return true;
    } catch {
        return false;
    }
}

function acquireBuildRootLock(lockPath) {
    const startedAt = Date.now();
    while (true) {
        try {
            fs.mkdirSync(lockPath);
            try {
                fs.writeFileSync(path.join(lockPath, BUILD_ROOT_LOCK_OWNER_FILENAME), JSON.stringify({
                    hostname: os.hostname(),
                    pid: process.pid,
                    startedAtUtc: new Date().toISOString()
                }, null, 2) + '\n', 'utf8');
            } catch (error) {
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw error;
            }
            return;
        } catch (error) {
            const errorCode = getErrorCode(error);
            if (errorCode !== 'EEXIST') {
                throw error;
            }
            if (tryRemoveStaleBuildRootLock(lockPath)) {
                continue;
            }
            if (Date.now() - startedAt >= BUILD_ROOT_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out acquiring build root lock: ${lockPath}`);
            }
            sleepSync(BUILD_ROOT_LOCK_RETRY_MS);
        }
    }
}

function releaseBuildRootLock(lockPath) {
    try {
        fs.rmSync(lockPath, { recursive: true, force: true });
    } catch {
        // best-effort lock cleanup
    }
}

function getBuildRootLockPath(buildRoot) {
    return `${buildRoot}.lock`;
}

function resetBuildRoot(buildRoot) {
    fs.mkdirSync(buildRoot, { recursive: true });

    for (const entry of fs.readdirSync(buildRoot, { withFileTypes: true })) {
        fs.rmSync(path.join(buildRoot, entry.name), {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 50
        });
    }
}

function withBuildRootLock(buildRoot, operation) {
    const lockPath = getBuildRootLockPath(buildRoot);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    acquireBuildRootLock(lockPath);
    try {
        return operation();
    } finally {
        releaseBuildRootLock(lockPath);
    }
}

module.exports = {
    acquireBuildRootLock,
    getBuildRootLockPath,
    releaseBuildRootLock,
    resetBuildRoot,
    sleepSync,
    withBuildRootLock
};
