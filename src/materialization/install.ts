const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const { ensureDirectory, pathExists, readTextFile, writeTextFile } = require('../core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../core/json.ts');
const { normalizeLineEndings } = require('../core/line-endings.ts');
const { isPathInsideRoot, resolvePathInsideRoot } = require('../core/paths.ts');
const { validateInitAnswers } = require('../schemas/init-answers.ts');
const {
    getCanonicalEntrypointFile,
    getActiveAgentEntrypointFiles,
    convertActiveAgentEntrypointFilesToString,
    getProviderOrchestratorProfileDefinitions,
    getGitHubSkillBridgeProfileDefinitions
} = require('./common.ts');
const {
    MANAGED_START,
    MANAGED_END,
    COMMIT_GUARD_START,
    COMMIT_GUARD_END,
    INSTALL_BACKUP_CANDIDATE_PATHS,
    extractManagedBlockFromContent,
    buildTaskManagedBlockWithExistingQueue,
    buildCanonicalManagedBlock,
    buildRedirectManagedBlock,
    buildCommitGuardManagedBlock,
    buildProviderOrchestratorAgentContent,
    buildGitHubSkillBridgeAgentContent,
    buildQwenSettingsContent,
    buildClaudeLocalSettingsContent,
    buildGitignoreEntries,
    syncManagedBlockInContent
} = require('./content-builders.ts');

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs the install materialization pipeline.
 * This is the main entry point for porting install.ps1 to Node/TS.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root directory
 * @param {string} options.bundleRoot - Orchestrator bundle directory
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.preserveExisting=true]
 * @param {boolean} [options.alignExisting=true]
 * @param {boolean} [options.runInit=true]
 * @param {boolean} [options.answerDependentOnly=false]
 * @param {boolean} [options.skipBackups=false]
 * @param {string} options.assistantLanguage
 * @param {string} options.assistantBrevity
 * @param {string} options.sourceOfTruth
 * @param {string} options.initAnswersPath
 * @param {Function} [options.initRunner] - Optional callback to run init
 * @returns {object} Install result metrics
 */
