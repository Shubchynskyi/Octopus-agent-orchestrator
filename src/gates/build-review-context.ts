const fs = require('node:fs');
const path = require('node:path');

const { buildReviewContextSections } = require('../gate-runtime/review-context.ts');
const { normalizePath, orchestratorRelativePath, parseBool, resolvePathInsideRepo, toStringArray } = require('./helpers.ts');

/**
 * Rule pack configuration by review type.
 * Matches Python get_rule_pack.
 */
function getRulePack(reviewType) {
    if (reviewType === 'code') {
        return {
            full: ['00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md'],
            depth1: ['00-core.md', '80-task-workflow.md'],
            depth2: ['00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md']
        };
    }
    if (reviewType === 'db' || reviewType === 'security') {
        return {
            full: ['00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md'],
            depth1: ['00-core.md', '80-task-workflow.md'],
            depth2: ['00-core.md', '35-strict-coding-rules.md', '70-security.md', '80-task-workflow.md']
        };
    }
    if (reviewType === 'refactor') {
        return {
            full: ['00-core.md', '30-code-style.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '80-task-workflow.md'],
            depth1: ['00-core.md', '80-task-workflow.md'],
            depth2: ['00-core.md', '30-code-style.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '80-task-workflow.md']
        };
    }
    return {
        full: ['00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md'],
        depth1: ['00-core.md', '80-task-workflow.md'],
        depth2: ['00-core.md', '35-strict-coding-rules.md', '50-structure-and-docs.md', '70-security.md', '80-task-workflow.md']
    };
}

/**
 * Resolve the output path for review context.
 */
function resolveContextOutputPath(explicitOutputPath, preflightPath, reviewType, repoRoot) {
    if (explicitOutputPath && explicitOutputPath.trim()) {
        return resolvePathInsideRepo(explicitOutputPath, repoRoot, { allowMissing: true });
    }
    const preflightDir = path.dirname(preflightPath);
    const baseName = path.basename(preflightPath, path.extname(preflightPath)).replace(/-preflight$/, '');
    return path.resolve(preflightDir, `${baseName}-${reviewType}-context.json`);
}

/**
 * Resolve scoped diff metadata path.
 */
function resolveScopedDiffMetadataPath(explicitPath, preflightPath, reviewType, repoRoot) {
    if (explicitPath && explicitPath.trim()) {
        return resolvePathInsideRepo(explicitPath, repoRoot, { allowMissing: true });
    }
    const preflightDir = path.dirname(preflightPath);
    const baseName = path.basename(preflightPath, path.extname(preflightPath)).replace(/-preflight$/, '');
    return path.resolve(preflightDir, `${baseName}-${reviewType}-scoped.json`);
}

/**
 * Convert a value to non-negative integer or null.
 */
function toNonNegativeInt(value) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value === 'number') return value >= 0 ? Math.floor(value) : null;
    try {
        const parsed = parseInt(String(value).trim(), 10);
        return parsed >= 0 ? parsed : null;
    } catch { return null; }
}

/**
 * Build review context for a specific review type and depth.
 * Builds the review-context artifact shape for the Node gate runtime.
 */
