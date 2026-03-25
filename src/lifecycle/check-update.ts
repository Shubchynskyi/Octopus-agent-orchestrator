const fs = require('node:fs');
const os = require('node:os');
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

const DEFAULT_PACKAGE_NAME = 'octopus-agent-orchestrator';
let resolvedNpmInvocation = null;

function resolveNpmInvocation() {
    if (resolvedNpmInvocation) {
        return resolvedNpmInvocation;
    }

    const npmExecPath = String(process.env.npm_execpath || '').trim();
    if (npmExecPath && pathExists(npmExecPath)) {
        resolvedNpmInvocation = {
            command: process.execPath,
            prefixArgs: [npmExecPath]
        };
        return resolvedNpmInvocation;
    }

    const bundledCandidates = [
        path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(path.dirname(process.execPath), '..', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    ];

    for (const candidate of bundledCandidates) {
        const resolvedCandidate = path.resolve(candidate);
        if (pathExists(resolvedCandidate)) {
            resolvedNpmInvocation = {
                command: process.execPath,
                prefixArgs: [resolvedCandidate]
            };
            return resolvedNpmInvocation;
        }
    }

    resolvedNpmInvocation = {
        command: 'npm',
        prefixArgs: []
    };
    return resolvedNpmInvocation;
}

function runNpmSync(args, options = {}) {
    const {
        encoding = 'utf8',
        stdio = 'pipe'
    } = options;

    const invocation = resolveNpmInvocation();

    return childProcess.spawnSync(invocation.command, [...invocation.prefixArgs, ...args], {
        ...options,
        encoding,
        stdio,
        windowsHide: true
    });
}

function readPackageNameFromDirectory(directoryPath, fallbackValue = null) {
    const packageJsonPath = path.join(directoryPath, 'package.json');
    if (!pathExists(packageJsonPath)) {
        return fallbackValue;
    }

    try {
        const parsed = JSON.parse(readTextFile(packageJsonPath));
        const name = String(parsed && parsed.name ? parsed.name : '').trim();
        return name || fallbackValue;
    } catch (_error) {
        return fallbackValue;
    }
}

function resolveNodeModulesPackageRoot(nodeModulesRoot, packageName) {
    return path.join(nodeModulesRoot, ...packageName.split('/'));
}

function resolveInstalledPackageRoot(tempInstallRoot) {
    const listResult = runNpmSync([
        'ls',
        '--json',
        '--depth=0',
        '--prefix',
        tempInstallRoot
    ]);

    const stdout = String(listResult.stdout || '').trim();
    if (!stdout) {
        throw new Error('Failed to resolve installed update package metadata.');
    }

    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (_error) {
        throw new Error('Failed to parse installed update package metadata.');
    }

    const dependencyNames = Object.keys(parsed && parsed.dependencies ? parsed.dependencies : {});
    if (dependencyNames.length === 0) {
        throw new Error('Installed update package metadata did not contain any top-level dependencies.');
    }

    const packageName = dependencyNames[0];
    const packageRoot = resolveNodeModulesPackageRoot(path.join(tempInstallRoot, 'node_modules'), packageName);
    if (!pathExists(packageRoot)) {
        throw new Error(`Installed update package root not found: ${packageRoot}`);
    }

    return {
        packageName,
        packageRoot
    };
}

function acquireUpdateSource(options) {
    const {
        deployedBundleRoot,
        packageSpec,
        sourcePath
    } = options;

    if (packageSpec && sourcePath) {
        throw new Error('Provide either packageSpec or sourcePath for check-update, not both.');
    }

    if (sourcePath) {
        const resolvedSourcePath = path.resolve(String(sourcePath).trim());
        if (!pathExists(resolvedSourcePath)) {
            throw new Error(`Update source path not found: ${resolvedSourcePath}`);
        }

        const stats = fs.lstatSync(resolvedSourcePath);
        if (!stats.isDirectory()) {
            throw new Error(`Update source path must be a directory: ${resolvedSourcePath}`);
        }

        return {
            sourceType: 'path',
            sourceReference: resolvedSourcePath,
            packageSpec: null,
            packageName: readPackageNameFromDirectory(resolvedSourcePath),
            sourceRoot: resolvedSourcePath,
            cleanup() {}
        };
    }

    try {
        const versionResult = runNpmSync(['--version'], { stdio: 'pipe' });
        if (versionResult.status !== 0) {
            throw new Error(String(versionResult.stderr || versionResult.stdout || '').trim() || 'npm version probe failed.');
        }
    } catch (_error) {
        throw new Error('npm is required for npm-based check-update workflow.');
    }

    const deployedPackageName = readPackageNameFromDirectory(deployedBundleRoot, DEFAULT_PACKAGE_NAME);
    const effectivePackageSpec = String(packageSpec || `${deployedPackageName}@latest`).trim();
    const tempInstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-update-npm-'));

    try {
        const installArgs = [
            'install',
            '--prefix',
            tempInstallRoot,
            '--no-save',
            '--ignore-scripts',
            '--package-lock=false',
            '--fund=false',
            '--audit=false',
            effectivePackageSpec
        ];
        const installResult = runNpmSync(installArgs);

        if (installResult.status !== 0) {
            const errorText = String(installResult.stderr || installResult.stdout || '').trim();
            const suffix = errorText ? ` ${errorText}` : '';
            throw new Error(`Failed to install update package '${effectivePackageSpec}'.${suffix}`);
        }

        const installed = resolveInstalledPackageRoot(tempInstallRoot);
        return {
            sourceType: 'npm',
            sourceReference: effectivePackageSpec,
            packageSpec: effectivePackageSpec,
            packageName: installed.packageName,
            sourceRoot: installed.packageRoot,
            cleanup() {
                removePathRecursive(tempInstallRoot);
            }
        };
    } catch (error) {
        removePathRecursive(tempInstallRoot);
        throw error;
    }
}

/**
 * Runs the check-update pipeline.
 * Node implementation of the check-update lifecycle.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root directory
 * @param {string} options.bundleRoot - Orchestrator bundle directory (deployed)
 * @param {string} [options.initAnswersPath]
 * @param {string} [options.packageSpec]
 * @param {string} [options.sourcePath]
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
        packageSpec = null,
        sourcePath = null,
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

    const currentVersionPath = path.join(deployedBundleRoot, 'VERSION');
    if (!pathExists(currentVersionPath)) {
        throw new Error(`Current VERSION file not found: ${currentVersionPath}`);
    }
    const currentVersion = readTextFile(currentVersionPath).trim();
    if (!currentVersion) {
        throw new Error(`Current VERSION file is empty: ${currentVersionPath}`);
    }

    const timestamp = getTimestamp();
    const syncBackupRoot = path.join(deployedBundleRoot, 'runtime', 'bundle-backups', timestamp);
    const source = acquireUpdateSource({
        deployedBundleRoot,
        packageSpec,
        sourcePath
    });

    const result = {
        targetRoot: normalizedTarget,
        sourceType: source.sourceType,
        sourceReference: source.sourceReference,
        packageSpec: source.packageSpec,
        sourcePath: source.sourceType === 'path' ? source.sourceReference : null,
        packageName: source.packageName,
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
        const latestVersionPath = path.join(source.sourceRoot, 'VERSION');
        if (!pathExists(latestVersionPath)) {
            throw new Error(`Latest VERSION file not found in update source: ${latestVersionPath}`);
        }
        const latestVersion = readTextFile(latestVersionPath).trim();
        if (!latestVersion) {
            throw new Error(`Latest VERSION file is empty: ${latestVersionPath}`);
        }
        result.latestVersion = latestVersion;

        const comparison = compareVersionStrings(currentVersion, latestVersion);
        result.updateAvailable = comparison < 0;
        result.checkUpdateResult = result.updateAvailable ? 'UPDATE_AVAILABLE' : 'UP_TO_DATE';

        if (result.updateAvailable && apply) {
            const syncPreexistingMap = {};

            try {
                for (const item of BUNDLE_SYNC_ITEMS) {
                    const sourceItemPath = path.join(source.sourceRoot, item);
                    if (!fs.existsSync(sourceItemPath)) continue;

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

                    const sourceIsDirectory = fs.lstatSync(sourceItemPath).isDirectory();
                    const isNodeRuntimeDir = item.toLowerCase() === 'src';

                    if (sourceIsDirectory) {
                        if (isNodeRuntimeDir) {
                            if (!fs.existsSync(destinationPath) || !fs.lstatSync(destinationPath).isDirectory()) {
                                removePathRecursive(destinationPath);
                                fs.mkdirSync(destinationPath, { recursive: true });
                            }
                            const skipPaths = runningScriptPath ? [path.resolve(runningScriptPath)] : [];
                            copyDirectoryContentMerge(sourceItemPath, destinationPath, skipPaths);
                        } else {
                            removePathRecursive(destinationPath);
                            copyPathRecursive(sourceItemPath, destinationPath);
                        }
                    } else {
                        removePathRecursive(destinationPath);
                        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
                        fs.copyFileSync(sourceItemPath, destinationPath);
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
        }
    } finally {
        source.cleanup();
    }

    return result;
}

module.exports = {
    DEFAULT_PACKAGE_NAME,
    runCheckUpdate
};
