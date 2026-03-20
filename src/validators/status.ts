const fs = require('node:fs');
const path = require('node:path');

const {
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH
} = require('../core/constants.ts');
const { pathExists, readTextFile } = require('../core/fs.ts');
const { isPathInsideRoot } = require('../core/paths.ts');
const { validateInitAnswers } = require('../schemas/init-answers.ts');

const {
    getBundlePath,
    getCanonicalEntrypoint,
    getCommandsRulePath,
    getMissingProjectCommands,
    readUtf8IfExists
} = require('./workspace-layout.ts');

function resolveInitAnswersPath(targetRoot, initAnswersPath) {
    var candidate = String(initAnswersPath || '').trim();
    if (!candidate) candidate = DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    if (!path.isAbsolute(candidate)) candidate = path.join(targetRoot, candidate);
    var fullPath = path.resolve(candidate);
    if (!isPathInsideRoot(targetRoot, fullPath))
        throw new Error("InitAnswersPath must resolve inside TargetRoot '"+targetRoot+"'. Resolved path: "+fullPath);
    return fullPath;
}

function readInitAnswersSafe(targetRoot, initAnswersResolvedPath) {
    if (!pathExists(initAnswersResolvedPath)) return { answers: null, error: null };
    try {
        var stats = fs.lstatSync(initAnswersResolvedPath);
        if (!stats.isFile()) return { answers: null, error: 'Init answers path is not a file: '+initAnswersResolvedPath };
    } catch(e) { return { answers: null, error: 'Cannot stat init answers path: '+initAnswersResolvedPath }; }
    try {
        var raw = readTextFile(initAnswersResolvedPath);
        if (!raw.trim()) return { answers: null, error: 'Init answers artifact is empty: '+initAnswersResolvedPath };
        var parsed;
        try { parsed = JSON.parse(raw); } catch(e2) { return { answers: null, error: 'Init answers artifact is not valid JSON: '+initAnswersResolvedPath }; }
        var validated = validateInitAnswers(parsed);
        return { answers: validated, error: null };
    } catch(err) { return { answers: null, error: err.message || String(err) }; }
}

