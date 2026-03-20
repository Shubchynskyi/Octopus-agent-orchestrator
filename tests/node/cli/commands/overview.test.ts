const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    buildOverviewOutput,
    printOverview
} = require('../../../../src/cli/commands/overview.ts');

const { DEFAULT_BUNDLE_NAME } = require('../../../../src/core/constants.ts');

// ---------------------------------------------------------------------------
// buildOverviewOutput
// ---------------------------------------------------------------------------

test('buildOverviewOutput includes OCTOPUS_OVERVIEW marker', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('OCTOPUS_OVERVIEW'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput includes OCTOPUS_STATUS marker', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('OCTOPUS_STATUS'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput includes Available Commands', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('Available Commands'));
        assert.ok(output.includes('setup'));
        assert.ok(output.includes('bootstrap'));
        assert.ok(output.includes('doctor'));
        assert.ok(output.includes('status'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput includes banner with version', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '2.0.0', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('v2.0.0'));
        assert.ok(output.includes('OCTOPUS AGENT ORCHESTRATOR'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput shows not-installed state for empty workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('Not installed'));
        assert.ok(output.includes('RecommendedNextCommand'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput shows bundle-present state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    const bundlePath = path.join(tmpDir, DEFAULT_BUNDLE_NAME);
    fs.mkdirSync(bundlePath, { recursive: true });
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('[x] Installed'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput includes Workspace Stages section', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('Workspace Stages'));
        assert.ok(output.includes('Installed'));
        assert.ok(output.includes('Primary initialization'));
        assert.ok(output.includes('Agent initialization'));
        assert.ok(output.includes('Ready for task execution'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('buildOverviewOutput includes workspace overview title', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));
    try {
        const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
        const output = buildOverviewOutput(pkg, tmpDir);
        assert.ok(output.includes('Workspace overview'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
