import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';

import { runUpdateFromGit, buildGitCloneArgs } from '../../../src/lifecycle/update-git';
import { removePathRecursive } from '../../../src/lifecycle/common';

function git(args: string[], cwd: string) {
    const result = childProcess.spawnSync('git', args, {
        cwd,
        stdio: 'pipe',
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        const errorText = String(result.stderr || result.stdout || '').trim();
        throw new Error(`git ${args.join(' ')} failed: ${errorText}`);
    }
}

function createGitUpdateRepo(version: string) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-update-git-repo-'));
    fs.writeFileSync(path.join(repoRoot, 'VERSION'), `${version}\n`, 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({
        name: 'octopus-agent-orchestrator',
        version
    }, null, 2));
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Updated bundle\n', 'utf8');

    git(['init'], repoRoot);
    git(['config', 'user.email', 'tests@example.com'], repoRoot);
    git(['config', 'user.name', 'Octopus Tests'], repoRoot);
    git(['add', '.'], repoRoot);
    git(['commit', '-m', 'init'], repoRoot);
    return repoRoot;
}

function createDeployedWorkspace(version: string) {
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-update-git-target-'));
    const bundleRoot = path.join(targetRoot, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundleRoot, { recursive: true });
    fs.writeFileSync(path.join(bundleRoot, 'VERSION'), `${version}\n`, 'utf8');
    fs.writeFileSync(path.join(bundleRoot, 'package.json'), JSON.stringify({
        name: 'octopus-agent-orchestrator',
        version
    }, null, 2));
    return { targetRoot, bundleRoot };
}

describe('buildGitCloneArgs', () => {
    it('includes depth and repo path', () => {
        assert.deepEqual(
            buildGitCloneArgs('https://example.com/repo.git', null, 'C:/tmp/clone'),
            ['clone', '--depth', '1', 'https://example.com/repo.git', 'C:/tmp/clone']
        );
    });

    it('includes branch when provided', () => {
        assert.deepEqual(
            buildGitCloneArgs('https://example.com/repo.git', 'main', 'C:/tmp/clone'),
            ['clone', '--depth', '1', '--branch', 'main', '--single-branch', 'https://example.com/repo.git', 'C:/tmp/clone']
        );
    });
});

describe('runUpdateFromGit', () => {
    it('detects update availability from a local git repository in check-only mode', async () => {
        const repoRoot = createGitUpdateRepo('2.1.0');
        const { targetRoot, bundleRoot } = createDeployedWorkspace('2.0.0');
        try {
            const result = await runUpdateFromGit({
                targetRoot,
                bundleRoot,
                repoUrl: repoRoot,
                checkOnly: true,
                noPrompt: true,
                trustOverride: true
            });

            assert.equal(result.sourceType, 'git');
            assert.equal(result.repoUrl, repoRoot);
            assert.equal(result.checkUpdateResult, 'UPDATE_AVAILABLE');
            assert.equal(result.updateAvailable, true);
            assert.equal(result.updateApplied, false);
        } finally {
            removePathRecursive(repoRoot);
            removePathRecursive(targetRoot);
        }
    });

    it('runs the post-sync update lifecycle callback when applying an update', async () => {
        const repoRoot = createGitUpdateRepo('2.1.0');
        const { targetRoot, bundleRoot } = createDeployedWorkspace('2.0.0');
        try {
            let updateRunnerCalled = false;
            const result = await runUpdateFromGit({
                targetRoot,
                bundleRoot,
                repoUrl: repoRoot,
                noPrompt: true,
                trustOverride: true,
                updateRunner: () => {
                    updateRunnerCalled = true;
                }
            });

            assert.equal(result.checkUpdateResult, 'UPDATED');
            assert.equal(result.updateApplied, true);
            assert.equal(updateRunnerCalled, true);
        } finally {
            removePathRecursive(repoRoot);
            removePathRecursive(targetRoot);
        }
    });

    it('surfaces classified diagnostics when the requested branch is missing', async () => {
        const repoRoot = createGitUpdateRepo('2.1.0');
        const { targetRoot, bundleRoot } = createDeployedWorkspace('2.0.0');
        try {
            await assert.rejects(
                runUpdateFromGit({
                    targetRoot,
                    bundleRoot,
                    repoUrl: repoRoot,
                    branch: 'missing-branch',
                    checkOnly: true,
                    noPrompt: true,
                    trustOverride: true
                }),
                (error) => {
                    assert.match((error as Error).message, /DiagnosticTool: git/);
                    assert.match((error as Error).message, /DiagnosticCode: GIT_REF_NOT_FOUND/);
                    assert.match((error as Error).message, /DiagnosticSource:/);
                    assert.match((error as Error).message, /missing-branch/);
                    assert.match((error as Error).message, /DiagnosticStderr:/);
                    return true;
                }
            );
        } finally {
            removePathRecursive(repoRoot);
            removePathRecursive(targetRoot);
        }
    });
});
