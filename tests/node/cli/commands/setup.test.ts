const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    SETUP_DEFINITIONS,
    getSetupAnswerDefaults,
    buildSetupHandoffText,
    buildSetupStepsText
} = require('../../../../src/cli/commands/setup.ts');

const { DEFAULT_BUNDLE_NAME, DEFAULT_INIT_ANSWERS_RELATIVE_PATH } = require('../../../../src/core/constants.ts');
const { parseOptions, getBundlePath } = require('../../../../src/cli/commands/cli-helpers.ts');

// ---------------------------------------------------------------------------
// SETUP_DEFINITIONS
// ---------------------------------------------------------------------------

test('SETUP_DEFINITIONS includes all expected flags', () => {
    assert.ok(SETUP_DEFINITIONS['--target-root']);
    assert.ok(SETUP_DEFINITIONS['--init-answers-path']);
    assert.ok(SETUP_DEFINITIONS['--repo-url']);
    assert.ok(SETUP_DEFINITIONS['--branch']);
    assert.ok(SETUP_DEFINITIONS['--dry-run']);
    assert.equal(SETUP_DEFINITIONS['--dry-run'].type, 'boolean');
    assert.ok(SETUP_DEFINITIONS['--no-prompt']);
    assert.ok(SETUP_DEFINITIONS['--skip-verify']);
    assert.ok(SETUP_DEFINITIONS['--skip-manifest-validation']);
    assert.ok(SETUP_DEFINITIONS['--assistant-language']);
    assert.ok(SETUP_DEFINITIONS['--assistant-brevity']);
    assert.ok(SETUP_DEFINITIONS['--active-agent-files']);
    assert.ok(SETUP_DEFINITIONS['--source-of-truth']);
    assert.ok(SETUP_DEFINITIONS['--enforce-no-auto-commit']);
    assert.ok(SETUP_DEFINITIONS['--claude-orchestrator-full-access']);
    assert.ok(SETUP_DEFINITIONS['--claude-full-access']);
    assert.equal(SETUP_DEFINITIONS['--claude-full-access'].key, 'claudeOrchestratorFullAccess');
    assert.ok(SETUP_DEFINITIONS['--token-economy-enabled']);
});

test('parseOptions works with SETUP_DEFINITIONS', () => {
    const { options } = parseOptions([
        '--target-root', '/workspace',
        '--no-prompt',
        '--source-of-truth', 'Claude',
        '--assistant-language', 'English',
        '--assistant-brevity', 'concise',
        '--enforce-no-auto-commit', 'true',
        '--token-economy-enabled', 'false'
    ], SETUP_DEFINITIONS);

    assert.equal(options.targetRoot, '/workspace');
    assert.equal(options.noPrompt, true);
    assert.equal(options.sourceOfTruth, 'Claude');
    assert.equal(options.assistantLanguage, 'English');
    assert.equal(options.assistantBrevity, 'concise');
    assert.equal(options.enforceNoAutoCommit, 'true');
    assert.equal(options.tokenEconomyEnabled, 'false');
});

test('--claude-full-access aliases to claudeOrchestratorFullAccess', () => {
    const { options } = parseOptions(['--claude-full-access', 'yes'], SETUP_DEFINITIONS);
    assert.equal(options.claudeOrchestratorFullAccess, 'yes');
});

// ---------------------------------------------------------------------------
// getSetupAnswerDefaults
// ---------------------------------------------------------------------------

