const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const { pathExists } = require('../core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../core/json.ts');
const { validateInitAnswers, serializeInitAnswers } = require('../schemas/init-answers.ts');
const {
    convertActiveAgentEntrypointFilesToString,
    getActiveAgentEntrypointFiles
} = require('../materialization/common.ts');
const { runInstall } = require('../materialization/install.ts');
const { runVerify } = require('../validators/verify.ts');
const { validateManifest } = require('../validators/validate-manifest.ts');
const {
    createAgentInitState,
    writeAgentInitState
} = require('../runtime/agent-init-state.ts');

function resolvePathInsideTarget(targetRoot, relativeOrAbsolutePath) {
    return path.isAbsolute(relativeOrAbsolutePath)
        ? relativeOrAbsolutePath
        : path.resolve(targetRoot, relativeOrAbsolutePath);
}

function parseBooleanYesNo(value, fieldName) {
    if (value === true || value === false) {
        return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'yes' || normalized === 'true' || normalized === '1') {
        return true;
    }
    if (normalized === 'no' || normalized === 'false' || normalized === '0') {
        return false;
    }
    throw new Error(`${fieldName} must be yes or no.`);
}

function runAgentInit(options) {
    const {
        targetRoot,
        bundleRoot = path.join(targetRoot, DEFAULT_BUNDLE_NAME),
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        activeAgentFiles,
        projectRulesUpdated,
        skillsPrompted,
        installRunner = runInstall,
        verifyRunner = runVerify,
        manifestRunner = validateManifest
    } = options;

    const normalizedTargetRoot = path.resolve(targetRoot);
    const normalizedBundleRoot = path.resolve(bundleRoot);
    const resolvedInitAnswersPath = resolvePathInsideTarget(normalizedTargetRoot, initAnswersPath);

    if (!pathExists(normalizedBundleRoot)) {
        throw new Error(`Deployed bundle not found: ${normalizedBundleRoot}`);
    }
    if (!pathExists(resolvedInitAnswersPath)) {
        throw new Error(`Init answers artifact not found: ${resolvedInitAnswersPath}`);
    }

    const answers = validateInitAnswers(readJsonFile(resolvedInitAnswersPath));
    const normalizedActiveFiles = getActiveAgentEntrypointFiles(activeAgentFiles, answers.SourceOfTruth);
    if (normalizedActiveFiles.length === 0) {
        throw new Error('ActiveAgentFiles must resolve to at least one canonical entrypoint.');
    }

    const serializedAnswers = serializeInitAnswers({
        ...answers,
        CollectedVia: 'AGENT_INIT_PROMPT.md',
        ActiveAgentFiles: convertActiveAgentEntrypointFilesToString(normalizedActiveFiles)
    });
    writeJsonFile(resolvedInitAnswersPath, serializedAnswers);

    installRunner({
        targetRoot: normalizedTargetRoot,
        bundleRoot: normalizedBundleRoot,
        preserveExisting: true,
        alignExisting: true,
        runInit: false,
        answerDependentOnly: true,
        skipBackups: true,
        assistantLanguage: serializedAnswers.AssistantLanguage,
        assistantBrevity: serializedAnswers.AssistantBrevity,
        sourceOfTruth: serializedAnswers.SourceOfTruth,
        initAnswersPath: resolvedInitAnswersPath
    });

    const verifyResult = verifyRunner({
        targetRoot: normalizedTargetRoot,
        sourceOfTruth: serializedAnswers.SourceOfTruth,
        initAnswersPath: resolvedInitAnswersPath
    });
    const manifestResult = manifestRunner(path.join(normalizedBundleRoot, 'MANIFEST.md'));

    const state = createAgentInitState({
        AssistantLanguage: serializedAnswers.AssistantLanguage,
        SourceOfTruth: serializedAnswers.SourceOfTruth,
        AssistantLanguageConfirmed: true,
        ActiveAgentFilesConfirmed: true,
        ProjectRulesUpdated: parseBooleanYesNo(projectRulesUpdated, 'ProjectRulesUpdated'),
        SkillsPromptCompleted: parseBooleanYesNo(skillsPrompted, 'SkillsPrompted'),
        VerificationPassed: verifyResult.passed,
        ManifestValidationPassed: manifestResult.passed,
        ActiveAgentFiles: normalizedActiveFiles
    });
    const statePath = writeAgentInitState(normalizedTargetRoot, state);

    return {
        targetRoot: normalizedTargetRoot,
        bundleRoot: normalizedBundleRoot,
        initAnswersPath: resolvedInitAnswersPath,
        agentInitStatePath: statePath,
        activeAgentFiles: normalizedActiveFiles,
        projectRulesUpdated: state.ProjectRulesUpdated,
        skillsPromptCompleted: state.SkillsPromptCompleted,
        verifyPassed: verifyResult.passed,
        manifestPassed: manifestResult.passed,
        readyForTasks: (
            state.AssistantLanguageConfirmed
            && state.ActiveAgentFilesConfirmed
            && state.ProjectRulesUpdated
            && state.SkillsPromptCompleted
            && state.VerificationPassed
            && state.ManifestValidationPassed
        ),
        verifyResult,
        manifestResult,
        state
    };
}

module.exports = {
    runAgentInit
};
