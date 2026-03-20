const fs = require('node:fs');
const path = require('node:path');

const {
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    SOURCE_OF_TRUTH_VALUES
} = require('../../core/constants.ts');

const {
    getStatusSnapshot,
    formatStatusSnapshot
} = require('../../validators/status.ts');

const {
    acquireSourceRoot,
    addStringArg,
    addSwitchArg,
    bold,
    ensureDirectoryExists,
    getAgentInitPromptPath,
    getBundlePath,
    getInitAnswerValue,
    green,
    normalizeActiveAgentFiles,
    normalizeAssistantBrevity,
    normalizePathValue,
    normalizeSourceOfTruth,
    parseCliBoolean,
    parseOptionalText,
    parseOptions,
    printBanner,
    printHelp,
    printHighlightedPair,
    printStatus,
    promptSingleSelect,
    promptTextInput,
    readOptionalJsonFile,
    resolvePathInsideRoot,
    runPowerShellScript,
    supportsInteractivePrompts,
    syncBundleItems,
    tryNormalizeAssistantBrevity,
    tryNormalizeSourceOfTruth,
    tryParseBooleanText
} = require('./cli-helpers.ts');

// ---------------------------------------------------------------------------
// Flag definitions
// ---------------------------------------------------------------------------

const SETUP_DEFINITIONS = {
    '--target-root': { key: 'targetRoot', type: 'string' },
    '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
    '--repo-url': { key: 'repoUrl', type: 'string' },
    '--branch': { key: 'branch', type: 'string' },
    '--dry-run': { key: 'dryRun', type: 'boolean' },
    '--verify': { key: 'runVerify', type: 'boolean' },
    '--no-prompt': { key: 'noPrompt', type: 'boolean' },
    '--skip-verify': { key: 'skipVerify', type: 'boolean' },
    '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
    '--assistant-language': { key: 'assistantLanguage', type: 'string' },
    '--assistant-brevity': { key: 'assistantBrevity', type: 'string' },
    '--active-agent-files': { key: 'activeAgentFiles', type: 'string' },
    '--source-of-truth': { key: 'sourceOfTruth', type: 'string' },
    '--enforce-no-auto-commit': { key: 'enforceNoAutoCommit', type: 'string' },
    '--claude-orchestrator-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
    '--claude-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
    '--token-economy-enabled': { key: 'tokenEconomyEnabled', type: 'string' }
};

// ---------------------------------------------------------------------------
// Setup answer defaults & interactive collection
// ---------------------------------------------------------------------------

function getSetupAnswerDefaults(targetRoot, initAnswersPath, options) {
    const resolvedInitAnswersPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    const existingAnswers = readOptionalJsonFile(resolvedInitAnswersPath) || {};
    const sourceOfTruth = tryNormalizeSourceOfTruth(
        options.sourceOfTruth ?? getInitAnswerValue(existingAnswers, 'SourceOfTruth'),
        'Claude'
    );
    const activeAgentFiles = normalizeActiveAgentFiles(
        options.activeAgentFiles ?? getInitAnswerValue(existingAnswers, 'ActiveAgentFiles'),
        sourceOfTruth
    );

    return {
        assistantLanguage:
            parseOptionalText(options.assistantLanguage)
            || parseOptionalText(getInitAnswerValue(existingAnswers, 'AssistantLanguage'))
            || 'English',
        assistantBrevity: tryNormalizeAssistantBrevity(
            options.assistantBrevity ?? getInitAnswerValue(existingAnswers, 'AssistantBrevity'),
            'concise'
        ),
        sourceOfTruth,
        enforceNoAutoCommit: tryParseBooleanText(
            options.enforceNoAutoCommit ?? getInitAnswerValue(existingAnswers, 'EnforceNoAutoCommit'),
            true
        ),
        claudeOrchestratorFullAccess: tryParseBooleanText(
            options.claudeOrchestratorFullAccess ?? getInitAnswerValue(existingAnswers, 'ClaudeOrchestratorFullAccess'),
            false
        ),
        tokenEconomyEnabled: tryParseBooleanText(
            options.tokenEconomyEnabled ?? getInitAnswerValue(existingAnswers, 'TokenEconomyEnabled'),
            true
        ),
        activeAgentFiles
    };
}

