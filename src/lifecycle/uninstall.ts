import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ALL_AGENT_ENTRYPOINT_FILES,
    BOOLEAN_TRUE_VALUES,
    BOOLEAN_FALSE_VALUES,
    DEFAULT_BUNDLE_NAME
} from '../core/constants';
import { pathExists, readTextFile } from '../core/fs';
import { detectLineEnding } from '../core/line-endings';
import { readJsonFile } from '../core/json';
import { getActiveAgentEntrypointFiles, getCanonicalEntrypointFile, getManagedGitignoreEntries } from '../materialization/common';
import {
    MANAGED_START,
    MANAGED_END,
    COMMIT_GUARD_START,
    COMMIT_GUARD_END,
    CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES
} from '../materialization/content-builders';
import {
    copyPathRecursive,
    createRollbackSnapshot,
    getTimestamp,
    readUninstallSentinel,
    removePathRecursive,
    removeUninstallSentinel,
    restoreRollbackSnapshot,
    type RollbackRecord,
    validateTargetRoot,
    writeRollbackRecords,
    writeUninstallSentinel
} from './common';

type JsonObject = Record<string, unknown>;

interface EntrypointConfigJson extends JsonObject {
    CanonicalEntrypoint?: unknown;
    SourceOfTruth?: unknown;
    ActiveAgentFiles?: unknown;
}

interface InitializationBackupManifest extends JsonObject {
    PreExistingFiles?: unknown;
    preExistingFiles?: unknown;
}

interface QwenSettingsContext extends JsonObject {
    fileName?: unknown;
}

interface QwenSettings extends JsonObject {
    context?: QwenSettingsContext;
}

interface ClaudeLocalSettingsPermissions extends JsonObject {
    allow?: unknown;
}

interface ClaudeLocalSettings extends JsonObject {
    permissions?: ClaudeLocalSettingsPermissions;
}

interface UninstallTestHooks {
    afterFileCleanup?: () => void;
}

export interface RunUninstallOptions {
    targetRoot: string;
    bundleRoot: string;
    initAnswersPath?: string;
    dryRun?: boolean;
    skipBackups?: boolean;
    noPrompt?: boolean;
    keepPrimaryEntrypoint?: string | boolean | null;
    keepTaskFile?: string | boolean | null;
    keepRuntimeArtifacts?: string | boolean | null;
    _testHooks?: UninstallTestHooks;
}

