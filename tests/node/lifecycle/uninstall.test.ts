const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runUninstall, parseBooleanAnswer } = require('../../../src/lifecycle/uninstall.ts');
const { removePathRecursive, copyPathRecursive } = require('../../../src/lifecycle/common.ts');
const { MANAGED_START, MANAGED_END, COMMIT_GUARD_START, COMMIT_GUARD_END } = require('../../../src/materialization/content-builders.ts');

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

function setupDeployedWorkspace(repoRoot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-uninstall-'));
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });

    // Copy VERSION
    fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(bundle, 'VERSION'));

    // Copy template
    const templateSrc = path.join(repoRoot, 'template');
    copyDirRecursive(templateSrc, path.join(bundle, 'template'));

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
        EnforceNoAutoCommit: 'true',
        ClaudeOrchestratorFullAccess: 'false',
        TokenEconomyEnabled: 'true',
        CollectedVia: 'CLI_NONINTERACTIVE'
    };
    fs.writeFileSync(path.join(bundle, 'runtime', 'init-answers.json'), JSON.stringify(answers, null, 2));

    // Create managed entrypoint files
    const managedContent = `${MANAGED_START}\n# Octopus Agent Orchestrator Rule Index\n## Rule Routing\nSome content\n${MANAGED_END}\n`;
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), managedContent);
    fs.writeFileSync(path.join(tmpDir, 'TASK.md'), managedContent);

    // Create .git dir
    fs.mkdirSync(path.join(tmpDir, '.git', 'hooks'), { recursive: true });

    // Create .gitignore with managed block
    const gitignoreContent = 'node_modules/\n# Octopus-agent-orchestrator managed ignores\nOctopus-agent-orchestrator/\nAGENTS.md\n';
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), gitignoreContent);

    return { projectRoot: tmpDir, bundleRoot: bundle };
}

describe('parseBooleanAnswer', () => {
    it('parses yes/no strings', () => {
        assert.equal(parseBooleanAnswer('yes', 'test'), true);
        assert.equal(parseBooleanAnswer('no', 'test'), false);
        assert.equal(parseBooleanAnswer('true', 'test'), true);
        assert.equal(parseBooleanAnswer('false', 'test'), false);
        assert.equal(parseBooleanAnswer('1', 'test'), true);
        assert.equal(parseBooleanAnswer('0', 'test'), false);
        assert.equal(parseBooleanAnswer('да', 'test'), true);
        assert.equal(parseBooleanAnswer('нет', 'test'), false);
    });

    it('parses native booleans', () => {
        assert.equal(parseBooleanAnswer(true, 'test'), true);
        assert.equal(parseBooleanAnswer(false, 'test'), false);
    });

    it('throws for invalid values', () => {
        assert.throws(() => parseBooleanAnswer('maybe', 'test'), /must be one of/);
    });
});

