const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function findRepoRoot(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        const packageJsonPath = path.join(current, 'package.json');
        const cliPath = path.join(current, 'bin', 'octopus.js');
        if (fs.existsSync(packageJsonPath) && fs.existsSync(cliPath)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(`Could not resolve repository root from: ${startDir}`);
        }
        current = parent;
    }
}

const CLI_PATH = path.join(findRepoRoot(__dirname), 'bin', 'octopus.js');

function runCli(args) {
    const result = childProcess.spawnSync(
        process.execPath,
        [CLI_PATH, ...args],
        { windowsHide: true, encoding: 'utf8', timeout: 30000 }
    );
    const combined = (result.stdout || '') + (result.stderr || '');
    return { exitCode: result.status, output: combined, stderr: result.stderr || '' };
}

// ---------------------------------------------------------------------------
// Bootstrap failures still produce OCTOPUS_BOOTSTRAP_FAILED
// ---------------------------------------------------------------------------

test('bootstrap with invalid flag produces OCTOPUS_BOOTSTRAP_FAILED', () => {
    const { exitCode, stderr } = runCli(['bootstrap', '--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Expected OCTOPUS_BOOTSTRAP_FAILED in stderr');
});

test('implicit bootstrap (unrecognised first arg) produces OCTOPUS_BOOTSTRAP_FAILED', () => {
    const { exitCode, stderr } = runCli(['--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Expected OCTOPUS_BOOTSTRAP_FAILED in stderr');
});

// ---------------------------------------------------------------------------
// Non-bootstrap failures produce OCTOPUS_CLI_FAILED
// ---------------------------------------------------------------------------

test('verify with invalid flag produces OCTOPUS_CLI_FAILED', () => {
    const { exitCode, stderr } = runCli(['verify', '--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_CLI_FAILED'), 'Expected OCTOPUS_CLI_FAILED in stderr');
    assert.ok(!stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Should not contain OCTOPUS_BOOTSTRAP_FAILED');
});

test('gate with invalid gate name produces OCTOPUS_CLI_FAILED', () => {
    const { exitCode, stderr } = runCli(['gate', 'nonexistent-gate']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_CLI_FAILED'), 'Expected OCTOPUS_CLI_FAILED in stderr');
    assert.ok(!stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Should not contain OCTOPUS_BOOTSTRAP_FAILED');
});

test('uninstall with invalid flag produces OCTOPUS_CLI_FAILED', () => {
    const { exitCode, stderr } = runCli(['uninstall', '--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_CLI_FAILED'), 'Expected OCTOPUS_CLI_FAILED in stderr');
    assert.ok(!stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Should not contain OCTOPUS_BOOTSTRAP_FAILED');
});

test('update with invalid flag produces OCTOPUS_CLI_FAILED', () => {
    const { exitCode, stderr } = runCli(['update', '--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_CLI_FAILED'), 'Expected OCTOPUS_CLI_FAILED in stderr');
    assert.ok(!stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Should not contain OCTOPUS_BOOTSTRAP_FAILED');
});

test('skills with invalid flag produces OCTOPUS_CLI_FAILED', () => {
    const { exitCode, stderr } = runCli(['skills', '--no-such-flag']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('OCTOPUS_CLI_FAILED'), 'Expected OCTOPUS_CLI_FAILED in stderr');
    assert.ok(!stderr.includes('OCTOPUS_BOOTSTRAP_FAILED'), 'Should not contain OCTOPUS_BOOTSTRAP_FAILED');
});

// ---------------------------------------------------------------------------
// Error message is still printed alongside the marker
// ---------------------------------------------------------------------------

test('failure marker is followed by human-readable error message', () => {
    const { stderr } = runCli(['gate', 'nonexistent-gate']);
    const lines = stderr.split(/\r?\n/).filter(Boolean);
    assert.ok(lines.length >= 2, 'Expected at least two non-empty stderr lines (marker + message)');
    assert.equal(lines[0], 'OCTOPUS_CLI_FAILED');
    assert.ok(lines[1].length > 0, 'Expected a human-readable error message after the marker');
});
