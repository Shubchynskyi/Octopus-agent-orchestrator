const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    BOOTSTRAP_DEFINITIONS,
    buildBootstrapSuccessOutput,
    handleBootstrap
} = require('../../../../src/cli/commands/bootstrap.ts');

const { DEPLOY_ITEMS, deployFreshBundle } = require('../../../../src/cli/commands/cli-helpers.ts');
const { DEFAULT_BUNDLE_NAME } = require('../../../../src/core/constants.ts');

// ---------------------------------------------------------------------------
// BOOTSTRAP_DEFINITIONS
// ---------------------------------------------------------------------------

test('BOOTSTRAP_DEFINITIONS includes expected flags', () => {
    assert.ok(BOOTSTRAP_DEFINITIONS['--destination']);
    assert.ok(BOOTSTRAP_DEFINITIONS['--target']);
    assert.equal(BOOTSTRAP_DEFINITIONS['--target'].key, 'destination');
    assert.ok(BOOTSTRAP_DEFINITIONS['--repo-url']);
    assert.ok(BOOTSTRAP_DEFINITIONS['--branch']);
});

// ---------------------------------------------------------------------------
// buildBootstrapSuccessOutput
// ---------------------------------------------------------------------------

test('buildBootstrapSuccessOutput includes OCTOPUS_BOOTSTRAP_OK marker', () => {
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', '/workspace/Octopus-agent-orchestrator');
    assert.ok(output.includes('OCTOPUS_BOOTSTRAP_OK'));
});

test('buildBootstrapSuccessOutput includes version info', () => {
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', '/workspace/Octopus-agent-orchestrator');
    assert.ok(output.includes('PackageVersion: 1.0.8'));
    assert.ok(output.includes('BundleVersion: 1.0.8'));
});

test('buildBootstrapSuccessOutput includes paths', () => {
    const dest = path.join('/workspace', DEFAULT_BUNDLE_NAME);
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', dest);
    assert.ok(output.includes('BundlePath:'));
    assert.ok(output.includes('TargetRoot:'));
    assert.ok(output.includes('InitPromptPath:'));
    assert.ok(output.includes('InitAnswersPath:'));
});

test('buildBootstrapSuccessOutput includes next steps', () => {
    const dest = path.join('/workspace', DEFAULT_BUNDLE_NAME);
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', dest);
    assert.ok(output.includes('NextSteps:'));
    assert.ok(output.includes('1. Give your agent'));
    assert.ok(output.includes('2. Let the agent write'));
    assert.ok(output.includes('AGENT_INIT_PROMPT.md'));
});

test('buildBootstrapSuccessOutput uses npx for default bundle name', () => {
    const dest = path.join('/workspace', DEFAULT_BUNDLE_NAME);
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', dest);
    assert.ok(output.includes('npx'));
    assert.ok(output.includes('install'));
});

test('buildBootstrapSuccessOutput uses raw installer for custom bundle paths', () => {
    const dest = path.join('/workspace', 'custom-bundle');
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const output = buildBootstrapSuccessOutput(pkg, '1.0.8', dest);
    assert.ok(output.includes('pwsh -File'));
    assert.ok(output.includes('bash'));
    assert.ok(output.includes('install.ps1'));
    assert.ok(output.includes('install.sh'));
});

// ---------------------------------------------------------------------------
// handleBootstrap integration (with local source)
// ---------------------------------------------------------------------------

test('handleBootstrap deploys bundle to destination', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-integ-'));
    try {
        // Resolve repo root: __dirname is .node-build/tests/node/cli/commands/ → 5 up
        const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
        const dest = path.join(tmpDir, DEFAULT_BUNDLE_NAME);

        // Capture console output
        const originalLog = console.log;
        const lines = [];
        console.log = function () {
            lines.push([...arguments].join(' '));
        };

        try {
            await handleBootstrap(['--destination', dest], { version: '1.0.8', name: 'octopus-agent-orchestrator' }, repoRoot);
        } finally {
            console.log = originalLog;
        }

        assert.ok(fs.existsSync(dest), 'Bundle directory should exist');
        assert.ok(fs.existsSync(path.join(dest, 'VERSION')), 'VERSION file should exist');
        assert.ok(fs.existsSync(path.join(dest, 'package.json')), 'package.json should exist');
        assert.ok(fs.existsSync(path.join(dest, 'bin', 'octopus.js')), 'bin/octopus.js should exist');
        assert.ok(lines.some(function (l) { return l.includes('OCTOPUS_BOOTSTRAP_OK'); }), 'Should print OCTOPUS_BOOTSTRAP_OK');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('handleBootstrap uses positional as destination fallback', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-integ-'));
    try {
        const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
        const dest = path.join(tmpDir, 'my-bundle');

        const originalLog = console.log;
        const lines = [];
        console.log = function () { lines.push([...arguments].join(' ')); };
        try {
            await handleBootstrap([dest], { version: '1.0.8', name: 'octopus-agent-orchestrator' }, repoRoot);
        } finally {
            console.log = originalLog;
        }

        assert.ok(fs.existsSync(dest), 'Bundle directory should exist');
        assert.ok(lines.some(function (l) { return l.includes('OCTOPUS_BOOTSTRAP_OK'); }));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('handleBootstrap prints help on --help flag', async () => {
    const originalLog = console.log;
    const lines = [];
    console.log = function () { lines.push([...arguments].join(' ')); };
    try {
        await handleBootstrap(['--help'], { version: '1.0.8', name: 'octopus-agent-orchestrator' }, '/tmp');
    } finally {
        console.log = originalLog;
    }
    assert.ok(lines.some(function (l) { return l.includes('Octopus Agent Orchestrator CLI'); }));
});

test('handleBootstrap prints version on --version flag', async () => {
    const originalLog = console.log;
    const lines = [];
    console.log = function () { lines.push([...arguments].join(' ')); };
    try {
        await handleBootstrap(['--version'], { version: '1.0.8', name: 'octopus-agent-orchestrator' }, '/tmp');
    } finally {
        console.log = originalLog;
    }
    assert.ok(lines.some(function (l) { return l === '1.0.8'; }));
});
