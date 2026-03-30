import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    LIFECYCLE_COMMANDS
} from '../core/constants';
import { getAllShimmedGateNames } from '../compat/shim-registry';
import {
    buildReviewContext,
    resolveContextOutputPath,
    resolveReviewSkillId,
    resolveScopedDiffMetadataPath
} from '../gates/build-review-context';
import { buildScopedDiff, resolveMetadataPath, resolveOutputPath } from '../gates/build-scoped-diff';
import { formatCompletionGateResult, runCompletionGate } from '../gates/completion';
import { buildTaskEventsSummary, formatTaskEventsSummaryText } from '../gates/task-events-summary';
import {
    emitMandatoryCompletionGateEvent,
    emitReviewPhaseStartedEvent,
    emitStatusChangedEvent
} from '../gate-runtime/lifecycle-events';
import * as gateHelpers from '../gates/helpers';
import {
    emitSkillReferenceLoadedEvent,
    emitSkillSelectedEvent
} from '../runtime/skill-telemetry';
import { runDoctor, formatDoctorResult } from '../validators/doctor';
import { explainFailure, formatExplainResult, listExplainIds } from '../validators/explain';
import { getStatusSnapshot } from '../validators/status';
import { getWhyBlocked, formatWhyBlockedResult } from '../validators/why-blocked';
import { formatManifestResult, validateManifest } from '../validators/validate-manifest';
import { formatVerifyResult, runVerify } from '../validators/verify';
import { runCheckUpdate, type CheckUpdateRunnerOptions } from '../lifecycle/check-update';
import { runContractMigrations } from '../lifecycle/contract-migrations';
import { runRollback } from '../lifecycle/rollback';
import { assertExplicitCliTrustOverride } from '../lifecycle/update-trust';
import { runUninstall } from '../lifecycle/uninstall';
import { runUpdate } from '../lifecycle/update';
import { runUpdateFromGit } from '../lifecycle/update-git';
import { runInit } from '../materialization/init';
import { runInstall } from '../materialization/install';
import { runReinit } from '../materialization/reinit';
import { handleAgentInit } from './commands/agent-init';
import { handleBootstrap } from './commands/bootstrap';
import {
    acquireSourceRoot,
    bold,
    cyan,
    dim,
    ensureDirectoryExists,
    getBundlePath,
    green,
    normalizeAssistantBrevity,
    normalizePathValue,
    normalizeSourceOfTruth,
    PackageJsonLike,
    parseBooleanText,
    parseOptions,
    parseRequiredText,
    printBanner,
    printHelp,
    printHighlightedPair,
    printStatus,
    readInitAnswersArtifact,
    readPackageJson,
    syncBundleItems,
    yellow
} from './commands/cli-helpers';
import {
    runClassifyChangeCommand,
    runCompileGateCommand,
    runDocImpactGateCommand,
    runEnterTaskModeCommand,
    runHumanCommitCommand,
    runLoadRulePackCommand,
    runLogTaskEventCommand,
    runRecordNoOpCommand,
    runRequiredReviewsCheckCommand
} from './commands/gates';
import { handleOverview } from './commands/overview';
import { handleSetup } from './commands/setup';
import { handleSkills } from './commands/skills';
import { installSignalHandlers } from './signal-handler';

type ParsedOptionValue = string | boolean | string[] | undefined;
type ParsedOptionsRecord = Record<string, ParsedOptionValue>;

interface UpdateLifecycleResult extends Record<string, unknown> {
    previousVersion?: unknown;
    updatedVersion?: unknown;
    rollbackSnapshotPath?: unknown;
    rollbackStatus?: unknown;
    updateReportPath?: unknown;
}

let resolvedCommand: string | null = null;

function getPackageRoot(): string {
    return path.resolve(__dirname, '..', '..', '..');
}

function requireResolvedPath(resolvedPath: string | null, label: string): string {
    if (!resolvedPath) {
        throw new Error(`${label} must not be empty.`);
    }
    return resolvedPath;
}

function toKeyValueRecord(value: unknown): Record<string, unknown> {
    return value as Record<string, unknown>;
}

function formatKeyValueOutput(obj: Record<string, unknown> | null | undefined, keys: string[]): void {
    if (!obj) {
        return;
    }
    for (const key of keys) {
        if (obj[key] === undefined) {
            continue;
        }
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const value = typeof obj[key] === 'boolean'
            ? (obj[key] ? 'True' : 'False')
            : String(obj[key]);
        console.log(`${label}: ${value}`);
    }
}

function normalizeYesNo(value: unknown, label: string): string {
    const text = parseRequiredText(value, label).toLowerCase();
    if (text === 'true') {
        return 'yes';
    }
    if (text === 'false') {
        return 'no';
    }
    if (text !== 'yes' && text !== 'no') {
        throw new Error(`${label} must be one of: yes, no (legacy true/false also accepted).`);
    }
    return text;
}

function getCommandName(argv: string[]): string {
    if (argv.length === 0) {
        return 'bootstrap';
    }
    const candidate = String(argv[0] || '').trim();
    if (candidate === 'help') {
        return 'help';
    }
    if (candidate === 'gate' || LIFECYCLE_COMMANDS.includes(candidate)) {
        return candidate;
    }
    return 'bootstrap';
}

function ensureBundleExists(targetRoot: string, commandName: string): string {
    const bundlePath = getBundlePath(targetRoot);
    if (!fs.existsSync(bundlePath) || !fs.lstatSync(bundlePath).isDirectory()) {
        throw new Error([
            `Deployed bundle not found: ${bundlePath}`,
            `Run 'npx octopus-agent-orchestrator' first, then rerun '${commandName}'.`
        ].join('\n'));
    }
    return bundlePath;
}

