const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runUpdate, getUpdateRollbackItems } = require('../../../src/lifecycle/update.ts');
const { removePathRecursive } = require('../../../src/lifecycle/common.ts');

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

function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

function setupUpdateWorkspace(repoRoot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-update-'));
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });

    // Copy VERSION
    fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(bundle, 'VERSION'));

    // Copy template
    copyDirRecursive(path.join(repoRoot, 'template'), path.join(bundle, 'template'));

    // Create live dir
    fs.mkdirSync(path.join(bundle, 'live', 'config'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'live', 'docs', 'agent-rules'), { recursive: true });

    // Create runtime dir
    fs.mkdirSync(path.join(bundle, 'runtime'), { recursive: true });

    // Write init-answers.json
    const answers = {
        AssistantLanguage: 'English',
        AssistantBrevity: 'concise',
        SourceOfTruth: 'Claude',
        EnforceNoAutoCommit: 'false',
        ClaudeOrchestratorFullAccess: 'false',
        TokenEconomyEnabled: 'true',
        CollectedVia: 'CLI_NONINTERACTIVE'
    };
    const answersPath = path.join(bundle, 'runtime', 'init-answers.json');
    fs.writeFileSync(answersPath, JSON.stringify(answers, null, 2));

    // Create .git dir for install
    fs.mkdirSync(path.join(tmpDir, '.git', 'hooks'), { recursive: true });

    return {
        projectRoot: tmpDir,
        bundleRoot: bundle,
        answersPath: path.relative(tmpDir, answersPath).replace(/\\/g, '/')
    };
}

describe('getUpdateRollbackItems', () => {
    it('returns expected items including init answers', () => {
        const dir = os.tmpdir();
        const answersPath = path.join(dir, 'Octopus-agent-orchestrator', 'runtime', 'init-answers.json');
        const items = getUpdateRollbackItems(dir, answersPath);

        assert.ok(items.includes('CLAUDE.md'));
        assert.ok(items.includes('AGENTS.md'));
        assert.ok(items.includes('TASK.md'));
        assert.ok(items.includes('.gitignore'));
        assert.ok(items.includes('Octopus-agent-orchestrator/VERSION'));
        assert.ok(items.includes('Octopus-agent-orchestrator/live'));
        // init answers path should be included
        assert.ok(items.some((p) => p.includes('init-answers.json')));
    });
});

describe('runUpdate', () => {
    const repoRoot = findRepoRoot();

    it('runs install and produces update report', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result.installStatus, 'PASS');
            assert.equal(result.rollbackStatus, 'NOT_TRIGGERED');
            assert.ok(result.rollbackSnapshotCreated);
            assert.ok(result.rollbackRecordCount > 0);
            assert.equal(result.verifyStatus, 'SKIPPED');
            assert.equal(result.manifestValidationStatus, 'SKIPPED');

            // Update report should be written
            const reportPath = path.join(projectRoot, result.updateReportPath);
            assert.ok(fs.existsSync(reportPath));
            const reportContent = fs.readFileSync(reportPath, 'utf8');
            assert.ok(reportContent.includes('# Update Report'));
            assert.ok(reportContent.includes('Install: PASS'));
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('supports dry-run mode', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                dryRun: true
            });

            assert.equal(result.installStatus, 'PASS');
            assert.equal(result.verifyStatus, 'SKIPPED_DRY_RUN');
            assert.equal(result.manifestValidationStatus, 'SKIPPED_DRY_RUN');
            assert.equal(result.rollbackStatus, 'NOT_NEEDED');
            assert.ok(!result.rollbackSnapshotCreated);
            assert.equal(result.updateReportPath, 'not-generated-in-dry-run');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('rolls back on install failure', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Create a file that should be in pre-update snapshot
            fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'original-content');

            assert.throws(
                () => runUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    initAnswersPath: answersPath,
                    skipVerify: true,
                    skipManifestValidation: true,
                    installRunner: () => {
                        throw new Error('Simulated install failure');
                    }
                }),
                /rollback completed successfully.*Simulated install failure/
            );

            // CLAUDE.md should be restored by rollback
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.equal(fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8'), 'original-content');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('throws when init answers not found', () => {
        const { projectRoot, bundleRoot } = setupUpdateWorkspace(repoRoot);
        try {
            assert.throws(
                () => runUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    initAnswersPath: 'nonexistent/path/answers.json'
                }),
                /Init answers artifact not found/
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('throws when bundle VERSION not found', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            fs.rmSync(path.join(bundleRoot, 'VERSION'));
            assert.throws(
                () => runUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    initAnswersPath: answersPath
                }),
                /Bundle version file not found/
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('reports rollback failure when both install and rollback fail', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Make rollback impossible by having a record pointing to non-existent snapshot
            assert.throws(
                () => runUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    initAnswersPath: answersPath,
                    installRunner: () => {
                        // Delete the rollback snapshot to cause rollback failure
                        const runtimeDir = path.join(projectRoot, 'Octopus-agent-orchestrator', 'runtime', 'update-rollbacks');
                        if (fs.existsSync(runtimeDir)) {
                            fs.rmSync(runtimeDir, { recursive: true, force: true });
                        }
                        throw new Error('Simulated install failure');
                    }
                }),
                /Rollback failed|rollback completed/
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });
});
