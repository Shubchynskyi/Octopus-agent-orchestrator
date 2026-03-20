const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getCanonicalEntrypointForSource,
    serializeInitAnswers,
    validateInitAnswers
} = require('../../../src/schemas/init-answers.ts');

test('validateInitAnswers normalizes booleans and canonical entrypoint selections', () => {
    const normalized = validateInitAnswers({
        AssistantLanguage: 'English',
        AssistantBrevity: 'concise',
        SourceOfTruth: 'claude',
        EnforceNoAutoCommit: 'да',
        ClaudeOrchestratorFullAccess: 'no',
        TokenEconomyEnabled: 1,
        CollectedVia: 'cli_noninteractive',
        ActiveAgentFiles: 'agents.md, CLAUDE.md'
    });

    assert.equal(normalized.EnforceNoAutoCommit, true);
    assert.equal(normalized.ClaudeOrchestratorFullAccess, false);
    assert.equal(normalized.TokenEconomyEnabled, true);
    assert.deepEqual(normalized.ActiveAgentFiles, ['AGENTS.md', 'CLAUDE.md']);
    assert.equal(getCanonicalEntrypointForSource(normalized.SourceOfTruth), 'CLAUDE.md');
});

test('serializeInitAnswers returns the persisted string-backed contract shape', () => {
    const serialized = serializeInitAnswers({
        AssistantLanguage: 'English',
        AssistantBrevity: 'concise',
        SourceOfTruth: 'Codex',
        EnforceNoAutoCommit: true,
        ClaudeOrchestratorFullAccess: false,
        TokenEconomyEnabled: true,
        CollectedVia: 'AGENT_INIT_PROMPT.md',
        ActiveAgentFiles: 'AGENTS.md, CLAUDE.md'
    });

    assert.equal(serialized.EnforceNoAutoCommit, 'true');
    assert.equal(serialized.ClaudeOrchestratorFullAccess, 'false');
    assert.equal(serialized.TokenEconomyEnabled, 'true');
    assert.equal(serialized.ActiveAgentFiles, 'AGENTS.md, CLAUDE.md');
});

test('validateInitAnswers rejects unsupported source-of-truth values', () => {
    assert.throws(
        () => validateInitAnswers({
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'Other',
            EnforceNoAutoCommit: true,
            ClaudeOrchestratorFullAccess: false,
            TokenEconomyEnabled: true
        }),
        /SourceOfTruth/
    );
});
