import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_CLI_SYNC_LOCK_TIMEOUT_MS = 15000;
const REPO_CLI_SYNC_RETRY_MS = 50;
const REPO_CLI_SYNC_MAX_RETRIES = 20;
const {
    resetBuildRoot,
    withBuildRootLock
} = require('./build-root-lock.cjs') as {
    resetBuildRoot: (buildRoot: string) => void;
    withBuildRootLock: <T>(buildRoot: string, operation: () => T) => T;
};

export { withBuildRootLock };

export interface BuildResult {
    buildRoot: string;
    copiedFiles: string[];
    generatedCliPath: string;
    manifestPath: string;
    repoRoot: string;
}

export interface RepoCliSyncFsLike {
    chmodSync: typeof fs.chmodSync;
    existsSync: typeof fs.existsSync;
    mkdirSync: typeof fs.mkdirSync;
    readFileSync: typeof fs.readFileSync;
    renameSync: typeof fs.renameSync;
    rmSync: typeof fs.rmSync;
    writeFileSync: typeof fs.writeFileSync;
}

const DEFAULT_REPO_CLI_SYNC_FS: RepoCliSyncFsLike = fs;
const SCRIPT_RUNTIME_SUPPORT_FILES = Object.freeze(['build-root-lock.cjs']);

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
    return (pkg.engines && pkg.engines.node) || '>=24.0.0';
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

