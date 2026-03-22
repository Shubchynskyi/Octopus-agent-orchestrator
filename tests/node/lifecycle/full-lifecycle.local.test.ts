const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRuntimeModule(relativeModulePath) {
    const basePath = path.resolve(__dirname, relativeModulePath);
    const candidates = [`${basePath}.ts`, `${basePath}.js`];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(`Cannot resolve runtime module for '${relativeModulePath}'.`);
}

const {
    COMMIT_GUARD_START,
    MANAGED_START,
    MANAGED_END
} = require(resolveRuntimeModule('../../../src/materialization/content-builders'));
const { runReinit } = require(resolveRuntimeModule('../../../src/materialization/reinit'));
const { runUpdate } = require(resolveRuntimeModule('../../../src/lifecycle/update'));
const { runUninstall } = require(resolveRuntimeModule('../../../src/lifecycle/uninstall'));

function findRepoRoot() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'VERSION')) && fs.existsSync(path.join(dir, 'template'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    throw new Error('Cannot find repo root');
}

function createRepoLocalWorkspace(repoRoot, prefix) {
    const baseDir = path.join(repoRoot, 'runtime', 'test-workspaces');
    fs.mkdirSync(baseDir, { recursive: true });
    return fs.mkdtempSync(path.join(baseDir, `${prefix}-`));
}

function writeTextFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listChildDirectories(parentDir) {
    if (!fs.existsSync(parentDir)) return [];
    return fs.readdirSync(parentDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function seedLegacyWorkspace(workspaceRoot) {
    const legacyFiles = new Map([
        ['AGENTS.md', '# User AGENTS\n\nLegacy user instructions.\n'],
        ['TASK.md', '# User Tasks\n\n- Keep this original task list.\n'],
        ['.gitignore', 'node_modules/\n.custom-cache/\n'],
        ['.qwen/settings.json', JSON.stringify({
            context: { fileName: ['README.md'] },
            userSetting: true
        }, null, 2)],
        ['.claude/settings.local.json', JSON.stringify({
            permissions: { allow: ['Bash(git status:*)'] }
        }, null, 2)],
        ['.git/hooks/pre-commit', '#!/usr/bin/env bash\necho "user hook"\n']
    ]);

    for (const [relativePath, content] of legacyFiles) {
        writeTextFile(path.join(workspaceRoot, relativePath), content);
    }

    return legacyFiles;
}

async function runInteractiveSetup(repoRoot, workspaceRoot, answers) {
    const cliHelpersPath = resolveRuntimeModule('../../../src/cli/commands/cli-helpers');
    const setupPath = resolveRuntimeModule('../../../src/cli/commands/setup');
    const cliHelpers = require(cliHelpersPath);
    const originals = {
        supportsInteractivePrompts: cliHelpers.supportsInteractivePrompts,
        promptTextInput: cliHelpers.promptTextInput,
        promptSingleSelect: cliHelpers.promptSingleSelect
    };
    const promptTrace = [];
    const output = [];
    const selectValues = [
        answers.assistantBrevity,
        answers.sourceOfTruth,
        answers.enforceNoAutoCommit ? 'true' : 'false',
        answers.claudeOrchestratorFullAccess ? 'true' : 'false',
        answers.tokenEconomyEnabled ? 'true' : 'false'
    ];
    let selectIndex = 0;
    const packageJson = readJson(path.join(repoRoot, 'package.json'));
    const originalConsoleLog = console.log;

    delete require.cache[setupPath];
    cliHelpers.supportsInteractivePrompts = function () { return true; };
    cliHelpers.promptTextInput = async function (title) {
        promptTrace.push(title);
        return answers.assistantLanguage;
    };
    cliHelpers.promptSingleSelect = async function (config) {
        promptTrace.push(config.title);
        const value = selectValues[selectIndex];
        selectIndex += 1;
        assert.ok(config.options.some((option) => option.value === value), `Unexpected prompt value '${value}' for '${config.title}'.`);
        return value;
    };
    console.log = function (...args) {
        output.push(args.map((value) => String(value)).join(' '));
    };

    try {
        const { handleSetup } = require(setupPath);
        await handleSetup(
            ['--target-root', workspaceRoot, '--skip-verify', '--skip-manifest-validation'],
            packageJson,
            repoRoot
        );
    } finally {
        console.log = originalConsoleLog;
        cliHelpers.supportsInteractivePrompts = originals.supportsInteractivePrompts;
        cliHelpers.promptTextInput = originals.promptTextInput;
        cliHelpers.promptSingleSelect = originals.promptSingleSelect;
        delete require.cache[setupPath];
    }

    return { promptTrace, output };
}

function injectBundleUpdate(bundleRoot, updateMarker, nextVersion) {
    const versionPath = path.join(bundleRoot, 'VERSION');
    const templateClaudePath = path.join(bundleRoot, 'template', 'CLAUDE.md');
    const currentTemplate = fs.readFileSync(templateClaudePath, 'utf8');
    const updatedTemplate = currentTemplate.replace(
        MANAGED_END,
        `Update marker: ${updateMarker}\r\n${MANAGED_END}`
    );

    fs.writeFileSync(versionPath, `${nextVersion}\n`, 'utf8');
    fs.writeFileSync(templateClaudePath, updatedTemplate, 'utf8');
}

describe('full local lifecycle', () => {
    const repoRoot = findRepoRoot();

    it('runs setup, reinit, update, and uninstall entirely inside the repository', async () => {
        const workspaceRoot = createRepoLocalWorkspace(repoRoot, 'oao-full-lifecycle');
        const legacyFiles = seedLegacyWorkspace(workspaceRoot);
        const setupAnswers = {
            assistantLanguage: 'Russian',
            assistantBrevity: 'detailed',
            sourceOfTruth: 'Codex',
            enforceNoAutoCommit: true,
            claudeOrchestratorFullAccess: true,
            tokenEconomyEnabled: false
        };

        try {
            const { promptTrace, output } = await runInteractiveSetup(repoRoot, workspaceRoot, setupAnswers);
            const bundleRoot = path.join(workspaceRoot, 'Octopus-agent-orchestrator');
            const initAnswersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
            const setupOutput = output.join('\n');

            assert.deepEqual(promptTrace, [
                'Set communication language',
                'Set default response brevity',
                'Set primary source-of-truth entrypoint',
                'Set no-auto-commit guard mode',
                'Set Claude access level for orchestrator files',
                'Set default token economy mode'
            ]);

            const persistedAnswers = readJson(initAnswersPath);
            assert.equal(persistedAnswers.AssistantLanguage, 'Russian');
            assert.equal(persistedAnswers.AssistantBrevity, 'detailed');
            assert.equal(persistedAnswers.SourceOfTruth, 'Codex');
            assert.equal(persistedAnswers.EnforceNoAutoCommit, 'true');
            assert.equal(persistedAnswers.ClaudeOrchestratorFullAccess, 'true');
            assert.equal(persistedAnswers.TokenEconomyEnabled, 'false');
            assert.equal(persistedAnswers.CollectedVia, 'CLI_INTERACTIVE');
            assert.equal(persistedAnswers.ActiveAgentFiles, 'AGENTS.md');

            assert.ok(fs.existsSync(bundleRoot));
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live', 'version.json')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, 'AGENTS.md')));
            assert.ok(!fs.existsSync(path.join(workspaceRoot, 'CLAUDE.md')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, 'TASK.md')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.qwen', 'settings.json')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.claude', 'settings.local.json')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.git', 'hooks', 'pre-commit')));
            assert.ok(setupOutput.includes('Primary setup finished. Next stage: agent initialization.'));
            assert.ok(setupOutput.includes('Agent Initialization'));
            assert.ok(setupOutput.includes('Give your agent:'));
            assert.ok(!setupOutput.includes('Workspace is ready.'));

            const installedAgents = fs.readFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'utf8');
            const installedTask = fs.readFileSync(path.join(workspaceRoot, 'TASK.md'), 'utf8');
            const installedGitignore = fs.readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8');
            const installedQwen = readJson(path.join(workspaceRoot, '.qwen', 'settings.json'));
            const installedClaude = readJson(path.join(workspaceRoot, '.claude', 'settings.local.json'));
            const installedHook = fs.readFileSync(path.join(workspaceRoot, '.git', 'hooks', 'pre-commit'), 'utf8');

            assert.ok(installedAgents.includes(MANAGED_START));
            assert.ok(!installedAgents.includes('Legacy user instructions.'));
            assert.ok(installedTask.includes(MANAGED_START));
            assert.ok(!installedTask.includes('Keep this original task list.'));
            assert.ok(installedGitignore.includes('.custom-cache/'));
            assert.ok(installedGitignore.includes('# Octopus-agent-orchestrator managed ignores'));
            assert.ok(installedQwen.context.fileName.includes('README.md'));
            assert.ok(installedQwen.context.fileName.includes('AGENTS.md'));
            assert.ok(installedClaude.permissions.allow.includes('Bash(git status:*)'));
            assert.ok(installedHook.includes('user hook'));
            assert.ok(installedHook.includes(COMMIT_GUARD_START));

            const installBackupsRoot = path.join(bundleRoot, 'runtime', 'backups');
            const installBackupDirs = listChildDirectories(installBackupsRoot);
            assert.equal(installBackupDirs.length, 1);
            const installBackupManifest = readJson(
                path.join(installBackupsRoot, installBackupDirs[0], '_install-backup.manifest.json')
            );
            const preExistingFiles = new Set(
                (installBackupManifest.PreExistingFiles || []).map((item) => String(item).replace(/\\/g, '/').toLowerCase())
            );
            for (const relativePath of legacyFiles.keys()) {
                assert.ok(
                    preExistingFiles.has(relativePath.replace(/\\/g, '/').toLowerCase()),
                    `Missing '${relativePath}' in initial backup manifest.`
                );
            }

            const reinitResult = runReinit({
                targetRoot: workspaceRoot,
                bundleRoot,
                initAnswersPath: 'Octopus-agent-orchestrator/runtime/init-answers.json',
                overrides: {
                    AssistantLanguage: 'English',
                    AssistantBrevity: 'concise',
                    SourceOfTruth: 'Codex',
                    EnforceNoAutoCommit: 'false',
                    ClaudeOrchestratorFullAccess: 'false',
                    TokenEconomyEnabled: 'true'
                },
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(reinitResult.assistantLanguage, 'English');
            assert.equal(reinitResult.assistantBrevity, 'concise');
            assert.equal(reinitResult.tokenEconomyEnabled, true);

            const reinitAnswers = readJson(initAnswersPath);
            assert.equal(reinitAnswers.AssistantLanguage, 'English');
            assert.equal(reinitAnswers.AssistantBrevity, 'concise');
            assert.equal(reinitAnswers.EnforceNoAutoCommit, 'false');
            assert.equal(reinitAnswers.ClaudeOrchestratorFullAccess, 'false');
            assert.equal(reinitAnswers.TokenEconomyEnabled, 'true');

            const coreRulePath = path.join(bundleRoot, 'live', 'docs', 'agent-rules', '00-core.md');
            const tokenEconomyPath = path.join(bundleRoot, 'live', 'config', 'token-economy.json');
            assert.ok(fs.readFileSync(coreRulePath, 'utf8').includes('English'));
            assert.equal(readJson(tokenEconomyPath).enabled, true);

            const updateMarker = 'UPDATED_FROM_LOCAL_LIFECYCLE_TEST';
            injectBundleUpdate(bundleRoot, updateMarker, '1.0.9');

            const updateResult = runUpdate({
                targetRoot: workspaceRoot,
                bundleRoot,
                initAnswersPath: 'Octopus-agent-orchestrator/runtime/init-answers.json',
                skipVerify: true,
                skipManifestValidation: true
            });

            assert.equal(updateResult.installStatus, 'PASS');
            assert.equal(updateResult.rollbackStatus, 'NOT_TRIGGERED');
            assert.ok(fs.existsSync(path.join(workspaceRoot, updateResult.updateReportPath)));
            assert.ok(fs.readFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'utf8').includes(updateMarker));

            const liveVersion = readJson(path.join(bundleRoot, 'live', 'version.json'));
            assert.equal(liveVersion.Version, '1.0.9');

            const uninstallResult = runUninstall({
                targetRoot: workspaceRoot,
                bundleRoot,
                initAnswersPath: 'Octopus-agent-orchestrator/runtime/init-answers.json',
                keepPrimaryEntrypoint: false,
                keepTaskFile: false,
                keepRuntimeArtifacts: false
            });

            assert.equal(uninstallResult.result, 'SUCCESS');
            assert.ok(fs.existsSync(uninstallResult.backupRoot));
            assert.ok(!fs.existsSync(bundleRoot));
            assert.ok(fs.existsSync(path.join(workspaceRoot, 'Octopus-agent-orchestrator-uninstall-backups')));

            for (const [relativePath, originalContent] of legacyFiles) {
                const restoredPath = path.join(workspaceRoot, relativePath);
                assert.ok(fs.existsSync(restoredPath), `Expected restored file '${relativePath}'.`);
                assert.equal(fs.readFileSync(restoredPath, 'utf8'), originalContent);
            }
        } finally {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });
});
