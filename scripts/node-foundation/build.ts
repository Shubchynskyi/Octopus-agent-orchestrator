const fs = require('node:fs');
const path = require('node:path');

const { NODE_ENGINE_RANGE } = require('../../src/core/constants.ts');

function getRepoRoot() {
    return path.resolve(__dirname, '..', '..');
}

function collectFiles(rootPath, extension = '.ts') {
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(entryPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(extension)) {
            files.push(entryPath);
        }
    }

    return files.sort();
}

function validateSourceModule(filePath) {
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    require(resolved);
    delete require.cache[resolved];
}

function rewriteTypeScriptSpecifiers(source) {
    return String(source).replace(
        /require\((['"])(\.[^'"]+?)\.ts\1\)/g,
        (match, quote, specifier) => `require(${quote}${specifier}.js${quote})`
    );
}

function copyFileToBuildRoot(filePath, repoRoot, buildRoot) {
    const relativePath = path.relative(repoRoot, filePath);
    const outputRelativePath = relativePath.replace(/\.ts$/i, '.js');
    const destinationPath = path.join(buildRoot, outputRelativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const transformedSource = rewriteTypeScriptSpecifiers(fs.readFileSync(filePath, 'utf8'));
    fs.writeFileSync(destinationPath, transformedSource, 'utf8');
    return outputRelativePath.split(path.sep).join('/');
}

function resetBuildRoot(buildRoot) {
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

function buildSourceRoots(repoRoot, buildRoot, sourceRoots, options = {}) {
    const copiedFiles = [];
    const validateSourceFiles = new Set((options.validateSourceFiles || []).map(p => path.resolve(p)));

    resetBuildRoot(buildRoot);

    for (const sourceRoot of sourceRoots) {
        for (const filePath of collectFiles(sourceRoot, '.ts')) {
            if (validateSourceFiles.has(path.resolve(sourceRoot))) {
                validateSourceModule(filePath);
            }
            copiedFiles.push(copyFileToBuildRoot(filePath, repoRoot, buildRoot));
        }
    }

    return copiedFiles;
}

function buildNodeFoundation() {
    const repoRoot = getRepoRoot();
    const buildRoot = path.join(repoRoot, '.node-build');
    const sourceRoots = [
        path.join(repoRoot, 'src'),
        path.join(repoRoot, 'tests', 'node')
    ];
    const copiedFiles = buildSourceRoots(repoRoot, buildRoot, sourceRoots, {
        validateSourceFiles: [path.join(repoRoot, 'src')]
    });

    const manifestPath = path.join(buildRoot, 'node-foundation-manifest.json');
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({
            nodeEngineRange: NODE_ENGINE_RANGE,
            sourceRoots: ['src', 'tests/node'],
            files: copiedFiles
        }, null, 2) + '\n',
        'utf8'
    );

    return {
        buildRoot,
        copiedFiles,
        manifestPath,
        repoRoot
    };
}

function buildPublishRuntime() {
    const repoRoot = getRepoRoot();
    const buildRoot = path.join(repoRoot, 'dist');
    const sourceRoots = [
        path.join(repoRoot, 'src')
    ];
    const copiedFiles = buildSourceRoots(repoRoot, buildRoot, sourceRoots, {
        validateSourceFiles: sourceRoots
    });

    const manifestPath = path.join(buildRoot, 'publish-runtime-manifest.json');
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({
            nodeEngineRange: NODE_ENGINE_RANGE,
            sourceRoots: ['src'],
            files: copiedFiles
        }, null, 2) + '\n',
        'utf8'
    );

    return {
        buildRoot,
        copiedFiles,
        manifestPath,
        repoRoot
    };
}

function runNodeFoundationBuild() {
    const result = buildNodeFoundation();
    console.log('NODE_FOUNDATION_BUILD_OK');
    console.log(`OutputRoot: ${path.relative(result.repoRoot, result.buildRoot).split(path.sep).join('/')}`);
    console.log(`ManifestPath: ${path.relative(result.repoRoot, result.manifestPath).split(path.sep).join('/')}`);
    console.log(`Files: ${result.copiedFiles.length}`);
    return result;
}

function runPublishRuntimeBuild() {
    const result = buildPublishRuntime();
    console.log('PUBLISH_RUNTIME_BUILD_OK');
    console.log(`OutputRoot: ${path.relative(result.repoRoot, result.buildRoot).split(path.sep).join('/')}`);
    console.log(`ManifestPath: ${path.relative(result.repoRoot, result.manifestPath).split(path.sep).join('/')}`);
    console.log(`Files: ${result.copiedFiles.length}`);
    return result;
}

if (require.main === module) {
    runNodeFoundationBuild();
}

module.exports = {
    buildPublishRuntime,
    buildNodeFoundation,
    collectFiles,
    getRepoRoot,
    runPublishRuntimeBuild,
    runNodeFoundationBuild
};
