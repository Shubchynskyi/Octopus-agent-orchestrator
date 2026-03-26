const fs = require('node:fs');
const path = require('node:path');

const { buildScopedDiffMetadata, convertToGitPathspecs } = require('../gate-runtime/scoped-diff.ts');
const { matchAnyRegex } = require('../gate-runtime/text-utils.ts');
const { normalizePath, resolveGitRoot, resolvePathInsideRepo, toStringArray, toPosix } = require('./helpers.ts');
const { DEFAULT_GIT_TIMEOUT_MS, spawnSyncWithTimeout } = require('../core/subprocess.ts');

/**
 * Resolve output path for scoped diff.
 */
function resolveOutputPath(explicitOutputPath, preflightPath, reviewType, repoRoot) {
    if (explicitOutputPath && explicitOutputPath.trim()) {
        return resolvePathInsideRepo(explicitOutputPath, repoRoot, { allowMissing: true });
    }
    const preflightDir = path.dirname(preflightPath);
    const baseName = path.basename(preflightPath, path.extname(preflightPath)).replace(/-preflight$/, '');
    return path.resolve(preflightDir, `${baseName}-${reviewType}-scoped.diff`);
}

/**
 * Resolve metadata path for scoped diff.
 */
function resolveMetadataPath(explicitMetadataPath, preflightPath, reviewType, repoRoot) {
    if (explicitMetadataPath && explicitMetadataPath.trim()) {
        return resolvePathInsideRepo(explicitMetadataPath, repoRoot, { allowMissing: true });
    }
    const preflightDir = path.dirname(preflightPath);
    const baseName = path.basename(preflightPath, path.extname(preflightPath)).replace(/-preflight$/, '');
    return path.resolve(preflightDir, `${baseName}-${reviewType}-scoped.json`);
}

/**
 * Run git diff and return stdout text.
 */
function runGitDiff(gitRoot, useStaged, pathspecs) {
    const gitArgs = ['-C', String(gitRoot), 'diff', '--no-color'];
    if (useStaged) gitArgs.push('--staged');
    else gitArgs.push('HEAD');
    if (pathspecs && pathspecs.length > 0) {
        gitArgs.push('--');
        gitArgs.push(...pathspecs);
    }
    const result = spawnSyncWithTimeout('git', gitArgs, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 50 * 1024 * 1024,
        timeoutMs: DEFAULT_GIT_TIMEOUT_MS
    });
    if (result.timedOut) {
        throw new Error(`git diff timed out after ${DEFAULT_GIT_TIMEOUT_MS} ms.`);
    }
    if (result.error) {
        throw new Error(`git diff exited with error: ${result.error.message || result.error}`);
    }
    if (result.status !== 0) {
        const errText = String(result.stderr || '').trim();
        throw new Error(`git diff exited with code ${result.status}. ${errText}`);
    }
    return String(result.stdout || '');
}

/**
 * Build a scoped diff for a specific review type.
 * Orchestrates git operations and writes artifacts.
 * Returns the metadata object.
 */
function buildScopedDiff(options) {
    const reviewType = options.reviewType;
    const preflightPath = options.preflightPath;
    const pathsConfigPath = options.pathsConfigPath;
    const outputPath = options.outputPath;
    const metadataPath = options.metadataPath;
    const fullDiffPath = options.fullDiffPath || null;
    const repoRoot = options.repoRoot;
    const useStaged = options.useStaged || false;

    const gitRepoRoot = resolveGitRoot(repoRoot);

    const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
    const changedFiles = [...new Set(
        toStringArray(preflight.changed_files).map(f => String(f).replace(/\\/g, '/')).filter(Boolean)
    )].sort();

    const pathsConfig = JSON.parse(fs.readFileSync(pathsConfigPath, 'utf8'));
    const triggers = pathsConfig.triggers || {};
    const triggerRegexes = toStringArray(triggers[reviewType]);
    if (!triggerRegexes.length) {
        throw new Error(`No trigger regexes found for review type '${reviewType}' in ${pathsConfigPath}`);
    }

    const matchedFiles = changedFiles.filter(
        p => matchAnyRegex(p, triggerRegexes, {
            skipInvalidRegex: true,
            invalidRegexContext: `review '${reviewType}'`,
            caseInsensitive: true
        })
    );

    let scopedDiffText = '';
    let fallbackToFullDiff = false;
    let fullDiffSource = 'none';

    if (matchedFiles.length > 0) {
        try {
            const gitPathspecs = convertToGitPathspecs(matchedFiles, toPosix(repoRoot), toPosix(gitRepoRoot));
            scopedDiffText = runGitDiff(gitRepoRoot, useStaged, gitPathspecs);
            if (!scopedDiffText.trim()) fallbackToFullDiff = true;
        } catch {
            fallbackToFullDiff = true;
        }
    } else {
        fallbackToFullDiff = true;
    }

    let outputDiffText = scopedDiffText;
    if (fallbackToFullDiff) {
        if (fullDiffPath && fs.existsSync(fullDiffPath) && fs.statSync(fullDiffPath).isFile()) {
            outputDiffText = fs.readFileSync(fullDiffPath, 'utf8');
            fullDiffSource = 'artifact';
        } else {
            outputDiffText = runGitDiff(gitRepoRoot, useStaged, []);
            fullDiffSource = 'git';
        }
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    let outputPayload = outputDiffText || '';
    if (outputPayload && !outputPayload.endsWith('\n')) outputPayload += '\n';
    fs.writeFileSync(outputPath, outputPayload, 'utf8');

    function lineCount(text) {
        if (!text) return 0;
        return text.split('\n').length;
    }

    const result = {
        review_type: reviewType,
        preflight_path: normalizePath(preflightPath),
        paths_config_path: normalizePath(pathsConfigPath),
        output_path: normalizePath(outputPath),
        metadata_path: normalizePath(metadataPath),
        git_repo_root: normalizePath(gitRepoRoot),
        full_diff_path: fullDiffPath ? normalizePath(fullDiffPath) : null,
        full_diff_source: fullDiffSource,
        use_staged: !!useStaged,
        matched_files_count: matchedFiles.length,
        matched_files: matchedFiles,
        fallback_to_full_diff: !!fallbackToFullDiff,
        scoped_diff_line_count: lineCount(scopedDiffText),
        output_diff_line_count: lineCount(outputPayload)
    };

    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

    return result;
}

module.exports = {
    buildScopedDiff,
    resolveMetadataPath,
    resolveOutputPath,
    runGitDiff
};