function buildReviewContext(options) {
    const reviewType = options.reviewType;
    const depth = options.depth;
    const preflightPath = options.preflightPath;
    const tokenEconomyConfigPath = options.tokenEconomyConfigPath;
    const scopedDiffMetadataPath = options.scopedDiffMetadataPath;
    const outputPath = options.outputPath;
    const repoRoot = options.repoRoot;

    const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
    let tokenConfig = {};
    if (tokenEconomyConfigPath && fs.existsSync(tokenEconomyConfigPath) && fs.statSync(tokenEconomyConfigPath).isFile()) {
        tokenConfig = JSON.parse(fs.readFileSync(tokenEconomyConfigPath, 'utf8'));
    }

    const enabled = parseBool(tokenConfig.enabled);
    const enabledDepths = [...new Set(
        toStringArray(tokenConfig.enabled_depths).filter(s => /^\d+$/.test(String(s).trim())).map(s => parseInt(String(s).trim(), 10))
    )].sort();
    const tokenEconomyActive = enabled && enabledDepths.includes(depth);

    const rulePack = getRulePack(reviewType);
    const fullRuleFiles = [...rulePack.full];
    let selectedRuleFiles;
    if (!tokenEconomyActive || depth >= 3) {
        selectedRuleFiles = [...fullRuleFiles];
    } else if (depth === 1) {
        selectedRuleFiles = [...rulePack.depth1];
    } else {
        selectedRuleFiles = [...rulePack.depth2];
    }

    const omittedRuleFiles = fullRuleFiles.filter(f => !selectedRuleFiles.includes(f));
    const ruleFilesBasePath = orchestratorRelativePath(repoRoot, 'live/docs/agent-rules');
    const selectedRulePaths = selectedRuleFiles.map(f => `${ruleFilesBasePath}/${f}`);
    const fullRulePaths = fullRuleFiles.map(f => `${ruleFilesBasePath}/${f}`);
    const omittedRulePaths = omittedRuleFiles.map(f => `${ruleFilesBasePath}/${f}`);
    const rulePackOmissionReason = omittedRulePaths.length > 0 ? 'deferred_by_depth' : 'none';

    const requiredReviews = preflight.required_reviews || {};
    const requiredReview = parseBool(requiredReviews[reviewType]);
    const stripExamplesFlag = parseBool(tokenConfig.strip_examples);
    const stripCodeBlocksFlag = parseBool(tokenConfig.strip_code_blocks);
    const scopedDiffsFlag = parseBool(tokenConfig.scoped_diffs);
    const compactReviewerOutputFlag = parseBool(tokenConfig.compact_reviewer_output);
    const failTailLines = toNonNegativeInt(tokenConfig.fail_tail_lines);
    const stripExamplesApplied = tokenEconomyActive && stripExamplesFlag;
    const stripCodeBlocksApplied = tokenEconomyActive && stripCodeBlocksFlag;
    const scopedDiffExpected = tokenEconomyActive && ['db', 'security', 'refactor'].includes(reviewType) && scopedDiffsFlag;

    let scopedDiffMetadata = null;
    if (scopedDiffMetadataPath && fs.existsSync(scopedDiffMetadataPath) && fs.statSync(scopedDiffMetadataPath).isFile()) {
        try {
            scopedDiffMetadata = JSON.parse(fs.readFileSync(scopedDiffMetadataPath, 'utf8'));
        } catch (exc) {
            scopedDiffMetadata = { metadata_path: normalizePath(scopedDiffMetadataPath), parse_error: String(exc) };
        }
    }

    const omittedSections = [];
    if (tokenEconomyActive && depth === 1) {
        omittedSections.push({
            section: 'rule_pack',
            reason: 'deferred_by_depth',
            details: 'Only minimal reviewer rule context is selected at depth=1.'
        });
    }
    if (tokenEconomyActive && stripExamplesFlag) {
        omittedSections.push({
            section: 'examples',
            reason: 'token_economy_strip_examples',
            details: 'Examples may be omitted from reviewer context.'
        });
    }
    if (tokenEconomyActive && stripCodeBlocksFlag) {
        omittedSections.push({
            section: 'code_blocks',
            reason: 'token_economy_strip_code_blocks',
            details: 'Code blocks may be omitted from reviewer context.'
        });
    }

    const tokenEconomyFlags = {
        enabled: !!enabled,
        enabled_depths: enabledDepths,
        strip_examples: stripExamplesFlag,
        strip_code_blocks: stripCodeBlocksFlag,
        scoped_diffs: scopedDiffsFlag,
        compact_reviewer_output: compactReviewerOutputFlag,
        fail_tail_lines: failTailLines
    };
    const tokenEconomyOmissionReason = (omittedSections.length > 0 || omittedRulePaths.length > 0) ? 'token_economy_compaction' : 'none';

    // Build the rule context artifact using gate-runtime
    const ruleContextArtifactPath = outputPath.replace(/\.json$/, '.md');
    const readFileCallback = (rulePath) => {
        const resolved = path.isAbsolute(rulePath) ? rulePath : path.resolve(repoRoot, rulePath);
        try { return fs.readFileSync(resolved, 'utf8'); } catch { return ''; }
    };
    const ruleContextSections = buildReviewContextSections(selectedRulePaths, readFileCallback, {
        stripExamples: stripExamplesApplied,
        stripCodeBlocks: stripCodeBlocksApplied
    });

    // Write rule context artifact
    fs.mkdirSync(path.dirname(ruleContextArtifactPath), { recursive: true });
    fs.writeFileSync(ruleContextArtifactPath, ruleContextSections.artifact_text, 'utf8');

    const ruleContextArtifact = {
        artifact_path: normalizePath(ruleContextArtifactPath),
        artifact_sha256: ruleContextSections.artifact_sha256,
        source_file_count: ruleContextSections.source_file_count,
        strip_examples_applied: stripExamplesApplied,
        strip_code_blocks_applied: stripCodeBlocksApplied,
        summary: ruleContextSections.summary,
        source_files: ruleContextSections.source_files,
        preferred_prompt_artifact: normalizePath(ruleContextArtifactPath)
    };

    const compatibility = {
        note: 'Use nested rule_pack.* and token_economy.* fields. Legacy top-level duplicates were removed in schema_version=2.',
        legacy_top_level_fields_removed: {
            selected_rule_files: 'rule_pack.selected_rule_files',
            selected_rule_count: 'rule_pack.selected_rule_count',
            full_rule_pack_files: 'rule_pack.full_rule_pack_files',
            omitted_rule_files: 'rule_pack.omitted_rule_files',
            omitted_rule_count: 'rule_pack.omitted_rule_count',
            omission_reason: 'rule_pack.omission_reason',
            token_economy_flags: 'token_economy.flags',
            omitted_sections: 'token_economy.omitted_sections',
            omitted_sections_count: 'token_economy.omitted_sections_count'
        }
    };

    const result = {
        schema_version: 2,
        review_type: reviewType,
        depth,
        token_economy_active: !!tokenEconomyActive,
        required_review: !!requiredReview,
        preflight_path: normalizePath(preflightPath),
        output_path: normalizePath(outputPath),
        token_economy_config_path: normalizePath(tokenEconomyConfigPath),
        compatibility,
        rule_pack: {
            selected_rule_files: selectedRulePaths,
            selected_rule_count: selectedRulePaths.length,
            full_rule_pack_files: fullRulePaths,
            omitted_rule_files: omittedRulePaths,
            omitted_rule_count: omittedRulePaths.length,
            omission_reason: rulePackOmissionReason
        },
        token_economy: {
            active: !!tokenEconomyActive,
            flags: tokenEconomyFlags,
            omitted_sections: omittedSections,
            omitted_sections_count: omittedSections.length,
            omission_reason: tokenEconomyOmissionReason
        },
        rule_context: ruleContextArtifact,
        scoped_diff: {
            expected: !!scopedDiffExpected,
            metadata_path: normalizePath(scopedDiffMetadataPath),
            metadata: scopedDiffMetadata
        }
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

    return result;
}

module.exports = {
    buildReviewContext,
    getRulePack,
    resolveContextOutputPath,
    resolveScopedDiffMetadataPath,
    toNonNegativeInt
};
