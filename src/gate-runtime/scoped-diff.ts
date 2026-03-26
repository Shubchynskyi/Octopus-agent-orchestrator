const { matchAnyRegex } = require('./text-utils.ts');

/**
 * Build a scoped diff by filtering changed files against trigger regexes.
 * Pure-logic helper: callers provide preflight data and diff text.
 *
 * Shared scoped-diff behavior used by the Node gate runtime.
 * without git or filesystem side effects.
 */
function buildScopedDiffMetadata(options) {
    const reviewType = options.reviewType;
    const changedFiles = options.changedFiles || [];
    const triggerRegexes = options.triggerRegexes || [];
    const scopedDiffText = options.scopedDiffText || '';
    const fullDiffText = options.fullDiffText || '';
    const fullDiffSource = options.fullDiffSource || 'none';
    const useStaged = options.useStaged || false;
    const preflightPath = options.preflightPath || '';
    const pathsConfigPath = options.pathsConfigPath || '';
    const outputPath = options.outputPath || '';
    const metadataPath = options.metadataPath || '';
    const gitRepoRoot = options.gitRepoRoot || '';
    const fullDiffPath = options.fullDiffPath || '';

    if (!reviewType) {
        throw new Error("reviewType is required.");
    }
    if (triggerRegexes.length === 0) {
        throw new Error(`No trigger regexes found for review type '${reviewType}'.`);
    }

    const normalizedChangedFiles = [...new Set(
        changedFiles.map(f => String(f).replace(/\\/g, '/')).sort()
    )];

    const matchedFiles = normalizedChangedFiles.filter(
        filePath => matchAnyRegex(filePath, triggerRegexes, {
            skipInvalidRegex: true,
            invalidRegexContext: `review '${reviewType}'`,
            caseInsensitive: true
        })
    ).sort();

    let fallbackToFullDiff = false;
    let outputDiffText;

    if (matchedFiles.length > 0 && scopedDiffText && scopedDiffText.trim()) {
        outputDiffText = scopedDiffText;
    } else {
        fallbackToFullDiff = true;
        outputDiffText = fullDiffText;
    }

    function countLines(text) {
        if (!text) return 0;
        return text.split(/\r?\n/).length;
    }

    return {
        review_type: reviewType,
        preflight_path: preflightPath ? String(preflightPath).replace(/\\/g, '/') : null,
        paths_config_path: pathsConfigPath ? String(pathsConfigPath).replace(/\\/g, '/') : null,
        output_path: outputPath ? String(outputPath).replace(/\\/g, '/') : null,
        metadata_path: metadataPath ? String(metadataPath).replace(/\\/g, '/') : null,
        git_repo_root: gitRepoRoot ? String(gitRepoRoot).replace(/\\/g, '/') : null,
        full_diff_path: fullDiffPath ? String(fullDiffPath).replace(/\\/g, '/') : null,
        full_diff_source: fullDiffSource,
        use_staged: useStaged,
        matched_files_count: matchedFiles.length,
        matched_files: matchedFiles,
        fallback_to_full_diff: fallbackToFullDiff,
        scoped_diff_line_count: countLines(scopedDiffText),
        output_diff_line_count: countLines(outputDiffText),
        output_diff_text: outputDiffText
    };
}

/**
 * Convert pathspecs from repo-root-relative to git-root-relative.
 * Mirrors the legacy pathspec normalization contract.
 */
function convertToGitPathspecs(pathspecs, repoRoot, gitRoot) {
    if (!pathspecs || pathspecs.length === 0) {
        return [];
    }

    const repoRootNormalized = repoRoot.replace(/[\\/]+$/, '').replace(/\\/g, '/');
    const gitRootNormalized = gitRoot.replace(/[\\/]+$/, '').replace(/\\/g, '/');

    if (repoRootNormalized.toLowerCase() === gitRootNormalized.toLowerCase()) {
        return [...pathspecs];
    }

    const path = require('node:path');
    const gitRootName = path.basename(gitRootNormalized);
    const prefix = `${gitRootName}/`;

    return pathspecs.map(pathspec => {
        let normalized = String(pathspec).replace(/\\/g, '/');
        if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
            normalized = normalized.substring(prefix.length);
        }
        return normalized;
    });
}

module.exports = {
    buildScopedDiffMetadata,
    convertToGitPathspecs
};
