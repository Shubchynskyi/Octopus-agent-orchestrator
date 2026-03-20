const fs = require('node:fs');
const path = require('node:path');

const {
    ALL_AGENT_ENTRYPOINT_FILES,
    BOOLEAN_TRUE_VALUES,
    BOOLEAN_FALSE_VALUES,
    DEFAULT_BUNDLE_NAME,
    SOURCE_TO_ENTRYPOINT_MAP
} = require('../core/constants.ts');
const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { readJsonFile } = require('../core/json.ts');
const { isPathInsideRoot, resolvePathInsideRoot } = require('../core/paths.ts');
const { removeManagedBlock } = require('../core/managed-blocks.ts');
const { getActiveAgentEntrypointFiles, getCanonicalEntrypointFile } = require('../materialization/common.ts');
const {
    MANAGED_START,
    MANAGED_END,
    COMMIT_GUARD_START,
    COMMIT_GUARD_END,
    CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES,
    INSTALL_BACKUP_CANDIDATE_PATHS
} = require('../materialization/content-builders.ts');

const {
    copyPathRecursive,
    getTimestamp,
    removePathRecursive,
    validateTargetRoot
} = require('./common.ts');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTRYPOINT_FILES = Object.freeze([...ALL_AGENT_ENTRYPOINT_FILES]);

const PROVIDER_AGENT_FILES = Object.freeze([
    '.github/agents/orchestrator.md',
    '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md',
    '.antigravity/agents/orchestrator.md'
]);

const GITHUB_SKILL_BRIDGE_FILES = Object.freeze([
    '.github/agents/reviewer.md',
    '.github/agents/code-review.md',
    '.github/agents/db-review.md',
    '.github/agents/security-review.md',
    '.github/agents/refactor-review.md',
    '.github/agents/api-review.md',
    '.github/agents/test-review.md',
    '.github/agents/performance-review.md',
    '.github/agents/infra-review.md',
    '.github/agents/dependency-review.md'
]);

const QWEN_SETTINGS_RELATIVE = '.qwen/settings.json';
const CLAUDE_LOCAL_SETTINGS_RELATIVE = '.claude/settings.local.json';
const PRE_COMMIT_HOOK_RELATIVE = '.git/hooks/pre-commit';

const GITIGNORE_MANAGED_COMMENT = '# Octopus-agent-orchestrator managed ignores';
const GITIGNORE_MANAGED_ENTRIES = Object.freeze([
    'Octopus-agent-orchestrator/',
    'AGENTS.md',
    'TASK.md',
    '.qwen/',
    '.github/agents/',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md',
    '.claude/'
]);

// ---------------------------------------------------------------------------
// Boolean answer parsing (mirrors Convert-ToBooleanAnswer)
// ---------------------------------------------------------------------------

function parseBooleanAnswer(value, fieldName) {
    if (value === true) return true;
    if (value === false) return false;
    const normalized = String(value).trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
    if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
    throw new Error(`${fieldName} must be one of: true, false, yes, no, 1, 0.`);
}

// ---------------------------------------------------------------------------
// Entrypoint detection helpers (mirror uninstall.ps1 helpers)
// ---------------------------------------------------------------------------

function getCanonicalEntrypointFromSourceOfTruth(sourceOfTruthValue) {
    if (!sourceOfTruthValue || !String(sourceOfTruthValue).trim()) return null;
    try {
        return getCanonicalEntrypointFile(sourceOfTruthValue);
    } catch (_e) {
        return null;
    }
}

function tryGetCanonicalEntrypointFromJsonFile(filePath, preferCanonicalProperty) {
    if (!pathExists(filePath)) return null;
    let payload;
    try { payload = readJsonFile(filePath); } catch (_e) { return null; }
    if (!payload || typeof payload !== 'object') return null;

    if (preferCanonicalProperty && payload.CanonicalEntrypoint) {
        const canonical = String(payload.CanonicalEntrypoint).trim();
        if (canonical) return canonical;
    }

    if (payload.SourceOfTruth) {
        return getCanonicalEntrypointFromSourceOfTruth(String(payload.SourceOfTruth));
    }
    return null;
}

