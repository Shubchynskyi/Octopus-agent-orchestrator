const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findRepoRoot(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        const buildScriptPath = path.join(current, 'scripts', 'node-foundation', 'build.ts');
        const packageJsonPath = path.join(current, 'package.json');
        if (fs.existsSync(buildScriptPath) && fs.existsSync(packageJsonPath)) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(`Could not resolve repository root from: ${startDir}`);
        }
        current = parent;
    }
}

if (!require.extensions['.ts']) {
    require.extensions['.ts'] = require.extensions['.js'];
}

const {
    buildPublishRuntime,
    getRepoRoot
} = require(path.join(findRepoRoot(__dirname), 'scripts', 'node-foundation', 'build.ts'));

// Derive published package surface from the package.json files whitelist (single source of truth).
// npm always includes package.json itself in published packages.
function loadPackageSurfaceItems(repoRoot) {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const items = Array.from(pkgJson.files || []);
    if (!items.includes('package.json')) {
        items.push('package.json');
    }
    return Object.freeze(items.sort());
}

const PACKAGE_SURFACE_ITEMS = loadPackageSurfaceItems(findRepoRoot(__dirname));

function copyPublishedPackageSurface(repoRoot, packageRoot) {
    fs.mkdirSync(packageRoot, { recursive: true });
    for (const relativePath of PACKAGE_SURFACE_ITEMS) {
        fs.cpSync(path.join(repoRoot, relativePath), path.join(packageRoot, relativePath), { recursive: true });
    }
}

function writeTextFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('published runtime works when the package is executed from node_modules', () => {
    const repoRoot = getRepoRoot();
    const buildResult = buildPublishRuntime();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-publish-runtime-'));
    const packageRoot = path.join(tempRoot, 'node_modules', 'octopus-agent-orchestrator');
    const workspaceRoot = path.join(tempRoot, 'workspace');

    try {
        assert.ok(fs.existsSync(path.join(buildResult.buildRoot, 'src', 'index.js')));

        copyPublishedPackageSurface(repoRoot, packageRoot);
        fs.mkdirSync(workspaceRoot, { recursive: true });

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(packageRoot, 'bin', 'octopus.js'), 'status', '--target-root', workspaceRoot],
            {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }
        );

        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /OCTOPUS_STATUS/);
        assert.doesNotMatch(
            `${result.stdout}\n${result.stderr}`,
            /Stripping types is currently unsupported for files under node_modules/i
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('published runtime setup stays in agent handoff state and uninstall restores legacy files', () => {
    const repoRoot = getRepoRoot();
    buildPublishRuntime();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-publish-lifecycle-'));
    const packageRoot = path.join(tempRoot, 'node_modules', 'octopus-agent-orchestrator');
    const workspaceRoot = path.join(tempRoot, 'workspace');

    const legacyFiles = new Map([
        ['AGENTS.md', '# Legacy AGENTS\n\nUser-owned instructions.\n'],
        ['TASK.md', '# Legacy TASK\n\n- user backlog\n'],
        ['.gitignore', 'node_modules/\n.custom-cache/\n'],
        ['.qwen/settings.json', JSON.stringify({
            context: { fileName: ['README.md'] },
            userSetting: true
        }, null, 2)]
    ]);

    try {
        copyPublishedPackageSurface(repoRoot, packageRoot);
        fs.mkdirSync(workspaceRoot, { recursive: true });
        for (const [relativePath, content] of legacyFiles) {
            writeTextFile(path.join(workspaceRoot, relativePath), content);
        }

        const setupResult = childProcess.spawnSync(
            process.execPath,
            [
                path.join(packageRoot, 'bin', 'octopus.js'),
                'setup',
                '--target-root', workspaceRoot,
                '--no-prompt',
                '--assistant-language', 'English',
                '--assistant-brevity', 'concise',
                '--source-of-truth', 'Codex',
                '--enforce-no-auto-commit', 'false',
                '--claude-orchestrator-full-access', 'false',
                '--token-economy-enabled', 'true'
            ],
            {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }
        );

        assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
        assert.match(setupResult.stdout, /Primary setup finished\. Next stage: agent initialization\./);
        assert.doesNotMatch(setupResult.stdout, /Workspace is ready\./);
        assert.match(setupResult.stdout, /Give your agent:/);

        const initAnswersPath = path.join(workspaceRoot, 'Octopus-agent-orchestrator', 'runtime', 'init-answers.json');
        const initAnswers = readJson(initAnswersPath);
        assert.equal(initAnswers.SourceOfTruth, 'Codex');
        assert.equal(initAnswers.CollectedVia, 'CLI_NONINTERACTIVE');
        assert.equal(initAnswers.ActiveAgentFiles, 'AGENTS.md');

        assert.ok(fs.existsSync(path.join(workspaceRoot, 'AGENTS.md')));
        assert.ok(!fs.existsSync(path.join(workspaceRoot, 'CLAUDE.md')));

        const uninstallResult = childProcess.spawnSync(
            process.execPath,
            [path.join(packageRoot, 'bin', 'octopus.js'), 'uninstall', '--target-root', workspaceRoot],
            {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }
        );

        assert.equal(uninstallResult.status, 0, uninstallResult.stderr || uninstallResult.stdout);
        assert.ok(!fs.existsSync(path.join(workspaceRoot, 'Octopus-agent-orchestrator')));

        for (const [relativePath, originalContent] of legacyFiles) {
            const restoredPath = path.join(workspaceRoot, relativePath);
            assert.ok(fs.existsSync(restoredPath), `Expected restored file: ${relativePath}`);
            assert.equal(fs.readFileSync(restoredPath, 'utf8'), originalContent);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