test('getSetupAnswerDefaults returns sensible defaults for empty workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-defaults-'));
    try {
        const defaults = getSetupAnswerDefaults(tmpDir, DEFAULT_INIT_ANSWERS_RELATIVE_PATH, {});
        assert.equal(defaults.assistantLanguage, 'English');
        assert.equal(defaults.assistantBrevity, 'concise');
        assert.equal(defaults.sourceOfTruth, 'Claude');
        assert.equal(defaults.enforceNoAutoCommit, true);
        assert.equal(defaults.claudeOrchestratorFullAccess, false);
        assert.equal(defaults.tokenEconomyEnabled, true);
        assert.equal(defaults.activeAgentFiles, 'CLAUDE.md');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getSetupAnswerDefaults respects CLI options over defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-defaults-'));
    try {
        const defaults = getSetupAnswerDefaults(tmpDir, DEFAULT_INIT_ANSWERS_RELATIVE_PATH, {
            assistantLanguage: 'Russian',
            assistantBrevity: 'detailed',
            sourceOfTruth: 'Codex',
            enforceNoAutoCommit: 'false',
            claudeOrchestratorFullAccess: 'true',
            tokenEconomyEnabled: 'false'
        });
        assert.equal(defaults.assistantLanguage, 'Russian');
        assert.equal(defaults.assistantBrevity, 'detailed');
        assert.equal(defaults.sourceOfTruth, 'Codex');
        assert.equal(defaults.enforceNoAutoCommit, false);
        assert.equal(defaults.claudeOrchestratorFullAccess, true);
        assert.equal(defaults.tokenEconomyEnabled, false);
        assert.equal(defaults.activeAgentFiles, 'AGENTS.md');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getSetupAnswerDefaults reads existing init answers file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-defaults-'));
    const answersDir = path.join(tmpDir, DEFAULT_BUNDLE_NAME, 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'Deutsch',
            AssistantBrevity: 'detailed',
            SourceOfTruth: 'Gemini',
            EnforceNoAutoCommit: 'true',
            ClaudeOrchestratorFullAccess: 'true',
            TokenEconomyEnabled: 'false'
        }),
        'utf8'
    );

    try {
        const defaults = getSetupAnswerDefaults(tmpDir, DEFAULT_INIT_ANSWERS_RELATIVE_PATH, {});
        assert.equal(defaults.assistantLanguage, 'Deutsch');
        assert.equal(defaults.assistantBrevity, 'detailed');
        assert.equal(defaults.sourceOfTruth, 'Gemini');
        assert.equal(defaults.enforceNoAutoCommit, true);
        assert.equal(defaults.claudeOrchestratorFullAccess, true);
        assert.equal(defaults.tokenEconomyEnabled, false);
        assert.equal(defaults.activeAgentFiles, 'GEMINI.md');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getSetupAnswerDefaults CLI options override existing init answers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-defaults-'));
    const answersDir = path.join(tmpDir, DEFAULT_BUNDLE_NAME, 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'Deutsch',
            AssistantBrevity: 'detailed',
            SourceOfTruth: 'Gemini',
            EnforceNoAutoCommit: 'true',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true'
        }),
        'utf8'
    );

    try {
        const defaults = getSetupAnswerDefaults(tmpDir, DEFAULT_INIT_ANSWERS_RELATIVE_PATH, {
            sourceOfTruth: 'Claude'
        });
        assert.equal(defaults.assistantLanguage, 'Deutsch');
        assert.equal(defaults.sourceOfTruth, 'Claude');
        assert.equal(defaults.activeAgentFiles, 'CLAUDE.md');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getSetupAnswerDefaults does not silently reuse old extra active agent files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-defaults-'));
    const answersDir = path.join(tmpDir, DEFAULT_BUNDLE_NAME, 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'Codex',
            EnforceNoAutoCommit: 'true',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true',
            ActiveAgentFiles: 'CLAUDE.md, AGENTS.md'
        }),
        'utf8'
    );

    try {
        const defaults = getSetupAnswerDefaults(tmpDir, DEFAULT_INIT_ANSWERS_RELATIVE_PATH, {});
        assert.equal(defaults.sourceOfTruth, 'Codex');
        assert.equal(defaults.activeAgentFiles, 'AGENTS.md');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// buildSetupHandoffText
// ---------------------------------------------------------------------------

test('buildSetupHandoffText includes agent initialization section', () => {
    const snapshot = {
        bundlePath: '/workspace/Octopus-agent-orchestrator',
        activeAgentFiles: 'CLAUDE.md, AGENTS.md'
    };
    const text = buildSetupHandoffText(snapshot);
    assert.ok(text.includes('Agent Initialization'));
    assert.ok(text.includes('Primary setup is complete'));
    assert.ok(text.includes('Next stage: launch your agent'));
    assert.ok(text.includes('CLAUDE.md, AGENTS.md'));
    assert.ok(text.includes('AGENT_INIT_PROMPT.md'));
    assert.ok(text.includes('Execute task T-001 depth=2'));
});

test('buildSetupHandoffText omits active agent files when null', () => {
    const snapshot = {
        bundlePath: '/workspace/Octopus-agent-orchestrator',
        activeAgentFiles: null
    };
    const text = buildSetupHandoffText(snapshot);
    assert.ok(!text.includes('Active agent files'));
    assert.ok(text.includes('Agent Initialization'));
});

// ---------------------------------------------------------------------------
// buildSetupStepsText
// ---------------------------------------------------------------------------

test('buildSetupStepsText includes step markers for interactive', () => {
    const text = buildSetupStepsText('/workspace', true, true);
    assert.ok(text.includes('You will be asked 6 control questions'));
    assert.ok(text.includes('[1/3] Deploy bundle'));
    assert.ok(text.includes('[2/3] Collect or reuse init answers'));
    assert.ok(text.includes('[3/3] Run install and prepare agent handoff'));
});

test('buildSetupStepsText shows non-interactive message for no-prompt', () => {
    const text = buildSetupStepsText('/workspace', false, false);
    assert.ok(text.includes('Running in non-interactive mode'));
});

test('buildSetupStepsText shows fallback message for non-TTY interactive', () => {
    const text = buildSetupStepsText('/workspace', false, true);
    assert.ok(text.includes('Interactive prompts are unavailable'));
});

test('buildSetupStepsText includes project path', () => {
    const text = buildSetupStepsText('/workspace', true, true);
    assert.ok(text.includes('Project: /workspace'));
});

test('buildSetupStepsText includes bundle path', () => {
    const text = buildSetupStepsText('/workspace', true, true);
    assert.ok(text.includes('BundlePath:'));
});
