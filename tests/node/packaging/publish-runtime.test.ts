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

test('published runtime works when the package is executed from node_modules', () => {
    const repoRoot = getRepoRoot();
    const buildResult = buildPublishRuntime();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-publish-runtime-'));
    const packageRoot = path.join(tempRoot, 'node_modules', 'octopus-agent-orchestrator');
    const workspaceRoot = path.join(tempRoot, 'workspace');

    try {
        assert.ok(fs.existsSync(path.join(buildResult.buildRoot, 'src', 'index.js')));

        fs.mkdirSync(packageRoot, { recursive: true });
        fs.mkdirSync(workspaceRoot, { recursive: true });

        fs.cpSync(path.join(repoRoot, 'bin'), path.join(packageRoot, 'bin'), { recursive: true });
        fs.cpSync(path.join(repoRoot, 'dist'), path.join(packageRoot, 'dist'), { recursive: true });
        fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(packageRoot, 'package.json'));
        fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(packageRoot, 'VERSION'));

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
