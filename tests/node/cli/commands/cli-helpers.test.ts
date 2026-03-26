const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    buildBannerText,
    buildHelpText,
    COMMAND_SUMMARY,
    convertSourceOfTruthToEntrypoint,
    copyPath,
    DEPLOY_ITEMS,
    deployFreshBundle,
    ensureDirectoryExists,
    ensureSourceItemExists,
    getAgentInitPromptPath,
    getBundlePath,
    getInitAnswerValue,
    normalizeActiveAgentFiles,
    normalizeAgentEntrypointToken,
    normalizeAssistantBrevity,
    normalizeLogicalKey,
    normalizePathValue,
    normalizeSourceOfTruth,
    padRight,
    parseBooleanText,
    parseOptionalText,
    parseOptions,
    parseRequiredText,
    readBundleVersion,
    readOptionalJsonFile,
    removePathIfExists,
    resolvePathInsideRoot,
    shouldSkipPath,
    syncBundleItems,
    toPosixPath,
    tryNormalizeAssistantBrevity,
    tryNormalizeSourceOfTruth,
    tryParseBooleanText
} = require('../../../../src/cli/commands/cli-helpers.ts');

// ---------------------------------------------------------------------------
// parseOptions
// ---------------------------------------------------------------------------

test('parseOptions parses string flags', () => {
    const defs = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--branch': { key: 'branch', type: 'string' }
    };
    const { options } = parseOptions(['--target-root', '/tmp', '--branch', 'main'], defs);
    assert.equal(options.targetRoot, '/tmp');
    assert.equal(options.branch, 'main');
});

test('parseOptions parses boolean flags', () => {
    const defs = {
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' }
    };
    const { options } = parseOptions(['--dry-run', '--no-prompt'], defs);
    assert.equal(options.dryRun, true);
    assert.equal(options.noPrompt, true);
});

test('parseOptions parses inline equals values', () => {
    const defs = { '--target-root': { key: 'targetRoot', type: 'string' } };
    const { options } = parseOptions(['--target-root=/tmp/test'], defs);
    assert.equal(options.targetRoot, '/tmp/test');
});

test('parseOptions accumulates repeated string-array flags', () => {
    const defs = { '--changed-path': { key: 'changedPaths', type: 'string[]' } };
    const { options } = parseOptions(['--changed-path', 'src/app.ts', '--changed-path=tests/app.test.ts'], defs);
    assert.deepEqual(options.changedPaths, ['src/app.ts', 'tests/app.test.ts']);
});

test('parseOptions recognizes --help and --version', () => {
    const { options } = parseOptions(['-h', '-v'], {});
    assert.equal(options.help, true);
    assert.equal(options.version, true);
});

test('parseOptions allows positionals when configured', () => {
    const defs = {};
    const { positionals } = parseOptions(['mypath'], defs, { allowPositionals: true, maxPositionals: 1 });
    assert.deepEqual(positionals, ['mypath']);
});

test('parseOptions rejects unknown options', () => {
    assert.throws(
        () => parseOptions(['--unknown'], {}),
        /Unknown option/
    );
});

test('parseOptions rejects excess positionals', () => {
    assert.throws(
        () => parseOptions(['a', 'b'], {}, { allowPositionals: true, maxPositionals: 1 }),
        /Too many positional/
    );
});

test('parseOptions rejects unexpected positionals', () => {
    assert.throws(
        () => parseOptions(['a'], {}),
        /Unexpected positional/
    );
});

test('parseOptions throws when string flag missing value', () => {
    const defs = { '--target-root': { key: 'targetRoot', type: 'string' } };
    assert.throws(
        () => parseOptions(['--target-root'], defs),
        /requires a value/
    );
});

// ---------------------------------------------------------------------------
// Boolean parsing
// ---------------------------------------------------------------------------

test('parseBooleanText handles true values', () => {
    assert.equal(parseBooleanText(true, 'test'), true);
    assert.equal(parseBooleanText('true', 'test'), true);
    assert.equal(parseBooleanText('yes', 'test'), true);
    assert.equal(parseBooleanText('1', 'test'), true);
    assert.equal(parseBooleanText('да', 'test'), true);
    assert.equal(parseBooleanText(1, 'test'), true);
});