function buildUpdateLifecycleRunner(bundlePath: string, fallbackDryRun: boolean | undefined) {
    return function runLifecycleFromCli(runnerOptions: CheckUpdateRunnerOptions): UpdateLifecycleResult {
        return runUpdate({
            targetRoot: runnerOptions.targetRoot,
            bundleRoot: bundlePath,
            initAnswersPath: runnerOptions.initAnswersPath,
            dryRun: fallbackDryRun,
            skipVerify: runnerOptions.skipVerify,
            skipManifestValidation: runnerOptions.skipManifestValidation,
            trustContext: {
                policy: runnerOptions.trustPolicy,
                overrideUsed: runnerOptions.trustOverrideUsed,
                overrideSource: runnerOptions.trustOverrideSource,
                sourceType: runnerOptions.sourceType,
                sourceReference: runnerOptions.sourceReference
            },
            contractMigrationRunner(options) {
                return runContractMigrations(options);
            },
            verifyRunner(options) {
                const result = runVerify({
                    targetRoot: options.targetRoot,
                    initAnswersPath: options.initAnswersPath,
                    sourceOfTruth: options.sourceOfTruth
                });
                if (!result.passed) {
                    throw new Error(formatVerifyResult(result));
                }
                return result;
            },
            manifestRunner(options) {
                const manifestPath = path.join(options.targetRoot, 'Octopus-agent-orchestrator', 'MANIFEST.md');
                const result = validateManifest(manifestPath, options.targetRoot);
                if (!result.passed) {
                    throw new Error(formatManifestResult(result));
                }
                return result;
            }
        }) as UpdateLifecycleResult;
    };
}

function mergeUpdateLifecycleOutput(
    baseResult: Record<string, unknown>,
    lifecycleResult: UpdateLifecycleResult | null
): Record<string, unknown> {
    if (!lifecycleResult) {
        return baseResult;
    }
    return {
        ...baseResult,
        previousVersion: lifecycleResult.previousVersion,
        updatedVersion: lifecycleResult.updatedVersion,
        rollbackSnapshotPath: lifecycleResult.rollbackSnapshotPath,
        rollbackStatus: lifecycleResult.rollbackStatus,
        updateReportPath: lifecycleResult.updateReportPath
    };
}

async function handleInstall(commandArgv: string[], packageJson: PackageJsonLike, packageRoot: string): Promise<void> {
    const installDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, installDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');

    const source = await acquireSourceRoot(
        typeof options.repoUrl === 'string' ? options.repoUrl : undefined,
        typeof options.branch === 'string' ? options.branch : undefined,
        packageRoot
    );
    try {
        const bundlePath = getBundlePath(targetRoot);
        const sourceResolved = path.resolve(source.sourceRoot);
        const bundleResolved = path.resolve(bundlePath);
        if (sourceResolved.toLowerCase() !== bundleResolved.toLowerCase() && !options.dryRun) {
            syncBundleItems(source.sourceRoot, bundlePath);
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const initAnswersPath = typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
        const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, getBundlePath(targetRoot), 'install');
        const installResult = runInstall({
            targetRoot,
            bundleRoot: effectiveBundlePath,
            assistantLanguage: answers.assistantLanguage,
            assistantBrevity: answers.assistantBrevity,
            sourceOfTruth: answers.sourceOfTruth,
            initAnswersPath: answers.resolvedPath,
            dryRun: options.dryRun === true,
            initRunner(initOptions) {
                runInit({ bundleRoot: effectiveBundlePath, ...initOptions });
            }
        }) as Record<string, unknown>;
        formatKeyValueOutput(installResult, [
            'targetRoot', 'sourceOfTruth', 'canonicalEntrypoint',
            'assistantLanguage', 'assistantBrevity',
            'filesDeployed', 'initInvoked', 'liveVersionWritten',
            'dryRun'
        ]);
    } finally {
        source.cleanup();
    }
}

function handleInit(commandArgv: string[], packageJson: PackageJsonLike): void {
    const initDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, initDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'init');
    const initAnswersPath = typeof options.initAnswersPath === 'string'
        ? options.initAnswersPath
        : DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'init');

    const initResult = runInit({
        targetRoot,
        bundleRoot: bundlePath,
        assistantLanguage: answers.assistantLanguage,
        assistantBrevity: answers.assistantBrevity,
        sourceOfTruth: answers.sourceOfTruth,
        enforceNoAutoCommit: answers.enforceNoAutoCommit,
        tokenEconomyEnabled: answers.tokenEconomyEnabled,
        dryRun: options.dryRun === true
    }) as Record<string, unknown>;
    console.log('Init: PASS');
    formatKeyValueOutput(initResult, [
        'targetRoot', 'sourceOfTruth', 'assistantLanguage',
        'ruleFilesMaterialized', 'projectDiscoveryPath', 'usagePath'
    ]);
}

function handleStatus(commandArgv: string[], packageJson: PackageJsonLike): void {
    // Detect subcommand: `status why-blocked`
    if (commandArgv.length > 0 && commandArgv[0].toLowerCase() === 'why-blocked') {
        handleStatusWhyBlocked(commandArgv.slice(1));
        return;
    }

    const statusDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, statusDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    printBanner(packageJson, 'Workspace status', targetRoot);
    printStatus(getStatusSnapshot(
        targetRoot,
        typeof options.initAnswersPath === 'string' ? options.initAnswersPath : DEFAULT_INIT_ANSWERS_RELATIVE_PATH
    ));
}

