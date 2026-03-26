const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeJsonFile } = require('../../../src/core/json.ts');
const {
    loadInitAnswersFile,
    loadManagedConfigFile
} = require('../../../src/runtime/loaders.ts');

test('loadInitAnswersFile reads and normalizes persisted init answers', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-node-foundation-'));

    try {
        const targetPath = path.join(tempRoot, 'init-answers.json');
        writeJsonFile(targetPath, {
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'GitHubCopilot',
            EnforceNoAutoCommit: '1',
            ClaudeOrchestratorFullAccess: '0',
            TokenEconomyEnabled: 'yes',
            CollectedVia: 'CLI_INTERACTIVE',
            ActiveAgentFiles: 'AGENTS.md'
        });

        const normalized = loadInitAnswersFile(targetPath);
        assert.equal(normalized.SourceOfTruth, 'GitHubCopilot');
        assert.equal(normalized.EnforceNoAutoCommit, true);
        assert.equal(normalized.TokenEconomyEnabled, true);
        assert.deepEqual(normalized.ActiveAgentFiles, ['AGENTS.md']);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('loadManagedConfigFile validates tracked template configs through the runtime loader', () => {
    const normalized = loadManagedConfigFile(
        'paths',
        path.join(process.cwd(), 'template', 'config', 'paths.json')
    );

    assert.ok(Array.isArray(normalized.runtime_roots));
    assert.ok(Array.isArray(normalized.triggers.db));
    assert.ok(normalized.runtime_roots.includes('src/'));
});
