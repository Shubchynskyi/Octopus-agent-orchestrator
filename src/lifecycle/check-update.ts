const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const { pathExists, readTextFile } = require('../core/fs.ts');

const {
    BUNDLE_SYNC_ITEMS,
    compareVersionStrings,
    copyDirectoryContentMerge,
    copyPathRecursive,
    getTimestamp,
    removePathRecursive,
    restoreSyncedItemsFromBackup,
    validateTargetRoot
} = require('./common.ts');

const DEFAULT_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';

/**
 * Runs the check-update pipeline.
 * Ports check-update.ps1 to Node/TS.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root directory
 * @param {string} options.bundleRoot - Orchestrator bundle directory (deployed)
 * @param {string} [options.initAnswersPath]
 * @param {string} [options.repoUrl]
 * @param {string} [options.branch]
 * @param {boolean} [options.apply=false]
 * @param {boolean} [options.noPrompt=false]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.skipVerify=false]
 * @param {boolean} [options.skipManifestValidation=false]
 * @param {string} [options.runningScriptPath] - Path of the currently running script (for skip during merge)
 * @param {Function} [options.updateRunner] - Callback that performs the post-sync update step
 * @returns {object} Check-update result
 */
function runCheckUpdate(options) {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        repoUrl = DEFAULT_REPO_URL,
        branch,
        apply = false,
        noPrompt = false,
        dryRun = false,
        skipVerify = false,
        skipManifestValidation = false,
        runningScriptPath = null,
        updateRunner = null
    } = options;

    const normalizedTarget = validateTargetRoot(targetRoot, bundleRoot);
    const deployedBundleRoot = path.join(normalizedTarget, DEFAULT_BUNDLE_NAME);
    if (!pathExists(deployedBundleRoot)) {
        throw new Error(`Deployed bundle not found: ${deployedBundleRoot}`);
    }

    // Verify git is available
    try {
        childProcess.execFileSync('git', ['--version'], { stdio: 'pipe' });
    } catch (_e) {
        throw new Error('git is required for check-update workflow.');
    }

    // Read current version
    const currentVersionPath = path.join(deployedBundleRoot, 'VERSION');
    if (!pathExists(currentVersionPath)) {
        throw new Error(`Current VERSION file not found: ${currentVersionPath}`);
    }
    const currentVersion = readTextFile(currentVersionPath).trim();
    if (!currentVersion) {
        throw new Error(`Current VERSION file is empty: ${currentVersionPath}`);
    }

    const timestamp = getTimestamp();
    const tempRepoPath = path.join(require('node:os').tmpdir(), `octopus-update-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const syncBackupRoot = path.join(deployedBundleRoot, 'runtime', 'bundle-backups', timestamp);

    const result = {
        targetRoot: normalizedTarget,
        repoUrl: repoUrl.trim(),
        branch: branch ? branch.trim() : null,
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        applyRequested: apply,
        noPrompt,
        dryRun,
        syncItemsDetected: 0,
        syncItemsBackedUp: 0,
        syncItemsUpdated: 0,
        syncBackupRoot: 'not-created',
        syncRollbackStatus: 'NOT_NEEDED',
        syncedItems: [],
        updateApplied: false,
        checkUpdateResult: 'UNKNOWN'
    };

    try {
        // Clone latest from repo (shallow)
        const cloneArgs = ['clone', '--depth', '1'];
        if (branch) cloneArgs.push('--branch', branch.trim());
        cloneArgs.push(repoUrl.trim(), tempRepoPath);

        const cloneResult = childProcess.spawnSync('git', cloneArgs, { stdio: 'pipe' });
        if (cloneResult.status !== 0) {
            throw new Error(`Failed to clone update source: ${repoUrl}`);
        }

        // Read latest version
        const latestVersionPath = path.join(tempRepoPath, 'VERSION');
        if (!pathExists(latestVersionPath)) {
            throw new Error(`Latest VERSION file not found in cloned source: ${latestVersionPath}`);
        }
        const latestVersion = readTextFile(latestVersionPath).trim();
        if (!latestVersion) {
            throw new Error(`Latest VERSION file is empty: ${latestVersionPath}`);
        }
        result.latestVersion = latestVersion;

        const comparison = compareVersionStrings(currentVersion, latestVersion);
        result.updateAvailable = comparison < 0;

        if (!result.updateAvailable) {
            result.checkUpdateResult = 'UP_TO_DATE';
        } else {
            result.checkUpdateResult = 'UPDATE_AVAILABLE';
        }

        let applyNow = apply;

        if (result.updateAvailable && applyNow) {
            const syncPreexistingMap = {};

            try {
                for (const item of BUNDLE_SYNC_ITEMS) {
                    const sourcePath = path.join(tempRepoPath, item);
                    if (!fs.existsSync(sourcePath)) continue;

                    result.syncItemsDetected++;
                    const destinationPath = path.join(deployedBundleRoot, item);
                    const destinationExists = fs.existsSync(destinationPath);

                    if (dryRun) {
                        result.syncedItems.push(item);
                        continue;
                    }

                    if (!(item in syncPreexistingMap)) {
                        syncPreexistingMap[item] = destinationExists;
                    }

                    if (destinationExists) {
                        const backupPath = path.join(syncBackupRoot, item);
                        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
                        copyPathRecursive(destinationPath, backupPath);
                        result.syncItemsBackedUp++;
                        result.syncBackupRoot = syncBackupRoot;
                    }

                    const sourceIsDirectory = fs.lstatSync(sourcePath).isDirectory();
                    const isScriptsDir = item.toLowerCase() === 'scripts';

                    if (sourceIsDirectory) {
                        if (isScriptsDir) {
                            if (!fs.existsSync(destinationPath) || !fs.lstatSync(destinationPath).isDirectory()) {
                                removePathRecursive(destinationPath);
                                fs.mkdirSync(destinationPath, { recursive: true });
                            }
                            const skipPaths = runningScriptPath ? [path.resolve(runningScriptPath)] : [];
                            copyDirectoryContentMerge(sourcePath, destinationPath, skipPaths);
                        } else {
                            removePathRecursive(destinationPath);
                            copyPathRecursive(sourcePath, destinationPath);
                        }
                    } else {
                        removePathRecursive(destinationPath);
                        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
                        fs.copyFileSync(sourcePath, destinationPath);
                    }

                    result.syncItemsUpdated++;
                    result.syncedItems.push(item);
                }

                if (!dryRun) {
                    if (updateRunner) {
                        updateRunner({
                            targetRoot: normalizedTarget,
                            initAnswersPath,
                            noPrompt,
                            skipVerify,
                            skipManifestValidation
                        });
                    }
                    result.updateApplied = true;
                    result.checkUpdateResult = 'UPDATED';
                    if (Object.keys(syncPreexistingMap).length > 0 && result.syncRollbackStatus === 'NOT_NEEDED') {
                        result.syncRollbackStatus = 'NOT_TRIGGERED';
                    }
                } else {
                    result.checkUpdateResult = 'DRY_RUN_UPDATE_AVAILABLE';
                }
            } catch (applyError) {
                const originalError = applyError.message || String(applyError);
                if (!dryRun && Object.keys(syncPreexistingMap).length > 0) {
                    result.syncRollbackStatus = 'ATTEMPTED';
                    try {
                        restoreSyncedItemsFromBackup(deployedBundleRoot, syncBackupRoot, syncPreexistingMap, runningScriptPath);
                        result.syncRollbackStatus = 'SUCCESS';
                    } catch (rollbackError) {
                        const rollbackMsg = rollbackError.message || String(rollbackError);
                        result.syncRollbackStatus = `FAILED: ${rollbackMsg}`;
                        throw new Error(`Update apply failed. Original error: ${originalError}. Sync rollback failed: ${rollbackMsg}`);
                    }
                    throw new Error(`Update apply failed and sync rollback completed. Original error: ${originalError}`);
                }
                throw new Error(`Update apply failed. Error: ${originalError}`);
            }
        } else if (result.updateAvailable && !applyNow) {
            // noPrompt or user didn't want to apply — leave as UPDATE_AVAILABLE
        }
    } finally {
        removePathRecursive(tempRepoPath);
    }

    return result;
}

module.exports = {
    DEFAULT_REPO_URL,
    runCheckUpdate
};