async function collectSetupAnswersInteractively(targetRoot, initAnswersPath, options) {
    const defaults = getSetupAnswerDefaults(targetRoot, initAnswersPath, options);

    const assistantLanguage = await promptTextInput('Set communication language', defaults.assistantLanguage);
    const assistantBrevity = await promptSingleSelect({
        title: 'Set default response brevity',
        defaultLabel: defaults.assistantBrevity,
        defaultValue: defaults.assistantBrevity,
        options: [
            { label: 'concise', value: 'concise' },
            { label: 'detailed', value: 'detailed' }
        ]
    });
    const sourceOfTruth = await promptSingleSelect({
        title: 'Set primary source-of-truth entrypoint',
        defaultLabel: defaults.sourceOfTruth,
        defaultValue: defaults.sourceOfTruth,
        options: [...SOURCE_OF_TRUTH_VALUES].map(function (v) { return { label: v, value: v }; })
    });
    const enforceNoAutoCommit = await promptSingleSelect({
        title: 'Set no-auto-commit guard mode',
        defaultLabel: defaults.enforceNoAutoCommit ? 'Yes' : 'No',
        defaultValue: defaults.enforceNoAutoCommit ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });
    const claudeOrchestratorFullAccess = await promptSingleSelect({
        title: 'Set Claude access level for orchestrator files',
        defaultLabel: defaults.claudeOrchestratorFullAccess ? 'Yes' : 'No',
        defaultValue: defaults.claudeOrchestratorFullAccess ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });
    const tokenEconomyEnabled = await promptSingleSelect({
        title: 'Set default token economy mode',
        defaultLabel: defaults.tokenEconomyEnabled ? 'Yes' : 'No',
        defaultValue: defaults.tokenEconomyEnabled ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });

    const activeAgentFiles = normalizeActiveAgentFiles(defaults.activeAgentFiles, sourceOfTruth);

    return {
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess,
        tokenEconomyEnabled,
        activeAgentFiles
    };
}

// ---------------------------------------------------------------------------
// Setup handoff message
// ---------------------------------------------------------------------------

function printSetupHandoff(snapshot) {
    const initPromptPath = getAgentInitPromptPath(snapshot.bundlePath);
    console.log('');
    console.log(bold('Agent Initialization'));
    if (snapshot.activeAgentFiles) {
        console.log(`  Active agent files: ${snapshot.activeAgentFiles}`);
    }
    printHighlightedPair('1. Give your agent:', `"${initPromptPath}"`, { indent: '  ' });
    console.log('  2. The prompt already tells the agent to reuse existing init answers,');
    console.log('     validate/normalize language, fill project context, replace placeholders,');
    console.log('     and run the final doctor check.');
    console.log('  3. After that you can execute tasks, for example:');
    console.log(`     ${green('Execute task T-001 depth=2')}`);
}

