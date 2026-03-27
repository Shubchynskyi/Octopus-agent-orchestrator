import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StatusSnapshot as CliStatusSnapshot } from '../cli/commands/cli-helpers';
import { DEFAULT_BUNDLE_NAME, DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH, DEFAULT_INIT_ANSWERS_RELATIVE_PATH } from '../core/constants';
import { pathExists, readTextFile } from '../core/fs';
import { isPathInsideRoot } from '../core/paths';
import { validateInitAnswers } from '../schemas/init-answers';
import { doesAgentInitStateMatchAnswers, readAgentInitStateSafe } from '../runtime/agent-init-state';
import {
    getBundlePath,
    getCanonicalEntrypoint,
    getCommandsRulePath,
    getMissingProjectCommands,
    readUtf8IfExists
} from './workspace-layout';

type InitAnswers = ReturnType<typeof validateInitAnswers>;

interface LiveVersionPayload {
    Version?: unknown;
    SourceOfTruth?: unknown;
}

type AgentInitStateResult = ReturnType<typeof readAgentInitStateSafe>;
type AgentInitState = NonNullable<AgentInitStateResult['state']>;

export interface StatusSnapshot extends CliStatusSnapshot {
    initAnswersPathForDisplay: string;
    initAnswersPresent: boolean;
    taskPresent: boolean;
    livePresent: boolean;
    usagePresent: boolean;
    agentInitStatePath: string;
    agentInitState: AgentInitState | null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function resolveInitAnswersPath(targetRoot: string, initAnswersPath?: string): string {
    var candidate = String(initAnswersPath || '').trim();
    if (!candidate) candidate = DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    if (!path.isAbsolute(candidate)) candidate = path.join(targetRoot, candidate);
    var fullPath = path.resolve(candidate);
    if (!isPathInsideRoot(targetRoot, fullPath))
        throw new Error("InitAnswersPath must resolve inside TargetRoot '"+targetRoot+"'. Resolved path: "+fullPath);
    return fullPath;
}

export function readInitAnswersSafe(targetRoot: string, initAnswersResolvedPath: string): { answers: InitAnswers | null; error: string | null } {
    if (!pathExists(initAnswersResolvedPath)) return { answers: null, error: null };
    try {
        var stats = fs.lstatSync(initAnswersResolvedPath);
        if (!stats.isFile()) return { answers: null, error: 'Init answers path is not a file: '+initAnswersResolvedPath };
    } catch (_error: unknown) { return { answers: null, error: 'Cannot stat init answers path: '+initAnswersResolvedPath }; }
    try {
        var raw = readTextFile(initAnswersResolvedPath);
        if (!raw.trim()) return { answers: null, error: 'Init answers artifact is empty: '+initAnswersResolvedPath };
        var parsed: unknown;
        try { parsed = JSON.parse(raw); } catch (_error: unknown) { return { answers: null, error: 'Init answers artifact is not valid JSON: '+initAnswersResolvedPath }; }
        var validated = validateInitAnswers(parsed);
        return { answers: validated, error: null };
    } catch (err: unknown) { return { answers: null, error: getErrorMessage(err) }; }
}

export function getStatusSnapshot(targetRoot: string, initAnswersPath: string = DEFAULT_INIT_ANSWERS_RELATIVE_PATH): StatusSnapshot {
    var resolvedTargetRoot = path.resolve(targetRoot);
    var bundlePath = getBundlePath(resolvedTargetRoot);
    var bundlePresent = pathExists(bundlePath) && fs.lstatSync(bundlePath).isDirectory();
    var taskPath = path.join(resolvedTargetRoot, 'TASK.md');
    var livePath = path.join(bundlePath, 'live');
    var usagePath = path.join(livePath, 'USAGE.md');
    var commandsRulePath = getCommandsRulePath(bundlePath);
    var commandsContent = readUtf8IfExists(commandsRulePath);
    var missingProjectCommands = getMissingProjectCommands(commandsContent);
    var agentInitStateResult: AgentInitStateResult = bundlePresent
        ? readAgentInitStateSafe(resolvedTargetRoot, DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH)
        : { statePath: path.join(bundlePath, 'runtime', 'agent-init-state.json'), state: null, error: null };
    var initAnswersResolvedPath;
    try { initAnswersResolvedPath = resolveInitAnswersPath(resolvedTargetRoot, initAnswersPath); }
    catch (_error: unknown) { initAnswersResolvedPath = path.resolve(resolvedTargetRoot, initAnswersPath); }
    var initAnswersPresent = pathExists(initAnswersResolvedPath) && fs.lstatSync(initAnswersResolvedPath).isFile();
    var answersResult = initAnswersPresent ? readInitAnswersSafe(resolvedTargetRoot, initAnswersResolvedPath) : { answers: null, error: null };
    var answers = answersResult.answers;
    var initAnswersError = answersResult.error;
    var collectedVia = answers ? (answers.CollectedVia || null) : null;
    var liveVersionPath = path.join(livePath, 'version.json');
    var liveVersion: LiveVersionPayload | null = null;
    var liveVersionError = null;
    if (pathExists(liveVersionPath)) {
        try { liveVersion = JSON.parse(readTextFile(liveVersionPath)) as LiveVersionPayload; }
        catch (err: unknown) { liveVersionError = getErrorMessage(err); }
    }
    var sourceOfTruth = answers ? answers.SourceOfTruth
        : (liveVersion && String(liveVersion.SourceOfTruth || '').trim()) ? String(liveVersion.SourceOfTruth).trim() : null;
    var canonicalEntrypoint = sourceOfTruth ? getCanonicalEntrypoint(sourceOfTruth) : null;
    var livePresent = pathExists(livePath) && fs.lstatSync(livePath).isDirectory();
    var taskPresent = pathExists(taskPath) && fs.lstatSync(taskPath).isFile();
    var usagePresent = pathExists(usagePath) && fs.lstatSync(usagePath).isFile();
    var primaryInitializationComplete = bundlePresent && initAnswersPresent && !initAnswersError && livePresent && taskPresent && usagePresent;
    var agentInitializationPendingReason: CliStatusSnapshot['agentInitializationPendingReason'] = null;
    var currentActiveAgentFiles: string[] = [];
    if (answers && answers.ActiveAgentFiles) {
        currentActiveAgentFiles = Array.isArray(answers.ActiveAgentFiles)
            ? answers.ActiveAgentFiles.slice()
            : String(answers.ActiveAgentFiles).split(/[;,]/g).map(function (item) { return item.trim(); }).filter(Boolean);
    } else if (canonicalEntrypoint) {
        currentActiveAgentFiles = [canonicalEntrypoint];
    }
    if (primaryInitializationComplete) {
        if (agentInitStateResult.error) {
            agentInitializationPendingReason = 'AGENT_STATE_INVALID';
        } else if (!agentInitStateResult.state) {
            agentInitializationPendingReason = 'AGENT_HANDOFF_REQUIRED';
        } else if (!doesAgentInitStateMatchAnswers(agentInitStateResult.state, {
            AssistantLanguage: answers && answers.AssistantLanguage,
            SourceOfTruth: sourceOfTruth,
            ActiveAgentFiles: currentActiveAgentFiles
        })) {
            agentInitializationPendingReason = 'AGENT_STATE_STALE';
        } else if (!agentInitStateResult.state.AssistantLanguageConfirmed) {
            agentInitializationPendingReason = 'LANGUAGE_CONFIRMATION_PENDING';
        } else if (!agentInitStateResult.state.ActiveAgentFilesConfirmed) {
            agentInitializationPendingReason = 'ACTIVE_AGENT_FILES_PENDING';
        } else if (!agentInitStateResult.state.ProjectRulesUpdated) {
            agentInitializationPendingReason = 'PROJECT_RULES_PENDING';
        } else if (!agentInitStateResult.state.SkillsPromptCompleted) {
            agentInitializationPendingReason = 'SKILLS_PROMPT_PENDING';
        } else if (missingProjectCommands.length > 0) {
            agentInitializationPendingReason = 'PROJECT_COMMANDS_PENDING';
        } else if (!agentInitStateResult.state.VerificationPassed || !agentInitStateResult.state.ManifestValidationPassed) {
            agentInitializationPendingReason = 'VALIDATION_PENDING';
        }
    }
    var agentInitializationComplete = primaryInitializationComplete && agentInitializationPendingReason === null;
    var readyForTasks = agentInitializationComplete;
    var recommendedNextCommand = 'npx octopus-agent-orchestrator setup';
    if (readyForTasks) recommendedNextCommand = 'Execute task T-001 depth=2';
    else if (primaryInitializationComplete && agentInitializationPendingReason !== null)
        recommendedNextCommand = 'Give your agent "'+path.join(bundlePath,'AGENT_INIT_PROMPT.md')+'" and complete the agent-init flow';
    else if (bundlePresent && (!initAnswersPresent || initAnswersError)) recommendedNextCommand = 'npx octopus-agent-orchestrator setup --target-root "'+resolvedTargetRoot+'"';
    else if (bundlePresent) recommendedNextCommand = 'npx octopus-agent-orchestrator install --target-root "'+resolvedTargetRoot+'" --init-answers-path "'+initAnswersPath+'"';
    var activeAgentFilesValue = null;
    if (currentActiveAgentFiles.length > 0) {
        activeAgentFilesValue = currentActiveAgentFiles.join(', ');
    }
    return {
        targetRoot: resolvedTargetRoot, bundlePath: bundlePath, initAnswersResolvedPath: initAnswersResolvedPath,
        initAnswersPathForDisplay: initAnswersPath, bundlePresent: bundlePresent, initAnswersPresent: initAnswersPresent,
        initAnswersError: initAnswersError, taskPresent: taskPresent, livePresent: livePresent, usagePresent: usagePresent,
        commandsRulePath: commandsRulePath, missingProjectCommands: missingProjectCommands,
        sourceOfTruth: sourceOfTruth, canonicalEntrypoint: canonicalEntrypoint,
        collectedVia: collectedVia,
        agentInitStatePath: agentInitStateResult.statePath,
        agentInitStateError: agentInitStateResult.error,
        agentInitState: agentInitStateResult.state,
        activeAgentFiles: activeAgentFilesValue, liveVersionError: liveVersionError,
        primaryInitializationComplete: primaryInitializationComplete,
        agentInitializationPendingReason: agentInitializationPendingReason,
        agentInitializationComplete: agentInitializationComplete,
        readyForTasks: readyForTasks, recommendedNextCommand: recommendedNextCommand
    };
}

export function formatStatusSnapshot(snapshot: StatusSnapshot, options?: { heading?: string }): string {
    var heading = (options && options.heading) || 'OCTOPUS_STATUS';
    var lines: string[] = [];
    var headlineText;
    if (snapshot.readyForTasks) headlineText = 'Workspace ready';
    else if (snapshot.primaryInitializationComplete) headlineText = 'Agent setup required';
    else if (snapshot.bundlePresent) headlineText = 'Primary setup required';
    else headlineText = 'Not installed';
    function badge(c: boolean) { return c ? '[x]' : '[ ]'; }
    lines.push(heading);
    lines.push(headlineText);
    lines.push('Project: '+snapshot.targetRoot);
    lines.push('Bundle: '+snapshot.bundlePath);
    lines.push('InitAnswers: '+snapshot.initAnswersResolvedPath);
    lines.push('CollectedVia: '+(snapshot.collectedVia||'n/a'));
    if (snapshot.activeAgentFiles) lines.push('ActiveAgentFiles: '+snapshot.activeAgentFiles);
    lines.push('SourceOfTruth: '+(snapshot.sourceOfTruth||'n/a')+(snapshot.canonicalEntrypoint ? ' -> '+snapshot.canonicalEntrypoint : ''));
    lines.push('');
    lines.push('Workspace Stages');
    lines.push('  '+badge(snapshot.bundlePresent)+' Installed');
    lines.push('  '+badge(snapshot.primaryInitializationComplete)+' Primary initialization');
    lines.push('  '+badge(snapshot.agentInitializationComplete)+' Agent initialization');
    lines.push('  '+badge(snapshot.readyForTasks)+' Ready for task execution');
    if (snapshot.agentInitializationPendingReason === 'AGENT_HANDOFF_REQUIRED')
        lines.push('  Next stage: Launch your agent with AGENT_INIT_PROMPT.md');
    else if (snapshot.agentInitializationPendingReason === 'LANGUAGE_CONFIRMATION_PENDING')
        lines.push('  Pending checkpoint: Confirm assistant language during AGENT_INIT_PROMPT flow');
    else if (snapshot.agentInitializationPendingReason === 'ACTIVE_AGENT_FILES_PENDING')
        lines.push('  Pending checkpoint: Confirm active agent files during AGENT_INIT_PROMPT flow');
    else if (snapshot.agentInitializationPendingReason === 'AGENT_STATE_STALE')
        lines.push('  Pending checkpoint: Agent-init state no longer matches current init answers; rerun AGENT_INIT_PROMPT flow');
    else if (snapshot.agentInitializationPendingReason === 'PROJECT_RULES_PENDING')
        lines.push('  Pending checkpoint: Update project-specific live rules before finalizing agent init');
    else if (snapshot.agentInitializationPendingReason === 'SKILLS_PROMPT_PENDING')
        lines.push('  Pending checkpoint: Ask the built-in specialist skills question before finalizing agent init');
    else if (snapshot.agentInitializationPendingReason === 'PROJECT_COMMANDS_PENDING')
        lines.push('  Missing project commands: '+snapshot.missingProjectCommands.length);
    else if (snapshot.agentInitializationPendingReason === 'VALIDATION_PENDING')
        lines.push('  Pending checkpoint: Run agent-init validation to get verify + manifest PASS');
    else if (snapshot.agentInitializationPendingReason === 'AGENT_STATE_INVALID')
        lines.push('  Pending checkpoint: Repair invalid agent-init state file');
    if (snapshot.initAnswersError) lines.push('InitAnswersStatus: INVALID ('+snapshot.initAnswersError+')');
    if (snapshot.liveVersionError) lines.push('LiveVersionStatus: INVALID ('+snapshot.liveVersionError+')');
    if (snapshot.agentInitStateError) lines.push('AgentInitStateStatus: INVALID ('+snapshot.agentInitStateError+')');
    lines.push('RecommendedNextCommand: '+snapshot.recommendedNextCommand);
    return lines.join('\n');
}