export interface RunUninstallResult {
    targetRoot: string;
    orchestratorRoot: string;
    initAnswersPath: string;
    initializationBackupRoot: string;
    canonicalEntrypoint: string;
    keepPrimaryEntrypoint: boolean;
    keepTaskFile: boolean;
    keepRuntimeArtifacts: boolean;
    dryRun: boolean;
    skipBackups: boolean;
    backupRoot: string;
    preservedRuntimePath: string;
    preservedProjectMemoryPath: string;
    filesUpdated: number;
    filesDeleted: number;
    filesRestored: number;
    directoriesDeleted: number;
    itemsBackedUp: number;
    rollbackStatus: string;
    warningsCount: number;
    warnings: string[];
    result: 'DRY_RUN' | 'SUCCESS';
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ENTRYPOINT_FILES = Object.freeze([...ALL_AGENT_ENTRYPOINT_FILES]);

export const PROVIDER_AGENT_FILES = Object.freeze([
    '.github/agents/orchestrator.md',
    '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md',
    '.antigravity/agents/orchestrator.md'
]);

export const GITHUB_SKILL_BRIDGE_FILES = Object.freeze([
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

export const QWEN_SETTINGS_RELATIVE = '.qwen/settings.json';
export const CLAUDE_LOCAL_SETTINGS_RELATIVE = '.claude/settings.local.json';
export const PRE_COMMIT_HOOK_RELATIVE = '.git/hooks/pre-commit';

export const GITIGNORE_MANAGED_COMMENT = '# Octopus-agent-orchestrator managed ignores';
export const GITIGNORE_MANAGED_ENTRIES = Object.freeze(getManagedGitignoreEntries(true));

// ---------------------------------------------------------------------------
// Boolean answer parsing (mirrors Convert-ToBooleanAnswer)
// ---------------------------------------------------------------------------

export function parseBooleanAnswer(value: unknown, fieldName: string): boolean {
    if (value === true) return true;
    if (value === false) return false;
    const normalized = String(value).trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
    if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
    throw new Error(`${fieldName} must be one of: true, false, yes, no, 1, 0.`);
}

// ---------------------------------------------------------------------------
// Entrypoint detection helpers
// ---------------------------------------------------------------------------

function getCanonicalEntrypointFromSourceOfTruth(sourceOfTruthValue: unknown): string | null {
    if (!sourceOfTruthValue || !String(sourceOfTruthValue).trim()) return null;
    try {
        return getCanonicalEntrypointFile(String(sourceOfTruthValue));
    } catch (_e) {
        return null;
    }
}

function tryGetCanonicalEntrypointFromJsonFile(filePath: string, preferCanonicalProperty: boolean): string | null {
    if (!pathExists(filePath)) return null;
    let payload: unknown;
    try { payload = readJsonFile(filePath); } catch (_e) { return null; }
    if (!isJsonObject(payload)) return null;

    const config = payload as EntrypointConfigJson;

    if (preferCanonicalProperty && config.CanonicalEntrypoint) {
        const canonical = String(config.CanonicalEntrypoint).trim();
        if (canonical) return canonical;
    }

    if (config.SourceOfTruth) {
        return getCanonicalEntrypointFromSourceOfTruth(String(config.SourceOfTruth));
    }
    return null;
}

function tryGetActiveAgentFilesFromJsonFile(filePath: string, fallbackSourceOfTruth: string | null): string[] {
    if (!pathExists(filePath)) return [];
    let payload: unknown;
    try { payload = readJsonFile(filePath); } catch (_e) { return []; }
    if (!isJsonObject(payload)) return [];

    const config = payload as EntrypointConfigJson;

    const activeAgentFilesRaw = config.ActiveAgentFiles
        ? String(config.ActiveAgentFiles).trim() || null
        : null;

    const sot = config.SourceOfTruth
        ? String(config.SourceOfTruth)
        : fallbackSourceOfTruth || null;

    return getActiveAgentEntrypointFiles(activeAgentFilesRaw, sot);
}

function tryDetectCanonicalEntrypointFromManagedFiles(
    targetRoot: string,
    entrypointFiles: readonly string[]
): string | null {
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

function normalizeTextAfterManagedBlockRemoval(content: string): string {
    if (!content) return '';
    const eol = detectLineEnding(content);
    let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    const trimmed = normalized.trim();
    if (!trimmed) return '';
    return trimmed.split('\n').join(eol);
}

// ---------------------------------------------------------------------------
// Empty directory cleanup
// ---------------------------------------------------------------------------

function removeEmptyDirectoriesUpwards(startDirectory: string, targetRoot: string, dryRun: boolean): number {
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

function getInitializationBackupRoot(orchestratorRoot: string): string | null {
    const installBackupsRoot = path.join(orchestratorRoot, 'runtime', 'backups');
    if (!pathExists(installBackupsRoot)) return null;

    const dirs = fs.readdirSync(installBackupsRoot, { withFileTypes: true })
        .filter((entry: fs.Dirent) => entry.isDirectory())
        .map((entry: fs.Dirent) => entry.name)
        .sort();

    if (dirs.length === 0) return null;
    return path.join(installBackupsRoot, dirs[0]);
}

function getInitializationBackupManifest(backupRoot: string | null): InitializationBackupManifest | null {
    if (!backupRoot) return null;
    const manifestPath = path.join(backupRoot, '_install-backup.manifest.json');
    if (!pathExists(manifestPath)) return null;
    try {
        const manifest = readJsonFile(manifestPath);
        return isJsonObject(manifest) ? manifest as InitializationBackupManifest : null;
    } catch (_e) {
        return null;
    }
}

function isManagedOnlyBackupContent(backupPath: string, managedStart: string, managedEnd: string): boolean {
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

function shouldRestoreItemFromInitializationBackup(
    relativePath: string,
    backupPath: string,
    manifest: InitializationBackupManifest | null,
    managedStart: string,
    managedEnd: string
): boolean {
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

function escapeRegex(text: string): string {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function arrayContainsPath(items: readonly string[], relativePath: string): boolean {
    const normalizedRelative = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
    for (const item of items) {
        if (String(item || '').replace(/\\/g, '/').toLowerCase() === normalizedRelative) {
            return true;
        }
    }
    return false;
}

function looksLikeManagedFileWithoutMarkers(relativePath: string, content: string): boolean {
    const text = String(content || '');
    if (!text.trim()) return false;

    if (arrayContainsPath(ENTRYPOINT_FILES, relativePath)) {
        if (text.includes('Octopus Agent Orchestrator Rule Index') && text.includes('## Rule Routing')) {
            return true;
        }
        if (text.includes('This file is a redirect.') && text.includes('Canonical source of truth for agent workflow rules:')) {
            return true;
        }
    }

    if (String(relativePath || '').replace(/\\/g, '/').toLowerCase() === 'task.md') {
        if (text.includes('Single-file task queue for local agent orchestration.') && text.includes('## Active Queue')) {
            return true;
        }
    }

    if (arrayContainsPath(PROVIDER_AGENT_FILES, relativePath)) {
        if (text.includes('Canonical source of truth for agent workflow rules:') && text.includes('## Required Execution Contract')) {
            return true;
        }
    }

    if (arrayContainsPath(GITHUB_SKILL_BRIDGE_FILES, relativePath)) {
        if (text.includes('Canonical source of truth for agent workflow rules:') && text.includes('## Skill Bridge Contract')) {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Rollback item set for journal-based uninstall
// ---------------------------------------------------------------------------

export function getUninstallRollbackItems(): string[] {
    return [
        'TASK.md',
        ...ENTRYPOINT_FILES,
        ...PROVIDER_AGENT_FILES,
        ...GITHUB_SKILL_BRIDGE_FILES,
        QWEN_SETTINGS_RELATIVE,
        CLAUDE_LOCAL_SETTINGS_RELATIVE,
        PRE_COMMIT_HOOK_RELATIVE,
        '.gitignore'
    ];
}

// ---------------------------------------------------------------------------
// Main uninstall function
// ---------------------------------------------------------------------------

/**
 * Runs the uninstall pipeline.
 * Node implementation of the uninstall lifecycle.
 *
 * @param {object} options
 * @param {string} options.targetRoot
 * @param {string} options.bundleRoot
 * @param {string} [options.initAnswersPath]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.skipBackups=false]
 * @param {string|boolean} [options.keepPrimaryEntrypoint]
 * @param {string|boolean} [options.keepTaskFile]
 * @param {string|boolean} [options.keepRuntimeArtifacts]
 * @returns {object} Uninstall result
 */
export function runUninstall(options: RunUninstallOptions): RunUninstallResult {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        dryRun = false,
        skipBackups = false,
        keepPrimaryEntrypoint,
        keepTaskFile,
        keepRuntimeArtifacts
    } = options;

    const normalizedTarget = validateTargetRoot(targetRoot, bundleRoot);
    const orchestratorRoot = path.join(normalizedTarget, DEFAULT_BUNDLE_NAME);

    // Resolve init answers path (allow missing)
    let initAnswersCandidatePath: string;
    if (path.isAbsolute(initAnswersPath)) {
        initAnswersCandidatePath = initAnswersPath;
    } else {
        initAnswersCandidatePath = path.resolve(normalizedTarget, initAnswersPath);
    }

    const liveVersionPath = path.join(orchestratorRoot, 'live', 'version.json');
    const timestamp = getTimestamp();

    // State tracking
    let backupRoot: string | null = null;
    const backedUpSet = new Set<string>();
    let itemsBackedUp = 0;
    let deletedFiles = 0;
    let updatedFiles = 0;
    let deletedDirectories = 0;
    let restoredFiles = 0;
    const warnings: string[] = [];
    let preservedRuntimePath: string | null = null;
    let preservedProjectMemoryPath: string | null = null;
    let rollbackSnapshotPath: string | null = null;
    let rollbackRecords: RollbackRecord[] = [];
    let rollbackStatus = 'NOT_NEEDED';
    let currentPhase = 'INIT';
    const journalRoot = path.join(normalizedTarget, `${DEFAULT_BUNDLE_NAME}-uninstall-journal`);

    // Check for interrupted uninstall from a previous run
    if (!dryRun) {
        const existingSentinel = readUninstallSentinel(normalizedTarget);
        if (existingSentinel) {
            warnings.push(
                `Detected interrupted uninstall from ${existingSentinel.startedAt || 'unknown time'}. ` +
                `Previous journal: ${existingSentinel.rollbackSnapshotPath || 'unknown'}. Proceeding with fresh uninstall.`
            );
        }
    }

    // Initialization backup detection
    const initBackupRoot = getInitializationBackupRoot(orchestratorRoot);
    const initBackupManifest = getInitializationBackupManifest(initBackupRoot);

    // ---------------------------------------------------------------------------
    // Internal helpers bound to this uninstall context
    // ---------------------------------------------------------------------------

    function getBackupRoot(): string {
        if (!backupRoot) {
            backupRoot = path.join(normalizedTarget, `${DEFAULT_BUNDLE_NAME}-uninstall-backups`, timestamp);
        }
        return backupRoot;
    }

    function backupItem(itemPath: string, relativePath: string, isDirectory: boolean, forcePreserve: boolean): void {
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

    function addWarning(message: string): void {
        warnings.push(message);
    }

    function updateOrRemoveFile(filePath: string, relativePath: string, content: string): void {
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

    function removeManagedFile(relativePath: string): void {
        const filePath = path.join(normalizedTarget, relativePath);
        if (!pathExists(filePath)) return;

        const content = readTextFile(filePath);
        const pattern = new RegExp(
            escapeRegex(MANAGED_START) + '[\\s\\S]*?' + escapeRegex(MANAGED_END),
            ''
        );

        if (!pattern.test(content)) {
            if (looksLikeManagedFileWithoutMarkers(relativePath, content)) {
                updateOrRemoveFile(filePath, relativePath, '');
                return;
            }
            addWarning(`Skipping '${relativePath}' because it no longer contains Octopus managed block markers.`);
            return;
        }

        const updatedContent = content.replace(pattern, '');
        const normalized = normalizeTextAfterManagedBlockRemoval(updatedContent);
        updateOrRemoveFile(filePath, relativePath, normalized);
    }

    function getInitBackupPath(relativePath: string): string | null {
        if (!initBackupRoot) return null;
        const bp = path.join(initBackupRoot, relativePath);
        if (!fs.existsSync(bp)) return null;
        return bp;
    }

    function restoreItemFromInitializationBackup(relativePath: string): boolean {
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
            const backupItemStats = fs.lstatSync(bp);
            if (fs.existsSync(destinationPath)) {
                const destItem = fs.lstatSync(destinationPath);
                if (destItem.isDirectory() !== backupItemStats.isDirectory()) {
                    removePathRecursive(destinationPath);
                }
            }
            if (backupItemStats.isDirectory()) {
                removePathRecursive(destinationPath);
                copyPathRecursive(bp, destinationPath);
            } else {
                fs.copyFileSync(bp, destinationPath);
            }
        }

        restoredFiles++;
        return true;
    }

    function cleanupQwenSettings(qwenManagedEntries: readonly string[]): void {
        const filePath = path.join(normalizedTarget, QWEN_SETTINGS_RELATIVE);
        if (!pathExists(filePath)) return;

        let settings: unknown;
        try {
            settings = readJsonFile(filePath);
        } catch (_e) {
            addWarning(`Skipping '${QWEN_SETTINGS_RELATIVE}' because it is no longer valid JSON.`);
            return;
        }

        if (!isJsonObject(settings)) {
            addWarning(`Skipping '${QWEN_SETTINGS_RELATIVE}' because its JSON root is no longer an object.`);
            return;
        }

        const qwenSettings = settings as QwenSettings;
        if (!qwenSettings.context || typeof qwenSettings.context !== 'object') return;

        const context = qwenSettings.context as QwenSettingsContext;

        const currentEntries = Array.isArray(context.fileName)
            ? context.fileName
                .filter((entry: unknown) => entry && String(entry).trim())
                .map((entry: unknown) => String(entry).trim())
            : [];

        const managedSet = new Set<string>(qwenManagedEntries);
        const updatedEntries = currentEntries.filter((entry: string) => !managedSet.has(entry));

        if (updatedEntries.length === currentEntries.length) return;

        const updatedSettings: QwenSettings = { ...qwenSettings };
        const updatedContext: QwenSettingsContext = { ...context };

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

    function cleanupClaudeLocalSettings(): void {
        const filePath = path.join(normalizedTarget, CLAUDE_LOCAL_SETTINGS_RELATIVE);
        if (!pathExists(filePath)) return;

        let settings: unknown;
        try {
            settings = readJsonFile(filePath);
        } catch (_e) {
            addWarning(`Skipping '${CLAUDE_LOCAL_SETTINGS_RELATIVE}' because it is no longer valid JSON.`);
            return;
        }

        if (!isJsonObject(settings)) {
            addWarning(`Skipping '${CLAUDE_LOCAL_SETTINGS_RELATIVE}' because its JSON root is no longer an object.`);
            return;
        }

        const claudeSettings = settings as ClaudeLocalSettings;
        if (!claudeSettings.permissions || typeof claudeSettings.permissions !== 'object') return;

        const permissions = claudeSettings.permissions as ClaudeLocalSettingsPermissions;

        const currentAllowEntries = Array.isArray(permissions.allow)
            ? permissions.allow
                .filter((entry: unknown) => entry && String(entry).trim())
                .map((entry: unknown) => String(entry).trim())
            : [];

        const managedSet = new Set<string>([...CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES]);
        const updatedAllowEntries = currentAllowEntries.filter((entry: string) => !managedSet.has(entry));

        if (updatedAllowEntries.length === currentAllowEntries.length) return;

        const updatedSettings: ClaudeLocalSettings = { ...claudeSettings };
        const updatedPermissions: ClaudeLocalSettingsPermissions = { ...permissions };

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

    function cleanupGitignore(): void {
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

    function cleanupCommitGuardHook(): void {
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

    function removeBundleDirectory(): void {
        if (!fs.existsSync(orchestratorRoot) || !fs.lstatSync(orchestratorRoot).isDirectory()) return;

        const keepRuntime = keepRuntimeArtifactsValue;
        const runtimePath = path.join(orchestratorRoot, 'runtime');

        if (keepRuntime && fs.existsSync(runtimePath) && fs.lstatSync(runtimePath).isDirectory()) {
            backupItem(runtimePath, path.join(DEFAULT_BUNDLE_NAME, 'runtime'), true, true);
            preservedRuntimePath = path.join(getBackupRoot(), DEFAULT_BUNDLE_NAME, 'runtime');
        }

        // Preserve project-memory alongside runtime artifacts when requested
        const projectMemoryPath = path.join(orchestratorRoot, 'live', 'docs', 'project-memory');
        if (keepRuntime && fs.existsSync(projectMemoryPath) && fs.lstatSync(projectMemoryPath).isDirectory()) {
            backupItem(projectMemoryPath, path.join(DEFAULT_BUNDLE_NAME, 'live', 'docs', 'project-memory'), true, true);
            preservedProjectMemoryPath = path.join(getBackupRoot(), DEFAULT_BUNDLE_NAME, 'live', 'docs', 'project-memory');
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

    let detectedActiveAgentFiles: string[] = [];
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
    const qwenManagedEntries = [...new Set(['TASK.md', ...detectedActiveAgentFiles])].sort();

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
    // Skip-backups hardening
    // ---------------------------------------------------------------------------

    if (skipBackups) {
        warnings.push(
            '--skip-backups active: no user-facing backup will be created. ' +
            'Recovery after successful completion is not possible.'
        );
        if (!keepRuntimeArtifactsValue) {
            warnings.push(
                '--skip-backups with keepRuntimeArtifacts=no: runtime artifacts ' +
                '(reports, logs, rollback snapshots) will be permanently deleted.'
            );
        }
    }

    // ---------------------------------------------------------------------------
    // Create rollback snapshot and sentinel (journal)
    // ---------------------------------------------------------------------------

    if (!dryRun) {
        currentPhase = 'SNAPSHOT';
        rollbackSnapshotPath = path.join(journalRoot, timestamp);
        const rollbackItems = getUninstallRollbackItems();
        rollbackRecords = createRollbackSnapshot(
            normalizedTarget, rollbackSnapshotPath, rollbackItems
        );
        writeRollbackRecords(rollbackSnapshotPath, rollbackRecords);

        currentPhase = 'SENTINEL';
        writeUninstallSentinel(normalizedTarget, {
            startedAt: new Date().toISOString(),
            operation: 'uninstall',
            rollbackSnapshotPath,
            timestamp,
            skipBackups,
            keepPrimaryEntrypoint: keepPrimaryEntrypointValue,
            keepTaskFile: keepTaskFileValue,
            keepRuntimeArtifacts: keepRuntimeArtifactsValue
        });
    }

    // ---------------------------------------------------------------------------
    // Execute uninstall operations (journaled)
    // ---------------------------------------------------------------------------

    try {
        currentPhase = 'CLEANUP_FILES';

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

        // Test hook: allow tests to inject a failure between file cleanup and bundle removal
        if (options._testHooks && typeof options._testHooks.afterFileCleanup === 'function') {
            options._testHooks.afterFileCleanup();
        }

        currentPhase = 'CLEANUP_BUNDLE';
        // Remove bundle directory (with backup and runtime preservation)
        removeBundleDirectory();

        currentPhase = 'FINALIZE';

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (!dryRun && rollbackSnapshotPath && rollbackRecords.length > 0) {
            try {
                restoreRollbackSnapshot(
                    normalizedTarget, rollbackSnapshotPath, rollbackRecords
                );
                rollbackStatus = 'RESTORED';
            } catch (rollbackError: unknown) {
                const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
                rollbackStatus = `FAILED: ${rollbackMsg}`;
                throw new Error(
                    `Uninstall failed during ${currentPhase}. Original error: ${errorMessage}. ` +
                    `Rollback also failed: ${rollbackMsg}. ` +
                    `Journal preserved at: ${rollbackSnapshotPath}`
                );
            }
            // Rollback succeeded — clean up journal artifacts
            removeUninstallSentinel(normalizedTarget);
            removePathRecursive(journalRoot);

            throw new Error(
                `Uninstall failed during ${currentPhase} and workspace was restored to pre-uninstall state. ` +
                `Error: ${errorMessage}`
            );
        }
        throw error;
    }

    // ---------------------------------------------------------------------------
    // Success: clean up journal artifacts
    // ---------------------------------------------------------------------------

    if (!dryRun) {
        removeUninstallSentinel(normalizedTarget);
        removePathRecursive(journalRoot);
        rollbackStatus = 'NOT_TRIGGERED';
    }

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
        preservedProjectMemoryPath: preservedProjectMemoryPath || '<none>',
        filesUpdated: updatedFiles,
        filesDeleted: deletedFiles,
        filesRestored: restoredFiles,
        directoriesDeleted: deletedDirectories,
        itemsBackedUp,
        rollbackStatus,
        warningsCount: warnings.length,
        warnings,
        result: dryRun ? 'DRY_RUN' : 'SUCCESS'
    };
}
