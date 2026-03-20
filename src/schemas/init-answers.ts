const {
    ALL_AGENT_ENTRYPOINT_FILES,
    BREVITY_VALUES,
    COLLECTED_VIA_VALUES,
    SOURCE_OF_TRUTH_VALUES,
    SOURCE_TO_ENTRYPOINT_MAP
} = require('../core/constants.ts');

const {
    ensurePlainObject,
    normalizeBooleanLike,
    normalizeEnum,
    normalizeNonEmptyString
} = require('./shared.ts');

function normalizeActiveAgentFiles(value) {
    if (value === null || value === undefined || value === '') {
        return [];
    }

    const parts = Array.isArray(value)
        ? value
        : String(value).split(/[;,]/g);

    const normalized = [];
    for (const part of parts) {
        const trimmed = normalizeNonEmptyString(part, 'ActiveAgentFiles');
        const match = ALL_AGENT_ENTRYPOINT_FILES.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
        if (!match) {
            throw new Error(`ActiveAgentFiles entry '${trimmed}' is not a canonical entrypoint.`);
        }

        if (!normalized.includes(match)) {
            normalized.push(match);
        }
    }

    return normalized;
}

function validateInitAnswers(input) {
    const raw = ensurePlainObject(input, 'Init answers');
    const normalized = {
        AssistantLanguage: normalizeNonEmptyString(raw.AssistantLanguage, 'AssistantLanguage'),
        AssistantBrevity: normalizeEnum(raw.AssistantBrevity, BREVITY_VALUES, 'AssistantBrevity'),
        SourceOfTruth: normalizeEnum(raw.SourceOfTruth, SOURCE_OF_TRUTH_VALUES, 'SourceOfTruth'),
        EnforceNoAutoCommit: normalizeBooleanLike(raw.EnforceNoAutoCommit, 'EnforceNoAutoCommit'),
        ClaudeOrchestratorFullAccess: normalizeBooleanLike(raw.ClaudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess'),
        TokenEconomyEnabled: normalizeBooleanLike(raw.TokenEconomyEnabled, 'TokenEconomyEnabled'),
        CollectedVia: raw.CollectedVia === undefined
            ? 'AGENT_INIT_PROMPT.md'
            : normalizeEnum(raw.CollectedVia, COLLECTED_VIA_VALUES, 'CollectedVia')
    };

    const activeAgentFiles = normalizeActiveAgentFiles(raw.ActiveAgentFiles);
    if (activeAgentFiles.length > 0) {
        normalized.ActiveAgentFiles = activeAgentFiles;
    }

    return normalized;
}

function serializeInitAnswers(input) {
    const normalized = validateInitAnswers(input);
    const serialized = {
        AssistantLanguage: normalized.AssistantLanguage,
        AssistantBrevity: normalized.AssistantBrevity,
        SourceOfTruth: normalized.SourceOfTruth,
        EnforceNoAutoCommit: normalized.EnforceNoAutoCommit ? 'true' : 'false',
        ClaudeOrchestratorFullAccess: normalized.ClaudeOrchestratorFullAccess ? 'true' : 'false',
        TokenEconomyEnabled: normalized.TokenEconomyEnabled ? 'true' : 'false',
        CollectedVia: normalized.CollectedVia
    };

    if (normalized.ActiveAgentFiles && normalized.ActiveAgentFiles.length > 0) {
        serialized.ActiveAgentFiles = normalized.ActiveAgentFiles.join(', ');
    }

    return serialized;
}

function getCanonicalEntrypointForSource(sourceOfTruth) {
    const normalized = normalizeEnum(sourceOfTruth, SOURCE_OF_TRUTH_VALUES, 'SourceOfTruth');
    return SOURCE_TO_ENTRYPOINT_MAP[normalized];
}

module.exports = {
    getCanonicalEntrypointForSource,
    serializeInitAnswers,
    validateInitAnswers
};
