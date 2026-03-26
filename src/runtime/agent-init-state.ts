const path = require('node:path');

const {
    DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH
} = require('../core/constants.ts');
const { pathExists } = require('../core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../core/json.ts');

const AGENT_INIT_STATE_VERSION = 1;

function normalizeBoolean(value, fieldName) {
    if (value === true || value === false) {
        return value;
    }

    throw new Error(`${fieldName} must be a boolean.`);
}

function normalizeOptionalStringArray(value, fieldName) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} must be an array.`);
    }

    const normalized = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text) {
            continue;
        }
        if (!normalized.includes(text)) {
            normalized.push(text);
        }
    }

    return normalized;
}

function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function areStringArraysEqual(left, right) {
    const leftNormalized = normalizeOptionalStringArray(left, 'left');
    const rightNormalized = normalizeOptionalStringArray(right, 'right');
    if (leftNormalized.length !== rightNormalized.length) {
        return false;
    }

    for (let index = 0; index < leftNormalized.length; index += 1) {
        if (leftNormalized[index] !== rightNormalized[index]) {
            return false;
        }
    }

    return true;
}

function validateAgentInitState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Agent init state must be a JSON object.');
    }

    return {
        Version: input.Version === undefined ? AGENT_INIT_STATE_VERSION : Number(input.Version),
        UpdatedAt: String(input.UpdatedAt || new Date().toISOString()),
        AssistantLanguage: normalizeOptionalString(input.AssistantLanguage),
        SourceOfTruth: normalizeOptionalString(input.SourceOfTruth),
        AssistantLanguageConfirmed: normalizeBoolean(input.AssistantLanguageConfirmed, 'AssistantLanguageConfirmed'),
        ActiveAgentFilesConfirmed: normalizeBoolean(input.ActiveAgentFilesConfirmed, 'ActiveAgentFilesConfirmed'),
        ProjectRulesUpdated: normalizeBoolean(input.ProjectRulesUpdated, 'ProjectRulesUpdated'),
        SkillsPromptCompleted: normalizeBoolean(input.SkillsPromptCompleted, 'SkillsPromptCompleted'),
        VerificationPassed: normalizeBoolean(input.VerificationPassed, 'VerificationPassed'),
        ManifestValidationPassed: normalizeBoolean(input.ManifestValidationPassed, 'ManifestValidationPassed'),
        ActiveAgentFiles: normalizeOptionalStringArray(input.ActiveAgentFiles, 'ActiveAgentFiles')
    };
}

function createAgentInitState(overrides = {}) {
    return validateAgentInitState({
        Version: AGENT_INIT_STATE_VERSION,
        UpdatedAt: new Date().toISOString(),
        AssistantLanguage: null,
        SourceOfTruth: null,
        AssistantLanguageConfirmed: false,
        ActiveAgentFilesConfirmed: false,
        ProjectRulesUpdated: false,
        SkillsPromptCompleted: false,
        VerificationPassed: false,
        ManifestValidationPassed: false,
        ActiveAgentFiles: [],
        ...overrides
    });
}

function getAgentInitStatePath(targetRoot, relativePath = DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH) {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.resolve(targetRoot, relativePath);
}

function readAgentInitStateSafe(targetRoot, relativePath = DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH) {
    const statePath = getAgentInitStatePath(targetRoot, relativePath);
    if (!pathExists(statePath)) {
    return {
        statePath,
        state: null,
        error: null
    };
    }

    try {
        return {
            statePath,
            state: validateAgentInitState(readJsonFile(statePath)),
            error: null
        };
    } catch (error) {
        return {
            statePath,
            state: null,
            error: error.message || String(error)
        };
    }
}

function writeAgentInitState(targetRoot, state, relativePath = DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH) {
    const statePath = getAgentInitStatePath(targetRoot, relativePath);
    writeJsonFile(statePath, validateAgentInitState(state));
    return statePath;
}

function doesAgentInitStateMatchAnswers(state, answers) {
    if (!state) {
        return false;
    }

    const expectedSourceOfTruth = normalizeOptionalString(answers && answers.SourceOfTruth);
    const expectedActiveAgentFiles = normalizeOptionalStringArray(
        answers && answers.ActiveAgentFiles,
        'ActiveAgentFiles'
    );

    return (
        normalizeOptionalString(state.SourceOfTruth) === expectedSourceOfTruth
        && areStringArraysEqual(state.ActiveAgentFiles, expectedActiveAgentFiles)
    );
}

module.exports = {
    AGENT_INIT_STATE_VERSION,
    areStringArraysEqual,
    createAgentInitState,
    doesAgentInitStateMatchAnswers,
    getAgentInitStatePath,
    readAgentInitStateSafe,
    validateAgentInitState,
    writeAgentInitState
};
