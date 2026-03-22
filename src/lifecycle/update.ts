const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const { pathExists, readTextFile } = require('../core/fs.ts');
const { readJsonFile } = require('../core/json.ts');
const { isPathInsideRoot } = require('../core/paths.ts');
const { validateInitAnswers } = require('../schemas/init-answers.ts');
const { runInstall } = require('../materialization/install.ts');

const {
    createRollbackSnapshot,
    getTimestamp,
    restoreRollbackSnapshot,
    validateTargetRoot
} = require('./common.ts');

/**
 * Computes the list of relative paths that should be included in an update rollback.
 * Returns the rollback item set for the Node update lifecycle.
 */
function getUpdateRollbackItems(rootPath, initAnswersResolvedPath) {
    const items = [
        'CLAUDE.md',
        'AGENTS.md',
        'GEMINI.md',
        'TASK.md',
        '.claude/settings.local.json',
        '.qwen/settings.json',
        '.github/copilot-instructions.md',
        '.github/agents',
        '.windsurf/rules/rules.md',
        '.windsurf/agents',
        '.junie/guidelines.md',
        '.junie/agents',
        '.antigravity/rules.md',
        '.antigravity/agents',
        '.gitignore',
        '.git/hooks/pre-commit',
        'Octopus-agent-orchestrator/.gitattributes',
        'Octopus-agent-orchestrator/bin',
        'Octopus-agent-orchestrator/live',
        'Octopus-agent-orchestrator/package.json',
        'Octopus-agent-orchestrator/src',
        'Octopus-agent-orchestrator/template',
        'Octopus-agent-orchestrator/README.md',
        'Octopus-agent-orchestrator/HOW_TO.md',
        'Octopus-agent-orchestrator/MANIFEST.md',
        'Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md',
        'Octopus-agent-orchestrator/CHANGELOG.md',
        'Octopus-agent-orchestrator/LICENSE',
        'Octopus-agent-orchestrator/VERSION'
    ];

    // Add the init answers file as a relative path
    const rootResolved = path.resolve(rootPath);
    const answersResolved = path.resolve(initAnswersResolvedPath);
    const rel = path.relative(rootResolved, answersResolved).replace(/\\/g, '/');
    items.push(rel);

    return [...new Set(items)].sort();
}

/**
 * Runs the update pipeline.
 * Node implementation of the update lifecycle.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root directory
 * @param {string} options.bundleRoot - Orchestrator bundle directory (source of scripts/template)
 * @param {string} [options.initAnswersPath]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.skipVerify=false]
 * @param {boolean} [options.skipManifestValidation=false]
 * @param {Function} [options.installRunner] - Optional override for install step
 * @param {Function} [options.verifyRunner] - Optional override for verify step
 * @param {Function} [options.manifestRunner] - Optional override for manifest validation step
 * @param {Function} [options.contractMigrationRunner] - Optional override for contract migration step
 * @returns {object} Update result
 */
