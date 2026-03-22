const fs = require('node:fs');
const path = require('node:path');

const {
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    SOURCE_OF_TRUTH_VALUES
} = require('../../core/constants.ts');

const { getStatusSnapshot } = require('../../validators/status.ts');

const {
    acquireSourceRoot,
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
    parseBooleanText,
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

function resolveSetupActiveAgentFiles(sourceOfTruth, explicitActiveAgentFiles) {
    if (explicitActiveAgentFiles === undefined) {
        return normalizeActiveAgentFiles(null, sourceOfTruth);
    }
    return normalizeActiveAgentFiles(explicitActiveAgentFiles, sourceOfTruth);
}

function getSetupAnswerDefaults(targetRoot, initAnswersPath, options) {
    const resolvedInitAnswersPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    const existingAnswers = readOptionalJsonFile(resolvedInitAnswersPath) || {};
    const sourceOfTruth = tryNormalizeSourceOfTruth(
        options.sourceOfTruth ?? getInitAnswerValue(existingAnswers, 'SourceOfTruth'),
        'Claude'
    );
    const activeAgentFiles = resolveSetupActiveAgentFiles(sourceOfTruth, options.activeAgentFiles);

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

    const activeAgentFiles = resolveSetupActiveAgentFiles(sourceOfTruth, options.activeAgentFiles);

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
    console.log('  Primary setup is complete.');
    console.log('  Next stage: launch your agent and give it the init prompt.');
    if (snapshot.activeAgentFiles) {
        console.log(`  Active agent files: ${snapshot.activeAgentFiles}`);
    }
    printHighlightedPair('1. Give your agent:', `"${initPromptPath}"`, { indent: '  ' });
    console.log('  2. The prompt already tells the agent to reuse existing init answers,');
    console.log('     validate/normalize language, fill project context, replace placeholders,');
    console.log('     and run the final doctor check.');
    console.log('  3. After agent initialization you can execute tasks, for example:');
    console.log(`     ${green('Execute task T-001 depth=2')}`);
}

function buildSetupHandoffText(snapshot) {
    const initPromptPath = getAgentInitPromptPath(snapshot.bundlePath);
    const lines = [];
    lines.push('');
    lines.push('Agent Initialization');
    lines.push('  Primary setup is complete.');
    lines.push('  Next stage: launch your agent and give it the init prompt.');
    if (snapshot.activeAgentFiles) {
        lines.push(`  Active agent files: ${snapshot.activeAgentFiles}`);
    }
    lines.push(`  1. Give your agent: "${initPromptPath}"`);
    lines.push('  2. The prompt already tells the agent to reuse existing init answers,');
    lines.push('     validate/normalize language, fill project context, replace placeholders,');
    lines.push('     and run the final doctor check.');
    lines.push('  3. After agent initialization you can execute tasks, for example:');
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
        const sourceResolved = path.resolve(source.sourceRoot);
        const bundleResolved = path.resolve(bundlePath);
        if (sourceResolved.toLowerCase() !== bundleResolved.toLowerCase()) {
            if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory()) {
                syncBundleItems(source.sourceRoot, bundlePath);
            } else if (!options.dryRun) {
                syncBundleItems(source.sourceRoot, bundlePath);
            }
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
        const resolvedAnswers = promptedAnswers || {};
        const assistantLanguage = resolvedAnswers.assistantLanguage || options.assistantLanguage || 'English';
        const assistantBrevity = resolvedAnswers.assistantBrevity
            || (options.assistantBrevity !== undefined ? normalizeAssistantBrevity(options.assistantBrevity) : 'concise');
        const sourceOfTruth = resolvedAnswers.sourceOfTruth
            || (options.sourceOfTruth !== undefined ? normalizeSourceOfTruth(options.sourceOfTruth) : 'Claude');
        const enforceNoAutoCommit = resolvedAnswers.enforceNoAutoCommit !== undefined
            ? (String(resolvedAnswers.enforceNoAutoCommit) === 'true')
            : (options.enforceNoAutoCommit !== undefined ? parseBooleanText(options.enforceNoAutoCommit, 'EnforceNoAutoCommit') : true);
        const claudeOrchestratorFullAccess = resolvedAnswers.claudeOrchestratorFullAccess !== undefined
            ? (String(resolvedAnswers.claudeOrchestratorFullAccess) === 'true')
            : (options.claudeOrchestratorFullAccess !== undefined ? parseBooleanText(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess') : false);
        const tokenEconomyEnabled = resolvedAnswers.tokenEconomyEnabled !== undefined
            ? (String(resolvedAnswers.tokenEconomyEnabled) === 'true')
            : (options.tokenEconomyEnabled !== undefined ? parseBooleanText(options.tokenEconomyEnabled, 'TokenEconomyEnabled') : true);
        const activeAgentFiles = resolveSetupActiveAgentFiles(
            sourceOfTruth,
            resolvedAnswers.activeAgentFiles !== undefined
                ? resolvedAnswers.activeAgentFiles
                : options.activeAgentFiles
        ) || [];
        const collectedVia = canUseInteractivePrompts ? 'CLI_INTERACTIVE' : 'CLI_NONINTERACTIVE';
        const resolvedInitAnswersPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });

        if (!options.dryRun) {
            const initAnswersDir = path.dirname(resolvedInitAnswersPath);
            if (!fs.existsSync(initAnswersDir)) {
                fs.mkdirSync(initAnswersDir, { recursive: true });
            }
            const { serializeInitAnswers } = require('../../schemas/init-answers.ts');
            const serialized = serializeInitAnswers({
                AssistantLanguage: assistantLanguage,
                AssistantBrevity: assistantBrevity,
                SourceOfTruth: sourceOfTruth,
                EnforceNoAutoCommit: enforceNoAutoCommit,
                ClaudeOrchestratorFullAccess: claudeOrchestratorFullAccess,
                TokenEconomyEnabled: tokenEconomyEnabled,
                CollectedVia: collectedVia,
                ActiveAgentFiles: activeAgentFiles
            });
            fs.writeFileSync(resolvedInitAnswersPath, JSON.stringify(serialized, null, 2), 'utf8');
        }

        const { runInstall } = require('../../materialization/install.ts');
        const { runInit } = require('../../materialization/init.ts');
        runInstall({
            targetRoot,
            bundleRoot: effectiveBundlePath,
            assistantLanguage,
            assistantBrevity,
            sourceOfTruth,
            initAnswersPath: resolvedInitAnswersPath,
            dryRun: options.dryRun,
            initRunner: function (initOptions) {
                runInit(Object.assign({ bundleRoot: effectiveBundlePath }, initOptions));
            }
        });

        let manifestStatus = options.skipManifestValidation ? 'SKIPPED' : 'PASS';
        if (!options.skipManifestValidation) {
            try {
                const manifestPath = path.join(effectiveBundlePath, 'MANIFEST.md');
                const { validateManifest } = require('../../validators/validate-manifest.ts');
                const manifestResult = validateManifest(manifestPath);
                manifestStatus = manifestResult.passed ? 'PASS' : 'FAIL';
            } catch (_error) {
                manifestStatus = 'ERROR';
            }
        }

        const snapshot = getStatusSnapshot(targetRoot, initAnswersPath);
        let verifyStatus = options.skipVerify ? 'SKIPPED' : 'PENDING_AGENT_CONTEXT';
        if (!options.skipVerify) {
            try {
                if (snapshot.readyForTasks || options.runVerify) {
                    const { runVerify } = require('../../validators/verify.ts');
                    const verifyResult = runVerify({
                        targetRoot,
                        sourceOfTruth,
                        initAnswersPath: resolvedInitAnswersPath
                    });
                    verifyStatus = verifyResult.totalViolationCount > 0 ? 'FAIL' : 'PASS';
                }
            } catch (_error) {
                verifyStatus = 'PENDING_AGENT_CONTEXT';
            }
        }

        console.log(`Setup: ${manifestStatus === 'FAIL' ? 'FAIL' : 'PASS'}`);
        console.log(`Verify: ${verifyStatus}`);
        console.log(`ManifestValidation: ${manifestStatus}`);
        console.log('');
        printBanner(
            packageJson,
            'Setup complete',
            snapshot.readyForTasks
                ? 'Workspace is ready.'
                : 'Primary setup finished. Next stage: agent initialization.'
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
