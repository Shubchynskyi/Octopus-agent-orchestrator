#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

interface CliMainModule {
    runCliMainWithHandling: (argv?: string[], packageRoot?: string) => Promise<void>;
}

function findPackageRoot(startDir: string): string {
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

async function main(): Promise<void> {
    const packageRoot = findPackageRoot(__dirname);
    const { runCliMainWithHandling } = loadCliMainModule(packageRoot);
    await runCliMainWithHandling(process.argv.slice(2), packageRoot);
}

void main();