function buildSetupHandoffText(snapshot) {
    const initPromptPath = getAgentInitPromptPath(snapshot.bundlePath);
    const lines = [];
    lines.push('');
    lines.push('Agent Initialization');
    if (snapshot.activeAgentFiles) {
        lines.push(`  Active agent files: ${snapshot.activeAgentFiles}`);
    }
    lines.push(`  1. Give your agent: "${initPromptPath}"`);
    lines.push('  2. The prompt already tells the agent to reuse existing init answers,');
    lines.push('     validate/normalize language, fill project context, replace placeholders,');
    lines.push('     and run the final doctor check.');
    lines.push('  3. After that you can execute tasks, for example:');
    lines.push('     Execute task T-001 depth=2');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Setup banner builder (testable)
// ---------------------------------------------------------------------------

function buildSetupStepsText(targetRoot, canUseInteractivePrompts, interactiveSetup) {
    const subtitle = canUseInteractivePrompts
        ? 'You will be asked 6 control questions.'
        : interactiveSetup
            ? 'Interactive prompts are unavailable in this terminal. Falling back to script-managed setup.'
            : 'Running in non-interactive mode with provided/default answers.';

    const lines = [];
    lines.push(`Subtitle: ${subtitle}`);
    lines.push(`Project: ${targetRoot}`);
    lines.push(`BundlePath: ${getBundlePath(targetRoot)}`);
    lines.push('');
    lines.push('Setup Steps');
    lines.push('  [1/3] Deploy bundle');
    lines.push('  [2/3] Collect or reuse init answers');
    lines.push('  [3/3] Run install and prepare agent handoff');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

/**
 * Handle the `setup` command.
 *
 * Contract markers:
 *   - OCTOPUS_SETUP at the start
 *   - [1/3], [2/3], [3/3] step markers
 *   - OCTOPUS_SETUP_STATUS after completion
 *   - Agent handoff message if agent init is incomplete
 *   - Exit code 0 on success
 */
async function handleSetup(commandArgv, packageJson, packageRoot) {
    const { options } = parseOptions(commandArgv, SETUP_DEFINITIONS);

    if (options.help) { printHelp(packageJson); return; }
    if (options.version) { console.log(packageJson.version); return; }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const interactiveSetup = !options.noPrompt;
    const canUseInteractivePrompts = interactiveSetup && supportsInteractivePrompts();

    console.log('OCTOPUS_SETUP');
    printBanner(
        packageJson,
        'Primary setup',
        canUseInteractivePrompts
            ? 'You will be asked 6 control questions.'
            : interactiveSetup
                ? 'Interactive prompts are unavailable in this terminal. Falling back to script-managed setup.'
                : 'Running in non-interactive mode with provided/default answers.'
    );
    console.log(`Project: ${targetRoot}`);
    console.log(`BundlePath: ${getBundlePath(targetRoot)}`);
    console.log('');
    console.log(bold('Setup Steps'));
    console.log(`  ${green('[1/3]')} Deploy bundle`);
    console.log(`  ${green('[2/3]')} Collect or reuse init answers`);
    console.log(`  ${green('[3/3]')} Run install and prepare agent handoff`);
    console.log('');

    const source = await acquireSourceRoot(options.repoUrl, options.branch, packageRoot);
    try {
        const promptedAnswers = canUseInteractivePrompts
            ? await collectSetupAnswersInteractively(
                targetRoot,
                options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
                options
            )
            : null;

        const bundlePath = getBundlePath(targetRoot);
        if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory()) {
            syncBundleItems(source.sourceRoot, bundlePath);
        } else if (!options.dryRun) {
            syncBundleItems(source.sourceRoot, bundlePath);
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const setupScriptPath = path.join(effectiveBundlePath, 'scripts', 'setup.ps1');
        const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;

        await runPowerShellScript(setupScriptPath, function (args) {
            addStringArg(args, 'TargetRoot', targetRoot);
            addStringArg(args, 'InitAnswersPath', initAnswersPath);
            addSwitchArg(args, 'DryRun', options.dryRun);
            addSwitchArg(args, 'RunVerify', options.runVerify);
            addSwitchArg(args, 'NoPrompt', options.noPrompt);
            addSwitchArg(args, 'SkipVerify', options.skipVerify);
            addSwitchArg(args, 'SkipManifestValidation', options.skipManifestValidation);
            addStringArg(args, 'AssistantLanguage',
                promptedAnswers ? promptedAnswers.assistantLanguage : options.assistantLanguage);
            if (promptedAnswers || options.assistantBrevity !== undefined) {
                addStringArg(args, 'AssistantBrevity',
                    promptedAnswers ? promptedAnswers.assistantBrevity : normalizeAssistantBrevity(options.assistantBrevity));
            }
            addStringArg(args, 'ActiveAgentFiles',
                promptedAnswers ? promptedAnswers.activeAgentFiles : options.activeAgentFiles);
            if (promptedAnswers || options.sourceOfTruth !== undefined) {
                addStringArg(args, 'SourceOfTruth',
                    promptedAnswers ? promptedAnswers.sourceOfTruth : normalizeSourceOfTruth(options.sourceOfTruth));
            }
            if (promptedAnswers || options.enforceNoAutoCommit !== undefined) {
                addStringArg(args, 'EnforceNoAutoCommit',
                    promptedAnswers
                        ? promptedAnswers.enforceNoAutoCommit
                        : (parseCliBoolean(options.enforceNoAutoCommit, 'EnforceNoAutoCommit') ? 'true' : 'false'));
            }
            if (promptedAnswers || options.claudeOrchestratorFullAccess !== undefined) {
                addStringArg(args, 'ClaudeOrchestratorFullAccess',
                    promptedAnswers
                        ? promptedAnswers.claudeOrchestratorFullAccess
                        : (parseCliBoolean(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess') ? 'true' : 'false'));
            }
            if (promptedAnswers || options.tokenEconomyEnabled !== undefined) {
                addStringArg(args, 'TokenEconomyEnabled',
                    promptedAnswers
                        ? promptedAnswers.tokenEconomyEnabled
                        : (parseCliBoolean(options.tokenEconomyEnabled, 'TokenEconomyEnabled') ? 'true' : 'false'));
            }
        }, {
            interactive: interactiveSetup && Boolean(process.stdin && process.stdin.isTTY)
        });

        const snapshot = getStatusSnapshot(targetRoot, initAnswersPath);
        console.log('');
        printBanner(
            packageJson,
            'Setup complete',
            snapshot.readyForTasks
                ? 'Workspace is ready.'
                : 'Primary setup finished. Agent handoff is still required.'
        );
        printStatus(snapshot, { heading: 'OCTOPUS_SETUP_STATUS' });
        if (!snapshot.agentInitializationComplete) {
            printSetupHandoff(snapshot);
        }
    } finally {
        source.cleanup();
    }
}

module.exports = {
    buildSetupHandoffText,
    buildSetupStepsText,
    collectSetupAnswersInteractively,
    getSetupAnswerDefaults,
    handleSetup,
    printSetupHandoff,
    SETUP_DEFINITIONS
};
