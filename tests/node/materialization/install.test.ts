const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runInstall } = require('../../../src/materialization/install.ts');

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

function setupTestWorkspace(bundleRoot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-install-'));

    // Create a mock bundle inside the project root
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });

    // Copy VERSION
    fs.copyFileSync(path.join(bundleRoot, 'VERSION'), path.join(bundle, 'VERSION'));

    // Copy template directory (minimal subset)
    const templateSrc = path.join(bundleRoot, 'template');
    const templateDst = path.join(bundle, 'template');
    copyDirRecursive(templateSrc, templateDst);

    // Create runtime dir for init answers
    const runtimeDir = path.join(bundle, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });

    // Create live dir
    fs.mkdirSync(path.join(bundle, 'live'), { recursive: true });

    // Create .git so commit guard tests pass
    fs.mkdirSync(path.join(tmpDir, '.git', 'hooks'), { recursive: true });

    return { projectRoot: tmpDir, bundleRoot: bundle };
}

function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

function writeInitAnswers(bundleRoot, answers) {
    const answersPath = path.join(bundleRoot, 'runtime', 'init-answers.json');
    fs.mkdirSync(path.dirname(answersPath), { recursive: true });
    fs.writeFileSync(answersPath, JSON.stringify(answers, null, 2));
    return answersPath;
}

describe('runInstall', () => {
    const repoRoot = findRepoRoot();

    it('deploys TASK.md and creates entrypoint files', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(result.filesDeployed >= 1);
            assert.ok(fs.existsSync(path.join(projectRoot, 'TASK.md')));
            assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.ok(result.liveVersionWritten);
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live', 'version.json')));
            assert.equal(result.canonicalEntrypoint, 'CLAUDE.md');
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates redirect entrypoint for active agent files', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE',
                ActiveAgentFiles: 'CLAUDE.md, AGENTS.md'
            });

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(fs.existsSync(path.join(projectRoot, 'AGENTS.md')));
            const agentsContent = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
            assert.ok(agentsContent.includes('redirect'));
            assert.ok(agentsContent.includes('CLAUDE.md'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates .qwen/settings.json', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(fs.existsSync(path.join(projectRoot, '.qwen', 'settings.json')));
            const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.qwen', 'settings.json'), 'utf8'));
            assert.ok(settings.context.fileName.includes('TASK.md'));
            assert.ok(settings.context.fileName.includes('CLAUDE.md'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('updates .gitignore', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(result.gitignoreEntriesAdded > 0);
            const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
            assert.ok(gitignore.includes('Octopus-agent-orchestrator/'));
            assert.ok(gitignore.includes('TASK.md'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('writes live/version.json with correct metadata', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'Russian',
                AssistantBrevity: 'detailed',
                SourceOfTruth: 'Codex',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'false',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'Russian',
                assistantBrevity: 'detailed',
                sourceOfTruth: 'Codex',
                initAnswersPath: answersPath
            });

            const version = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'live', 'version.json'), 'utf8'));
            assert.equal(version.SourceOfTruth, 'Codex');
            assert.equal(version.CanonicalEntrypoint, 'AGENTS.md');
            assert.equal(version.AssistantLanguage, 'Russian');
            assert.equal(version.AssistantBrevity, 'detailed');
            assert.equal(version.TokenEconomyEnabled, false);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('throws when parameter mismatch with init answers', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            assert.throws(() => runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'Russian',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            }), /does not match/);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('answer-dependent mode only syncs TASK.md managed block', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            // First do a full install
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            // Now run answer-dependent mode
            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                answerDependentOnly: true,
                skipBackups: true,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(result.answerDependentOnly);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates commit guard hook when enforceNoAutoCommit is true', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Claude',
                EnforceNoAutoCommit: 'true',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            assert.ok(result.preCommitHookUpdated);
            const hookContent = fs.readFileSync(
                path.join(projectRoot, '.git', 'hooks', 'pre-commit'), 'utf8'
            );
            assert.ok(hookContent.includes('commit-guard'));
            assert.ok(hookContent.includes('OCTOPUS_ALLOW_COMMIT'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates provider bridges when GitHubCopilot is active', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'GitHubCopilot',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'GitHubCopilot',
                initAnswersPath: answersPath
            });

            assert.ok(fs.existsSync(path.join(projectRoot, '.github', 'agents', 'orchestrator.md')));
            assert.ok(fs.existsSync(path.join(projectRoot, '.github', 'agents', 'code-review.md')));
            assert.ok(fs.existsSync(path.join(projectRoot, '.github', 'agents', 'reviewer.md')));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('backs up and fully replaces conflicting legacy entrypoint files', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const legacyEntrypointPath = path.join(projectRoot, 'AGENTS.md');
            fs.writeFileSync(
                legacyEntrypointPath,
                '# Legacy agent instructions\n\nDo not overwrite this file in place.\n',
                'utf8'
            );

            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Codex',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Codex',
                initAnswersPath: answersPath
            });

            const installedContent = fs.readFileSync(legacyEntrypointPath, 'utf8');
            assert.ok(installedContent.includes('Octopus-agent-orchestrator:managed-start'));
            assert.ok(!installedContent.includes('Legacy agent instructions'));

            const backupPath = path.join(result.backupRoot, 'AGENTS.md');
            assert.ok(fs.existsSync(backupPath));
            assert.ok(fs.readFileSync(backupPath, 'utf8').includes('Legacy agent instructions'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates unique backup roots when multiple installs happen in the same timestamp window', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        const RealDate = Date;
        const fixedNow = new RealDate('2026-03-22T12:00:00.123Z');

        class MockDate extends RealDate {
            constructor(...args) {
                if (args.length > 0) {
                    super(...args);
                    return;
                }
                super(fixedNow.getTime());
            }

            static now() {
                return fixedNow.getTime();
            }

            static parse(value) {
                return RealDate.parse(value);
            }

            static UTC(...args) {
                return RealDate.UTC(...args);
            }
        }

        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Codex',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE'
            });

            global.Date = MockDate;

            const legacyEntrypointPath = path.join(projectRoot, 'AGENTS.md');
            fs.writeFileSync(legacyEntrypointPath, '# First legacy instructions\n', 'utf8');
            const firstInstall = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Codex',
                initAnswersPath: answersPath
            });

            fs.writeFileSync(legacyEntrypointPath, '# Second legacy instructions\n', 'utf8');
            const secondInstall = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Codex',
                initAnswersPath: answersPath
            });

            assert.notEqual(firstInstall.backupRoot, secondInstall.backupRoot);
            assert.ok(fs.readFileSync(path.join(firstInstall.backupRoot, 'AGENTS.md'), 'utf8').includes('First legacy instructions'));
            assert.ok(fs.readFileSync(path.join(secondInstall.backupRoot, 'AGENTS.md'), 'utf8').includes('Second legacy instructions'));
        } finally {
            global.Date = RealDate;
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});