function runInstall(options) {
    const {
        targetRoot,
        bundleRoot,
        dryRun = false,
        preserveExisting = true,
        alignExisting = true,
        runInit = true,
        answerDependentOnly = false,
        skipBackups = false,
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        initAnswersPath,
        initRunner
    } = options;

    const sourceRoot = path.join(bundleRoot, 'template');

    // Validate template directory
    if (!pathExists(sourceRoot)) {
        throw new Error(`Template directory not found: ${sourceRoot}`);
    }

    // Validate target root doesn't point to bundle
    const normalizedTarget = path.resolve(targetRoot);
    const normalizedBundle = path.resolve(bundleRoot);
    if (normalizedTarget.toLowerCase() === normalizedBundle.toLowerCase()) {
        throw new Error(
            `TargetRoot points to orchestrator bundle directory '${bundleRoot}'. Use the project root parent directory instead.`
        );
    }

    // Validate and normalize parameters
    const trimmedLanguage = (assistantLanguage || '').trim();
    if (!trimmedLanguage) {
        throw new Error('AssistantLanguage must not be empty.');
    }
    const trimmedBrevity = (assistantBrevity || '').trim().toLowerCase();
    const trimmedSourceOfTruth = (sourceOfTruth || '').trim();

    // Read and validate init answers
    const resolvedInitPath = resolvePathInsideRoot(targetRoot, initAnswersPath);
    if (!pathExists(resolvedInitPath)) {
        throw new Error(`Init answers file not found: ${resolvedInitPath}`);
    }

    const initAnswersRaw = readJsonFile(resolvedInitPath);
    const initAnswers = validateInitAnswers(initAnswersRaw);

    // Cross-validate parameters vs init answers
    if (initAnswers.AssistantLanguage.toLowerCase() !== trimmedLanguage.toLowerCase()) {
        throw new Error(
            `AssistantLanguage parameter '${trimmedLanguage}' does not match init answers artifact value '${initAnswers.AssistantLanguage}'.`
        );
    }
    if (initAnswers.AssistantBrevity !== trimmedBrevity) {
        throw new Error(
            `AssistantBrevity parameter '${trimmedBrevity}' does not match init answers artifact value '${initAnswers.AssistantBrevity}'.`
        );
    }
    if (initAnswers.SourceOfTruth.toUpperCase().replace(/\s+/g, '') !== trimmedSourceOfTruth.toUpperCase().replace(/\s+/g, '')) {
        throw new Error(
            `SourceOfTruth parameter '${trimmedSourceOfTruth}' does not match init answers artifact value '${initAnswers.SourceOfTruth}'.`
        );
    }

    const enforceNoAutoCommit = initAnswers.EnforceNoAutoCommit;
    const enableClaudeOrchestratorFullAccess = initAnswers.ClaudeOrchestratorFullAccess;
    const tokenEconomyEnabled = initAnswers.TokenEconomyEnabled;

    const canonicalEntryFile = getCanonicalEntrypointFile(initAnswers.SourceOfTruth);
    const activeEntryFilesSeed = initAnswers.ActiveAgentFiles
        ? initAnswers.ActiveAgentFiles.join(', ')
        : null;
    let activeEntryFiles = getActiveAgentEntrypointFiles(activeEntryFilesSeed, initAnswers.SourceOfTruth);
    if (activeEntryFiles.length === 0) {
        activeEntryFiles = [canonicalEntryFile];
    }
    const redirectEntryFiles = activeEntryFiles.filter((f) => f !== canonicalEntryFile);

    const providerOrchestratorProfiles = getProviderOrchestratorProfileDefinitions().filter(
        (p) => activeEntryFiles.includes(p.entrypointFile)
    );
    const githubSkillBridgeProfiles = activeEntryFiles.includes('.github/copilot-instructions.md')
        ? getGitHubSkillBridgeProfileDefinitions()
        : [];
    const providerBridgePaths = providerOrchestratorProfiles.map((p) => p.orchestratorRelativePath);

    // Setup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15).replace('T', '-');
    const backupRoot = path.join(bundleRoot, 'runtime', 'backups', timestamp);
    const deploymentDate = new Date().toISOString().slice(0, 10);
    const bundleVersionPath = path.join(bundleRoot, 'VERSION');
    const liveVersionPath = path.join(bundleRoot, 'live', 'version.json');

    if (!pathExists(bundleVersionPath)) {
        throw new Error(`Bundle version file not found: ${bundleVersionPath}`);
    }
    const bundleVersion = readTextFile(bundleVersionPath).trim();
    if (!bundleVersion) {
        throw new Error(`Bundle version file is empty: ${bundleVersionPath}`);
    }

    // Counters
    let deployed = 0;
    let backedUp = 0;
    let skippedExisting = 0;
    let aligned = 0;
    let forcedOverwrites = 0;
    let initInvoked = false;
    let commitGuardHookUpdated = false;
    const backedUpSet = new Set();

    // Pre-existing file tracking
    const preExistingPaths = INSTALL_BACKUP_CANDIDATE_PATHS
        .filter((p) => pathExists(path.join(targetRoot, p)))
        .sort();

    // Backup manifest
    if (!skipBackups && !dryRun && preExistingPaths.length > 0) {
        const manifestDir = path.dirname(path.join(backupRoot, '_install-backup.manifest.json'));
        ensureDirectory(manifestDir);
        writeJsonFile(path.join(backupRoot, '_install-backup.manifest.json'), {
            Version: 1,
            CreatedAt: timestamp,
            PreExistingFiles: preExistingPaths
        });
    }

    // Backup helper
    function backupFile(destPath, relativePath) {
        if (skipBackups || !pathExists(destPath)) return;
        const key = relativePath.toLowerCase().replace(/\\/g, '/');
        if (backedUpSet.has(key)) return;
        if (!dryRun) {
            const backupPath = path.join(backupRoot, relativePath);
            ensureDirectory(path.dirname(backupPath));
            fs.copyFileSync(destPath, backupPath);
        }
        backedUp++;
        backedUpSet.add(key);
    }

    // Sync managed block into a file on disk
    function syncManagedBlockOnDisk(destPath, relativePath, managedBlock) {
        if (!pathExists(destPath)) return false;
        const content = readTextFile(destPath);
        const result = syncManagedBlockInContent(content, managedBlock);
        if (!result.changed) return false;
        backupFile(destPath, relativePath);
        if (!dryRun) {
            fs.writeFileSync(destPath, result.content, 'utf8');
        }
        return true;
    }

    // Apply entrypoint managed block
    function applyEntrypointManagedBlock(relativePath, managedBlock) {
        const destPath = path.join(targetRoot, relativePath);
        const destDir = path.dirname(destPath);
        if (!pathExists(destPath)) {
            if (!dryRun) {
                ensureDirectory(destDir);
                fs.writeFileSync(destPath, managedBlock + '\r\n', 'utf8');
            }
            deployed++;
            return;
        }
        if (syncManagedBlockOnDisk(destPath, relativePath, managedBlock)) {
            aligned++;
        }
    }

    // Template content with placeholder replacements
    function getTemplateContent(sourcePath, relativePath) {
        if (!pathExists(sourcePath)) return null;
        let content = readTextFile(sourcePath);
        if (!content || !content.trim()) return null;
        const norm = relativePath.replace(/\\/g, '/');
        if (norm === 'TASK.md') {
            content = content.replace(/\{\{DEPLOYMENT_DATE\}\}/g, deploymentDate);
            content = content.replace(/\{\{CANONICAL_ENTRYPOINT\}\}/g, canonicalEntryFile);
        }
        return content;
    }

    // Deploy exact files
    const exactFiles = ['TASK.md'];
    if (!answerDependentOnly) {
        for (const relPath of exactFiles) {
            const sourcePath = path.join(sourceRoot, relPath);
            if (!pathExists(sourcePath)) continue;
            const destPath = path.join(targetRoot, relPath);
            const destDir = path.dirname(destPath);
            if (!pathExists(destDir) && !dryRun) {
                ensureDirectory(destDir);
            }

            if (pathExists(destPath)) {
                if (preserveExisting) {
                    skippedExisting++;
                    if (relPath === 'TASK.md') {
                        const templateContent = getTemplateContent(sourcePath, relPath);
                        const existingContent = readTextFile(destPath);
                        const taskBlock = buildTaskManagedBlockWithExistingQueue(templateContent, existingContent);
                        if (taskBlock) {
                            if (syncManagedBlockOnDisk(destPath, relPath, taskBlock)) {
                                aligned++;
                            }
                        }
                    }
                    continue;
                }
                backupFile(destPath, relPath);
            }

            const content = getTemplateContent(sourcePath, relPath);
            if (content && !dryRun) {
                fs.writeFileSync(destPath, content, 'utf8');
            }
            deployed++;
        }
    } else {
        // Answer-dependent only: just sync TASK.md managed block
        const taskSourcePath = path.join(sourceRoot, 'TASK.md');
        const taskDestPath = path.join(targetRoot, 'TASK.md');

        if (pathExists(taskSourcePath)) {
            if (pathExists(taskDestPath)) {
                const templateContent = getTemplateContent(taskSourcePath, 'TASK.md');
                const existingContent = readTextFile(taskDestPath);
                const taskBlock = buildTaskManagedBlockWithExistingQueue(templateContent, existingContent);
                if (taskBlock) {
                    if (syncManagedBlockOnDisk(taskDestPath, 'TASK.md', taskBlock)) {
                        aligned++;
                    }
                }
            } else {
                if (!dryRun) {
                    ensureDirectory(path.dirname(taskDestPath));
                    const content = getTemplateContent(taskSourcePath, 'TASK.md');
                    if (content) {
                        fs.writeFileSync(taskDestPath, content, 'utf8');
                    }
                }
                deployed++;
            }
        }
    }

    // Apply canonical entrypoint managed block
    const templateClaudeContent = readTextFile(path.join(sourceRoot, 'CLAUDE.md'));
    const canonicalBlock = buildCanonicalManagedBlock(canonicalEntryFile, templateClaudeContent);
    applyEntrypointManagedBlock(canonicalEntryFile, canonicalBlock);

    // Apply redirect entrypoint managed blocks
    for (const redirectFile of redirectEntryFiles) {
        const redirectBlock = buildRedirectManagedBlock(redirectFile, canonicalEntryFile, providerBridgePaths);
        applyEntrypointManagedBlock(redirectFile, redirectBlock);
    }

    // Qwen settings
    const qwenRelPath = '.qwen/settings.json';
    const qwenPath = path.join(targetRoot, qwenRelPath);
    let qwenExisting = null;
    if (pathExists(qwenPath)) {
        qwenExisting = readTextFile(qwenPath);
    }
    const qwenPlan = buildQwenSettingsContent(qwenExisting, ['TASK.md', canonicalEntryFile]);
    let qwenUpdated = false;

    if (pathExists(qwenPath)) {
        if (!preserveExisting || qwenPlan.needsUpdate) {
            backupFile(qwenPath, qwenRelPath);
            if (!dryRun) {
                ensureDirectory(path.dirname(qwenPath));
                fs.writeFileSync(qwenPath, qwenPlan.content, 'utf8');
            }
            qwenUpdated = true;
            if (preserveExisting) aligned++;
            else deployed++;
        }
    } else {
        if (!dryRun) {
            ensureDirectory(path.dirname(qwenPath));
            fs.writeFileSync(qwenPath, qwenPlan.content, 'utf8');
        }
        qwenUpdated = true;
        deployed++;
    }

    // Claude local settings
    const claudeRelPath = '.claude/settings.local.json';
    const claudePath = path.join(targetRoot, claudeRelPath);
    let claudeExisting = null;
    if (pathExists(claudePath)) {
        claudeExisting = readTextFile(claudePath);
    }
    const claudePlan = buildClaudeLocalSettingsContent(claudeExisting, enableClaudeOrchestratorFullAccess);
    let claudeUpdated = false;
    let claudeParseMode = claudePlan.parseMode;
    let claudeNeedsUpdate = claudePlan.needsUpdate;

    if (enableClaudeOrchestratorFullAccess) {
        if (pathExists(claudePath)) {
            if (!preserveExisting || claudePlan.needsUpdate) {
                backupFile(claudePath, claudeRelPath);
                if (!dryRun) {
                    ensureDirectory(path.dirname(claudePath));
                    fs.writeFileSync(claudePath, claudePlan.content, 'utf8');
                }
                claudeUpdated = true;
                if (preserveExisting) aligned++;
                else deployed++;
            }
        } else {
            if (!dryRun) {
                ensureDirectory(path.dirname(claudePath));
                fs.writeFileSync(claudePath, claudePlan.content, 'utf8');
            }
            claudeUpdated = true;
            deployed++;
        }
    } else {
        claudeParseMode = 'disabled_by_init_answer';
        claudeNeedsUpdate = false;
    }

    // Provider orchestrator profiles
    for (const profile of providerOrchestratorProfiles) {
        const block = buildProviderOrchestratorAgentContent(
            profile.providerLabel, canonicalEntryFile, profile.orchestratorRelativePath
        );
        applyEntrypointManagedBlock(profile.orchestratorRelativePath, block);
    }

    // GitHub skill bridge profiles
    for (const profile of githubSkillBridgeProfiles) {
        const block = buildGitHubSkillBridgeAgentContent(
            profile.profileTitle, canonicalEntryFile,
            profile.skillPath, profile.reviewRequirement, profile.capabilityFlag
        );
        applyEntrypointManagedBlock(profile.relativePath, block);
    }

    // Gitignore
    const gitignoreEntryList = buildGitignoreEntries(
        activeEntryFiles, providerOrchestratorProfiles, enableClaudeOrchestratorFullAccess
    );
    let gitignoreAdded = 0;
    const gitignorePath = path.join(targetRoot, '.gitignore');
    if (!dryRun) {
        if (!pathExists(gitignorePath)) {
            fs.writeFileSync(gitignorePath, '', 'utf8');
        }
        const existingLines = readTextFile(gitignorePath).split(/\r?\n/);
        const appendLines = gitignoreEntryList.filter((e) => !existingLines.includes(e));
        if (appendLines.length > 0) {
            const appendContent = '\n# Octopus-agent-orchestrator managed ignores\n' + appendLines.join('\n') + '\n';
            fs.appendFileSync(gitignorePath, appendContent, 'utf8');
            gitignoreAdded = appendLines.length;
        }
    } else {
        if (pathExists(gitignorePath)) {
            const existingLines = readTextFile(gitignorePath).split(/\r?\n/);
            gitignoreAdded = gitignoreEntryList.filter((e) => !existingLines.includes(e)).length;
        } else {
            gitignoreAdded = gitignoreEntryList.length;
        }
    }

    // Commit guard hook
    commitGuardHookUpdated = applyCommitGuardHook(targetRoot, enforceNoAutoCommit, dryRun, backupFile);

    // Run init if requested
    if (runInit && !dryRun && initRunner) {
        initRunner({
            targetRoot,
            assistantLanguage: trimmedLanguage,
            assistantBrevity: trimmedBrevity,
            sourceOfTruth: initAnswers.SourceOfTruth,
            enforceNoAutoCommit,
            tokenEconomyEnabled
        });
        initInvoked = true;
    }

    // Write live/version.json
    let liveVersionWritten = false;
    if (!dryRun) {
        ensureDirectory(path.dirname(liveVersionPath));
        writeJsonFile(liveVersionPath, {
            Version: bundleVersion,
            UpdatedAt: new Date().toISOString(),
            SourceOfTruth: initAnswers.SourceOfTruth,
            CanonicalEntrypoint: canonicalEntryFile,
            ActiveAgentFiles: convertActiveAgentEntrypointFilesToString(activeEntryFiles),
            AssistantLanguage: trimmedLanguage,
            AssistantBrevity: trimmedBrevity,
            EnforceNoAutoCommit: enforceNoAutoCommit,
            ClaudeOrchestratorFullAccess: enableClaudeOrchestratorFullAccess,
            TokenEconomyEnabled: tokenEconomyEnabled,
            InitAnswersPath: resolvedInitPath
        });
        liveVersionWritten = true;
    }

    return {
        targetRoot: normalizedTarget,
        templateRoot: sourceRoot,
        preserveExisting,
        alignExisting,
        runInit,
        answerDependentOnly,
        skipBackups,
        initAnswersPath: resolvedInitPath,
        deploymentDate,
        bundleVersion,
        assistantLanguage: trimmedLanguage,
        assistantBrevity: trimmedBrevity,
        sourceOfTruth: initAnswers.SourceOfTruth,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess: enableClaudeOrchestratorFullAccess,
        tokenEconomyEnabled,
        canonicalEntrypoint: canonicalEntryFile,
        activeAgentFiles: convertActiveAgentEntrypointFilesToString(activeEntryFiles),
        filesDeployed: deployed,
        filesForcedOverwrite: forcedOverwrites,
        filesSkippedExisting: skippedExisting,
        filesAligned: aligned,
        filesBackedUp: backedUp,
        gitignoreEntriesAdded: gitignoreAdded,
        qwenSettingsParseMode: qwenPlan.parseMode,
        qwenSettingsNeedsUpdate: qwenPlan.needsUpdate,
        qwenSettingsUpdated: qwenUpdated,
        claudeLocalSettingsParseMode: claudeParseMode,
        claudeLocalSettingsNeedsUpdate: claudeNeedsUpdate,
        claudeLocalSettingsUpdated: claudeUpdated,
        initInvoked,
        preCommitHookUpdated: commitGuardHookUpdated,
        liveVersionWritten,
        backupRoot: dryRun ? null : backupRoot
    };
}

