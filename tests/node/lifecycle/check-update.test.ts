const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runCheckUpdate } = require('../../../src/lifecycle/check-update.ts');
const { removePathRecursive, copyPathRecursive } = require('../../../src/lifecycle/common.ts');

function findRepoRoot() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'VERSION')) && fs.existsSync(path.join(dir, 'template'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    throw new Error('Cannot find repo root');
}

function setupCheckUpdateWorkspace(repoRoot, deployedVersion) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-checkupdate-'));
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });

    // Write a specific VERSION
    fs.writeFileSync(path.join(bundle, 'VERSION'), deployedVersion || '1.0.0');

    // Create runtime dir
    fs.mkdirSync(path.join(bundle, 'runtime'), { recursive: true });

    return { projectRoot: tmpDir, bundleRoot: bundle };
}

describe('runCheckUpdate', () => {
    const repoRoot = findRepoRoot();

    it('detects UP_TO_DATE when versions match', () => {
        const currentVersion = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
        const { projectRoot, bundleRoot } = setupCheckUpdateWorkspace(repoRoot, currentVersion);
        try {
            // Point to local repo as the "remote"
            const result = runCheckUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                repoUrl: repoRoot,
                noPrompt: true,
                dryRun: true
            });

            assert.equal(result.checkUpdateResult, 'UP_TO_DATE');
            assert.equal(result.updateAvailable, false);
            assert.equal(result.currentVersion, currentVersion);
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('detects UPDATE_AVAILABLE when deployed version is older', () => {
        const { projectRoot, bundleRoot } = setupCheckUpdateWorkspace(repoRoot, '0.0.1');
        try {
            const result = runCheckUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                repoUrl: repoRoot,
                noPrompt: true,
                dryRun: false,
                apply: false
            });

            assert.equal(result.checkUpdateResult, 'UPDATE_AVAILABLE');
            assert.equal(result.updateAvailable, true);
            assert.equal(result.currentVersion, '0.0.1');
            assert.ok(result.latestVersion);
            assert.equal(result.updateApplied, false);
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('reports DRY_RUN_UPDATE_AVAILABLE when apply + dryRun', () => {
        const { projectRoot, bundleRoot } = setupCheckUpdateWorkspace(repoRoot, '0.0.1');
        try {
            const result = runCheckUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                repoUrl: repoRoot,
                noPrompt: true,
                dryRun: true,
                apply: true
            });

            assert.equal(result.checkUpdateResult, 'DRY_RUN_UPDATE_AVAILABLE');
            assert.equal(result.updateAvailable, true);
            assert.ok(result.syncedItems.length > 0);
            assert.equal(result.updateApplied, false);
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('applies update with updateRunner callback', () => {
        const { projectRoot, bundleRoot } = setupCheckUpdateWorkspace(repoRoot, '0.0.1');
        try {
            let updateRunnerCalled = false;

            const result = runCheckUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                repoUrl: repoRoot,
                noPrompt: true,
                apply: true,
                updateRunner: () => {
                    updateRunnerCalled = true;
                }
            });

            assert.equal(result.checkUpdateResult, 'UPDATED');
            assert.equal(result.updateApplied, true);
            assert.ok(updateRunnerCalled);
            assert.ok(result.syncItemsUpdated > 0);
            assert.equal(result.syncRollbackStatus, 'NOT_TRIGGERED');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('rolls back sync on updateRunner failure', () => {
        const { projectRoot, bundleRoot } = setupCheckUpdateWorkspace(repoRoot, '0.0.1');
        try {
            // Write a file that will get backed up and should be restored
            fs.writeFileSync(path.join(bundleRoot, 'VERSION'), '0.0.1');

            assert.throws(
                () => runCheckUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    repoUrl: repoRoot,
                    noPrompt: true,
                    apply: true,
                    updateRunner: () => {
                        throw new Error('Simulated update failure');
                    }
                }),
                /sync rollback completed.*Simulated update failure/
            );

            // VERSION should be restored to original
            assert.equal(fs.readFileSync(path.join(bundleRoot, 'VERSION'), 'utf8'), '0.0.1');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('throws when deployed bundle not found', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-checkupdate-no-bundle-'));
        const fakeBundleRoot = path.join(tmpDir, 'other');
        fs.mkdirSync(fakeBundleRoot, { recursive: true });
        try {
            assert.throws(
                () => runCheckUpdate({
                    targetRoot: tmpDir,
                    bundleRoot: fakeBundleRoot,
                    repoUrl: repoRoot
                }),
                /Deployed bundle not found/
            );
        } finally {
            removePathRecursive(tmpDir);
        }
    });

    it('throws when VERSION file is missing from deployed bundle', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-checkupdate-no-version-'));
        const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
        fs.mkdirSync(bundle, { recursive: true });
        // Do not create VERSION file
        try {
            assert.throws(
                () => runCheckUpdate({
                    targetRoot: tmpDir,
                    bundleRoot: bundle,
                    repoUrl: repoRoot
                }),
                /Current VERSION file not found/
            );
        } finally {
            removePathRecursive(tmpDir);
        }
    });
});
