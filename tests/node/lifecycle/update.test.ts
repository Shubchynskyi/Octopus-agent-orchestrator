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
        assert.ok(items.includes('Octopus-agent-orchestrator/live/docs/project-memory'),
            'project-memory must be in rollback items (T-072)');
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
            assert.equal(result.materializationStatus, 'PASS');
            assert.equal(result.rollbackStatus, 'NOT_TRIGGERED');
            assert.ok(result.rollbackSnapshotCreated);
            assert.ok(result.rollbackRecordCount > 0);
            assert.ok(fs.existsSync(path.join(projectRoot, result.rollbackRecordsPath)));
            assert.equal(result.verifyStatus, 'SKIPPED');
            assert.equal(result.manifestValidationStatus, 'SKIPPED');

            // Update report should be written
            const reportPath = path.join(projectRoot, result.updateReportPath);
            assert.ok(fs.existsSync(reportPath));
            const reportContent = fs.readFileSync(reportPath, 'utf8');
            assert.ok(reportContent.includes('# Update Report'));
            assert.ok(reportContent.includes('Install: PASS'));
            assert.ok(reportContent.includes('Materialization: PASS'));
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
            assert.equal(result.materializationStatus, 'SKIPPED_DRY_RUN');
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

    it('rematerializes live/ content during update (T-066)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Seed stale live/ content to simulate a previous version
            const liveRuleDir = path.join(bundleRoot, 'live', 'docs', 'agent-rules');
            fs.mkdirSync(liveRuleDir, { recursive: true });
            fs.writeFileSync(path.join(liveRuleDir, '00-core.md'), 'STALE_CORE_RULE');

            const liveConfigDir = path.join(bundleRoot, 'live', 'config');
            fs.mkdirSync(liveConfigDir, { recursive: true });
            fs.writeFileSync(path.join(liveConfigDir, 'skills-index.json'), '{"stale":true}');

            const liveSkillsDir = path.join(bundleRoot, 'live', 'skills');
            fs.mkdirSync(liveSkillsDir, { recursive: true });
            fs.writeFileSync(path.join(liveSkillsDir, 'stale-marker.txt'), 'STALE');

            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result.installStatus, 'PASS');
            assert.equal(result.materializationStatus, 'PASS');

            // 00-core.md should be refreshed from template, not stale
            const coreRuleContent = fs.readFileSync(path.join(liveRuleDir, '00-core.md'), 'utf8');
            assert.ok(coreRuleContent !== 'STALE_CORE_RULE', 'Core rule should be refreshed from template');
            assert.ok(coreRuleContent.length > 10, 'Core rule should have real content');

            // skills-index.json should be regenerated, not stale
            const skillsIndex = JSON.parse(fs.readFileSync(path.join(liveConfigDir, 'skills-index.json'), 'utf8'));
            assert.ok(!skillsIndex.stale, 'Skills index should be regenerated');
            assert.ok(Array.isArray(skillsIndex.packs) || Array.isArray(skillsIndex.skills),
                'Skills index should have valid structure');

            // live/version.json should have been written
            const liveVersion = JSON.parse(
                fs.readFileSync(path.join(bundleRoot, 'live', 'version.json'), 'utf8')
            );
            assert.ok(liveVersion.Version, 'live/version.json should have Version');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('rematerializes config files from template during update', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Ensure live/config has stale content
            const liveConfigDir = path.join(bundleRoot, 'live', 'config');
            fs.mkdirSync(liveConfigDir, { recursive: true });

            // Write a minimal stale token-economy config
            fs.writeFileSync(
                path.join(liveConfigDir, 'token-economy.json'),
                JSON.stringify({ enabled: false, staleFlag: true }, null, 2)
            );

            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result.materializationStatus, 'PASS');

            // token-economy.json should be merged: existing values preserved, template keys filled
            const tokenEconomy = JSON.parse(
                fs.readFileSync(path.join(liveConfigDir, 'token-economy.json'), 'utf8')
            );
            // TokenEconomyEnabled is 'true' in init answers, so enabled should be true
            assert.equal(tokenEconomy.enabled, true, 'Token economy enabled flag should match init answers');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('rolls back on materialization failure', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Create a file that should be in pre-update snapshot
            fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'pre-update-content');

            assert.throws(
                () => runUpdate({
                    targetRoot: projectRoot,
                    bundleRoot,
                    initAnswersPath: answersPath,
                    skipVerify: true,
                    skipManifestValidation: true,
                    materializationRunner: () => {
                        throw new Error('Simulated materialization failure');
                    }
                }),
                /rollback completed successfully.*Simulated materialization failure/
            );

            // CLAUDE.md should be restored by rollback
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.equal(
                fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
                'pre-update-content'
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('does not rematerialize live/ in dry-run mode', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Seed stale live/ content
            const liveRuleDir = path.join(bundleRoot, 'live', 'docs', 'agent-rules');
            fs.mkdirSync(liveRuleDir, { recursive: true });
            fs.writeFileSync(path.join(liveRuleDir, '00-core.md'), 'STALE_DRY_RUN');

            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                dryRun: true
            });

            assert.equal(result.materializationStatus, 'SKIPPED_DRY_RUN');

            // Stale content should remain since it's a dry run
            const coreRuleContent = fs.readFileSync(path.join(liveRuleDir, '00-core.md'), 'utf8');
            assert.equal(coreRuleContent, 'STALE_DRY_RUN', 'Dry run should not modify live/ content');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('reports SKIPPED_NO_RUNNER for verify/manifest/contractMigrations when no runners provided (T-067)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: false,
                skipManifestValidation: false
            });

            assert.equal(result.installStatus, 'PASS');
            assert.equal(result.materializationStatus, 'PASS');
            assert.equal(result.verifyStatus, 'SKIPPED_NO_RUNNER',
                'Verify must not report PASS when no verifyRunner was provided');
            assert.equal(result.manifestValidationStatus, 'SKIPPED_NO_RUNNER',
                'ManifestValidation must not report PASS when no manifestRunner was provided');
            assert.equal(result.contractMigrationStatus, 'SKIPPED_NO_RUNNER',
                'ContractMigrations must not report PASS when no contractMigrationRunner was provided');

            // Report should reflect truthful statuses
            const reportPath = path.join(projectRoot, result.updateReportPath);
            const reportContent = fs.readFileSync(reportPath, 'utf8');
            assert.ok(reportContent.includes('Verify: SKIPPED_NO_RUNNER'));
            assert.ok(reportContent.includes('ManifestValidation: SKIPPED_NO_RUNNER'));
            assert.ok(reportContent.includes('ContractMigrations: SKIPPED_NO_RUNNER'));
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('reports PASS for verify/manifest/contractMigrations when runners succeed (T-067)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            let verifyCalled = false;
            let manifestCalled = false;
            let migrationCalled = false;

            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: false,
                skipManifestValidation: false,
                verifyRunner: () => { verifyCalled = true; },
                manifestRunner: () => { manifestCalled = true; },
                contractMigrationRunner: () => {
                    migrationCalled = true;
                    return { appliedCount: 1, appliedFiles: ['test-migration.js'] };
                }
            });

            assert.ok(verifyCalled, 'verifyRunner should have been called');
            assert.ok(manifestCalled, 'manifestRunner should have been called');
            assert.ok(migrationCalled, 'contractMigrationRunner should have been called');
            assert.equal(result.verifyStatus, 'PASS');
            assert.equal(result.manifestValidationStatus, 'PASS');
            assert.equal(result.contractMigrationStatus, 'PASS');
            assert.equal(result.contractMigrationCount, 1);
            assert.deepEqual(result.contractMigrationFiles, ['test-migration.js']);
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('preserves project-memory user content across update (T-076)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // First update materializes workspace including project-memory seed
            runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            // Write user content into project-memory
            const pmDir = path.join(bundleRoot, 'live', 'docs', 'project-memory');
            assert.ok(fs.existsSync(pmDir), 'project-memory must be seeded after first update');
            fs.writeFileSync(path.join(pmDir, 'context.md'),
                '# Project Context\n\n## Domain\n\nB2B logistics SaaS.\n', 'utf8');
            fs.writeFileSync(path.join(pmDir, 'decisions.md'),
                '# Decisions\n\n## ADR-001\n\nUse PostgreSQL for persistence.\n', 'utf8');

            // Second update — user content must survive
            const result2 = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result2.materializationStatus, 'PASS');
            assert.ok(fs.existsSync(path.join(pmDir, 'context.md')),
                'context.md must survive update');
            assert.ok(fs.readFileSync(path.join(pmDir, 'context.md'), 'utf8')
                .includes('B2B logistics SaaS'),
                'user content must be intact');
            assert.ok(fs.existsSync(path.join(pmDir, 'decisions.md')),
                'decisions.md must survive update');
            assert.ok(fs.readFileSync(path.join(pmDir, 'decisions.md'), 'utf8')
                .includes('PostgreSQL'),
                'decisions content must be intact');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('regenerates 15-project-memory.md from user content during update (T-076)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            // Add user content to project-memory
            const pmDir = path.join(bundleRoot, 'live', 'docs', 'project-memory');
            fs.writeFileSync(path.join(pmDir, 'context.md'),
                '# Project Context\n\n## Domain\n\nEnterprise CRM platform.\n', 'utf8');

            // Second update — summary must regenerate with user content
            runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            const summaryPath = path.join(bundleRoot, 'live', 'docs', 'agent-rules', '15-project-memory.md');
            assert.ok(fs.existsSync(summaryPath), '15-project-memory.md must exist after update');
            const content = fs.readFileSync(summaryPath, 'utf8');
            assert.ok(content.includes('DO NOT EDIT'), 'must have DO NOT EDIT header');
            assert.ok(content.includes('Enterprise CRM platform'), 'must include user content');
            assert.ok(content.includes('Provenance'), 'must include provenance table');
            assert.ok(content.includes('docs/project-memory/context.md'), 'provenance must reference source');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('produces valid stub 15-project-memory.md when project-memory has only templates (T-076)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            // Single update — project-memory seeded with templates only
            runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            const summaryPath = path.join(bundleRoot, 'live', 'docs', 'agent-rules', '15-project-memory.md');
            assert.ok(fs.existsSync(summaryPath), '15-project-memory.md must exist');
            const content = fs.readFileSync(summaryPath, 'utf8');
            assert.ok(content.includes('DO NOT EDIT'));
            assert.ok(
                content.includes('placeholder templates') || content.includes('no content'),
                'stub must indicate placeholder state'
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('reports SKIPPED for verify/manifest when skip flags are set even with runners (T-067)', () => {
        const { projectRoot, bundleRoot, answersPath } = setupUpdateWorkspace(repoRoot);
        try {
            let verifyCalled = false;
            let manifestCalled = false;

            const result = runUpdate({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true,
                verifyRunner: () => { verifyCalled = true; },
                manifestRunner: () => { manifestCalled = true; }
            });

            assert.ok(!verifyCalled, 'verifyRunner should not be called when skipVerify is true');
            assert.ok(!manifestCalled, 'manifestRunner should not be called when skipManifestValidation is true');
            assert.equal(result.verifyStatus, 'SKIPPED');
            assert.equal(result.manifestValidationStatus, 'SKIPPED');
        } finally {
            removePathRecursive(projectRoot);
        }
    });
});