test('parseBooleanText handles false values', () => {
    assert.equal(parseBooleanText(false, 'test'), false);
    assert.equal(parseBooleanText('false', 'test'), false);
    assert.equal(parseBooleanText('no', 'test'), false);
    assert.equal(parseBooleanText('0', 'test'), false);
    assert.equal(parseBooleanText('нет', 'test'), false);
    assert.equal(parseBooleanText(0, 'test'), false);
});

test('parseBooleanText throws for invalid input', () => {
    assert.throws(() => parseBooleanText('maybe', 'test'), /must be one of/);
});

test('tryParseBooleanText returns fallback for null/undefined', () => {
    assert.equal(tryParseBooleanText(null, true), true);
    assert.equal(tryParseBooleanText(undefined, false), false);
    assert.equal(tryParseBooleanText('', true), true);
});

test('tryParseBooleanText parses valid values', () => {
    assert.equal(tryParseBooleanText('yes', false), true);
    assert.equal(tryParseBooleanText('no', true), false);
});

test('tryParseBooleanText returns fallback for invalid', () => {
    assert.equal(tryParseBooleanText('maybe', true), true);
});

// ---------------------------------------------------------------------------
// Source-of-truth normalization
// ---------------------------------------------------------------------------

test('normalizeSourceOfTruth normalizes case-insensitive values', () => {
    assert.equal(normalizeSourceOfTruth('claude'), 'Claude');
    assert.equal(normalizeSourceOfTruth('CODEX'), 'Codex');
    assert.equal(normalizeSourceOfTruth('GitHubCopilot'), 'GitHubCopilot');
});

test('normalizeSourceOfTruth throws for invalid values', () => {
    assert.throws(() => normalizeSourceOfTruth('Other'), /must be one of/);
});

test('tryNormalizeSourceOfTruth returns fallback for empty', () => {
    assert.equal(tryNormalizeSourceOfTruth(null, 'Claude'), 'Claude');
    assert.equal(tryNormalizeSourceOfTruth('', 'Claude'), 'Claude');
    assert.equal(tryNormalizeSourceOfTruth(undefined), 'Claude');
});

test('tryNormalizeSourceOfTruth returns fallback for invalid', () => {
    assert.equal(tryNormalizeSourceOfTruth('Invalid', 'Codex'), 'Codex');
});

// ---------------------------------------------------------------------------
// Brevity normalization
// ---------------------------------------------------------------------------

test('normalizeAssistantBrevity normalizes valid values', () => {
    assert.equal(normalizeAssistantBrevity('concise'), 'concise');
    assert.equal(normalizeAssistantBrevity('Detailed'), 'detailed');
});

test('normalizeAssistantBrevity throws for invalid values', () => {
    assert.throws(() => normalizeAssistantBrevity('verbose'), /must be one of/);
});

test('tryNormalizeAssistantBrevity returns fallback for empty/invalid', () => {
    assert.equal(tryNormalizeAssistantBrevity(null), 'concise');
    assert.equal(tryNormalizeAssistantBrevity('invalid', 'detailed'), 'detailed');
});

// ---------------------------------------------------------------------------
// Agent entrypoint normalization
// ---------------------------------------------------------------------------

test('normalizeAgentEntrypointToken maps shorthand names', () => {
    assert.equal(normalizeAgentEntrypointToken('claude'), 'CLAUDE.md');
    assert.equal(normalizeAgentEntrypointToken('codex'), 'AGENTS.md');
    assert.equal(normalizeAgentEntrypointToken('gemini'), 'GEMINI.md');
    assert.equal(normalizeAgentEntrypointToken('githubcopilot'), '.github/copilot-instructions.md');
    assert.equal(normalizeAgentEntrypointToken('copilot'), '.github/copilot-instructions.md');
    assert.equal(normalizeAgentEntrypointToken('windsurf'), '.windsurf/rules/rules.md');
    assert.equal(normalizeAgentEntrypointToken('junie'), '.junie/guidelines.md');
    assert.equal(normalizeAgentEntrypointToken('antigravity'), '.antigravity/rules.md');
});