function runUpdate(options) {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        dryRun = false,
        skipVerify = false,
        skipManifestValidation = false,
        installRunner = null,
        verifyRunner = null,
        manifestRunner = null,
        contractMigrationRunner = null
    } = options;

    const normalizedTarget = validateTargetRoot(targetRoot, bundleRoot);
    // Resolve init answers path
    let initAnswersResolvedPath;
    if (path.isAbsolute(initAnswersPath)) {
        initAnswersResolvedPath = initAnswersPath;
    } else {
        initAnswersResolvedPath = path.resolve(normalizedTarget, initAnswersPath);
    }

    if (!isPathInsideRoot(normalizedTarget, initAnswersResolvedPath)) {
        throw new Error(`InitAnswersPath must resolve inside target root '${normalizedTarget}'.`);
    }
    if (!pathExists(initAnswersResolvedPath)) {
        throw new Error(`Init answers artifact not found: ${initAnswersResolvedPath}`);
    }

    const initAnswersRaw = readTextFile(initAnswersResolvedPath);
    if (!initAnswersRaw.trim()) {
        throw new Error(`Init answers artifact is empty: ${initAnswersResolvedPath}`);
    }

    let initAnswers;
    try {
        initAnswers = JSON.parse(initAnswersRaw);
    } catch (_e) {
        throw new Error(`Init answers artifact is not valid JSON: ${initAnswersResolvedPath}`);
    }

    // Detect previous version from live/version.json
    const liveVersionPath = path.join(normalizedTarget, DEFAULT_BUNDLE_NAME, 'live', 'version.json');
    let existingLiveVersion = null;
    let previousVersion = 'unknown';
    let previousVersionSource = 'missing';
    if (pathExists(liveVersionPath)) {
        try {
            existingLiveVersion = readJsonFile(liveVersionPath);
            const parsedVersion = existingLiveVersion && existingLiveVersion.Version
                ? String(existingLiveVersion.Version).trim()
                : null;
            if (parsedVersion) {
                previousVersion = parsedVersion;
                previousVersionSource = 'live/version.json';
            } else {
                previousVersionSource = existingLiveVersion && existingLiveVersion.Version !== undefined
                    ? 'live/version.json-empty'
                    : 'live/version.json-no-version-field';
            }
        } catch (_e) {
            previousVersionSource = 'live/version.json-invalid-json';
        }
    }

    // Read bundle version
    const bundleVersionPath = path.join(bundleRoot, 'VERSION');
    if (!pathExists(bundleVersionPath)) {
        throw new Error(`Bundle version file not found: ${bundleVersionPath}`);
    }
    const bundleVersion = readTextFile(bundleVersionPath).trim();
    if (!bundleVersion) {
        throw new Error(`Bundle version file is empty: ${bundleVersionPath}`);
    }

    // Validate required init answer fields
    const validated = validateInitAnswers(initAnswers);
    const assistantLanguage = validated.AssistantLanguage;
    const assistantBrevity = validated.AssistantBrevity;
    const sourceOfTruth = validated.SourceOfTruth;

    const timestamp = getTimestamp();
    const rollbackSnapshotRelativePath = `${DEFAULT_BUNDLE_NAME}/runtime/update-rollbacks/update-${timestamp}`;
    const rollbackSnapshotPath = path.join(normalizedTarget, rollbackSnapshotRelativePath);
    const updateReportRelativePath = `${DEFAULT_BUNDLE_NAME}/runtime/update-reports/update-${timestamp}.md`;
    const updateReportPath = path.join(normalizedTarget, updateReportRelativePath);

    let rollbackSnapshotCreated = false;
    let rollbackRecordCount = 0;
    let rollbackStatus = 'NOT_NEEDED';
    let rollbackRecords = [];

    let installStatus = 'NOT_RUN';
    let contractMigrationStatus = 'NOT_RUN';
    let verifyStatus = 'NOT_RUN';
    let manifestStatus = 'NOT_RUN';
    let updatedVersion = bundleVersion;
    let contractMigrationCount = 0;
    let contractMigrationFiles = [];

    // Create rollback snapshot (not in dry-run)
    if (!dryRun) {
        fs.mkdirSync(path.dirname(rollbackSnapshotPath), { recursive: true });
        const rollbackItems = getUpdateRollbackItems(normalizedTarget, initAnswersResolvedPath);
        rollbackRecords = createRollbackSnapshot(normalizedTarget, rollbackSnapshotPath, rollbackItems);
        rollbackRecordCount = rollbackRecords.length;
        rollbackSnapshotCreated = true;
    }

    let currentStage = 'INSTALL';
    try {
        // Install step
        currentStage = 'INSTALL';
        if (installRunner) {
            installRunner({
                targetRoot: normalizedTarget,
                bundleRoot,
                dryRun,
                assistantLanguage,
                assistantBrevity,
                sourceOfTruth,
                initAnswersPath: initAnswersResolvedPath
            });
        } else {
            runInstall({
                targetRoot: normalizedTarget,
                bundleRoot,
                runInit: false,
                dryRun,
                assistantLanguage,
                assistantBrevity,
                sourceOfTruth,
                initAnswersPath: initAnswersResolvedPath
            });
        }
        installStatus = 'PASS';

        if (dryRun) {
            contractMigrationStatus = 'SKIPPED_DRY_RUN';
            verifyStatus = 'SKIPPED_DRY_RUN';
            manifestStatus = 'SKIPPED_DRY_RUN';
        } else {
            // Contract migrations
            currentStage = 'CONTRACT_MIGRATIONS';
            if (contractMigrationRunner) {
                const migResult = contractMigrationRunner({ rootPath: normalizedTarget });
                contractMigrationCount = migResult.appliedCount || 0;
                contractMigrationFiles = migResult.appliedFiles || [];
            }
            contractMigrationStatus = 'PASS';

            // Verify
            currentStage = 'VERIFY';
            if (skipVerify) {
                verifyStatus = 'SKIPPED';
            } else {
                if (verifyRunner) {
                    verifyRunner({
                        targetRoot: normalizedTarget,
                        sourceOfTruth,
                        initAnswersPath: initAnswersResolvedPath
                    });
                }
                verifyStatus = 'PASS';
            }

            // Manifest validation
            currentStage = 'MANIFEST_VALIDATION';
            if (skipManifestValidation) {
                manifestStatus = 'SKIPPED';
            } else {
                if (manifestRunner) {
                    manifestRunner({ targetRoot: normalizedTarget });
                }
                manifestStatus = 'PASS';
            }

            // Re-read updated version
            if (pathExists(liveVersionPath)) {
                try {
                    const newLiveVersion = readJsonFile(liveVersionPath);
                    if (newLiveVersion && newLiveVersion.Version) {
                        const newParsed = String(newLiveVersion.Version).trim();
                        if (newParsed) updatedVersion = newParsed;
                    }
                } catch (_e) {
                    updatedVersion = 'unknown';
                }
            }
        }
    } catch (error) {
        const errorMessage = error.message || String(error);

        switch (currentStage) {
            case 'INSTALL': installStatus = 'FAIL'; break;
            case 'BUNDLE_SYNC': installStatus = 'FAIL'; break;
            case 'CONTRACT_MIGRATIONS': contractMigrationStatus = 'FAIL'; break;
            case 'VERIFY': verifyStatus = 'FAIL'; break;
            case 'MANIFEST_VALIDATION': manifestStatus = 'FAIL'; break;
        }

        if (!dryRun && rollbackSnapshotCreated) {
            try {
                restoreRollbackSnapshot(normalizedTarget, rollbackSnapshotPath, rollbackRecords);
                rollbackStatus = 'SUCCESS';
            } catch (rollbackError) {
                const rollbackMsg = rollbackError.message || String(rollbackError);
                rollbackStatus = `FAILED: ${rollbackMsg}`;
                throw new Error(`Update failed during ${currentStage}. Original error: ${errorMessage}. Rollback failed: ${rollbackMsg}`);
            }
            throw new Error(`Update failed during ${currentStage} and rollback completed successfully. Original error: ${errorMessage}`);
        }
        throw new Error(`Update failed during ${currentStage}. Error: ${errorMessage}`);
    }

    if (!dryRun && rollbackSnapshotCreated && rollbackStatus === 'NOT_NEEDED') {
        rollbackStatus = 'NOT_TRIGGERED';
    }

    // Generate update report
    if (!dryRun) {
        fs.mkdirSync(path.dirname(updateReportPath), { recursive: true });
        const reportLines = [
            '# Update Report',
            '',
            `GeneratedAt: ${new Date().toISOString()}`,
            `TargetRoot: ${normalizedTarget}`,
            `InitAnswersPath: ${initAnswersResolvedPath}`,
            `RollbackSnapshotPath: ${rollbackSnapshotRelativePath}`,
            `RollbackSnapshotRecordCount: ${rollbackRecordCount}`,
            `RollbackStatus: ${rollbackStatus}`,
            '',
            '## Version',
            `PreviousVersion: ${previousVersion}`,
            `PreviousVersionSource: ${previousVersionSource}`,
            `BundleVersion: ${bundleVersion}`,
            `UpdatedVersion: ${updatedVersion}`,
            '',
            '## CommandStatus',
            `Install: ${installStatus}`,
            `ContractMigrations: ${contractMigrationStatus}`,
            `Verify: ${verifyStatus}`,
            `ManifestValidation: ${manifestStatus}`,
            '',
            '## ContractMigrations',
            `AppliedCount: ${contractMigrationCount}`,
            contractMigrationFiles.length > 0
                ? `AppliedFiles: ${contractMigrationFiles.join(', ')}`
                : 'AppliedFiles: none'
        ];
        fs.writeFileSync(updateReportPath, reportLines.join('\r\n'), 'utf8');
    }

    return {
        targetRoot: normalizedTarget,
        initAnswersPath: initAnswersResolvedPath,
        rollbackSnapshotPath: rollbackSnapshotRelativePath,
        rollbackSnapshotCreated,
        rollbackRecordCount,
        rollbackStatus,
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        previousVersion,
        previousVersionSource,
        bundleVersion,
        updatedVersion,
        installStatus,
        contractMigrationStatus,
        contractMigrationCount,
        contractMigrationFiles,
        verifyStatus,
        manifestValidationStatus: manifestStatus,
        updateReportPath: dryRun ? 'not-generated-in-dry-run' : updateReportRelativePath
    };
}

module.exports = {
    getUpdateRollbackItems,
    runUpdate
};