/**
 * Applies or removes the commit guard pre-commit hook.
 */
function applyCommitGuardHook(targetRoot, enabled, dryRun, backupFile) {
    const gitDirPath = path.join(targetRoot, '.git');
    if (!pathExists(gitDirPath)) {
        if (enabled) {
            throw new Error(
                `EnforceNoAutoCommit=true but .git directory is missing at '${gitDirPath}'. Initialize git or set EnforceNoAutoCommit=false in init answers.`
            );
        }
        return false;
    }

    const hookPath = path.join(targetRoot, '.git', 'hooks', 'pre-commit');
    const managedBlock = buildCommitGuardManagedBlock();
    const pattern = new RegExp(
        `${escapeRegex(COMMIT_GUARD_START)}[\\s\\S]*?${escapeRegex(COMMIT_GUARD_END)}`, 'm'
    );

    if (!pathExists(hookPath)) {
        if (!enabled) return false;
        if (!dryRun) {
            ensureDirectory(path.dirname(hookPath));
            const hookContent = '#!/usr/bin/env bash\n\n' + managedBlock + '\n';
            fs.writeFileSync(hookPath, hookContent, 'utf8');
        }
        return true;
    }

    let content = readTextFile(hookPath);
    content = normalizeLineEndings(content, '\n');
    let updatedContent;

    if (enabled) {
        if (pattern.test(content)) {
            updatedContent = content.replace(pattern, managedBlock);
        } else if (!content.trim()) {
            updatedContent = '#!/usr/bin/env bash\n\n' + managedBlock + '\n';
        } else {
            updatedContent = content.trimEnd() + '\n\n' + managedBlock + '\n';
        }
    } else {
        if (pattern.test(content)) {
            updatedContent = content.replace(pattern, '').trimEnd() + '\n';
        } else {
            return false;
        }
    }

    if (updatedContent === content) return false;

    if (backupFile) {
        backupFile(hookPath, '.git/hooks/pre-commit');
    }
    if (!dryRun) {
        fs.writeFileSync(hookPath, updatedContent, 'utf8');
    }
    return true;
}

module.exports = {
    applyCommitGuardHook,
    runInstall
};
