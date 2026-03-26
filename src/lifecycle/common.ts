const fs = require('node:fs');
const path = require('node:path');

const ROLLBACK_RECORDS_FILE_NAME = 'rollback-records.json';
const SYNC_BACKUP_METADATA_FILE_NAME = 'sync-backup-metadata.json';
const UPDATE_SENTINEL_FILE_NAME = '.update-in-progress';
const UNINSTALL_SENTINEL_FILE_NAME = '.uninstall-in-progress';

// ---------------------------------------------------------------------------
// Version comparison used by update flows.
// ---------------------------------------------------------------------------

function compareVersionStrings(current, latest) {
    const normalize = (v) => String(v).trim().replace(/^[vV]/, '');
    const a = normalize(current);
    const b = normalize(latest);

    // Separate core version from prerelease and build metadata.
    // Build metadata (+…) is always ignored per SemVer §10.
    const splitVersion = (value) => {
        const noBuild = value.split('+')[0];
        const dashIdx = noBuild.indexOf('-');
        if (dashIdx === -1) return { core: noBuild, prerelease: '' };
        return { core: noBuild.slice(0, dashIdx), prerelease: noBuild.slice(dashIdx + 1) };
    };

    const aParts = splitVersion(a);
    const bParts = splitVersion(b);

    const parseSegments = (value) =>
        value.split('.').map((segment) => {
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

function getTimestamp() {
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-` +
        `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    );
}

// ---------------------------------------------------------------------------
// Recursive file copy / directory helpers
// ---------------------------------------------------------------------------

function copyPathRecursive(sourcePath, destinationPath) {
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

function removePathRecursive(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function readdirRecursiveFiles(dirPath) {
    const results = [];
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

function readdirRecursiveDirs(dirPath) {
    const results = [];
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

const BUNDLE_SYNC_ITEMS = Object.freeze([
    '.gitattributes',
    'bin',
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

function createRollbackSnapshot(rootPath, snapshotRoot, relativePaths) {
    const unique = [...new Set(relativePaths)].sort();
    const records = [];

    for (const rel of unique) {
        const targetPath = path.join(rootPath, rel);
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

function getRollbackRecordsPath(snapshotRoot) {
    return path.join(snapshotRoot, ROLLBACK_RECORDS_FILE_NAME);
}

function writeRollbackRecords(snapshotRoot, records) {
    const recordsPath = getRollbackRecordsPath(snapshotRoot);
    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2), 'utf8');
    return recordsPath;
}

function readRollbackRecords(snapshotRoot) {
    const recordsPath = getRollbackRecordsPath(snapshotRoot);
    if (!fs.existsSync(recordsPath)) {
        throw new Error(`Rollback records file not found: ${recordsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
    } catch (_error) {
        throw new Error(`Rollback records file is not valid JSON: ${recordsPath}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error(`Rollback records file must contain an array: ${recordsPath}`);
    }

    return parsed.map((record, index) => {
        const relativePath = String(record && record.relativePath ? record.relativePath : '').trim();
        if (!relativePath) {
            throw new Error(`Rollback record at index ${index} is missing relativePath.`);
        }

        return {
            relativePath,
            existed: Boolean(record && record.existed),
            pathType: String(record && record.pathType ? record.pathType : 'missing')
        };
    });
}

function getSyncBackupMetadataPath(backupRoot) {
    return path.join(backupRoot, SYNC_BACKUP_METADATA_FILE_NAME);
}

function writeSyncBackupMetadata(backupRoot, metadata) {
    const metadataPath = getSyncBackupMetadataPath(backupRoot);
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    return metadataPath;
}

function readSyncBackupMetadata(backupRoot) {
    const metadataPath = getSyncBackupMetadataPath(backupRoot);
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Sync backup metadata file not found: ${metadataPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (_error) {
        throw new Error(`Sync backup metadata file is not valid JSON: ${metadataPath}`);
    }

    const preexistingMap = parsed && parsed.preexistingMap && typeof parsed.preexistingMap === 'object'
        ? parsed.preexistingMap
        : null;
    if (!preexistingMap || Array.isArray(preexistingMap)) {
        throw new Error(`Sync backup metadata is missing preexistingMap: ${metadataPath}`);
    }

    return {
        ...parsed,
        preexistingMap
    };
}

function restoreRollbackSnapshot(rootPath, snapshotRoot, records) {
    for (const record of records) {
        const rel = record.relativePath;
        const targetPath = path.join(rootPath, rel);
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

function copyDirectoryContentMerge(sourceDirectory, destinationDirectory, skipDestinationFiles) {
    if (!fs.existsSync(destinationDirectory)) {
        fs.mkdirSync(destinationDirectory, { recursive: true });
    }

    const skipSet = new Set(
        (skipDestinationFiles || [])
            .filter(Boolean)
            .map((f) => path.resolve(f).toLowerCase())
    );

    const sourceRoot = path.resolve(sourceDirectory);
    const expectedDestFiles = new Set();

    for (const sourceFile of readdirRecursiveFiles(sourceDirectory)) {
        const rel = path.relative(sourceRoot, sourceFile);
        if (!rel || rel === '.') continue;

        const destFile = path.resolve(path.join(destinationDirectory, rel));
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
            fs.rmSync(destFile, { force: true });
        }
    }

    // Remove empty directories bottom-up
    const dirs = readdirRecursiveDirs(destinationDirectory).sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
        const dirFull = path.resolve(dir).toLowerCase();
        if (skipSet.has(dirFull)) continue;
        try {
            const entries = fs.readdirSync(dir);
            if (entries.length === 0) fs.rmdirSync(dir);
        } catch (_e) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// Restore-SyncedItemsFromBackup (mirrors the PS function)
// ---------------------------------------------------------------------------

function restoreSyncedItemsFromBackup(targetBundleRoot, backupRoot, preexistingMap, runningScriptPath) {
    for (const item of Object.keys(preexistingMap)) {
        const destinationPath = path.join(targetBundleRoot, item);
        const preexisting = preexistingMap[item];

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

function syncWorkingTreeBundleItems(sourceBundleRoot, targetBundleRoot, relativeItems) {
    const unique = [...new Set(relativeItems)].sort();
    for (const item of unique) {
        const sourcePath = path.join(sourceBundleRoot, item);
        if (!fs.existsSync(sourcePath)) continue;

        const destinationPath = path.join(targetBundleRoot, item);
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

function getUpdateSentinelPath(bundleRoot) {
    return path.join(bundleRoot, 'runtime', UPDATE_SENTINEL_FILE_NAME);
}

function writeUpdateSentinel(bundleRoot, metadata) {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, JSON.stringify(metadata, null, 2), 'utf8');
    return sentinelPath;
}

function removeUpdateSentinel(bundleRoot) {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    if (fs.existsSync(sentinelPath)) {
        fs.rmSync(sentinelPath, { force: true });
    }
}

function readUpdateSentinel(bundleRoot) {
    const sentinelPath = getUpdateSentinelPath(bundleRoot);
    if (!fs.existsSync(sentinelPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    } catch (_error) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Uninstall sentinel (marks an in-progress uninstall to detect interrupted runs)
// ---------------------------------------------------------------------------

function getUninstallSentinelPath(targetRoot) {
    return path.join(targetRoot, UNINSTALL_SENTINEL_FILE_NAME);
}

function writeUninstallSentinel(targetRoot, metadata) {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    fs.writeFileSync(sentinelPath, JSON.stringify(metadata, null, 2), 'utf8');
    return sentinelPath;
}

function readUninstallSentinel(targetRoot) {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    if (!fs.existsSync(sentinelPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    } catch (_error) {
        return null;
    }
}

function removeUninstallSentinel(targetRoot) {
    const sentinelPath = getUninstallSentinelPath(targetRoot);
    if (fs.existsSync(sentinelPath)) {
        fs.rmSync(sentinelPath, { force: true });
    }
}

// ---------------------------------------------------------------------------
// Validate target root
// ---------------------------------------------------------------------------

function validateTargetRoot(targetRoot, bundleRoot) {
    const normalizedTarget = path.resolve(targetRoot);
    const normalizedBundle = path.resolve(bundleRoot);
    if (normalizedTarget.toLowerCase() === normalizedBundle.toLowerCase()) {
        throw new Error(
            `TargetRoot points to orchestrator bundle directory '${bundleRoot}'. Use the project root parent directory instead.`
        );
    }
    return normalizedTarget;
}

module.exports = {
    BUNDLE_SYNC_ITEMS,
    ROLLBACK_RECORDS_FILE_NAME,
    SYNC_BACKUP_METADATA_FILE_NAME,
    UNINSTALL_SENTINEL_FILE_NAME,
    UPDATE_SENTINEL_FILE_NAME,
    compareVersionStrings,
    copyDirectoryContentMerge,
    copyPathRecursive,
    createRollbackSnapshot,
    getRollbackRecordsPath,
    getSyncBackupMetadataPath,
    getTimestamp,
    getUninstallSentinelPath,
    getUpdateSentinelPath,
    readRollbackRecords,
    readSyncBackupMetadata,
    readUninstallSentinel,
    readUpdateSentinel,
    readdirRecursiveDirs,
    readdirRecursiveFiles,
    removePathRecursive,
    removeUninstallSentinel,
    removeUpdateSentinel,
    restoreRollbackSnapshot,
    restoreSyncedItemsFromBackup,
    syncWorkingTreeBundleItems,
    validateTargetRoot,
    writeRollbackRecords,
    writeSyncBackupMetadata,
    writeUninstallSentinel,
    writeUpdateSentinel
};