test('normalizeAgentEntrypointToken returns null for empty', () => {
    assert.equal(normalizeAgentEntrypointToken(''), null);
    assert.equal(normalizeAgentEntrypointToken(null), null);
});

test('normalizeAgentEntrypointToken strips "or" prefix', () => {
    assert.equal(normalizeAgentEntrypointToken('or CLAUDE.md'), 'CLAUDE.md');
});

test('normalizeAgentEntrypointToken resolves numbered selections', () => {
    assert.equal(normalizeAgentEntrypointToken('1'), 'CLAUDE.md');
    assert.equal(normalizeAgentEntrypointToken('2'), 'AGENTS.md');
    assert.equal(normalizeAgentEntrypointToken('7'), '.antigravity/rules.md');
});

test('normalizeAgentEntrypointToken returns null for unknown', () => {
    assert.equal(normalizeAgentEntrypointToken('unknown.md'), null);
    assert.equal(normalizeAgentEntrypointToken('99'), null);
});

test('convertSourceOfTruthToEntrypoint maps known values', () => {
    assert.equal(convertSourceOfTruthToEntrypoint('Claude'), 'CLAUDE.md');
    assert.equal(convertSourceOfTruthToEntrypoint('Codex'), 'AGENTS.md');
    assert.equal(convertSourceOfTruthToEntrypoint('GitHubCopilot'), '.github/copilot-instructions.md');
});

test('convertSourceOfTruthToEntrypoint returns null for unknown', () => {
    assert.equal(convertSourceOfTruthToEntrypoint('Unknown'), null);
    assert.equal(convertSourceOfTruthToEntrypoint(''), null);
});

test('normalizeActiveAgentFiles includes canonical entrypoint for source', () => {
    const result = normalizeActiveAgentFiles(null, 'Claude');
    assert.ok(result.includes('CLAUDE.md'));
});

test('normalizeActiveAgentFiles merges comma-separated inputs with canonical', () => {
    const result = normalizeActiveAgentFiles('AGENTS.md, GEMINI.md', 'Claude');
    assert.ok(result.includes('CLAUDE.md'));
    assert.ok(result.includes('AGENTS.md'));
    assert.ok(result.includes('GEMINI.md'));
});

test('normalizeActiveAgentFiles supports numbered selections in non-interactive setup input', () => {
    const result = normalizeActiveAgentFiles('1, 2, 7', 'Claude');
    assert.equal(result, 'CLAUDE.md, AGENTS.md, .antigravity/rules.md');
});

test('normalizeActiveAgentFiles returns null for empty input and unknown source', () => {
    assert.equal(normalizeActiveAgentFiles(null, 'Unknown'), null);
});

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

test('normalizeLogicalKey strips separators and lowercases', () => {
    assert.equal(normalizeLogicalKey('Assistant_Language'), 'assistantlanguage');
    assert.equal(normalizeLogicalKey('enforce-no-auto-commit'), 'enforcenoautocommit');
});

test('getInitAnswerValue finds case-insensitive keys', () => {
    const answers = { AssistantLanguage: 'English', SourceOfTruth: 'Claude' };
    assert.equal(getInitAnswerValue(answers, 'assistantlanguage'), 'English');
    assert.equal(getInitAnswerValue(answers, 'source_of_truth'), 'Claude');
    assert.equal(getInitAnswerValue(answers, 'missing'), null);
});

test('parseOptionalText handles null/undefined/empty', () => {
    assert.equal(parseOptionalText(null), null);
    assert.equal(parseOptionalText(undefined), null);
    assert.equal(parseOptionalText(''), null);
    assert.equal(parseOptionalText('hello'), 'hello');
});

test('parseOptionalText joins arrays', () => {
    assert.equal(parseOptionalText(['a', 'b']), 'a, b');
    assert.equal(parseOptionalText([]), null);
});

test('parseRequiredText throws for empty', () => {
    assert.throws(() => parseRequiredText('', 'field'), /must not be empty/);
    assert.throws(() => parseRequiredText(null, 'field'), /must not be empty/);
});

