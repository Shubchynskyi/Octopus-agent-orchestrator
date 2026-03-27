import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BuildResult {
    buildRoot: string;
    copiedFiles: string[];
    generatedCliPath: string;
    manifestPath: string;
    repoRoot: string;
}

export function getRepoRoot(): string {
    let current = __dirname;
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'VERSION'))) {
            return current;
        }
        current = path.dirname(current);
    }
    throw new Error('Cannot resolve repo root from ' + __dirname);
}

function getNodeEngineRange(): string {
    const pkg: { engines?: { node?: string } } =
        JSON.parse(fs.readFileSync(path.join(getRepoRoot(), 'package.json'), 'utf8'));
    return (pkg.engines && pkg.engines.node) || '>=20.0.0';
}

function collectFiles(rootPath: string, extension: string = '.js'): string[] {
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(entryPath, extension));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(extension)) {
            files.push(entryPath);
        }
    }

    return files.sort();
}

function resetBuildRoot(buildRoot: string): void {
    fs.mkdirSync(buildRoot, { recursive: true });

    for (const entry of fs.readdirSync(buildRoot, { withFileTypes: true })) {
        fs.rmSync(path.join(buildRoot, entry.name), {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 50
        });
    }
}

function runTsc(args: string[], repoRoot: string): void {
    const tscCliPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    if (!fs.existsSync(tscCliPath)) {
        throw new Error(`TypeScript CLI not found: ${tscCliPath}`);
    }

    const result = childProcess.spawnSync(process.execPath, [tscCliPath, ...args], {
        cwd: repoRoot,
        stdio: 'inherit',
        windowsHide: true
    });
    if (result.status !== 0) {
        throw new Error('TypeScript compilation failed (exit ' + result.status + ')');
    }
}

function syncRepoCliEntrypoint(compiledRoot: string, repoRoot: string): string {
    const compiledCliPath = path.join(compiledRoot, 'src', 'bin', 'octopus.js');
    if (!fs.existsSync(compiledCliPath)) {
        throw new Error(`Compiled CLI launcher not found: ${compiledCliPath}`);
    }

    const repoCliPath = path.join(repoRoot, 'bin', 'octopus.js');
    fs.mkdirSync(path.dirname(repoCliPath), { recursive: true });
    fs.copyFileSync(compiledCliPath, repoCliPath);

    try {
        fs.chmodSync(repoCliPath, 0o755);
    } catch {
        // Best-effort on Windows.
    }

    return repoCliPath;
}

export function syncRepoCliFromScriptsBuild(): string {
    const repoRoot = getRepoRoot();
    return syncRepoCliEntrypoint(path.join(repoRoot, '.scripts-build'), repoRoot);
}

export function buildNodeFoundation(): BuildResult {
    const repoRoot = getRepoRoot();
    const buildRoot = path.join(repoRoot, '.node-build');

    resetBuildRoot(buildRoot);

    // Compile src/ + tests/ + scripts/ with tsc (single type-checked graph)
    runTsc(['-p', 'tsconfig.tests.json'], repoRoot);
    const generatedCliPath = syncRepoCliEntrypoint(buildRoot, repoRoot);

    // Collect compiled files from all source roots
    const allFiles: string[] = [];

    for (const subdir of ['src', 'tests/node', 'scripts/node-foundation', 'scripts/test']) {
        const compiledRoot = path.join(buildRoot, ...subdir.split('/'));
        if (fs.existsSync(compiledRoot)) {
            for (const absPath of collectFiles(compiledRoot, '.js')) {
                allFiles.push(path.relative(buildRoot, absPath).split(path.sep).join('/'));
            }
        }
    }

    const manifestPath = path.join(buildRoot, 'node-foundation-manifest.json');
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({
            nodeEngineRange: getNodeEngineRange(),
            sourceRoots: ['src', 'tests/node', 'scripts/node-foundation', 'scripts/test'],
            files: allFiles
        }, null, 2) + '\n',
        'utf8'
    );

    return { buildRoot, copiedFiles: allFiles, generatedCliPath, manifestPath, repoRoot };
}

export function buildPublishRuntime(): BuildResult {
    const repoRoot = getRepoRoot();
    const buildRoot = path.join(repoRoot, 'dist');

    resetBuildRoot(buildRoot);

    // Compile src/ with tsc to dist/
    runTsc(['-p', 'tsconfig.build.json'], repoRoot);
    const generatedCliPath = syncRepoCliEntrypoint(buildRoot, repoRoot);

    // Collect compiled files
    const srcBuildRoot = path.join(buildRoot, 'src');
    const copiedFiles: string[] = fs.existsSync(srcBuildRoot)
        ? collectFiles(srcBuildRoot, '.js').map((f: string) =>
            path.relative(buildRoot, f).split(path.sep).join('/')
        )
        : [];

    const manifestPath = path.join(buildRoot, 'publish-runtime-manifest.json');
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({
            nodeEngineRange: getNodeEngineRange(),
            sourceRoots: ['src'],
            files: copiedFiles
        }, null, 2) + '\n',
        'utf8'
    );

    return { buildRoot, copiedFiles, generatedCliPath, manifestPath, repoRoot };
}

export function runNodeFoundationBuild(): BuildResult {
    const result = buildNodeFoundation();
    console.log('NODE_FOUNDATION_BUILD_OK');
    console.log(`OutputRoot: ${path.relative(result.repoRoot, result.buildRoot).split(path.sep).join('/')}`);
    console.log(`GeneratedCliPath: ${path.relative(result.repoRoot, result.generatedCliPath).split(path.sep).join('/')}`);
    console.log(`ManifestPath: ${path.relative(result.repoRoot, result.manifestPath).split(path.sep).join('/')}`);
    console.log(`Files: ${result.copiedFiles.length}`);
    return result;
}

export function runPublishRuntimeBuild(): BuildResult {
    const result = buildPublishRuntime();
    console.log('PUBLISH_RUNTIME_BUILD_OK');
    console.log(`OutputRoot: ${path.relative(result.repoRoot, result.buildRoot).split(path.sep).join('/')}`);
    console.log(`GeneratedCliPath: ${path.relative(result.repoRoot, result.generatedCliPath).split(path.sep).join('/')}`);
    console.log(`ManifestPath: ${path.relative(result.repoRoot, result.manifestPath).split(path.sep).join('/')}`);
    console.log(`Files: ${result.copiedFiles.length}`);
    return result;
}

// CLI entry point: dispatch based on argv when run directly
if (require.main === module) {
    const command = process.argv[2];
    if (command === 'publish-runtime') {
        runPublishRuntimeBuild();
    } else if (command === 'node-foundation') {
        runNodeFoundationBuild();
    } else if (command === 'sync-repo-cli') {
        const repoCliPath = syncRepoCliFromScriptsBuild();
        console.log('REPO_CLI_SYNC_OK');
        console.log(`GeneratedCliPath: ${path.relative(getRepoRoot(), repoCliPath).split(path.sep).join('/')}`);
    } else {
        console.error(`Usage: node build.js <publish-runtime|node-foundation|sync-repo-cli>`);
        process.exit(1);
    }
}
