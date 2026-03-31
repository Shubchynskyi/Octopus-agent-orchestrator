import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveDelegatedLauncherTarget } from '../../../src/bin/octopus';

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function createOctopusPackageRoot(rootPath: string, version = '2.4.0'): void {
    writeFile(path.join(rootPath, 'package.json'), JSON.stringify({
        name: 'octopus-agent-orchestrator',
        version
    }, null, 2));
    writeFile(path.join(rootPath, 'VERSION'), `${version}\n`);
    writeFile(path.join(rootPath, 'bin', 'octopus.js'), '#!/usr/bin/env node\n');
}

test('global launcher delegates to source checkout in current workspace', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-router-source-'));
    try {
        const sourceRoot = path.join(tempRoot, 'repo');
        const globalPackageRoot = path.join(tempRoot, 'global', 'node_modules', 'octopus-agent-orchestrator');
        createOctopusPackageRoot(sourceRoot);
        createOctopusPackageRoot(globalPackageRoot, '2.3.0');

        const delegatedCli = resolveDelegatedLauncherTarget(
            ['status'],
            sourceRoot,
            path.join(globalPackageRoot, 'bin', 'octopus.js'),
            globalPackageRoot
        );

        assert.equal(delegatedCli, path.join(sourceRoot, 'bin', 'octopus.js'));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('global launcher delegates to deployed bundle when workspace contains managed bundle', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-router-bundle-'));
    try {
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const bundleRoot = path.join(workspaceRoot, 'Octopus-agent-orchestrator');
        const globalPackageRoot = path.join(tempRoot, 'global', 'node_modules', 'octopus-agent-orchestrator');
        createOctopusPackageRoot(bundleRoot, '2.4.0');
        createOctopusPackageRoot(globalPackageRoot, '2.3.0');

        const delegatedCli = resolveDelegatedLauncherTarget(
            ['status'],
            workspaceRoot,
            path.join(globalPackageRoot, 'bin', 'octopus.js'),
            globalPackageRoot
        );

        assert.equal(delegatedCli, path.join(bundleRoot, 'bin', 'octopus.js'));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('global launcher respects explicit --target-root when cwd is outside the workspace', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-router-target-root-'));
    try {
        const callerRoot = path.join(tempRoot, 'caller');
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const bundleRoot = path.join(workspaceRoot, 'Octopus-agent-orchestrator');
        const globalPackageRoot = path.join(tempRoot, 'global', 'node_modules', 'octopus-agent-orchestrator');
        fs.mkdirSync(callerRoot, { recursive: true });
        createOctopusPackageRoot(bundleRoot, '2.4.0');
        createOctopusPackageRoot(globalPackageRoot, '2.3.0');

        const delegatedCli = resolveDelegatedLauncherTarget(
            ['status', '--target-root', workspaceRoot],
            callerRoot,
            path.join(globalPackageRoot, 'bin', 'octopus.js'),
            globalPackageRoot
        );

        assert.equal(delegatedCli, path.join(bundleRoot, 'bin', 'octopus.js'));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('local source launcher does not delegate to itself', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-router-local-source-'));
    try {
        const sourceRoot = path.join(tempRoot, 'repo');
        createOctopusPackageRoot(sourceRoot);

        const delegatedCli = resolveDelegatedLauncherTarget(
            ['status'],
            sourceRoot,
            path.join(sourceRoot, 'bin', 'octopus.js'),
            sourceRoot
        );

        assert.equal(delegatedCli, null);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('local deployed bundle launcher does not redirect to source checkout', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-router-local-bundle-'));
    try {
        const sourceRoot = path.join(tempRoot, 'repo');
        const bundleRoot = path.join(sourceRoot, 'Octopus-agent-orchestrator');
        createOctopusPackageRoot(sourceRoot);
        createOctopusPackageRoot(bundleRoot, '2.4.0');

        const delegatedCli = resolveDelegatedLauncherTarget(
            ['status'],
            sourceRoot,
            path.join(bundleRoot, 'bin', 'octopus.js'),
            bundleRoot
        );

        assert.equal(delegatedCli, null);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