test('parseRequiredText returns trimmed text', () => {
    assert.equal(parseRequiredText('  hello  ', 'field'), 'hello');
});

test('padRight pads to minimum width', () => {
    assert.equal(padRight('hi', 5), 'hi   ');
    assert.equal(padRight('hello', 3), 'hello');
});

test('toPosixPath converts backslashes', () => {
    assert.equal(toPosixPath('a\\b\\c'), 'a/b/c');
    assert.equal(toPosixPath('a/b/c'), 'a/b/c');
});

test('normalizePathValue resolves to absolute', () => {
    const result = normalizePathValue('.');
    assert.ok(path.isAbsolute(result));
});

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

test('shouldSkipPath detects skipped entries', () => {
    assert.equal(shouldSkipPath('/some/path/__pycache__'), true);
    assert.equal(shouldSkipPath('/some/path/.pytest_cache'), true);
    assert.equal(shouldSkipPath('/some/path/file.pyc'), true);
    assert.equal(shouldSkipPath('/some/path/file.pyo'), true);
    assert.equal(shouldSkipPath('/some/path/file.ts'), false);
    assert.equal(shouldSkipPath('/some/path/normal'), false);
});

test('removePathIfExists is no-op for missing path', () => {
    removePathIfExists(path.join(os.tmpdir(), 'nonexistent-' + Date.now()));
    // Should not throw
});

