const path = require('node:path');

const {
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH
} = require('../../core/constants.ts');
const { runAgentInit } = require('../../lifecycle/agent-init.ts');
const { getStatusSnapshot } = require('../../validators/status.ts');

const {
    bold,
    normalizePathValue,
    parseOptions,
    printBanner,
    printHelp,
    printStatus
} = require('./cli-helpers.ts');

const AGENT_INIT_DEFINITIONS = {
    '--target-root': { key: 'targetRoot', type: 'string' },
    '--bundle-root': { key: 'bundleRoot', type: 'string' },
    '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
    '--active-agent-files': { key: 'activeAgentFiles', type: 'string' },
    '--project-rules-updated': { key: 'projectRulesUpdated', type: 'string' },
    '--skills-prompted': { key: 'skillsPrompted', type: 'string' }
};

function buildAgentInitOutput(result) {
    const lines = [];
    lines.push(`Verify: ${result.verifyPassed ? 'PASS' : 'FAIL'}`);
    lines.push(`ManifestValidation: ${result.manifestPassed ? 'PASS' : 'FAIL'}`);
    lines.push(`ProjectRulesUpdated: ${result.projectRulesUpdated ? 'True' : 'False'}`);
    lines.push(`SkillsPromptCompleted: ${result.skillsPromptCompleted ? 'True' : 'False'}`);
    lines.push(`ActiveAgentFiles: ${result.activeAgentFiles.join(', ')}`);
    lines.push(`AgentInitStatePath: ${result.agentInitStatePath}`);
    lines.push(`AgentInit: ${result.readyForTasks ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
}

function buildAgentInitNextStep(result) {
    if (result.readyForTasks) {
        return 'Next: Execute task T-001 depth=2';
    }

    const blockers = [];
    if (!result.projectRulesUpdated) {
        blockers.push('project rules are not marked as updated');
    }
    if (!result.skillsPromptCompleted) {
        blockers.push('specialist skills question is not marked as completed');
    }
    if (!result.verifyPassed) {
        blockers.push('verify failed');
    }
    if (!result.manifestPassed) {
        blockers.push('manifest validation failed');
    }

    return `Next: resolve blockers and rerun agent-init (${blockers.join('; ')})`;
}

function handleAgentInit(commandArgv, packageJson) {
    const { options } = parseOptions(commandArgv, AGENT_INIT_DEFINITIONS);

    if (options.help) { printHelp(packageJson); return null; }
    if (options.version) { console.log(packageJson.version); return null; }

    if (!options.activeAgentFiles) {
        throw new Error('--active-agent-files is required for agent-init.');
    }
    if (options.projectRulesUpdated === undefined) {
        throw new Error('--project-rules-updated is required for agent-init.');
    }
    if (options.skillsPrompted === undefined) {
        throw new Error('--skills-prompted is required for agent-init.');
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    const bundleRoot = options.bundleRoot
        ? normalizePathValue(options.bundleRoot)
        : path.join(targetRoot, DEFAULT_BUNDLE_NAME);
    const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;

    console.log('OCTOPUS_AGENT_INIT');
    printBanner(packageJson, 'Finalize agent onboarding', 'Runs install answer-dependent refresh, verify, manifest validation, and writes agent-init state.');

    const result = runAgentInit({
        targetRoot,
        bundleRoot,
        initAnswersPath,
        activeAgentFiles: options.activeAgentFiles,
        projectRulesUpdated: options.projectRulesUpdated,
        skillsPrompted: options.skillsPrompted
    });

    console.log(buildAgentInitOutput(result));
    console.log('');
    console.log(bold(buildAgentInitNextStep(result)));
    console.log('');
    printStatus(getStatusSnapshot(targetRoot, initAnswersPath), { heading: 'OCTOPUS_AGENT_INIT_STATUS' });
    return result;
}

module.exports = {
    AGENT_INIT_DEFINITIONS,
    buildAgentInitNextStep,
    buildAgentInitOutput,
    handleAgentInit
};