function handleStatusWhyBlocked(commandArgv: string[]): void {
    const definitions = {
        '--target-root': { key: 'targetRoot', type: 'string' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, definitions);
    const options = rawOptions as ParsedOptionsRecord;

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');

    const result = getWhyBlocked(targetRoot);
    console.log(formatWhyBlockedResult(result));

    if (result.has_blocked_tasks) {
        process.exitCode = 1;
    }
}

function handleDoctor(commandArgv: string[], packageJson: PackageJsonLike): void {
    // Detect subcommand: `doctor explain <failure-id>`
    if (commandArgv.length > 0 && commandArgv[0].toLowerCase() === 'explain') {
        handleDoctorExplain(commandArgv.slice(1));
        return;
    }

    const doctorDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--cleanup-stale-locks': { key: 'cleanupStaleLocks', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, doctorDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    printBanner(packageJson, 'Workspace doctor', targetRoot);
    const bundlePath = ensureBundleExists(targetRoot, 'doctor');
    const initAnswersPath = typeof options.initAnswersPath === 'string'
        ? options.initAnswersPath
        : DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'doctor');
    const result = runDoctor({
        targetRoot,
        sourceOfTruth: answers.sourceOfTruth,
        initAnswersPath: answers.resolvedPath,
        cleanupStaleLocks: options.cleanupStaleLocks === true,
        dryRun: options.dryRun === true
    });
    console.log(formatDoctorResult(result));
    if (!result.passed) {
        throw new Error('Workspace doctor detected validation failures.');
    }
}

function handleDoctorExplain(commandArgv: string[]): void {
    // Allow positional: `doctor explain <failure-id>` or `doctor explain --failure-id <id>`
    const definitions = {
        '--failure-id': { key: 'failureId', type: 'string' },
        '--list': { key: 'list', type: 'boolean' }
    };
    const { options: rawOptions, positionals } = parseOptions(commandArgv, definitions, {
        allowPositionals: true,
        maxPositionals: 1
    });
    const options = rawOptions as ParsedOptionsRecord;

    if (options.list) {
        console.log('Available failure IDs:');
        for (const id of listExplainIds()) {
            console.log(`  ${id}`);
        }
        return;
    }

    const rawId = (typeof options.failureId === 'string' && options.failureId)
        ? options.failureId
        : (positionals[0] || '');

    if (!rawId) {
        console.log('Usage: octopus doctor explain <failure-id>');
        console.log('       octopus doctor explain --list');
        console.log('');
        console.log('Available failure IDs:');
        for (const id of listExplainIds()) {
            console.log(`  ${id}`);
        }
        return;
    }

    const result = explainFailure(rawId);
    console.log(formatExplainResult(result));

    if (!result.found) {
        process.exitCode = 1;
    }
}

