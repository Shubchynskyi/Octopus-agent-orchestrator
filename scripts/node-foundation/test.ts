const childProcess = require('node:child_process');
const path = require('node:path');

const { buildNodeFoundation, getRepoRoot } = require('./build.ts');

function runNodeFoundationTests() {
    const repoRoot = getRepoRoot();
    const buildResult = buildNodeFoundation();
    const testFiles = buildResult.copiedFiles
        .filter((relativePath) => relativePath.startsWith('tests/node/') && relativePath.endsWith('.test.js'))
        .map((relativePath) => path.join(buildResult.buildRoot, ...relativePath.split('/')));

    if (testFiles.length === 0) {
        throw new Error('No Node foundation tests were found under .node-build/tests/node.');
    }

    const result = childProcess.spawnSync(process.execPath, ['--test', ...testFiles], {
        cwd: repoRoot,
        stdio: 'inherit'
    });

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }

    console.log('NODE_FOUNDATION_TEST_OK');
}

if (require.main === module) {
    runNodeFoundationTests();
}

module.exports = {
    runNodeFoundationTests
};
