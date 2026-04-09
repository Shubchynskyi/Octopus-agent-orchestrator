#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface CliMainModule {
    runCliMainWithHandling: (argv?: string[], packageRoot?: string) => Promise<void>;
}

const PACKAGE_NAME = 'octopus-agent-orchestrator';
const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';

function resolveBundleName(): string {
    const envValue = process.env.OCTOPUS_BUNDLE_NAME;
    if (envValue && envValue.trim()) return envValue.trim();
    return DEFAULT_BUNDLE_NAME;
}

export function findPackageRoot(startDir: string): string {
    let current = path.resolve(startDir);

    while (true) {
        if (
            fs.existsSync(path.join(current, 'package.json'))
            && fs.existsSync(path.join(current, 'VERSION'))
        ) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(`Cannot resolve package root from ${startDir}`);
        }
        current = parent;
    }
}

function hasRuntimeRoot(runtimeRoot: string): boolean {
    return fs.existsSync(path.join(runtimeRoot, 'index.js'));
}

function isRecoverableLoadError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'MODULE_NOT_FOUND' || code === 'ENOENT';
}

function getRuntimeCandidates(packageRoot: string): string[] {
    const publishRuntimeRoot = path.join(packageRoot, 'dist', 'src');
    const devBuildRuntimeRoot = path.join(packageRoot, '.node-build', 'src');
    const candidates: string[] = [];

    if (hasRuntimeRoot(publishRuntimeRoot)) {
        candidates.push(publishRuntimeRoot);
    }
    if (hasRuntimeRoot(devBuildRuntimeRoot)) {
        candidates.push(devBuildRuntimeRoot);
    }

    return candidates;
}

function loadCliMainModule(packageRoot: string): CliMainModule {
    const runtimeCandidates = getRuntimeCandidates(packageRoot);
    if (runtimeCandidates.length === 0) {
        console.error(
            'Octopus runtime build output not found.\n'
            + 'Run "npm run build" to compile TypeScript sources before execution.'
        );
        process.exit(1);
    }

    let lastError: unknown = null;

    for (let index = 0; index < runtimeCandidates.length; index += 1) {
        const runtimeRoot = runtimeCandidates[index];
        try {
            return require(path.join(runtimeRoot, 'cli', 'main.js')) as CliMainModule;
        } catch (error: unknown) {
            lastError = error;
            const hasFallback = index < runtimeCandidates.length - 1;
            if (!hasFallback || !isRecoverableLoadError(error)) {
                throw error;
            }
        }
    }

    throw lastError;
}

function isPackageInstalledUnderNodeModules(packageRoot: string): boolean {
    return path.resolve(packageRoot).split(path.sep).includes('node_modules');
}

function readPackageName(packageRoot: string): string | null {
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
        return typeof parsed.name === 'string' ? parsed.name : null;
    } catch (_error) {
        return null;
    }
}

function isOctopusPackageRoot(candidateRoot: string): boolean {
    return readPackageName(candidateRoot) === PACKAGE_NAME
        && fs.existsSync(path.join(candidateRoot, 'VERSION'))
        && fs.existsSync(path.join(candidateRoot, 'bin', 'octopus.js'));
}

function findSourceCheckoutRoot(startDir: string): string | null {
    let current = path.resolve(startDir);

    while (true) {
        if (isOctopusPackageRoot(current)) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function findDeployedBundleRoot(startDir: string): string | null {
    const effectiveName = resolveBundleName();
    let current = path.resolve(startDir);

    while (true) {
        const bundleRoot = path.join(current, effectiveName);
        if (isOctopusPackageRoot(bundleRoot)) {
            return bundleRoot;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function extractTargetRootArg(argv: string[], cwd: string): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--target-root' && index + 1 < argv.length) {
            return path.resolve(cwd, argv[index + 1]);
        }
        if (token.startsWith('--target-root=')) {
            return path.resolve(cwd, token.slice('--target-root='.length));
        }
    }
    return null;
}

function resolveUniqueStartDirs(argv: string[], cwd: string): string[] {
    const candidates = [extractTargetRootArg(argv, cwd), cwd]
        .filter((value): value is string => Boolean(value))
        .map(function (value) { return path.resolve(value); });
    return Array.from(new Set(candidates));
}

function resolveCliPathIfExternal(candidateRoot: string | null, currentScriptPath: string): string | null {
    if (!candidateRoot) {
        return null;
    }

    const candidateCli = path.join(candidateRoot, 'bin', 'octopus.js');
    if (!fs.existsSync(candidateCli)) {
        return null;
    }

    const currentRealPath = fs.realpathSync.native(currentScriptPath);
    const candidateRealPath = fs.realpathSync.native(candidateCli);
    if (candidateRealPath === currentRealPath) {
        return null;
    }

    return candidateCli;
}

export function resolveDelegatedLauncherTarget(
    argv: string[],
    cwd: string,
    currentScriptPath: string,
    packageRoot: string
): string | null {
    if (!isPackageInstalledUnderNodeModules(packageRoot)) {
        return null;
    }

    for (const startDir of resolveUniqueStartDirs(argv, cwd)) {
        const sourceCli = resolveCliPathIfExternal(findSourceCheckoutRoot(startDir), currentScriptPath);
        if (sourceCli) {
            return sourceCli;
        }

        const bundleCli = resolveCliPathIfExternal(findDeployedBundleRoot(startDir), currentScriptPath);
        if (bundleCli) {
            return bundleCli;
        }
    }

    return null;
}

function delegateToLocalCli(cliPath: string, argv: string[]): never {
    const result = childProcess.spawnSync(process.execPath, [cliPath, ...argv], {
        stdio: 'inherit',
        env: process.env
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== null) {
        process.exit(result.status);
    }

    process.exit(1);
}

function extractBundleNameArg(argv: string[]): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--bundle-name' && index + 1 < argv.length) {
            return argv[index + 1];
        }
        if (token.startsWith('--bundle-name=')) {
            return token.slice('--bundle-name='.length);
        }
    }
    return null;
}

export async function main(argv: string[] = process.argv.slice(2), cwd: string = process.cwd()): Promise<void> {
    const bundleNameArg = extractBundleNameArg(argv);
    if (bundleNameArg) {
        process.env.OCTOPUS_BUNDLE_NAME = bundleNameArg;
    }
    const packageRoot = findPackageRoot(__dirname);
    const delegatedCli = resolveDelegatedLauncherTarget(argv, cwd, __filename, packageRoot);
    if (delegatedCli) {
        delegateToLocalCli(delegatedCli, argv);
    }
    const { runCliMainWithHandling } = loadCliMainModule(packageRoot);
    await runCliMainWithHandling(argv, packageRoot);
}

if (require.main === module) {
    void main();
}
