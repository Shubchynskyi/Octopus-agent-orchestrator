const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    BASE_REQUIRED_PATHS,
    RULE_FILES,
    PROJECT_COMMAND_PLACEHOLDERS,
    MANAGED_START,
    MANAGED_END,
    buildRequiredPaths,
    detectMissingPaths,
    detectRuleFileViolations,
    detectVersionViolations,
    detectGitignoreViolations,
    extractManagedBlock,
    getBundlePath,
    getCanonicalEntrypoint,
    getCommandsRulePath,
    getMissingProjectCommands,
    readUtf8IfExists
} = require('../../../src/validators/workspace-layout.ts');

test('BASE_REQUIRED_PATHS is a frozen non-empty array', () => {
    assert.ok(Array.isArray(BASE_REQUIRED_PATHS));
    assert.ok(BASE_REQUIRED_PATHS.length > 50);
    assert.ok(Object.isFrozen(BASE_REQUIRED_PATHS));
});

test('RULE_FILES contains all 11 standard rule files', () => {
    assert.equal(RULE_FILES.length, 11);
    assert.ok(RULE_FILES.includes('00-core.md'));
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