function tryGetActiveAgentFilesFromJsonFile(filePath, fallbackSourceOfTruth) {
    if (!pathExists(filePath)) return [];
    let payload;
    try { payload = readJsonFile(filePath); } catch (_e) { return []; }
    if (!payload || typeof payload !== 'object') return [];

    const activeAgentFilesRaw = payload.ActiveAgentFiles
        ? String(payload.ActiveAgentFiles).trim() || null
        : null;

    const sot = payload.SourceOfTruth
        ? String(payload.SourceOfTruth)
        : fallbackSourceOfTruth || null;

    return getActiveAgentEntrypointFiles(activeAgentFilesRaw, sot);
}

function tryDetectCanonicalEntrypointFromManagedFiles(targetRoot, entrypointFiles) {
    for (const rel of entrypointFiles) {
        const candidatePath = path.join(targetRoot, rel);
        if (!pathExists(candidatePath)) continue;
        const content = readTextFile(candidatePath);
        if (!content.trim()) continue;
        if (content.includes('Octopus Agent Orchestrator Rule Index') || content.includes('## Rule Routing')) {
            return rel;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Text normalization after managed block removal
// ---------------------------------------------------------------------------

function normalizeTextAfterManagedBlockRemoval(content) {
    if (!content) return '';
    let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    const trimmed = normalized.trim();
    if (!trimmed) return '';
    return trimmed.split('\n').join('\r\n');
}

// ---------------------------------------------------------------------------
// Empty directory cleanup
// ---------------------------------------------------------------------------

function removeEmptyDirectoriesUpwards(startDirectory, targetRoot, dryRun) {
    let current = startDirectory;
    let deletedCount = 0;
    const normalizedRoot = path.resolve(targetRoot).toLowerCase();

    while (current) {
        const normalizedCurrent = path.resolve(current).toLowerCase();
        if (normalizedCurrent === normalizedRoot) break;

        if (!fs.existsSync(current) || !fs.lstatSync(current).isDirectory()) {
            current = path.dirname(current);
            continue;
        }

        const entries = fs.readdirSync(current);
        if (entries.length > 0) break;

        if (!dryRun) {
            fs.rmdirSync(current);
        }
        deletedCount++;
        current = path.dirname(current);
    }

    return deletedCount;
}

// ---------------------------------------------------------------------------
// Initialization backup helpers
// ---------------------------------------------------------------------------

function getInitializationBackupRoot(orchestratorRoot) {
    const installBackupsRoot = path.join(orchestratorRoot, 'runtime', 'backups');
    if (!pathExists(installBackupsRoot)) return null;

    const dirs = fs.readdirSync(installBackupsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

    if (dirs.length === 0) return null;
    return path.join(installBackupsRoot, dirs[0]);
}

function getInitializationBackupManifest(backupRoot) {
    if (!backupRoot) return null;
    const manifestPath = path.join(backupRoot, '_install-backup.manifest.json');
    if (!pathExists(manifestPath)) return null;
    try {
        return readJsonFile(manifestPath);
    } catch (_e) {
        return null;
    }
}

function isManagedOnlyBackupContent(backupPath, managedStart, managedEnd) {
    if (!pathExists(backupPath)) return false;
    const content = readTextFile(backupPath);
    if (!content.trim()) return false;

    const pattern = new RegExp(
        escapeRegex(managedStart) + '[\\s\\S]*?' + escapeRegex(managedEnd),
        ''
    );
    if (!pattern.test(content)) return false;

    const withoutBlock = content.replace(pattern, '');
    return normalizeTextAfterManagedBlockRemoval(withoutBlock) === '';
}

function shouldRestoreItemFromInitializationBackup(relativePath, backupPath, manifest, managedStart, managedEnd) {
    if (manifest) {
        const preExistingFiles = manifest.PreExistingFiles || manifest.preExistingFiles;
        if (Array.isArray(preExistingFiles)) {
            const normalizedRel = relativePath.replace(/\//g, '\\');
            for (const item of preExistingFiles) {
                if (!item) continue;
                const candidate = String(item).replace(/\//g, '\\');
                if (candidate.toLowerCase() === normalizedRel.toLowerCase()) return true;
            }
            return false;
        }
    }
    return !isManagedOnlyBackupContent(backupPath, managedStart, managedEnd);
}

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main uninstall function
// ---------------------------------------------------------------------------

/**
 * Runs the uninstall pipeline.
 * Ports uninstall.ps1 to Node/TS.
 *
 * @param {object} options
 * @param {string} options.targetRoot
 * @param {string} options.bundleRoot
 * @param {string} [options.initAnswersPath]
 * @param {boolean} [options.noPrompt=true]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.skipBackups=false]
 * @param {string|boolean} [options.keepPrimaryEntrypoint]
 * @param {string|boolean} [options.keepTaskFile]
 * @param {string|boolean} [options.keepRuntimeArtifacts]
 * @returns {object} Uninstall result
 */
function runUninstall(options) {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        noPrompt = true,
        dryRun = false,
        skipBackups = false,
        keepPrimaryEntrypoint,
        keepTaskFile,
        keepRuntimeArtifacts
    } = options;

    const normalizedTarget = validateTargetRoot(targetRoot, bundleRoot);
    const orchestratorRoot = path.join(normalizedTarget, DEFAULT_BUNDLE_NAME);

    // Resolve init answers path (allow missing)
    let initAnswersCandidatePath;
    if (path.isAbsolute(initAnswersPath)) {
        initAnswersCandidatePath = initAnswersPath;
    } else {
        initAnswersCandidatePath = path.resolve(normalizedTarget, initAnswersPath);
    }

    const liveVersionPath = path.join(orchestratorRoot, 'live', 'version.json');
    const timestamp = getTimestamp();

    // State tracking
    let backupRoot = null;
    const backedUpSet = new Set();
    let itemsBackedUp = 0;
    let deletedFiles = 0;
    let updatedFiles = 0;
    let deletedDirectories = 0;
    let restoredFiles = 0;
    const warnings = [];
    let preservedRuntimePath = null;

    // Initialization backup detection
    const initBackupRoot = getInitializationBackupRoot(orchestratorRoot);
    const initBackupManifest = getInitializationBackupManifest(initBackupRoot);

    // ---------------------------------------------------------------------------
    // Internal helpers bound to this uninstall context
    // ---------------------------------------------------------------------------

    function getBackupRoot() {
        if (!backupRoot) {
            backupRoot = path.join(normalizedTarget, `${DEFAULT_BUNDLE_NAME}-uninstall-backups`, timestamp);
        }
        return backupRoot;
    }

    function backupItem(itemPath, relativePath, isDirectory, forcePreserve) {
        if (!fs.existsSync(itemPath)) return;
        if (skipBackups && !forcePreserve) return;

        const normalizedRel = relativePath.replace(/\//g, path.sep);
        if (backedUpSet.has(normalizedRel.toLowerCase())) return;

        const backupPath = path.join(getBackupRoot(), normalizedRel);
        if (!dryRun) {
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            copyPathRecursive(itemPath, backupPath);
        }

        backedUpSet.add(normalizedRel.toLowerCase());
        itemsBackedUp++;
    }

    function addWarning(message) {
        warnings.push(message);
    }

    function updateOrRemoveFile(filePath, relativePath, content) {
        backupItem(filePath, relativePath, false, false);

        if (!content || !content.trim()) {
            if (!dryRun) {
                fs.rmSync(filePath, { force: true });
            }
            deletedFiles++;
            deletedDirectories += removeEmptyDirectoriesUpwards(path.dirname(filePath), normalizedTarget, dryRun);
            return;
        }

        if (!dryRun) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
        updatedFiles++;
    }

    function removeManagedFile(relativePath) {
        const filePath = path.join(normalizedTarget, relativePath);
        if (!pathExists(filePath)) return;

        const content = readTextFile(filePath);
        const pattern = new RegExp(
            escapeRegex(MANAGED_START) + '[\\s\\S]*?' + escapeRegex(MANAGED_END),
            ''
        );

        if (!pattern.test(content)) {
            addWarning(`Skipping '${relativePath}' because it no longer contains Octopus managed block markers.`);
            return;
        }

        const updatedContent = content.replace(pattern, '');
        const normalized = normalizeTextAfterManagedBlockRemoval(updatedContent);
        updateOrRemoveFile(filePath, relativePath, normalized);
    }

    function getInitBackupPath(relativePath) {
        if (!initBackupRoot) return null;
        const bp = path.join(initBackupRoot, relativePath);
        if (!fs.existsSync(bp)) return null;
        return bp;
    }

    function restoreItemFromInitializationBackup(relativePath) {
        const bp = getInitBackupPath(relativePath);
        if (!bp) return false;

        if (!shouldRestoreItemFromInitializationBackup(
            relativePath, bp, initBackupManifest, MANAGED_START, MANAGED_END
        )) {
            return false;
        }

        const destinationPath = path.join(normalizedTarget, relativePath);
        backupItem(destinationPath, relativePath, false, false);

        if (!dryRun) {
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            const backupItem2 = fs.lstatSync(bp);
            if (fs.existsSync(destinationPath)) {
                const destItem = fs.lstatSync(destinationPath);
                if (destItem.isDirectory() !== backupItem2.isDirectory()) {
                    removePathRecursive(destinationPath);
                }
            }
            if (backupItem2.isDirectory()) {
                removePathRecursive(destinationPath);
                copyPathRecursive(bp, destinationPath);
            } else {
                fs.copyFileSync(bp, destinationPath);
            }
        }

        restoredFiles++;
        return true;
    }

    function cleanupQwenSettings(qwenManagedEntries) {
        const filePath = path.join(normalizedTarget, QWEN_SETTINGS_RELATIVE);
        if (!pathExists(filePath)) return;

        let settings;
        try {
            settings = readJsonFile(filePath);
        } catch (_e) {
            addWarning(`Skipping '${QWEN_SETTINGS_RELATIVE}' because it is no longer valid JSON.`);
            return;
        }

        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            addWarning(`Skipping '${QWEN_SETTINGS_RELATIVE}' because its JSON root is no longer an object.`);
            return;
        }

        if (!settings.context || typeof settings.context !== 'object') return;

        const currentEntries = Array.isArray(settings.context.fileName)
            ? settings.context.fileName.filter((e) => e && String(e).trim()).map((e) => String(e).trim())
            : [];

        const managedSet = new Set(qwenManagedEntries);
        const updatedEntries = currentEntries.filter((e) => !managedSet.has(e));

        if (updatedEntries.length === currentEntries.length) return;

        const updatedSettings = { ...settings };
        const updatedContext = { ...updatedSettings.context };

        if (updatedEntries.length > 0) {
            updatedContext.fileName = updatedEntries;
        } else {
            delete updatedContext.fileName;
        }

        if (Object.keys(updatedContext).length > 0) {
            updatedSettings.context = updatedContext;
        } else {
            delete updatedSettings.context;
        }

        if (Object.keys(updatedSettings).length === 0) {
            updateOrRemoveFile(filePath, QWEN_SETTINGS_RELATIVE, '');
            return;
        }

        const json = JSON.stringify(updatedSettings, null, 2);
        updateOrRemoveFile(filePath, QWEN_SETTINGS_RELATIVE, json);
    }

    function cleanupClaudeLocalSettings() {
        const filePath = path.join(normalizedTarget, CLAUDE_LOCAL_SETTINGS_RELATIVE);
        if (!pathExists(filePath)) return;

        let settings;
        try {
            settings = readJsonFile(filePath);
        } catch (_e) {
            addWarning(`Skipping '${CLAUDE_LOCAL_SETTINGS_RELATIVE}' because it is no longer valid JSON.`);
            return;
        }

        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            addWarning(`Skipping '${CLAUDE_LOCAL_SETTINGS_RELATIVE}' because its JSON root is no longer an object.`);
            return;
        }

        if (!settings.permissions || typeof settings.permissions !== 'object') return;

        const currentAllowEntries = Array.isArray(settings.permissions.allow)
            ? settings.permissions.allow.filter((e) => e && String(e).trim()).map((e) => String(e).trim())
            : [];

        const managedSet = new Set(CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES);
        const updatedAllowEntries = currentAllowEntries.filter((e) => !managedSet.has(e));

        if (updatedAllowEntries.length === currentAllowEntries.length) return;

        const updatedSettings = { ...settings };
        const updatedPermissions = { ...updatedSettings.permissions };

        if (updatedAllowEntries.length > 0) {
            updatedPermissions.allow = updatedAllowEntries;
        } else {
            delete updatedPermissions.allow;
        }

        if (Object.keys(updatedPermissions).length > 0) {
            updatedSettings.permissions = updatedPermissions;
        } else {
            delete updatedSettings.permissions;
        }

        if (Object.keys(updatedSettings).length === 0) {
            updateOrRemoveFile(filePath, CLAUDE_LOCAL_SETTINGS_RELATIVE, '');
            return;
        }

        const json = JSON.stringify(updatedSettings, null, 2);
        updateOrRemoveFile(filePath, CLAUDE_LOCAL_SETTINGS_RELATIVE, json);
    }

    function cleanupGitignore() {
        const filePath = path.join(normalizedTarget, '.gitignore');
        if (!pathExists(filePath)) return;

        const lines = readTextFile(filePath).split(/\r?\n/);
        const updatedLines = [];
        let changed = false;
        const managedEntrySet = new Set(GITIGNORE_MANAGED_ENTRIES);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === GITIGNORE_MANAGED_COMMENT) {
                changed = true;
                i++;
                while (i < lines.length) {
                    const candidate = lines[i];
                    if (managedEntrySet.has(candidate)) {
                        changed = true;
                        i++;
                        continue;
                    }
                    i--;
                    break;
                }
                continue;
            }
            updatedLines.push(line);
        }

        if (!changed) return;

        const updatedContent = normalizeTextAfterManagedBlockRemoval(updatedLines.join('\r\n'));
        updateOrRemoveFile(filePath, '.gitignore', updatedContent);
    }

    function cleanupCommitGuardHook() {
        const filePath = path.join(normalizedTarget, PRE_COMMIT_HOOK_RELATIVE);
        if (!pathExists(filePath)) return;

        const content = readTextFile(filePath);
        const pattern = new RegExp(
            escapeRegex(COMMIT_GUARD_START) + '[\\s\\S]*?' + escapeRegex(COMMIT_GUARD_END),
            ''
        );

        if (!pattern.test(content)) return;

        let updatedContent = content.replace(pattern, '');
        updatedContent = normalizeTextAfterManagedBlockRemoval(updatedContent);
        if (/^#!\/usr\/bin\/env bash\s*$/.test(updatedContent)) {
            updatedContent = '';
        }

        updateOrRemoveFile(filePath, PRE_COMMIT_HOOK_RELATIVE, updatedContent);
    }

    function removeBundleDirectory() {
        if (!fs.existsSync(orchestratorRoot) || !fs.lstatSync(orchestratorRoot).isDirectory()) return;

        const keepRuntime = keepRuntimeArtifactsValue;

        if (!skipBackups) {
            backupItem(orchestratorRoot, DEFAULT_BUNDLE_NAME, true, false);
            if (keepRuntime) {
                preservedRuntimePath = path.join(getBackupRoot(), DEFAULT_BUNDLE_NAME, 'runtime');
            }
        } else if (keepRuntime) {
            const runtimePath = path.join(orchestratorRoot, 'runtime');
            if (fs.existsSync(runtimePath) && fs.lstatSync(runtimePath).isDirectory()) {
                backupItem(runtimePath, path.join(DEFAULT_BUNDLE_NAME, 'runtime'), true, true);
                preservedRuntimePath = path.join(getBackupRoot(), DEFAULT_BUNDLE_NAME, 'runtime');
            }
        }

        if (!dryRun) {
            removePathRecursive(orchestratorRoot);
        }
        deletedDirectories++;
    }

    // ---------------------------------------------------------------------------
    // Detect canonical entrypoint and active agent files
    // ---------------------------------------------------------------------------

    let canonicalEntrypoint = tryGetCanonicalEntrypointFromJsonFile(initAnswersCandidatePath, false);
    if (!canonicalEntrypoint) {
        canonicalEntrypoint = tryGetCanonicalEntrypointFromJsonFile(liveVersionPath, true);
    }
    if (!canonicalEntrypoint) {
        canonicalEntrypoint = tryDetectCanonicalEntrypointFromManagedFiles(normalizedTarget, ENTRYPOINT_FILES);
    }

    let detectedActiveAgentFiles = [];
    if (pathExists(initAnswersCandidatePath)) {
        detectedActiveAgentFiles = tryGetActiveAgentFilesFromJsonFile(initAnswersCandidatePath, null);
    }
    if (detectedActiveAgentFiles.length === 0 && pathExists(liveVersionPath)) {
        detectedActiveAgentFiles = tryGetActiveAgentFilesFromJsonFile(liveVersionPath, null);
    }
    if (detectedActiveAgentFiles.length === 0 && canonicalEntrypoint) {
        detectedActiveAgentFiles = [canonicalEntrypoint];
    }

    // Build qwen managed entries (TASK.md + active agent files)
    const qwenManagedEntries = [...new Set(['TASK.md', ...detectedActiveAgentFiles.filter(Boolean)])].sort();

    // ---------------------------------------------------------------------------
    // Resolve keep decisions
    // ---------------------------------------------------------------------------

    let keepPrimaryEntrypointValue = false;
    if (canonicalEntrypoint && pathExists(path.join(normalizedTarget, canonicalEntrypoint))) {
        if (keepPrimaryEntrypoint !== undefined && keepPrimaryEntrypoint !== null && String(keepPrimaryEntrypoint).trim()) {
            keepPrimaryEntrypointValue = parseBooleanAnswer(keepPrimaryEntrypoint, 'KeepPrimaryEntrypoint');
        }
    }

    let keepTaskFileValue = false;
    const taskPath = path.join(normalizedTarget, 'TASK.md');
    if (pathExists(taskPath)) {
        if (keepTaskFile !== undefined && keepTaskFile !== null && String(keepTaskFile).trim()) {
            keepTaskFileValue = parseBooleanAnswer(keepTaskFile, 'KeepTaskFile');
        }
    }

    let keepRuntimeArtifactsValue = false;
    const runtimePath = path.join(orchestratorRoot, 'runtime');
    if (pathExists(runtimePath)) {
        if (keepRuntimeArtifacts !== undefined && keepRuntimeArtifacts !== null && String(keepRuntimeArtifacts).trim()) {
            keepRuntimeArtifactsValue = parseBooleanAnswer(keepRuntimeArtifacts, 'KeepRuntimeArtifacts');
        }
    }

    // ---------------------------------------------------------------------------
    // Execute uninstall operations
    // ---------------------------------------------------------------------------

    // TASK.md
    if (!keepTaskFileValue) {
        if (!restoreItemFromInitializationBackup('TASK.md')) {
            removeManagedFile('TASK.md');
        }
    }

    // Entrypoint files
    for (const rel of ENTRYPOINT_FILES) {
        if (keepPrimaryEntrypointValue && canonicalEntrypoint && rel.toLowerCase() === canonicalEntrypoint.toLowerCase()) {
            continue;
        }
        if (!restoreItemFromInitializationBackup(rel)) {
            removeManagedFile(rel);
        }
    }

    // Provider agent files + skill bridge files
    for (const rel of [...PROVIDER_AGENT_FILES, ...GITHUB_SKILL_BRIDGE_FILES]) {
        if (!restoreItemFromInitializationBackup(rel)) {
            removeManagedFile(rel);
        }
    }

    // Qwen settings
    if (!restoreItemFromInitializationBackup(QWEN_SETTINGS_RELATIVE)) {
        cleanupQwenSettings(qwenManagedEntries);
    }
    // Claude local settings
    if (!restoreItemFromInitializationBackup(CLAUDE_LOCAL_SETTINGS_RELATIVE)) {
        cleanupClaudeLocalSettings();
    }
    // Commit guard hook
    if (!restoreItemFromInitializationBackup(PRE_COMMIT_HOOK_RELATIVE)) {
        cleanupCommitGuardHook();
    }
    // Gitignore
    if (!restoreItemFromInitializationBackup('.gitignore')) {
        cleanupGitignore();
    }

    // Remove bundle directory (with backup and runtime preservation)
    removeBundleDirectory();

    return {
        targetRoot: normalizedTarget,
        orchestratorRoot,
        initAnswersPath: initAnswersCandidatePath,
        initializationBackupRoot: initBackupRoot || '<none>',
        canonicalEntrypoint: canonicalEntrypoint || '<unknown>',
        keepPrimaryEntrypoint: keepPrimaryEntrypointValue,
        keepTaskFile: keepTaskFileValue,
        keepRuntimeArtifacts: keepRuntimeArtifactsValue,
        dryRun,
        skipBackups,
        backupRoot: backupRoot || '<none>',
        preservedRuntimePath: preservedRuntimePath || '<none>',
        filesUpdated: updatedFiles,
        filesDeleted: deletedFiles,
        filesRestored: restoredFiles,
        directoriesDeleted: deletedDirectories,
        itemsBackedUp,
        warningsCount: warnings.length,
        warnings,
        result: dryRun ? 'DRY_RUN' : 'SUCCESS'
    };
}

module.exports = {
    CLAUDE_LOCAL_SETTINGS_RELATIVE,
    ENTRYPOINT_FILES,
    GITIGNORE_MANAGED_COMMENT,
    GITIGNORE_MANAGED_ENTRIES,
    GITHUB_SKILL_BRIDGE_FILES,
    PRE_COMMIT_HOOK_RELATIVE,
    PROVIDER_AGENT_FILES,
    QWEN_SETTINGS_RELATIVE,
    parseBooleanAnswer,
    runUninstall
};