test('copyPath copies file correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-test-'));
    try {
        const srcFile = path.join(tmpDir, 'source.txt');
        const dstFile = path.join(tmpDir, 'sub', 'dest.txt');
        fs.writeFileSync(srcFile, 'hello', 'utf8');
        copyPath(srcFile, dstFile);
        assert.equal(fs.readFileSync(dstFile, 'utf8'), 'hello');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('copyPath copies directory recursively', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-test-'));
    try {
        const srcDir = path.join(tmpDir, 'src');
        const dstDir = path.join(tmpDir, 'dst');
        fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'a.txt'), 'aa', 'utf8');
        fs.writeFileSync(path.join(srcDir, 'sub', 'b.txt'), 'bb', 'utf8');
        copyPath(srcDir, dstDir);
        assert.equal(fs.readFileSync(path.join(dstDir, 'a.txt'), 'utf8'), 'aa');
        assert.equal(fs.readFileSync(path.join(dstDir, 'sub', 'b.txt'), 'utf8'), 'bb');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('copyPath skips __pycache__', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-test-'));
    try {
        const srcDir = path.join(tmpDir, '__pycache__');
        const dstDir = path.join(tmpDir, 'dst');
        fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, 'file.pyc'), 'data', 'utf8');
        copyPath(srcDir, dstDir);
        assert.equal(fs.existsSync(dstDir), false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('copyPath rejects symlink targets outside the bundle root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-test-'));
    try {
        const sourceRoot = path.join(tmpDir, 'source');
        const destRoot = path.join(tmpDir, 'dest');
        const outsideFile = path.join(tmpDir, 'outside.txt');
        const linkPath = path.join(sourceRoot, 'outside-link.txt');

        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.writeFileSync(outsideFile, 'outside', 'utf8');

        try {
            fs.symlinkSync(outsideFile, linkPath);
        } catch (error) {
            if (error && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
                return;
            }
            throw error;
        }

        assert.throws(
            () => copyPath(linkPath, path.join(destRoot, 'outside-link.txt'), sourceRoot),
            /Refusing to copy symlink outside bundle root/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ensureSourceItemExists throws for missing asset', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-test-'));
    try {
        assert.throws(
            () => ensureSourceItemExists(tmpDir, 'nonexistent'),
            /Bundle source asset is missing/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ensureSourceItemExists returns path for existing asset', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-test-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hi', 'utf8');
        const result = ensureSourceItemExists(tmpDir, 'file.txt');
        assert.equal(result, path.join(tmpDir, 'file.txt'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// deployFreshBundle
// ---------------------------------------------------------------------------

test('deployFreshBundle copies DEPLOY_ITEMS to destination', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
    try {
        const sourceRoot = path.join(tmpDir, 'source');
        const destPath = path.join(tmpDir, 'bundle');
        fs.mkdirSync(sourceRoot, { recursive: true });
        for (const item of DEPLOY_ITEMS) {
            const itemPath = path.join(sourceRoot, item);
            if (item.includes('/') || item === 'bin' || item === 'src' || item === 'template') {
                fs.mkdirSync(itemPath, { recursive: true });
                fs.writeFileSync(path.join(itemPath, 'marker.txt'), item, 'utf8');
            } else {
                fs.mkdirSync(path.dirname(itemPath), { recursive: true });
                fs.writeFileSync(itemPath, item, 'utf8');
            }
        }
        deployFreshBundle(sourceRoot, destPath);
        assert.ok(fs.existsSync(destPath));
        for (const item of DEPLOY_ITEMS) {
            assert.ok(fs.existsSync(path.join(destPath, item)), `Missing: ${item}`);
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('deployFreshBundle throws for non-empty destination', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
    try {
        const dest = path.join(tmpDir, 'dest');
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'existing.txt'), 'data', 'utf8');
        assert.throws(
            () => deployFreshBundle(tmpDir, dest),
            /already exists and is not empty/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('deployFreshBundle allows empty existing directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
    try {
        const sourceRoot = path.join(tmpDir, 'source');
        const destPath = path.join(tmpDir, 'empty-dest');
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });
        for (const item of DEPLOY_ITEMS) {
            const itemPath = path.join(sourceRoot, item);
            if (item.includes('/') || item === 'bin' || item === 'src' || item === 'template') {
                fs.mkdirSync(itemPath, { recursive: true });
                fs.writeFileSync(path.join(itemPath, 'marker.txt'), item, 'utf8');
            } else {
                fs.writeFileSync(itemPath, item, 'utf8');
            }
        }
        deployFreshBundle(sourceRoot, destPath);
        assert.ok(fs.existsSync(destPath));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// syncBundleItems
// ---------------------------------------------------------------------------

test('syncBundleItems replaces existing items', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
    try {
        const sourceRoot = path.join(tmpDir, 'source');
        const destPath = path.join(tmpDir, 'bundle');
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });
        for (const item of DEPLOY_ITEMS) {
            const itemPath = path.join(sourceRoot, item);
            if (item.includes('/') || item === 'bin' || item === 'src' || item === 'template') {
                fs.mkdirSync(itemPath, { recursive: true });
                fs.writeFileSync(path.join(itemPath, 'marker.txt'), 'new', 'utf8');
            } else {
                fs.writeFileSync(itemPath, 'new-' + item, 'utf8');
            }
        }
        // Pre-populate with old data
        fs.writeFileSync(path.join(destPath, 'VERSION'), 'old', 'utf8');

        syncBundleItems(sourceRoot, destPath);
        assert.equal(fs.readFileSync(path.join(destPath, 'VERSION'), 'utf8'), 'new-VERSION');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// resolvePathInsideRoot
// ---------------------------------------------------------------------------

test('resolvePathInsideRoot resolves relative path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
    try {
        const resolved = resolvePathInsideRoot(tmpDir, 'subdir/file.json', 'TestPath', { allowMissing: true });
        assert.ok(resolved.includes('subdir'));
        assert.ok(resolved.includes('file.json'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('resolvePathInsideRoot throws for path escape', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
    try {
        assert.throws(
            () => resolvePathInsideRoot(tmpDir, '../../etc/passwd', 'TestPath'),
            /must resolve inside target root/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('resolvePathInsideRoot throws for empty path', () => {
    assert.throws(
        () => resolvePathInsideRoot('/tmp', '', 'TestPath'),
        /must not be empty/
    );
});

// ---------------------------------------------------------------------------
// ensureDirectoryExists
// ---------------------------------------------------------------------------

test('ensureDirectoryExists throws for missing directory', () => {
    assert.throws(
        () => ensureDirectoryExists(path.join(os.tmpdir(), 'nonexistent-' + Date.now()), 'TestDir'),
        /not found/
    );
});

test('ensureDirectoryExists passes for real directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-test-'));
    try {
        ensureDirectoryExists(tmpDir, 'TestDir');
        // Should not throw
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// getBundlePath / getAgentInitPromptPath
// ---------------------------------------------------------------------------

test('getBundlePath joins with default bundle name', () => {
    const result = getBundlePath('/workspace');
    assert.ok(result.endsWith('Octopus-agent-orchestrator'));
});

test('getAgentInitPromptPath points to AGENT_INIT_PROMPT.md', () => {
    const result = getAgentInitPromptPath('/workspace/Octopus-agent-orchestrator');
    assert.ok(result.endsWith('AGENT_INIT_PROMPT.md'));
});

// ---------------------------------------------------------------------------
// readOptionalJsonFile
// ---------------------------------------------------------------------------

test('readOptionalJsonFile returns null for missing file', () => {
    assert.equal(readOptionalJsonFile(path.join(os.tmpdir(), 'missing-' + Date.now() + '.json')), null);
});

test('readOptionalJsonFile returns parsed JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-test-'));
    try {
        const filePath = path.join(tmpDir, 'test.json');
        fs.writeFileSync(filePath, '{"key":"value"}', 'utf8');
        const result = readOptionalJsonFile(filePath);
        assert.deepEqual(result, { key: 'value' });
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readOptionalJsonFile returns null for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-test-'));
    try {
        const filePath = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(filePath, 'not json', 'utf8');
        assert.equal(readOptionalJsonFile(filePath), null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readOptionalJsonFile returns null for empty file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-test-'));
    try {
        const filePath = path.join(tmpDir, 'empty.json');
        fs.writeFileSync(filePath, '  ', 'utf8');
        assert.equal(readOptionalJsonFile(filePath), null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// readBundleVersion
// ---------------------------------------------------------------------------

test('readBundleVersion reads VERSION file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'VERSION'), '1.2.3\n', 'utf8');
        assert.equal(readBundleVersion(tmpDir), '1.2.3');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readBundleVersion falls back to package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"version":"2.0.0"}', 'utf8');
        assert.equal(readBundleVersion(tmpDir), '2.0.0');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Banner / help builders
// ---------------------------------------------------------------------------

test('buildBannerText includes version and title', () => {
    const pkg = { version: '1.0.8' };
    const text = buildBannerText(pkg, 'Test title', 'Test subtitle');
    assert.ok(text.includes('v1.0.8'));
    assert.ok(text.includes('OCTOPUS AGENT ORCHESTRATOR'));
    assert.ok(text.includes('Test title'));
    assert.ok(text.includes('Test subtitle'));
});

test('buildHelpText includes all command descriptions', () => {
    const pkg = { version: '1.0.8', name: 'octopus-agent-orchestrator' };
    const text = buildHelpText(pkg);
    assert.ok(text.includes('setup'));
    assert.ok(text.includes('agent-init'));
    assert.ok(text.includes('bootstrap'));
    assert.ok(text.includes('doctor'));
    assert.ok(text.includes('skills'));
    assert.ok(text.includes('suggest'));
    assert.ok(text.includes('--help'));
    assert.ok(text.includes('--version'));
    assert.ok(text.includes('--target-root'));
    assert.ok(text.includes('--repo-url'));
    assert.ok(text.includes('--package-spec'));
    assert.ok(text.includes('--source-path'));
    assert.ok(text.includes('--snapshot-path'));
    assert.ok(text.includes('rollback'));
});

test('COMMAND_SUMMARY has expected commands', () => {
    const names = COMMAND_SUMMARY.map(function (c) { return c[0]; });
    assert.ok(names.includes('setup'));
    assert.ok(names.includes('agent-init'));
    assert.ok(names.includes('bootstrap'));
    assert.ok(names.includes('doctor'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('rollback'));
    assert.ok(names.includes('skills'));
    assert.ok(names.includes('gate'));
    assert.equal(COMMAND_SUMMARY.find(function (c) { return c[0] === 'skills'; })[1], 'List, suggest, and manage optional skill packs');
});