function getStatusSnapshot(targetRoot, initAnswersPath) {
    if (initAnswersPath === undefined) initAnswersPath = DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    var resolvedTargetRoot = path.resolve(targetRoot);
    var bundlePath = getBundlePath(resolvedTargetRoot);
    var bundlePresent = pathExists(bundlePath) && fs.lstatSync(bundlePath).isDirectory();
    var taskPath = path.join(resolvedTargetRoot, 'TASK.md');
    var livePath = path.join(bundlePath, 'live');
    var usagePath = path.join(livePath, 'USAGE.md');
    var commandsRulePath = getCommandsRulePath(bundlePath);
    var commandsContent = readUtf8IfExists(commandsRulePath);
    var missingProjectCommands = getMissingProjectCommands(commandsContent);
    var initAnswersResolvedPath;
    try { initAnswersResolvedPath = resolveInitAnswersPath(resolvedTargetRoot, initAnswersPath); }
    catch(e) { initAnswersResolvedPath = path.resolve(resolvedTargetRoot, initAnswersPath); }
    var initAnswersPresent = pathExists(initAnswersResolvedPath) && fs.lstatSync(initAnswersResolvedPath).isFile();
    var answersResult = initAnswersPresent ? readInitAnswersSafe(resolvedTargetRoot, initAnswersResolvedPath) : { answers: null, error: null };
    var answers = answersResult.answers;
    var initAnswersError = answersResult.error;
    var liveVersionPath = path.join(livePath, 'version.json');
    var liveVersion = null;
    var liveVersionError = null;
    if (pathExists(liveVersionPath)) {
        try { liveVersion = JSON.parse(readTextFile(liveVersionPath)); }
        catch(err) { liveVersionError = err.message || String(err); }
    }
    var sourceOfTruth = answers ? answers.SourceOfTruth
        : (liveVersion && String(liveVersion.SourceOfTruth || '').trim()) ? String(liveVersion.SourceOfTruth).trim() : null;
    var canonicalEntrypoint = sourceOfTruth ? getCanonicalEntrypoint(sourceOfTruth) : null;
    var livePresent = pathExists(livePath) && fs.lstatSync(livePath).isDirectory();
    var taskPresent = pathExists(taskPath) && fs.lstatSync(taskPath).isFile();
    var usagePresent = pathExists(usagePath) && fs.lstatSync(usagePath).isFile();
    var primaryInitializationComplete = bundlePresent && initAnswersPresent && !initAnswersError && livePresent && taskPresent && usagePresent;
    var agentInitializationComplete = primaryInitializationComplete && missingProjectCommands.length === 0;
    var readyForTasks = agentInitializationComplete;
    var recommendedNextCommand = 'npx octopus-agent-orchestrator setup';
    if (readyForTasks) recommendedNextCommand = 'Execute task T-001 depth=2';
    else if (primaryInitializationComplete) recommendedNextCommand = 'Give your agent "'+path.join(bundlePath,'AGENT_INIT_PROMPT.md')+'" and then run npx octopus-agent-orchestrator doctor';
    else if (bundlePresent && (!initAnswersPresent || initAnswersError)) recommendedNextCommand = 'npx octopus-agent-orchestrator setup --target-root "'+resolvedTargetRoot+'"';
    else if (bundlePresent) recommendedNextCommand = 'npx octopus-agent-orchestrator install --target-root "'+resolvedTargetRoot+'" --init-answers-path "'+initAnswersPath+'"';
    var activeAgentFilesValue = null;
    if (answers && answers.ActiveAgentFiles) {
        activeAgentFilesValue = Array.isArray(answers.ActiveAgentFiles) ? answers.ActiveAgentFiles.join(', ') : String(answers.ActiveAgentFiles);
    }
    return {
        targetRoot: resolvedTargetRoot, bundlePath: bundlePath, initAnswersResolvedPath: initAnswersResolvedPath,
        initAnswersPathForDisplay: initAnswersPath, bundlePresent: bundlePresent, initAnswersPresent: initAnswersPresent,
        initAnswersError: initAnswersError, taskPresent: taskPresent, livePresent: livePresent, usagePresent: usagePresent,
        commandsRulePath: commandsRulePath, missingProjectCommands: missingProjectCommands,
        sourceOfTruth: sourceOfTruth, canonicalEntrypoint: canonicalEntrypoint,
        collectedVia: answers ? (answers.CollectedVia || null) : null,
        activeAgentFiles: activeAgentFilesValue, liveVersionError: liveVersionError,
        primaryInitializationComplete: primaryInitializationComplete,
        agentInitializationComplete: agentInitializationComplete,
        readyForTasks: readyForTasks, recommendedNextCommand: recommendedNextCommand
    };
}

function formatStatusSnapshot(snapshot, options) {
    var heading = (options && options.heading) || 'OCTOPUS_STATUS';
    var lines = [];
    var headlineText;
    if (snapshot.readyForTasks) headlineText = 'Workspace ready';
    else if (snapshot.primaryInitializationComplete) headlineText = 'Agent setup required';
    else if (snapshot.bundlePresent) headlineText = 'Primary setup required';
    else headlineText = 'Not installed';
    function badge(c) { return c ? '[x]' : '[ ]'; }
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
    if (snapshot.primaryInitializationComplete && !snapshot.agentInitializationComplete)
        lines.push('  Missing project commands: '+snapshot.missingProjectCommands.length);
    if (snapshot.initAnswersError) lines.push('InitAnswersStatus: INVALID ('+snapshot.initAnswersError+')');
    if (snapshot.liveVersionError) lines.push('LiveVersionStatus: INVALID ('+snapshot.liveVersionError+')');
    lines.push('RecommendedNextCommand: '+snapshot.recommendedNextCommand);
    return lines.join('\n');
}

module.exports = {
    formatStatusSnapshot,
    getStatusSnapshot,
    readInitAnswersSafe,
    resolveInitAnswersPath
};