function handleReinit(commandArgv: string[], packageJson: PackageJsonLike): void {
    const reinitDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--assistant-language': { key: 'assistantLanguage', type: 'string' },
        '--assistant-brevity': { key: 'assistantBrevity', type: 'string' },
        '--source-of-truth': { key: 'sourceOfTruth', type: 'string' },
        '--enforce-no-auto-commit': { key: 'enforceNoAutoCommit', type: 'string' },
        '--claude-orchestrator-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--claude-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--token-economy-enabled': { key: 'tokenEconomyEnabled', type: 'string' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, reinitDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'reinit');

    const overrides: Record<string, string> = {};
    if (options.assistantLanguage !== undefined) {
        overrides.AssistantLanguage = String(options.assistantLanguage);
    }
    if (options.assistantBrevity !== undefined) {
        overrides.AssistantBrevity = normalizeAssistantBrevity(options.assistantBrevity);
    }
    if (options.sourceOfTruth !== undefined) {
        overrides.SourceOfTruth = normalizeSourceOfTruth(options.sourceOfTruth);
    }
    if (options.enforceNoAutoCommit !== undefined) {
        overrides.EnforceNoAutoCommit = String(parseBooleanText(options.enforceNoAutoCommit, 'EnforceNoAutoCommit'));
    }
    if (options.claudeOrchestratorFullAccess !== undefined) {
        overrides.ClaudeOrchestratorFullAccess = String(parseBooleanText(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess'));
    }
    if (options.tokenEconomyEnabled !== undefined) {
        overrides.TokenEconomyEnabled = String(parseBooleanText(options.tokenEconomyEnabled, 'TokenEconomyEnabled'));
    }

    const reinitResult = runReinit({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        overrides,
        skipVerify: options.skipVerify === true,
        skipManifestValidation: options.skipManifestValidation === true
    }) as Record<string, unknown>;
    console.log('Reinit: PASS');
    formatKeyValueOutput(reinitResult, [
        'targetRoot', 'sourceOfTruth', 'canonicalEntrypoint',
        'assistantLanguage', 'assistantBrevity',
        'coreRuleUpdated', 'tokenEconomyConfigUpdated'
    ]);
}

async function handleUpdate(commandArgv: string[], packageJson: PackageJsonLike): Promise<void> {
    if (commandArgv.length > 0 && String(commandArgv[0] || '').trim().toLowerCase() === 'git') {
        await handleUpdateGit(commandArgv.slice(1), packageJson);
        return;
    }

    const updateDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--package-spec': { key: 'packageSpec', type: 'string' },
        '--source-path': { key: 'sourcePath', type: 'string' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--trust-override': { key: 'trustOverride', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, updateDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'update');
    assertExplicitCliTrustOverride('update', {
        trustOverride: options.trustOverride === true,
        noPrompt: options.noPrompt === true
    });

    let lifecycleResult: UpdateLifecycleResult | null = null;
    const updateResult = await runCheckUpdate({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        packageSpec: typeof options.packageSpec === 'string' ? options.packageSpec : undefined,
        sourcePath: typeof options.sourcePath === 'string' ? options.sourcePath : undefined,
        apply: true,
        noPrompt: options.noPrompt === true,
        dryRun: options.dryRun === true,
        skipVerify: options.skipVerify === true,
        skipManifestValidation: options.skipManifestValidation === true,
        trustOverride: options.trustOverride === true,
        updateRunner(runnerOptions) {
            lifecycleResult = buildUpdateLifecycleRunner(bundlePath, options.dryRun === true)(runnerOptions);
        }
    });
    formatKeyValueOutput(mergeUpdateLifecycleOutput(toKeyValueRecord(updateResult), lifecycleResult), [
        'targetRoot', 'sourceType', 'sourceReference', 'packageSpec', 'sourcePath',
        'currentVersion', 'latestVersion', 'updateAvailable',
        'updateApplied', 'checkUpdateResult', 'trustPolicy', 'trustOverrideUsed', 'trustOverrideSource',
        'previousVersion', 'updatedVersion', 'rollbackSnapshotPath', 'rollbackStatus', 'updateReportPath'
    ]);
}

async function handleUpdateGit(commandArgv: string[], packageJson: PackageJsonLike): Promise<void> {
    const updateGitDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--check-only': { key: 'checkOnly', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--trust-override': { key: 'trustOverride', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, updateGitDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'update git');
    assertExplicitCliTrustOverride('update git', {
        trustOverride: options.trustOverride === true,
        noPrompt: options.noPrompt === true
    });

    let lifecycleResult: UpdateLifecycleResult | null = null;
    const updateResult = await runUpdateFromGit({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        repoUrl: typeof options.repoUrl === 'string' ? options.repoUrl : undefined,
        branch: typeof options.branch === 'string' ? options.branch : undefined,
        checkOnly: options.checkOnly === true,
        noPrompt: options.noPrompt === true,
        dryRun: options.dryRun === true,
        skipVerify: options.skipVerify === true,
        skipManifestValidation: options.skipManifestValidation === true,
        trustOverride: options.trustOverride === true,
        updateRunner(runnerOptions) {
            lifecycleResult = buildUpdateLifecycleRunner(bundlePath, options.dryRun === true)(runnerOptions);
        }
    }) as Record<string, unknown>;
    formatKeyValueOutput(mergeUpdateLifecycleOutput(updateResult, lifecycleResult), [
        'targetRoot', 'repoUrl', 'branch', 'sourceType', 'sourceReference',
        'currentVersion', 'latestVersion', 'updateAvailable',
        'updateApplied', 'checkUpdateResult', 'trustPolicy', 'trustOverrideUsed', 'trustOverrideSource',
        'previousVersion', 'updatedVersion', 'rollbackSnapshotPath', 'rollbackStatus', 'updateReportPath'
    ]);
}

function handleUninstall(commandArgv: string[], packageJson: PackageJsonLike): void {
    const uninstallDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-backups': { key: 'skipBackups', type: 'boolean' },
        '--keep-primary-entrypoint': { key: 'keepPrimaryEntrypoint', type: 'string' },
        '--keep-task-file': { key: 'keepTaskFile', type: 'string' },
        '--keep-runtime-artifacts': { key: 'keepRuntimeArtifacts', type: 'string' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, uninstallDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'uninstall');
    const uninstallResult = runUninstall({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        noPrompt: options.noPrompt === true,
        dryRun: options.dryRun === true,
        skipBackups: options.skipBackups === true,
        keepPrimaryEntrypoint: options.keepPrimaryEntrypoint !== undefined
            ? normalizeYesNo(options.keepPrimaryEntrypoint, 'KeepPrimaryEntrypoint')
            : undefined,
        keepTaskFile: options.keepTaskFile !== undefined
            ? normalizeYesNo(options.keepTaskFile, 'KeepTaskFile')
            : undefined,
        keepRuntimeArtifacts: options.keepRuntimeArtifacts !== undefined
            ? normalizeYesNo(options.keepRuntimeArtifacts, 'KeepRuntimeArtifacts')
            : undefined
    });

    formatKeyValueOutput(uninstallResult as unknown as Record<string, unknown>, [
        'targetRoot', 'keepPrimaryEntrypoint', 'keepTaskFile',
        'keepRuntimeArtifacts', 'dryRun', 'backupRoot',
        'preservedRuntimePath', 'filesDeleted', 'directoriesDeleted',
        'filesRestored', 'itemsBackedUp', 'rollbackStatus',
        'warningsCount'
    ]);
    console.log(`Result: ${uninstallResult.result || 'SUCCESS'}`);
    console.log(green('Uninstall complete.'));
    if (uninstallResult.filesRestored > 0) {
        printHighlightedPair('Restored user files:', String(uninstallResult.filesRestored), {
            labelColor: cyan,
            valueColor: green
        });
    }
    if (uninstallResult.backupRoot && uninstallResult.backupRoot !== '<none>' && uninstallResult.itemsBackedUp > 0) {
        console.log(yellow('Backup files were created.'));
        printHighlightedPair('Backup path:', uninstallResult.backupRoot, {
            labelColor: yellow,
            valueColor: cyan
        });
        printHighlightedPair('Backed up items:', String(uninstallResult.itemsBackedUp), {
            labelColor: yellow,
            valueColor: green
        });
        if (uninstallResult.preservedRuntimePath && uninstallResult.preservedRuntimePath !== '<none>') {
            printHighlightedPair('Preserved runtime:', uninstallResult.preservedRuntimePath, {
                labelColor: yellow,
                valueColor: cyan
            });
        }
    } else {
        console.log(dim('No backup files were created during uninstall.'));
    }
    if (Array.isArray(uninstallResult.warnings) && uninstallResult.warnings.length > 0) {
        console.log(yellow('Warnings:'));
        for (const warning of uninstallResult.warnings) {
            console.log(`  - ${warning}`);
        }
    }
}

function handleVerify(commandArgv: string[], packageJson: PackageJsonLike): void {
    const verifyDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--source-of-truth': { key: 'sourceOfTruth', type: 'string' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, verifyDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'verify');
    const initAnswersPath = typeof options.initAnswersPath === 'string'
        ? options.initAnswersPath
        : DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'verify');
    const sourceOfTruth = options.sourceOfTruth !== undefined
        ? normalizeSourceOfTruth(options.sourceOfTruth)
        : answers.sourceOfTruth;

    const result = runVerify({
        targetRoot,
        sourceOfTruth,
        initAnswersPath: answers.resolvedPath
    });
    console.log(formatVerifyResult(result));
    if (result.totalViolationCount > 0) {
        throw new Error(`Workspace verification failed with ${result.totalViolationCount} violation(s).`);
    }
}

async function handleCheckUpdate(commandArgv: string[], packageJson: PackageJsonLike): Promise<void> {
    const checkUpdateDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--package-spec': { key: 'packageSpec', type: 'string' },
        '--source-path': { key: 'sourcePath', type: 'string' },
        '--apply': { key: 'apply', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--trust-override': { key: 'trustOverride', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, checkUpdateDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'check-update');
    assertExplicitCliTrustOverride('check-update', {
        trustOverride: options.trustOverride === true,
        noPrompt: options.noPrompt === true
    });

    let lifecycleResult: UpdateLifecycleResult | null = null;
    const checkResult = await runCheckUpdate({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        packageSpec: typeof options.packageSpec === 'string' ? options.packageSpec : undefined,
        sourcePath: typeof options.sourcePath === 'string' ? options.sourcePath : undefined,
        apply: options.apply === true,
        noPrompt: options.noPrompt === true,
        dryRun: options.dryRun === true,
        skipVerify: options.skipVerify === true,
        skipManifestValidation: options.skipManifestValidation === true,
        trustOverride: options.trustOverride === true,
        updateRunner(runnerOptions) {
            lifecycleResult = buildUpdateLifecycleRunner(bundlePath, options.dryRun === true)(runnerOptions);
        }
    });
    formatKeyValueOutput(mergeUpdateLifecycleOutput(toKeyValueRecord(checkResult), lifecycleResult), [
        'targetRoot', 'sourceType', 'sourceReference', 'packageSpec', 'sourcePath',
        'currentVersion', 'latestVersion', 'updateAvailable',
        'checkUpdateResult', 'trustPolicy', 'trustOverrideUsed', 'trustOverrideSource', 'previousVersion', 'updatedVersion',
        'rollbackSnapshotPath', 'rollbackStatus', 'updateReportPath'
    ]);
}

async function handleRollback(commandArgv: string[], packageJson: PackageJsonLike): Promise<void> {
    const rollbackDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--snapshot-path': { key: 'snapshotPath', type: 'string' },
        '--to-version': { key: 'toVersion', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--source-path': { key: 'sourcePath', type: 'string' },
        '--package-spec': { key: 'packageSpec', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options: rawOptions } = parseOptions(commandArgv, rollbackDefinitions);
    const options = rawOptions as ParsedOptionsRecord;

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'rollback');

    const rollbackResult = await runRollback({
        targetRoot,
        bundleRoot: bundlePath,
        snapshotPath: typeof options.snapshotPath === 'string' ? options.snapshotPath : undefined,
        targetVersion: typeof options.toVersion === 'string' ? options.toVersion : undefined,
        sourcePath: typeof options.sourcePath === 'string' ? options.sourcePath : undefined,
        packageSpec: typeof options.packageSpec === 'string' ? options.packageSpec : undefined,
        initAnswersPath: typeof options.initAnswersPath === 'string'
            ? options.initAnswersPath
            : DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        dryRun: options.dryRun === true
    }) as Record<string, unknown>;

    if (rollbackResult.rollbackMode === 'version') {
        formatKeyValueOutput(rollbackResult, [
            'targetRoot', 'rollbackMode', 'targetVersion',
            'sourceType', 'sourceReference', 'sourceVersion',
            'currentVersion', 'rollbackVersion', 'updatedVersion',
            'restoreStatus', 'syncStatus', 'installStatus', 'materializationStatus',
            'safetySnapshotPath', 'safetySnapshotRecordsPath', 'safetyRollbackStatus',
            'bundleSyncBackupPath', 'rollbackReportPath'
        ]);
        return;
    }

    formatKeyValueOutput(rollbackResult, [
        'targetRoot', 'rollbackMode', 'snapshotPath', 'rollbackRecordsPath', 'rollbackRecordCount',
        'currentVersion', 'snapshotVersion', 'rollbackVersion', 'updatedVersion', 'restoreStatus',
        'bundleBackupPath', 'bundleBackupMetadataPath', 'bundleRestoreStatus',
        'safetySnapshotPath', 'safetySnapshotRecordsPath', 'safetyRollbackStatus',
        'rollbackReportPath'
    ]);
}

async function handleGate(commandArgv: string[]): Promise<void> {
    if (commandArgv.length === 0 || commandArgv[0] === '-h' || commandArgv[0] === '--help') {
        console.log(bold('Available gates:'));
        for (const name of getAllShimmedGateNames()) {
            console.log(`  ${name}`);
        }
        return;
    }

    const gateName = commandArgv[0];
    const gateArgv = commandArgv.slice(1);

    switch (gateName) {
        case 'validate-manifest': {
            const defs = { '--manifest-path': { key: 'manifestPath', type: 'string' } };
            const { options: rawOptions } = parseOptions(gateArgv, defs);
            const options = rawOptions as ParsedOptionsRecord;
            const manifestPath = typeof options.manifestPath === 'string'
                ? options.manifestPath
                : path.join('Octopus-agent-orchestrator', 'MANIFEST.md');
            const result = validateManifest(manifestPath);
            console.log(formatManifestResult(result));
            if (!result.passed) {
                throw new Error('Manifest validation failed.');
            }
            return;
        }
        case 'classify-change': {
            const defs = {
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--changed-file': { key: 'changedFiles', type: 'string[]' },
                '--changed-files': { key: 'changedFiles', type: 'string[]' },
                '--use-staged': { key: 'useStaged', type: 'boolean' },
                '--include-untracked': { key: 'includeUntracked', type: 'boolean' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--rule-pack-path': { key: 'rulePackPath', type: 'string' },
                '--task-intent': { key: 'taskIntent', type: 'string' },
                '--fast-path-max-files': { key: 'fastPathMaxFiles', type: 'string' },
                '--fast-path-max-changed-lines': { key: 'fastPathMaxChangedLines', type: 'string' },
                '--performance-heuristic-min-lines': { key: 'performanceHeuristicMinLines', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runClassifyChangeCommand(options);
            process.stdout.write(result.outputText);
            return;
        }
        case 'enter-task-mode': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--entry-mode': { key: 'entryMode', type: 'string' },
                '--requested-depth': { key: 'requestedDepth', type: 'string' },
                '--effective-depth': { key: 'effectiveDepth', type: 'string' },
                '--task-summary': { key: 'taskSummary', type: 'string' },
                '--actor': { key: 'actor', type: 'string' },
                '--artifact-path': { key: 'artifactPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runEnterTaskModeCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'load-rule-pack': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--stage': { key: 'stage', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-mode-path': { key: 'taskModePath', type: 'string' },
                '--loaded-rule-file': { key: 'loadedRuleFiles', type: 'string[]' },
                '--loaded-rule-files': { key: 'loadedRuleFiles', type: 'string[]' },
                '--actor': { key: 'actor', type: 'string' },
                '--artifact-path': { key: 'artifactPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runLoadRulePackCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'record-no-op': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--classification': { key: 'classification', type: 'string' },
                '--reason': { key: 'reason', type: 'string' },
                '--actor': { key: 'actor', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--artifact-path': { key: 'artifactPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runRecordNoOpCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'compile-gate': {
            const defs = {
                '--commands-path': { key: 'commandsPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--task-mode-path': { key: 'taskModePath', type: 'string' },
                '--rule-pack-path': { key: 'rulePackPath', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--compile-output-path': { key: 'compileOutputPath', type: 'string' },
                '--fail-tail-lines': { key: 'failTailLines', type: 'string' },
                '--output-filters-path': { key: 'outputFiltersPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = await runCompileGateCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'build-scoped-diff': {
            const defs = {
                '--review-type': { key: 'reviewType', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--paths-config-path': { key: 'pathsConfigPath', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--metadata-path': { key: 'metadataPath', type: 'string' },
                '--full-diff-path': { key: 'fullDiffPath', type: 'string' },
                '--use-staged': { key: 'useStaged', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options: rawOptions } = parseOptions(gateArgv, defs);
            const options = rawOptions as ParsedOptionsRecord;
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const reviewType = parseRequiredText(options.reviewType, 'ReviewType');
            const preflightPath = requireResolvedPath(
                gateHelpers.resolvePathInsideRepo(parseRequiredText(options.preflightPath, 'PreflightPath'), repoRoot),
                'PreflightPath'
            );
            const pathsConfigPath = options.pathsConfigPath
                ? requireResolvedPath(gateHelpers.resolvePathInsideRepo(String(options.pathsConfigPath), repoRoot), 'PathsConfigPath')
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'config', 'paths.json'));
            const outputPath = resolveOutputPath(String(options.outputPath || ''), preflightPath, reviewType, repoRoot);
            const metadataPath = resolveMetadataPath(String(options.metadataPath || ''), preflightPath, reviewType, repoRoot);
            const fullDiffPath = options.fullDiffPath
                ? gateHelpers.resolvePathInsideRepo(String(options.fullDiffPath), repoRoot)
                : null;
            const result = buildScopedDiff({
                reviewType,
                preflightPath,
                pathsConfigPath,
                outputPath,
                metadataPath,
                fullDiffPath,
                repoRoot,
                useStaged: options.useStaged === true
            });
            formatKeyValueOutput({
                outputPath: result.output_path,
                metadataPath: result.metadata_path,
                matchedFilesCount: result.matched_files_count,
                fallbackToFullDiff: result.fallback_to_full_diff
            }, ['outputPath', 'metadataPath', 'matchedFilesCount', 'fallbackToFullDiff']);
            return;
        }
        case 'build-review-context': {
            const defs = {
                '--review-type': { key: 'reviewType', type: 'string' },
                '--depth': { key: 'depth', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--token-economy-config-path': { key: 'tokenEconomyConfigPath', type: 'string' },
                '--scoped-diff-metadata-path': { key: 'scopedDiffMetadataPath', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options: rawOptions } = parseOptions(gateArgv, defs);
            const options = rawOptions as ParsedOptionsRecord;
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const reviewType = parseRequiredText(options.reviewType, 'ReviewType');
            const depth = Number.parseInt(parseRequiredText(options.depth, 'Depth'), 10);
            if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
                throw new Error('Depth must be an integer between 1 and 3.');
            }
            const preflightPath = requireResolvedPath(
                gateHelpers.resolvePathInsideRepo(parseRequiredText(options.preflightPath, 'PreflightPath'), repoRoot),
                'PreflightPath'
            );
            const tokenEconomyConfigPath = options.tokenEconomyConfigPath
                ? requireResolvedPath(
                    gateHelpers.resolvePathInsideRepo(String(options.tokenEconomyConfigPath), repoRoot, { allowMissing: true }),
                    'TokenEconomyConfigPath'
                )
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'config', 'token-economy.json'));
            const outputPath = resolveContextOutputPath(String(options.outputPath || ''), preflightPath, reviewType, repoRoot);
            const scopedDiffMetadataPath = resolveScopedDiffMetadataPath(
                String(options.scopedDiffMetadataPath || ''),
                preflightPath,
                reviewType,
                repoRoot
            );
            const result = buildReviewContext({
                reviewType,
                depth,
                preflightPath,
                tokenEconomyConfigPath,
                scopedDiffMetadataPath,
                outputPath,
                repoRoot
            });

            try {
                const preflightPayload = JSON.parse(fs.readFileSync(preflightPath, 'utf8')) as Record<string, unknown>;
                const taskId = String(preflightPayload.task_id || '').trim();
                if (taskId) {
                    const orchestratorRoot = gateHelpers.joinOrchestratorPath(repoRoot, '');
                    const skillId = resolveReviewSkillId(reviewType, repoRoot);
                    const skillPath = gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'skills', skillId, 'SKILL.md'));

                    emitReviewPhaseStartedEvent(orchestratorRoot, taskId, {
                        review_type: reviewType,
                        depth,
                        preflight_path: gateHelpers.normalizePath(preflightPath),
                        output_path: result.output_path,
                        review_context_artifact_path: result.rule_context.artifact_path
                    });
                    emitSkillSelectedEvent(orchestratorRoot, taskId, skillId, null, 'required_review');
                    if (fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
                        emitSkillReferenceLoadedEvent(orchestratorRoot, taskId, gateHelpers.normalizePath(skillPath), skillId, 'review_skill');
                    }
                    emitSkillReferenceLoadedEvent(
                        orchestratorRoot,
                        taskId,
                        gateHelpers.normalizePath(result.rule_context.artifact_path),
                        skillId,
                        'review_context_artifact'
                    );
                }
            } catch {
                // Keep build-review-context resilient even when telemetry cannot be emitted.
            }

            formatKeyValueOutput({
                outputPath: result.output_path,
                ruleContextArtifactPath: result.rule_context.artifact_path,
                tokenEconomyActive: result.token_economy_active
            }, ['outputPath', 'ruleContextArtifactPath', 'tokenEconomyActive']);
            return;
        }
        case 'task-events-summary': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--events-root': { key: 'eventsRoot', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--as-json': { key: 'asJson', type: 'boolean' },
                '--include-details': { key: 'includeDetails', type: 'boolean' }
            };
            const { options: rawOptions } = parseOptions(gateArgv, defs);
            const options = rawOptions as ParsedOptionsRecord;
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const eventsRoot = options.eventsRoot
                ? requireResolvedPath(
                    gateHelpers.resolvePathInsideRepo(String(options.eventsRoot), repoRoot, { allowMissing: true }),
                    'EventsRoot'
                )
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'task-events'));
            const summary = buildTaskEventsSummary({
                taskId: parseRequiredText(options.taskId, 'TaskId'),
                eventsRoot,
                repoRoot
            });
            const rendered = options.asJson === true
                ? `${JSON.stringify(summary, null, 2)}\n`
                : `${formatTaskEventsSummaryText(summary, options.includeDetails === true)}\n`;
            if (options.outputPath) {
                const outputPath = requireResolvedPath(
                    gateHelpers.resolvePathInsideRepo(String(options.outputPath), repoRoot, { allowMissing: true }),
                    'OutputPath'
                );
                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, rendered, 'utf8');
            }
            process.stdout.write(rendered);
            return;
        }
        case 'log-task-event': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--event-type': { key: 'eventType', type: 'string' },
                '--outcome': { key: 'outcome', type: 'string' },
                '--message': { key: 'message', type: 'string' },
                '--actor': { key: 'actor', type: 'string' },
                '--details-json': { key: 'detailsJson', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--events-root': { key: 'eventsRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runLogTaskEventCommand(options);
            process.stdout.write(result.outputText);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'required-reviews-check': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--task-mode-path': { key: 'taskModePath', type: 'string' },
                '--rule-pack-path': { key: 'rulePackPath', type: 'string' },
                '--code-review-verdict': { key: 'codeReviewVerdict', type: 'string' },
                '--db-review-verdict': { key: 'dbReviewVerdict', type: 'string' },
                '--security-review-verdict': { key: 'securityReviewVerdict', type: 'string' },
                '--refactor-review-verdict': { key: 'refactorReviewVerdict', type: 'string' },
                '--api-review-verdict': { key: 'apiReviewVerdict', type: 'string' },
                '--test-review-verdict': { key: 'testReviewVerdict', type: 'string' },
                '--performance-review-verdict': { key: 'performanceReviewVerdict', type: 'string' },
                '--infra-review-verdict': { key: 'infraReviewVerdict', type: 'string' },
                '--dependency-review-verdict': { key: 'dependencyReviewVerdict', type: 'string' },
                '--skip-reviews': { key: 'skipReviews', type: 'string' },
                '--skip-reason': { key: 'skipReason', type: 'string' },
                '--override-artifact-path': { key: 'overrideArtifactPath', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--reviews-root': { key: 'reviewsRoot', type: 'string' },
                '--review-evidence-path': { key: 'reviewEvidencePath', type: 'string' },
                '--no-op-artifact-path': { key: 'noOpArtifactPath', type: 'string' },
                '--output-filters-path': { key: 'outputFiltersPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runRequiredReviewsCheckCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'doc-impact-gate': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--decision': { key: 'decision', type: 'string' },
                '--behavior-changed': { key: 'behaviorChanged', type: 'boolean' },
                '--docs-updated': { key: 'docsUpdated', type: 'string[]' },
                '--changelog-updated': { key: 'changelogUpdated', type: 'boolean' },
                '--sensitive-scope-reviewed': { key: 'sensitiveScopeReviewed', type: 'boolean' },
                '--sensitive-reviewed': { key: 'sensitiveReviewed', type: 'boolean' },
                '--rationale': { key: 'rationale', type: 'string' },
                '--artifact-path': { key: 'artifactPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(gateArgv, defs);
            const result = runDocImpactGateCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'completion-gate': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--task-mode-path': { key: 'taskModePath', type: 'string' },
                '--rule-pack-path': { key: 'rulePackPath', type: 'string' },
                '--timeline-path': { key: 'timelinePath', type: 'string' },
                '--reviews-root': { key: 'reviewsRoot', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--review-evidence-path': { key: 'reviewEvidencePath', type: 'string' },
                '--doc-impact-path': { key: 'docImpactPath', type: 'string' },
                '--no-op-artifact-path': { key: 'noOpArtifactPath', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options: rawOptions } = parseOptions(gateArgv, defs);
            const options = rawOptions as ParsedOptionsRecord;
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const result = runCompletionGate({
                repoRoot,
                preflightPath: parseRequiredText(options.preflightPath, 'PreflightPath'),
                taskId: String(options.taskId || ''),
                taskModePath: String(options.taskModePath || ''),
                rulePackPath: String(options.rulePackPath || ''),
                timelinePath: String(options.timelinePath || ''),
                reviewsRoot: String(options.reviewsRoot || ''),
                compileEvidencePath: String(options.compileEvidencePath || ''),
                reviewEvidencePath: String(options.reviewEvidencePath || ''),
                docImpactPath: String(options.docImpactPath || ''),
                noOpArtifactPath: String(options.noOpArtifactPath || '')
            });

            // T-004: auto-emit COMPLETION_GATE_PASSED/FAILED to task timeline
            const completionTaskId = String(result.task_id || '').trim();
            if (completionTaskId) {
                const orchestratorRoot = gateHelpers.joinOrchestratorPath(repoRoot, '');
                try {
                    emitMandatoryCompletionGateEvent(orchestratorRoot, completionTaskId, result.outcome === 'PASS', {
                        status: result.status,
                        outcome: result.outcome,
                        preflight_path: result.preflight_path,
                        timeline_path: result.timeline_path,
                        violations: result.violations
                    });
                } catch (error: unknown) {
                    throw new Error(
                        `completion-gate failed because mandatory lifecycle event '${result.outcome === 'PASS' ? 'COMPLETION_GATE_PASSED' : 'COMPLETION_GATE_FAILED'}' could not be appended. ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                if (result.outcome === 'PASS') {
                    emitStatusChangedEvent(orchestratorRoot, completionTaskId, 'IN_REVIEW', 'DONE');
                }
            }

            process.stdout.write(`${formatCompletionGateResult(result)}\n`);
            if (result.outcome !== 'PASS') {
                process.exitCode = 1;
            }
            return;
        }
        case 'human-commit': {
            const exitCode = await runHumanCommitCommand(gateArgv, { cwd: process.cwd() });
            if (exitCode !== 0) {
                process.exitCode = exitCode;
            }
            return;
        }
        default:
            throw new Error(`Unknown gate: ${gateName}. Run "octopus gate --help" for available gates.`);
    }
}

function getFailureMarker(command: string | null): string {
    if (!command || command === 'bootstrap') {
        return 'OCTOPUS_BOOTSTRAP_FAILED';
    }
    return 'OCTOPUS_CLI_FAILED';
}

export async function runCliMain(argv: string[] = process.argv.slice(2), packageRoot = getPackageRoot()): Promise<void> {
    installSignalHandlers();
    const packageJson = readPackageJson(packageRoot);

    if (argv.length === 0) {
        handleOverview(packageJson, normalizePathValue('.'));
        return;
    }

    const commandName = getCommandName(argv);
    resolvedCommand = commandName;

    if (commandName === 'help') {
        printHelp(packageJson);
        return;
    }

    const commandArgv = commandName === 'bootstrap' && argv[0] !== 'bootstrap'
        ? argv
        : argv.slice(1);

    switch (commandName) {
        case 'setup':
            await handleSetup(commandArgv, packageJson, packageRoot);
            return;
        case 'agent-init': {
            const result = handleAgentInit(commandArgv, packageJson);
            if (result && result.readyForTasks === false) {
                process.exitCode = 1;
            }
            return;
        }
        case 'status':
            handleStatus(commandArgv, packageJson);
            return;
        case 'doctor':
            handleDoctor(commandArgv, packageJson);
            return;
        case 'bootstrap':
            await handleBootstrap(commandArgv, packageJson, packageRoot);
            return;
        case 'install':
            await handleInstall(commandArgv, packageJson, packageRoot);
            return;
        case 'init':
            handleInit(commandArgv, packageJson);
            return;
        case 'reinit':
            handleReinit(commandArgv, packageJson);
            return;
        case 'update':
            await handleUpdate(commandArgv, packageJson);
            return;
        case 'rollback':
            await handleRollback(commandArgv, packageJson);
            return;
        case 'uninstall':
            handleUninstall(commandArgv, packageJson);
            return;
        case 'verify':
            handleVerify(commandArgv, packageJson);
            return;
        case 'check-update':
            await handleCheckUpdate(commandArgv, packageJson);
            return;
        case 'skills': {
            const result = handleSkills(commandArgv, packageJson);
            if (result && typeof result === 'object' && 'passed' in result && result.passed === false) {
                process.exitCode = 1;
            }
            return;
        }
        case 'gate':
            await handleGate(commandArgv);
            return;
        default:
            throw new Error(`Unsupported command: ${commandName}`);
    }
}

export async function runCliMainWithHandling(
    argv: string[] = process.argv.slice(2),
    packageRoot = getPackageRoot()
): Promise<void> {
    try {
        await runCliMain(argv, packageRoot);
    } catch (error: unknown) {
        console.error(getFailureMarker(resolvedCommand));
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void runCliMainWithHandling();
}
