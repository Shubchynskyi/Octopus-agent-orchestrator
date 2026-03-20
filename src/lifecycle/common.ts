const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { isPathInsideRoot } = require('../core/paths.ts');

// ---------------------------------------------------------------------------
// Version comparison (mirrors Compare-VersionStrings from check-update.ps1)
// ---------------------------------------------------------------------------

function compareVersionStrings(current, latest) {
    const normalize = (v) => String(v).trim().replace(/^[vV]/, '');
    const a = normalize(current);
    const b = normalize(latest);

    const parseSegments = (value) =>
        value.split('.').map((segment) => {
            const match = segment.match(/^(\d+)/);
            return match ? Number(match[1]) : 0;
        });

    const aSegs = parseSegments(a);
    const bSegs = parseSegments(b);
    const maxLen = Math.max(aSegs.length, bSegs.length);

    for (let i = 0; i < maxLen; i++) {
        const av = i < aSegs.length ? aSegs[i] : 0;
        const bv = i < bSegs.length ? bSegs[i] : 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
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
    'template',
    'scripts',
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

            const isScriptsDir = item.toLowerCase() === 'scripts';
            if (isScriptsDir && fs.existsSync(backupPath) && fs.lstatSync(backupPath).isDirectory()) {
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
// Sync-WorkingTreeBundleItems (mirrors update.ps1)
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
    compareVersionStrings,
    copyDirectoryContentMerge,
    copyPathRecursive,
    createRollbackSnapshot,
    getTimestamp,
    readdirRecursiveDirs,
    readdirRecursiveFiles,
    removePathRecursive,
    restoreRollbackSnapshot,
    restoreSyncedItemsFromBackup,
    syncWorkingTreeBundleItems,
    validateTargetRoot
};
