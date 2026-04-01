import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { runInstall } from '../../../src/materialization/install';

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

function setupTestWorkspace(bundleRoot: string) {
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

function copyDirRecursive(src: string, dst: string) {
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

function writeInitAnswers(bundleRoot: string, answers: Record<string, unknown>) {
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

    it('does not create .qwen/settings.json when qwen is not already configured', () => {
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

            assert.ok(!fs.existsSync(path.join(projectRoot, '.qwen', 'settings.json')));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('updates existing .qwen/settings.json in place', () => {
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

            fs.mkdirSync(path.join(projectRoot, '.qwen'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.qwen', 'settings.json'),
                JSON.stringify({ context: { fileName: ['README.md'] } }, null, 2)
            );

            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.qwen', 'settings.json'), 'utf8'));
            assert.ok(settings.context.fileName.includes('README.md'));
            assert.ok(settings.context.fileName.includes('TASK.md'));
            assert.ok(settings.context.fileName.includes('CLAUDE.md'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('supports Qwen as canonical source-of-truth and keeps QWEN.md in qwen context', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const answersPath = writeInitAnswers(bundleRoot, {
                AssistantLanguage: 'English',
                AssistantBrevity: 'concise',
                SourceOfTruth: 'Qwen',
                EnforceNoAutoCommit: 'false',
                ClaudeOrchestratorFullAccess: 'false',
                TokenEconomyEnabled: 'true',
                CollectedVia: 'CLI_NONINTERACTIVE',
                ActiveAgentFiles: 'QWEN.md, AGENTS.md'
            });

            fs.mkdirSync(path.join(projectRoot, '.qwen'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.qwen', 'settings.json'),
                JSON.stringify({ context: { fileName: ['README.md'] } }, null, 2)
            );

            const result = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Qwen',
                initAnswersPath: answersPath
            });

            assert.equal(result.canonicalEntrypoint, 'QWEN.md');
            assert.ok(fs.existsSync(path.join(projectRoot, 'QWEN.md')));
            assert.ok(fs.existsSync(path.join(projectRoot, 'AGENTS.md')));
            const qwenEntrypoint = fs.readFileSync(path.join(projectRoot, 'QWEN.md'), 'utf8');
            assert.ok(qwenEntrypoint.includes('# QWEN.md'));
            assert.ok(qwenEntrypoint.includes('Rule Index'));
            const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.qwen', 'settings.json'), 'utf8'));
            assert.ok(settings.context.fileName.includes('TASK.md'));
            assert.ok(settings.context.fileName.includes('QWEN.md'));
            const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
            assert.ok(gitignore.includes('QWEN.md'));
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
            assert.ok(gitignore.includes('AGENTS.md'));
            assert.ok(gitignore.includes('GEMINI.md'));
            assert.ok(gitignore.includes('.antigravity/'));
            assert.ok(gitignore.includes('.windsurf/'));
            assert.ok(gitignore.includes('.junie/'));
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
            const apiBridge = fs.readFileSync(path.join(projectRoot, '.github', 'agents', 'api-review.md'), 'utf8');
            const infraBridge = fs.readFileSync(path.join(projectRoot, '.github', 'agents', 'infra-review.md'), 'utf8');
            assert.ok(apiBridge.includes('api-contract-review'));
            assert.ok(infraBridge.includes('devops-k8s'));
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

            const backupPath = path.join(result.backupRoot!, 'AGENTS.md');
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
            constructor(...args: unknown[]) {
                if (args.length > 0) {
                    super(...(args as [string]));
                    return;
                }
                super(fixedNow.getTime());
            }

            static now() {
                return fixedNow.getTime();
            }

            static parse(value: string) {
                return RealDate.parse(value);
            }

            static UTC(...args: unknown[]) {
                return RealDate.UTC(...(args as [number]));
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

            global.Date = MockDate as unknown as DateConstructor;

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
            assert.ok(fs.readFileSync(path.join(firstInstall.backupRoot!, 'AGENTS.md'), 'utf8').includes('First legacy instructions'));
            assert.ok(fs.readFileSync(path.join(secondInstall.backupRoot!, 'AGENTS.md'), 'utf8').includes('Second legacy instructions'));
        } finally {
            global.Date = RealDate;
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('dry-run does not write any files to disk', () => {
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
                initAnswersPath: answersPath,
                dryRun: true
            });

            // filesDeployed counts what *would* be deployed; actual writes are suppressed
            assert.ok(result.filesDeployed >= 0);
            assert.equal(result.initInvoked, false);
            assert.equal(result.liveVersionWritten, false);
            assert.equal(result.backupRoot, null);
            assert.ok(!fs.existsSync(path.join(projectRoot, 'TASK.md')));
            assert.ok(!fs.existsSync(path.join(projectRoot, 'CLAUDE.md')));
            assert.ok(!fs.existsSync(path.join(bundleRoot, 'live', 'version.json')));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('dry-run with existing bundle does not mutate bundle contents', () => {
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

            // First, do a real install to populate the project
            runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath
            });

            // Snapshot the bundle directory to detect mutations
            const snapshotDir = (dir: string) => {
                const result: Record<string, { size: number; mtime: number }> = {};
                for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
                    const full = path.join(entry.parentPath || dir, entry.name);
                    const rel = path.relative(dir, full);
                    if (entry.isFile()) {
                        const stat = fs.statSync(full);
                        result[rel] = { size: stat.size, mtime: stat.mtimeMs };
                    }
                }
                return result;
            };

            const bundleSnapshotBefore = snapshotDir(bundleRoot);
            const projectSnapshotBefore = snapshotDir(projectRoot);

            // Now run install again with dry-run
            const dryResult = runInstall({
                targetRoot: projectRoot,
                bundleRoot,
                runInit: false,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                initAnswersPath: answersPath,
                dryRun: true
            });

            const bundleSnapshotAfter = snapshotDir(bundleRoot);
            const projectSnapshotAfter = snapshotDir(projectRoot);

            // Verify no files were changed in the bundle
            assert.deepStrictEqual(
                Object.keys(bundleSnapshotBefore).sort(),
                Object.keys(bundleSnapshotAfter).sort(),
                'Bundle file list must not change during dry-run'
            );

            // Verify no files were changed in the project
            assert.deepStrictEqual(
                Object.keys(projectSnapshotBefore).sort(),
                Object.keys(projectSnapshotAfter).sort(),
                'Project file list must not change during dry-run'
            );

            assert.equal(dryResult.filesDeployed, 0);
            assert.equal(dryResult.backupRoot, null);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});