describe('runUninstall', () => {
    const repoRoot = findRepoRoot();

    it('removes deployed orchestrator files', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.ok(!fs.existsSync(path.join(projectRoot, 'Octopus-agent-orchestrator')));
            assert.ok(!fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.ok(!fs.existsSync(path.join(projectRoot, 'TASK.md')));
            assert.ok(result.itemsBackedUp >= 1);
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('preserves primary entrypoint when requested', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'yes',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.equal(result.keepPrimaryEntrypoint, true);
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.ok(!fs.existsSync(path.join(projectRoot, 'TASK.md')));
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('preserves TASK.md when requested', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'yes',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.equal(result.keepTaskFile, true);
            assert.ok(fs.existsSync(path.join(projectRoot, 'TASK.md')));
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('supports dry run without deleting files', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                dryRun: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'DRY_RUN');
            // Files should still exist after dry run
            assert.ok(fs.existsSync(path.join(projectRoot, 'Octopus-agent-orchestrator')));
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('removes managed content from .gitignore but preserves user content', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            if (fs.existsSync(path.join(projectRoot, '.gitignore'))) {
                const content = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
                assert.ok(content.includes('node_modules/'));
                assert.ok(!content.includes('Octopus-agent-orchestrator/'));
                assert.ok(!content.includes('Octopus-agent-orchestrator managed ignores'));
            }
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('strips managed blocks from qwen settings', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            // Create qwen settings with managed entries
            fs.mkdirSync(path.join(projectRoot, '.qwen'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.qwen', 'settings.json'),
                JSON.stringify({
                    context: {
                        fileName: ['TASK.md', 'user-file.md']
                    }
                }, null, 2)
            );

            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            if (fs.existsSync(path.join(projectRoot, '.qwen', 'settings.json'))) {
                const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.qwen', 'settings.json'), 'utf8'));
                assert.ok(settings.context);
                assert.ok(settings.context.fileName.includes('user-file.md'));
                assert.ok(!settings.context.fileName.includes('TASK.md'));
            }
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('strips managed entries from claude local settings', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.claude', 'settings.local.json'),
                JSON.stringify({
                    permissions: {
                        allow: [
                            'Bash(pwsh -File Octopus-agent-orchestrator/live/scripts/agent-gates/*:*)',
                            'user-custom-permission'
                        ]
                    }
                }, null, 2)
            );

            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            if (fs.existsSync(path.join(projectRoot, '.claude', 'settings.local.json'))) {
                const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
                const allowEntries = settings.permissions && settings.permissions.allow ? settings.permissions.allow : [];
                assert.ok(allowEntries.includes('user-custom-permission'));
                assert.ok(!allowEntries.some((e) => e.includes('Octopus-agent-orchestrator')));
            }
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('preserves runtime artifacts when requested', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            // Ensure runtime has content
            fs.writeFileSync(path.join(bundleRoot, 'runtime', 'test-artifact.txt'), 'data');

            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'yes'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.equal(result.keepRuntimeArtifacts, true);
            assert.ok(result.preservedRuntimePath !== '<none>');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('restores files from initialization backup when available', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            // Create initialization backup with pre-existing user content
            const backupDir = path.join(bundleRoot, 'runtime', 'backups', '20250101-120000');
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'CLAUDE.md'), '# My original Claude file');
            fs.writeFileSync(
                path.join(backupDir, '_install-backup.manifest.json'),
                JSON.stringify({ PreExistingFiles: ['CLAUDE.md'] })
            );

            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.ok(result.filesRestored >= 1);
            // After restore, CLAUDE.md should have original content
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.equal(
                fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
                '# My original Claude file'
            );
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('supports skip-backups flag', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                skipBackups: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            assert.equal(result.skipBackups, true);
            assert.equal(result.backupRoot, '<none>');
        } finally {
            removePathRecursive(projectRoot);
        }
    });

    it('cleans up commit guard hook', () => {
        const { projectRoot, bundleRoot } = setupDeployedWorkspace(repoRoot);
        try {
            const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
            const hookContent = [
                '#!/usr/bin/env bash',
                '# User hook',
                'echo "user hook"',
                COMMIT_GUARD_START,
                'echo "guard"',
                COMMIT_GUARD_END
            ].join('\n');
            fs.writeFileSync(hookPath, hookContent);

            const result = runUninstall({
                targetRoot: projectRoot,
                bundleRoot,
                noPrompt: true,
                keepPrimaryEntrypoint: 'no',
                keepTaskFile: 'no',
                keepRuntimeArtifacts: 'no'
            });

            assert.equal(result.result, 'SUCCESS');
            if (fs.existsSync(hookPath)) {
                const content = fs.readFileSync(hookPath, 'utf8');
                assert.ok(!content.includes(COMMIT_GUARD_START));
                assert.ok(content.includes('user hook'));
            }
        } finally {
            removePathRecursive(projectRoot);
        }
    });
});
