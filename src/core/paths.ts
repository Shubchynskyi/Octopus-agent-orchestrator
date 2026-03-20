const path = require('node:path');

function getPathModule(platform = process.platform) {
    return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeRelativePath(value) {
    return String(value).trim().replace(/[\\/]+/g, '/').replace(/^\.\//, '');
}

function normalizeComparisonPath(value, platform, includeTrailingSeparator = false) {
    const pathModule = getPathModule(platform);
    let normalized = pathModule.normalize(pathModule.resolve(String(value)));
    if (includeTrailingSeparator && !normalized.endsWith(pathModule.sep)) {
        normalized += pathModule.sep;
    }

    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInsideRoot(rootPath, candidatePath, platform = process.platform) {
    const pathModule = getPathModule(platform);
    const resolvedRoot = pathModule.resolve(String(rootPath));
    const resolvedCandidate = pathModule.resolve(String(candidatePath));
    const comparableRoot = normalizeComparisonPath(resolvedRoot, platform, true);
    const comparableCandidate = normalizeComparisonPath(resolvedCandidate, platform, false);

    return comparableCandidate === comparableRoot.slice(0, -1) || comparableCandidate.startsWith(comparableRoot);
}

function resolvePathInsideRoot(rootPath, candidatePath, platform = process.platform) {
    const pathModule = getPathModule(platform);
    const resolvedCandidate = pathModule.resolve(String(rootPath), String(candidatePath));

    if (!isPathInsideRoot(rootPath, resolvedCandidate, platform)) {
        throw new Error(`Resolved path escapes root '${rootPath}': ${candidatePath}`);
    }

    return resolvedCandidate;
}

module.exports = {
    getPathModule,
    isPathInsideRoot,
    normalizeRelativePath,
    resolvePathInsideRoot
};
