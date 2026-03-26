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
    getRepoRoot
} = require(path.join(findRepoRoot(__dirname), 'scripts', 'node-foundation', 'build.ts'));

function loadPackFixtureItems(repoRoot) {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const items = new Set(pkgJson.files || []);
    items.delete('dist');
    items.add('package.json');
    items.add('scripts/node-foundation');
    return Array.from(items).sort();
}

function copyPackFixture(repoRoot, fixtureRoot) {
    fs.mkdirSync(fixtureRoot, { recursive: true });
    for (const relativePath of loadPackFixtureItems(repoRoot)) {
        fs.cpSync(path.join(repoRoot, relativePath), path.join(fixtureRoot, relativePath), { recursive: true });
    }
}

function buildPublishRuntimeInRepo(repoRoot) {
    const result = childProcess.spawnSync(
        process.execPath,
        [
            '--input-type=commonjs',
            '--eval',
            "require.extensions['.ts']=require.extensions['.js'];require(process.argv[1]).runPublishRuntimeBuild()",
            './scripts/node-foundation/build.ts'
        ],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            timeout: 120_000
        }
    );

    if (result.status !== 0) {
        throw new Error(`publish runtime build failed:\n${result.stderr || result.stdout}`);
    }
}

function npmPack(repoRoot) {
    // Build dist/ explicitly in an isolated fixture repo so this smoke test
    // does not race with other packaging tests that also materialize dist/.
    buildPublishRuntimeInRepo(repoRoot);

    const npmExe = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = childProcess.spawnSync(
        npmExe,
        ['pack', '--ignore-scripts', '--pack-destination', repoRoot],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            timeout: 120_000,
            shell: true
        }
    );

    if (result.status !== 0) {
        throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`);
    }

    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const tarballFilename = lines[lines.length - 1].trim();
    return tarballFilename;
}

function npmInstallTarball(tarballPath, installDir) {
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(
        path.join(installDir, 'package.json'),
        JSON.stringify({ name: 'oao-smoke-test', version: '0.0.0', private: true }, null, 2),
        'utf8'
    );

    const npmExe = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = childProcess.spawnSync(
        npmExe,
        ['install', '--no-fund', '--no-audit', '--no-progress', tarballPath],
        {
            cwd: installDir,
            encoding: 'utf8',
            timeout: 120_000,
            shell: true
        }
    );

    if (result.status !== 0) {
        throw new Error(`npm install failed:\n${result.stderr || result.stdout}`);
    }
}

function runCli(cliScriptPath, args, cwd) {
    return childProcess.spawnSync(
        process.execPath,
        [cliScriptPath, ...args],
        {
            cwd,
            encoding: 'utf8',
            timeout: 30_000
        }
    );
}

test('npm pack -> install -> CLI invoke smoke test', () => {
    const repoRoot = getRepoRoot();
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const expectedVersion = packageJson.version;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-pack-smoke-'));
    const fixtureRoot = path.join(tempRoot, 'pack-repo');
    const installRoot = path.join(tempRoot, 'install-root');

    try {
        copyPackFixture(repoRoot, fixtureRoot);

        const tarballFilename = npmPack(fixtureRoot);
        const tarballPath = path.join(fixtureRoot, tarballFilename);

        assert.ok(fs.existsSync(tarballPath), `Tarball not found at ${tarballPath}`);

        npmInstallTarball(tarballPath, installRoot);

        const installedPackageRoot = path.join(installRoot, 'node_modules', 'octopus-agent-orchestrator');
        assert.ok(fs.existsSync(installedPackageRoot), 'Installed package root must exist');

        const cliScript = path.join(installedPackageRoot, 'bin', 'octopus.js');
        assert.ok(fs.existsSync(cliScript), 'bin/octopus.js must be present in installed package');

        // 1. Compiled dist/ must be present (prepack build result)
        assert.ok(
            fs.existsSync(path.join(installedPackageRoot, 'dist', 'src', 'index.js')),
            'dist/src/index.js must exist in the installed package'
        );

        // 2. --version prints the correct version
        const versionResult = runCli(cliScript, ['--version'], installRoot);
        assert.equal(versionResult.status, 0, `--version failed: ${versionResult.stderr}`);
        assert.match(versionResult.stdout.trim(), new RegExp(`^${expectedVersion.replace(/\./g, '\\.')}$`));

        // 3. --help prints usage information
        const helpResult = runCli(cliScript, ['--help'], installRoot);
        assert.equal(helpResult.status, 0, `--help failed: ${helpResult.stderr}`);
        assert.match(helpResult.stdout, /Usage:/);
        assert.match(helpResult.stdout, /setup/);

        // 4. status command works against a bare workspace (exercises compiled runtime)
        const workspaceRoot = path.join(installRoot, 'workspace');
        fs.mkdirSync(workspaceRoot, { recursive: true });
        const statusResult = runCli(cliScript, ['status', '--target-root', workspaceRoot], workspaceRoot);
        assert.equal(statusResult.status, 0, `status failed: ${statusResult.stderr || statusResult.stdout}`);
        assert.match(statusResult.stdout, /OCTOPUS_STATUS/);

        // 5. No TypeScript stripping warnings from node_modules
        const combinedOutput = [
            versionResult.stdout, versionResult.stderr,
            helpResult.stdout, helpResult.stderr,
            statusResult.stdout, statusResult.stderr
        ].join('\n');
        assert.doesNotMatch(
            combinedOutput,
            /Stripping types is currently unsupported for files under node_modules/i,
            'CLI must not produce TypeScript stripping warnings from node_modules'
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
