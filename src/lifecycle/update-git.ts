const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../core/constants.ts');
const {
    DEFAULT_GIT_CLONE_TIMEOUT_MS,
    DEFAULT_GIT_TIMEOUT_MS,
    spawnStreamed,
    spawnSyncWithTimeout
} = require('../core/subprocess.ts');
const { removePathRecursive } = require('./common.ts');
const { runCheckUpdate } = require('./check-update.ts');
const { validateGitSourceTrust } = require('./update-trust.ts');
const {
    classifyGitDiagnostic,
    createLifecycleDiagnosticError
} = require('./update-diagnostics.ts');
const { registerTempRoot } = require('../cli/signal-handler.ts');

const DEFAULT_GIT_UPDATE_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';

function buildGitCloneArgs(repoUrl, branch, destinationPath) {
    const args = ['clone', '--depth', '1'];
    if (branch) {
        args.push('--branch', String(branch).trim(), '--single-branch');
    }
    args.push(String(repoUrl).trim(), destinationPath);
    return args;
}

function ensureGitAvailable() {
    const result = spawnSyncWithTimeout('git', ['--version'], {
        stdio: 'pipe',
        timeoutMs: DEFAULT_GIT_TIMEOUT_MS
    });
    if (result.error || result.status !== 0) {
        const detailText = result.error ? (result.error.message || String(result.error)) : '';
        throw createLifecycleDiagnosticError({
            message: 'git is required for update git workflow.',
            tool: 'git',
            code: 'GIT_NOT_AVAILABLE',
            sourceReference: 'git',
            stderr: result.stderr,
            stdout: result.stdout,
            detailText
        });
    }
}

async function cloneGitUpdateSource(repoUrl, branch) {
    ensureGitAvailable();

    const tempClonePath = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-update-git-'));
    const disposeSignalCleanup = registerTempRoot(tempClonePath);
    const diagnosticSource = branch ? `${repoUrl}#${branch}` : repoUrl;
    const cloneResult = await spawnStreamed('git', buildGitCloneArgs(repoUrl, branch, tempClonePath), {
        timeoutMs: DEFAULT_GIT_CLONE_TIMEOUT_MS,
        onStderr(chunk) { process.stderr.write(chunk); }
    });

    if (cloneResult.timedOut) {
        disposeSignalCleanup();
        removePathRecursive(tempClonePath);
        throw createLifecycleDiagnosticError({
            message: `git clone timed out after ${DEFAULT_GIT_CLONE_TIMEOUT_MS} ms for '${repoUrl}'.`,
            tool: 'git',
            code: 'GIT_TIMEOUT',
            sourceReference: diagnosticSource,
            stderr: cloneResult.stderr,
            stdout: cloneResult.stdout
        });
    }

    if (cloneResult.exitCode !== 0) {
        disposeSignalCleanup();
        removePathRecursive(tempClonePath);
        const diagnosticText = `${String(cloneResult.stderr || '')}\n${String(cloneResult.stdout || '')}`;
        throw createLifecycleDiagnosticError({
            message: `Failed to clone git update source '${repoUrl}'.`,
            tool: 'git',
            code: classifyGitDiagnostic(diagnosticText),
            sourceReference: diagnosticSource,
            stderr: cloneResult.stderr,
            stdout: cloneResult.stdout
        });
    }

    return {
        clonePath: tempClonePath,
        cleanup() {
            disposeSignalCleanup();
            removePathRecursive(tempClonePath);
        }
    };
}

async function runUpdateFromGit(options) {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json'),
        repoUrl = DEFAULT_GIT_UPDATE_REPO_URL,
        branch = null,
        checkOnly = false,
        noPrompt = true,
        dryRun = false,
        skipVerify = false,
        skipManifestValidation = false,
        trustOverride = false,
        updateRunner = null
    } = options;

    const normalizedRepoUrl = String(repoUrl || DEFAULT_GIT_UPDATE_REPO_URL).trim();
    const normalizedBranch = branch ? String(branch).trim() : null;

    const trustResult = validateGitSourceTrust(normalizedRepoUrl, { trustOverride });

    const gitSource = await cloneGitUpdateSource(normalizedRepoUrl, normalizedBranch);

    try {
        const result = await runCheckUpdate({
            targetRoot,
            bundleRoot,
            initAnswersPath,
            sourcePath: gitSource.clonePath,
            diagnosticSourceReference: normalizedBranch ? `${normalizedRepoUrl}#${normalizedBranch}` : normalizedRepoUrl,
            diagnosticTool: 'git',
            apply: !checkOnly,
            noPrompt,
            dryRun,
            skipVerify,
            skipManifestValidation,
            trustOverride: true,
            updateRunner
        });

        return {
            ...result,
            sourceType: 'git',
            sourceReference: normalizedRepoUrl,
            sourcePath: null,
            repoUrl: normalizedRepoUrl,
            branch: normalizedBranch,
            trustPolicy: trustResult.policy
        };
    } finally {
        gitSource.cleanup();
    }
}

module.exports = {
    DEFAULT_GIT_UPDATE_REPO_URL,
    buildGitCloneArgs,
    cloneGitUpdateSource,
    runUpdateFromGit
};