function copyScriptRuntimeSupportFiles(compiledRoot: string, repoRoot: string): void {
    const compiledScriptsRoot = path.join(compiledRoot, 'scripts', 'node-foundation');
    fs.mkdirSync(compiledScriptsRoot, { recursive: true });

    for (const fileName of SCRIPT_RUNTIME_SUPPORT_FILES) {
        const sourcePath = path.join(repoRoot, 'scripts', 'node-foundation', fileName);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Script runtime support file not found: ${sourcePath}`);
        }
        fs.copyFileSync(sourcePath, path.join(compiledScriptsRoot, fileName));
    }
}

function getErrorCode(error: unknown): string {
    return error != null && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
}

function isRetryableCliSyncError(error: unknown): boolean {
    const errorCode = getErrorCode(error);
    return errorCode === 'EBUSY' || errorCode === 'EPERM' || errorCode === 'EACCES' || errorCode === 'EEXIST';
}

function sleepSync(milliseconds: number): void {
    if (!milliseconds || milliseconds <= 0) {
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function safeUnlink(filePath: string, fileSystem: RepoCliSyncFsLike): void {
    try {
        fileSystem.rmSync(filePath, { force: true });
    } catch {
        // best-effort temp cleanup
    }
}

function makeTempCliPath(repoCliPath: string): string {
    return `${repoCliPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

function readFileIfExists(filePath: string, fileSystem: RepoCliSyncFsLike): Buffer | null {
    try {
        return fileSystem.readFileSync(filePath);
    } catch (error: unknown) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function fileContentMatches(filePath: string, expectedContent: Buffer, fileSystem: RepoCliSyncFsLike): boolean {
    const currentContent = readFileIfExists(filePath, fileSystem);
    return currentContent !== null && Buffer.compare(currentContent, expectedContent) === 0;
}

function ensureExecutableMode(filePath: string, fileSystem: RepoCliSyncFsLike): void {
    try {
        fileSystem.chmodSync(filePath, 0o755);
    } catch {
        // Best-effort on Windows.
    }
}

function acquireRepoCliSyncLock(lockPath: string, fileSystem: RepoCliSyncFsLike): void {
    const startedAt = Date.now();
    while (true) {
        try {
            fileSystem.mkdirSync(lockPath);
            return;
        } catch (error: unknown) {
            const errorCode = getErrorCode(error);
            if (errorCode !== 'EEXIST') {
                throw error;
            }
            if (Date.now() - startedAt >= REPO_CLI_SYNC_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out acquiring repo CLI sync lock: ${lockPath}`);
            }
            sleepSync(REPO_CLI_SYNC_RETRY_MS);
        }
    }
}

function releaseRepoCliSyncLock(lockPath: string, fileSystem: RepoCliSyncFsLike): void {
    try {
        fileSystem.rmSync(lockPath, { recursive: true, force: true });
    } catch {
        // best-effort lock cleanup
    }
}

function replaceRepoCliEntrypoint(repoCliPath: string, desiredContent: Buffer, fileSystem: RepoCliSyncFsLike): void {
    for (let attempt = 0; attempt <= REPO_CLI_SYNC_MAX_RETRIES; attempt += 1) {
        const tempCliPath = makeTempCliPath(repoCliPath);
        try {
            if (fileContentMatches(repoCliPath, desiredContent, fileSystem)) {
                ensureExecutableMode(repoCliPath, fileSystem);
                return;
            }

            fileSystem.writeFileSync(tempCliPath, desiredContent);
            ensureExecutableMode(tempCliPath, fileSystem);

            safeUnlink(repoCliPath, fileSystem);
            fileSystem.renameSync(tempCliPath, repoCliPath);
            ensureExecutableMode(repoCliPath, fileSystem);
            return;
        } catch (error: unknown) {
            safeUnlink(tempCliPath, fileSystem);

            if (fileContentMatches(repoCliPath, desiredContent, fileSystem)) {
                ensureExecutableMode(repoCliPath, fileSystem);
                return;
            }
            if (!isRetryableCliSyncError(error) || attempt >= REPO_CLI_SYNC_MAX_RETRIES) {
                throw error;
            }
            sleepSync(REPO_CLI_SYNC_RETRY_MS);
        }
    }
}

export function syncRepoCliEntrypoint(compiledRoot: string, repoRoot: string, fileSystem: RepoCliSyncFsLike = DEFAULT_REPO_CLI_SYNC_FS): string {
    const compiledCliPath = path.join(compiledRoot, 'src', 'bin', 'octopus.js');
    if (!fileSystem.existsSync(compiledCliPath)) {
        throw new Error(`Compiled CLI launcher not found: ${compiledCliPath}`);
    }

    const repoCliPath = path.join(repoRoot, 'bin', 'octopus.js');
    const repoCliLockPath = path.join(path.dirname(repoCliPath), '.octopus-cli-sync.lock');
    const compiledCliContent = fileSystem.readFileSync(compiledCliPath);
    fileSystem.mkdirSync(path.dirname(repoCliPath), { recursive: true });
    acquireRepoCliSyncLock(repoCliLockPath, fileSystem);
    try {
        replaceRepoCliEntrypoint(repoCliPath, compiledCliContent, fileSystem);
    } finally {
        releaseRepoCliSyncLock(repoCliLockPath, fileSystem);
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
    return withBuildRootLock(buildRoot, () => {
        resetBuildRoot(buildRoot);

        // Compile the maintained runtime/test/build graph into .node-build.
        runTsc(['-p', 'tsconfig.tests.json'], repoRoot);
        copyScriptRuntimeSupportFiles(buildRoot, repoRoot);
        const generatedCliPath = syncRepoCliEntrypoint(buildRoot, repoRoot);

        // Collect compiled files from all source roots
        const allFiles: string[] = [];

        for (const subdir of ['src', 'tests/node', 'scripts/node-foundation']) {
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
                sourceRoots: ['src', 'tests/node', 'scripts/node-foundation'],
                files: allFiles
            }, null, 2) + '\n',
            'utf8'
        );

        return { buildRoot, copiedFiles: allFiles, generatedCliPath, manifestPath, repoRoot };
    });
}

export function buildPublishRuntime(): BuildResult {
    const repoRoot = getRepoRoot();
    const buildRoot = path.join(repoRoot, 'dist');
    return withBuildRootLock(buildRoot, () => {
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
    });
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
