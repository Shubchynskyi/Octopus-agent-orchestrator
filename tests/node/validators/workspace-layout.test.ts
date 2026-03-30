import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    BASE_REQUIRED_PATHS,
    RULE_FILES,
    PROJECT_COMMAND_PLACEHOLDERS,
    MANAGED_START,
    MANAGED_END,
    buildRequiredPaths,
    detectMissingPaths,
    detectVersionViolations,
    detectGitignoreViolations,
    extractManagedBlock,
    getBundlePath,
    getCanonicalEntrypoint,
    getCommandsRulePath,
    getMissingProjectCommands,
    readUtf8IfExists,
    detectSourceBundleParity
} from '../../../src/validators/workspace-layout';

test('detectSourceBundleParity returns isSourceCheckout false for empty dir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));
    try {
        const result = detectSourceBundleParity(tmpDir);
        assert.equal(result.isSourceCheckout, false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectSourceBundleParity detects stale bundle when version differs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'bin', 'octopus.js'), '', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin', 'octopus.js'), '', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'VERSION'), '1.0.1', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'VERSION'), '1.0.0', 'utf8');

        const result = detectSourceBundleParity(tmpDir);
        assert.equal(result.isSourceCheckout, true);
        assert.equal(result.isStale, true);
        assert.ok(result.violations.some(v => v.includes('version')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectSourceBundleParity detects stale bundle when launcher is older', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'VERSION'), '1.0.0', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'VERSION'), '1.0.0', 'utf8');

        const rootLauncher = path.join(tmpDir, 'bin', 'octopus.js');
        const bundleLauncher = path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin', 'octopus.js');

        fs.writeFileSync(bundleLauncher, 'old', 'utf8');
        // Ensure bundle is older by at least 2 seconds
        const bundleTime = new Date(Date.now() - 5000);
        fs.utimesSync(bundleLauncher, bundleTime, bundleTime);

        fs.writeFileSync(rootLauncher, 'new', 'utf8');

        const result = detectSourceBundleParity(tmpDir);
        assert.equal(result.isSourceCheckout, true);
        assert.equal(result.isStale, true);
        assert.ok(result.violations.some(v => v.includes('older than')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectSourceBundleParity passes when matching', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'VERSION'), '1.0.0', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'Octopus-agent-orchestrator', 'VERSION'), '1.0.0', 'utf8');

        const rootLauncher = path.join(tmpDir, 'bin', 'octopus.js');
        const bundleLauncher = path.join(tmpDir, 'Octopus-agent-orchestrator', 'bin', 'octopus.js');

        fs.writeFileSync(rootLauncher, 'same', 'utf8');
        fs.writeFileSync(bundleLauncher, 'same', 'utf8');

        // Ensure same time
        const now = new Date();
        fs.utimesSync(rootLauncher, now, now);
        fs.utimesSync(bundleLauncher, now, now);

        const result = detectSourceBundleParity(tmpDir);
        assert.equal(result.isSourceCheckout, true);
        assert.equal(result.isStale, false);
        assert.equal(result.violations.length, 0);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('BASE_REQUIRED_PATHS is a frozen non-empty array', () => {
    assert.ok(Array.isArray(BASE_REQUIRED_PATHS));
    assert.ok(BASE_REQUIRED_PATHS.length > 25);
    assert.ok(Object.isFrozen(BASE_REQUIRED_PATHS));
    assert.ok(BASE_REQUIRED_PATHS.includes('Octopus-agent-orchestrator/src'));
    assert.ok(BASE_REQUIRED_PATHS.includes('Octopus-agent-orchestrator/live/config/skills-index.json'));
    assert.ok(BASE_REQUIRED_PATHS.includes('Octopus-agent-orchestrator/live/skills/orchestration/skill.json'));
    assert.ok(BASE_REQUIRED_PATHS.includes('Octopus-agent-orchestrator/live/skills/dependency-review/skill.json'));
    assert.ok(!BASE_REQUIRED_PATHS.includes('.qwen/settings.json'));
});

test('RULE_FILES contains all 12 standard rule files', () => {
    assert.equal(RULE_FILES.length, 12);
    assert.ok(RULE_FILES.includes('00-core.md'));
    assert.ok(RULE_FILES.includes('15-project-memory.md'));
    assert.ok(RULE_FILES.includes('40-commands.md'));
    assert.ok(RULE_FILES.includes('90-skill-catalog.md'));
});

test('PROJECT_COMMAND_PLACEHOLDERS contains expected placeholders', () => {
    assert.ok(PROJECT_COMMAND_PLACEHOLDERS.length >= 14);
    assert.ok(PROJECT_COMMAND_PLACEHOLDERS.includes('<install dependencies command>'));
    assert.ok(PROJECT_COMMAND_PLACEHOLDERS.includes('<unit test command>'));
});

test('getCanonicalEntrypoint maps known source-of-truth values', () => {
    assert.equal(getCanonicalEntrypoint('Claude'), 'CLAUDE.md');
    assert.equal(getCanonicalEntrypoint('Codex'), 'AGENTS.md');
    assert.equal(getCanonicalEntrypoint('Qwen'), 'QWEN.md');
    assert.equal(getCanonicalEntrypoint('GitHubCopilot'), '.github/copilot-instructions.md');
    assert.equal(getCanonicalEntrypoint('Windsurf'), '.windsurf/rules/rules.md');
    assert.equal(getCanonicalEntrypoint('Junie'), '.junie/guidelines.md');
    assert.equal(getCanonicalEntrypoint('Antigravity'), '.antigravity/rules.md');
    assert.equal(getCanonicalEntrypoint('Gemini'), 'GEMINI.md');
});

test('getCanonicalEntrypoint returns null for unknown values', () => {
    assert.equal(getCanonicalEntrypoint('Unknown'), null);
    assert.equal(getCanonicalEntrypoint(''), null);
});

test('getCanonicalEntrypoint is case-insensitive', () => {
    assert.equal(getCanonicalEntrypoint('claude'), 'CLAUDE.md');
    assert.equal(getCanonicalEntrypoint('CLAUDE'), 'CLAUDE.md');
    assert.equal(getCanonicalEntrypoint('qwen'), 'QWEN.md');
    assert.equal(getCanonicalEntrypoint('githubcopilot'), '.github/copilot-instructions.md');
});

test('getBundlePath joins target root with default bundle name', () => {
    const result = getBundlePath('/projects/my-app');
    assert.ok(result.includes('Octopus-agent-orchestrator'));
});

test('buildRequiredPaths includes base paths plus rule files', () => {
    const paths = buildRequiredPaths({});
    assert.ok(paths.length >= BASE_REQUIRED_PATHS.length);
    assert.ok(paths.includes('TASK.md'));
    assert.ok(paths.includes('Octopus-agent-orchestrator/VERSION'));
    assert.ok(paths.some(p => p.includes('00-core.md')));
    assert.ok(paths.some(p => p.includes('90-skill-catalog.md')));
    for (const rf of RULE_FILES) {
        assert.ok(
            paths.some(p => p.includes(rf)),
            `Expected required paths to include rule file ${rf}`
        );
    }
});

test('buildRequiredPaths adds claude settings when claudeOrchestratorFullAccess', () => {
    const withAccess = buildRequiredPaths({ claudeOrchestratorFullAccess: true });
    const withoutAccess = buildRequiredPaths({ claudeOrchestratorFullAccess: false });
    assert.ok(withAccess.includes('.claude/settings.local.json'));
    assert.ok(!withoutAccess.includes('.claude/settings.local.json'));
});

test('buildRequiredPaths adds active agent files', () => {
    const paths = buildRequiredPaths({
        activeAgentFiles: ['CLAUDE.md', 'AGENTS.md']
    });
    assert.ok(paths.includes('CLAUDE.md'));
    assert.ok(paths.includes('AGENTS.md'));
});

test('detectMissingPaths finds missing paths in temp dir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'));
    try {
        const missing = detectMissingPaths(tmpDir, ['existing.txt', 'missing.txt']);
        assert.deepEqual(missing, ['existing.txt', 'missing.txt']);

        fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'ok', 'utf8');
        const missing2 = detectMissingPaths(tmpDir, ['existing.txt', 'missing.txt']);
        assert.deepEqual(missing2, ['missing.txt']);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getCommandsRulePath returns correct path', () => {
    const result = getCommandsRulePath('/bundle');
    assert.ok(result.endsWith(path.join('live', 'docs', 'agent-rules', '40-commands.md')));
});

test('getMissingProjectCommands returns all placeholders when content is null', () => {
    const missing = getMissingProjectCommands(null);
    assert.deepEqual(missing, [...PROJECT_COMMAND_PLACEHOLDERS]);
});

test('getMissingProjectCommands returns empty when no placeholders present', () => {
    const missing = getMissingProjectCommands('npm install\nnpm test\n');
    assert.deepEqual(missing, []);
});

test('getMissingProjectCommands detects remaining placeholders', () => {
    const content = 'npm install\n<unit test command>\n';
    const missing = getMissingProjectCommands(content);
    assert.ok(missing.includes('<unit test command>'));
    assert.ok(!missing.includes('<install dependencies command>'));
});

test('extractManagedBlock extracts content between markers', () => {
    const content = [
        'Before',
        MANAGED_START,
        'managed content',
        MANAGED_END,
        'After'
    ].join('\n');

    const block = extractManagedBlock(content);
    assert.ok(block !== null);
    assert.ok(block.includes('managed content'));
    assert.ok(block.startsWith(MANAGED_START));
    assert.ok(block.endsWith(MANAGED_END));
});

test('extractManagedBlock returns null when no markers', () => {
    assert.equal(extractManagedBlock('no markers here'), null);
    assert.equal(extractManagedBlock(''), null);
});

test('readUtf8IfExists returns null for non-existent file', () => {
    assert.equal(readUtf8IfExists('/nonexistent/file.txt'), null);
});

test('readUtf8IfExists reads existing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-test-'));
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world', 'utf8');

    try {
        const content = readUtf8IfExists(filePath);
        assert.equal(content, 'hello world');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectVersionViolations catches version mismatch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
    const oaoDir = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const liveDir = path.join(oaoDir, 'live');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(oaoDir, 'VERSION'), '1.0.0', 'utf8');
    fs.writeFileSync(
        path.join(liveDir, 'version.json'),
        JSON.stringify({ Version: '1.0.1', SourceOfTruth: 'Claude', CanonicalEntrypoint: 'CLAUDE.md' }),
        'utf8'
    );

    try {
        const { violations } = detectVersionViolations(tmpDir, 'Claude', 'CLAUDE.md');
        assert.ok(violations.some(v => v.includes('must match')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectVersionViolations passes when versions match', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
    const oaoDir = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const liveDir = path.join(oaoDir, 'live');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(oaoDir, 'VERSION'), '1.0.0', 'utf8');
    fs.writeFileSync(
        path.join(liveDir, 'version.json'),
        JSON.stringify({
            Version: '1.0.0',
            SourceOfTruth: 'Claude',
            CanonicalEntrypoint: 'CLAUDE.md',
            ActiveAgentFiles: 'CLAUDE.md'
        }),
        'utf8'
    );

    try {
        const { violations } = detectVersionViolations(tmpDir, 'Claude', 'CLAUDE.md');
        assert.equal(violations.length, 0);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectGitignoreViolations detects missing entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-test-'));
    fs.writeFileSync(
        path.join(tmpDir, '.gitignore'),
        'node_modules/\nTASK.md\n',
        'utf8'
    );

    try {
        const missing = detectGitignoreViolations(tmpDir, [
            'TASK.md',
            'Octopus-agent-orchestrator/',
            '.qwen/'
        ]);
        assert.ok(missing.includes('Octopus-agent-orchestrator/'));
        assert.ok(missing.includes('.qwen/'));
        assert.ok(!missing.includes('TASK.md'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectGitignoreViolations returns all entries when no .gitignore', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-test-'));
    try {
        const missing = detectGitignoreViolations(tmpDir, ['entry1', 'entry2']);
        assert.deepEqual(missing, ['entry1', 'entry2']);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
