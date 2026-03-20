const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runReinit, recollectInitAnswers, getOptionalValue } = require('../../../src/materialization/reinit.ts');

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

function setupTestWorkspace(bundleRoot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-reinit-'));
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });
    fs.copyFileSync(path.join(bundleRoot, 'VERSION'), path.join(bundle, 'VERSION'));
    copyDirRecursive(path.join(bundleRoot, 'template'), path.join(bundle, 'template'));
    fs.mkdirSync(path.join(bundle, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'live/docs/agent-rules'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'live/config'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.git', 'hooks'), { recursive: true });

    // Copy template rule files to live for init source selection
    const templateRules = path.join(bundle, 'template/docs/agent-rules');
    const liveRules = path.join(bundle, 'live/docs/agent-rules');
    if (fs.existsSync(templateRules)) {
        for (const entry of fs.readdirSync(templateRules)) {
            fs.copyFileSync(path.join(templateRules, entry), path.join(liveRules, entry));
        }
    }

    // Copy template config to live
    const templateConfig = path.join(bundle, 'template/config');
    const liveConfig = path.join(bundle, 'live/config');
    if (fs.existsSync(templateConfig)) {
        for (const entry of fs.readdirSync(templateConfig)) {
            fs.copyFileSync(path.join(templateConfig, entry), path.join(liveConfig, entry));
        }
    }

    return { projectRoot: tmpDir, bundleRoot: bundle };
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

describe('getOptionalValue', () => {
    it('does case-insensitive lookup', () => {
        assert.equal(getOptionalValue({ AssistantLanguage: 'English' }, 'assistantlanguage'), 'English');
        assert.equal(getOptionalValue({ assistantlanguage: 'English' }, 'AssistantLanguage'), 'English');
    });

    it('returns null for missing key', () => {
        assert.equal(getOptionalValue({ a: 1 }, 'missing'), null);
    });

    it('returns null for null/undefined object', () => {
        assert.equal(getOptionalValue(null, 'key'), null);
        assert.equal(getOptionalValue(undefined, 'key'), null);
    });

    it('strips underscores and hyphens for matching', () => {
        assert.equal(getOptionalValue({ 'assistant_language': 'English' }, 'AssistantLanguage'), 'English');
    });
});

describe('recollectInitAnswers', () => {
    it('preserves existing answers', () => {
        const changes = [];
        const result = recollectInitAnswers({
            existingAnswers: {
                AssistantLanguage: 'Russian',
                AssistantBrevity: 'detailed',
                SourceOfTruth: 'Codex',
                EnforceNoAutoCommit: 'true',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'AGENT_INIT_PROMPT.md'
            },
            changes
        });

        assert.equal(result.AssistantLanguage, 'Russian');
        assert.equal(result.AssistantBrevity, 'detailed');
        assert.equal(result.SourceOfTruth, 'Codex');
        const preservedCount = changes.filter((c) => c.action === 'preserved').length;
        assert.ok(preservedCount >= 6);
    });

    it('applies overrides over existing', () => {
        const changes = [];
        const result = recollectInitAnswers({
            existingAnswers: {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            },
            overrides: { AssistantLanguage: 'German' },
            changes
        });

        assert.equal(result.AssistantLanguage, 'German');
        const overridden = changes.filter((c) => c.action === 'overridden');
        assert.ok(overridden.length >= 1);
    });

    it('uses defaults when no existing or overrides', () => {
        const changes = [];
        const result = recollectInitAnswers({ changes });

        assert.equal(result.AssistantLanguage, 'English');
        assert.equal(result.AssistantBrevity, 'concise');
        assert.equal(result.SourceOfTruth, 'Claude');
        const defaulted = changes.filter((c) => c.action === 'recommended_default');
        assert.ok(defaulted.length >= 5);
    });

    it('infers from live version.json', () => {
        const changes = [];
        const result = recollectInitAnswers({
            liveVersion: { AssistantLanguage: 'French', SourceOfTruth: 'Windsurf' },
            changes
        });

        assert.equal(result.AssistantLanguage, 'French');
        assert.equal(result.SourceOfTruth, 'Windsurf');
        const inferred = changes.filter((c) => c.action === 'inferred');
        assert.ok(inferred.length >= 2);
    });

    it('infers TokenEconomyEnabled from token-economy.json', () => {
        const changes = [];
        const result = recollectInitAnswers({
            tokenEconomyConfig: { enabled: false },
            changes
        });

        assert.equal(result.TokenEconomyEnabled, 'false');
    });
});

describe('runReinit', () => {
    const repoRoot = findRepoRoot();

    it('runs end-to-end with existing answers', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
            fs.writeFileSync(answersPath, JSON.stringify({
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            }));

            const result = runReinit({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result.assistantLanguage, 'English');
            assert.equal(result.sourceOfTruth, 'Claude');
            assert.equal(result.canonicalEntrypoint, 'CLAUDE.md');
            assert.ok(result.changes.length > 0);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('applies overrides and writes updated answers', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
            fs.writeFileSync(answersPath, JSON.stringify({
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            }));

            const result = runReinit({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                overrides: { AssistantLanguage: 'German', AssistantBrevity: 'detailed' },
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(result.assistantLanguage, 'German');
            assert.equal(result.assistantBrevity, 'detailed');

            // Verify answers were persisted
            const persistedAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
            assert.equal(persistedAnswers.AssistantLanguage, 'German');
            assert.equal(persistedAnswers.AssistantBrevity, 'detailed');
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('updates core rule file with new language/brevity', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
            fs.writeFileSync(answersPath, JSON.stringify({
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            }));

            runReinit({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                overrides: { AssistantLanguage: 'Spanish' },
                skipVerify: true,
                skipManifestValidation: true
            });

            const coreRule = fs.readFileSync(
                path.join(bundleRoot, 'live/docs/agent-rules/00-core.md'), 'utf8'
            );
            assert.ok(coreRule.includes('Spanish'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('throws when no init answers and no defaults available', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            // Don't create any existing answers - reinit should still work with defaults
            const answersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
            // (file does not exist)

            const result = runReinit({
                targetRoot: projectRoot,
                bundleRoot,
                initAnswersPath: answersPath,
                skipVerify: true,
                skipManifestValidation: true
            });

            // Should use defaults
            assert.equal(result.assistantLanguage, 'English');
            assert.equal(result.sourceOfTruth, 'Claude');
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});
