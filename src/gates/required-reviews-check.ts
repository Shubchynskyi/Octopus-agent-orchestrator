const fs = require('node:fs');
const path = require('node:path');

const { auditReviewArtifactCompaction } = require('../gate-runtime/review-context.ts');
const { assertValidTaskId } = require('../gate-runtime/task-events.ts');
const { fileSha256, normalizePath } = require('./helpers.ts');

const REVIEW_CONTRACTS = [
    ['code', 'REVIEW PASSED'],
    ['db', 'DB REVIEW PASSED'],
    ['security', 'SECURITY REVIEW PASSED'],
    ['refactor', 'REFACTOR REVIEW PASSED'],
    ['api', 'API REVIEW PASSED'],
    ['test', 'TEST REVIEW PASSED'],
    ['performance', 'PERFORMANCE REVIEW PASSED'],
    ['infra', 'INFRA REVIEW PASSED'],
    ['dependency', 'DEPENDENCY REVIEW PASSED']
];

/**
 * Parse skip-reviews value into a sorted unique array.
 */
function parseSkipReviews(value) {
    if (!value || !String(value).trim()) return [];
    const parts = String(value).trim().toLowerCase().split(/[,; ]+/).filter(s => s.trim());
    return [...new Set(parts)].sort();
}

/**
 * Test expected verdict for a review type.
 * Matches Python test_expected_verdict.
 */
function testExpectedVerdict(errors, label, required, skippedByOverride, actualVerdict, passVerdict) {
    if (required && !skippedByOverride) {
        if (actualVerdict !== passVerdict) {
            errors.push(`${label} is required. Expected '${passVerdict}', got '${actualVerdict}'.`);
        }
        return;
    }
    if (skippedByOverride) {
        const allowed = new Set(['NOT_REQUIRED', 'SKIPPED_BY_OVERRIDE', passVerdict]);
        if (!allowed.has(actualVerdict)) {
            const allowedText = [...allowed].sort().join("', '");
            errors.push(`${label} override is active. Expected one of '${allowedText}', got '${actualVerdict}'.`);
        }
        return;
    }
    if (actualVerdict === 'NOT_REQUIRED' || actualVerdict === passVerdict) return;
    errors.push(`${label} is not required. Expected 'NOT_REQUIRED' or '${passVerdict}', got '${actualVerdict}'.`);
}

/**
 * Validate preflight for required-reviews-check.
 * Validates preflight payload shape for the Node review gate.
 */
function validatePreflightForReview(preflightPath, explicitTaskId) {
    let preflight;
    try {
        preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
    } catch {
        throw new Error(`Preflight artifact is not valid JSON: ${preflightPath}`);
    }

    const errors = [];
    let resolvedTaskId = null;
    if (explicitTaskId && explicitTaskId.trim()) {
        try {
            resolvedTaskId = assertValidTaskId(explicitTaskId);
        } catch (exc) {
            errors.push(String(exc.message || exc));
        }
    }

    let preflightTaskId = preflight.task_id != null ? String(preflight.task_id).trim() : '';
    if (preflightTaskId) {
        try {
            preflightTaskId = assertValidTaskId(preflightTaskId);
        } catch (exc) {
            errors.push(`preflight.task_id: ${exc.message || exc}`);
            preflightTaskId = null;
        }
    } else {
        preflightTaskId = null;
    }

    if (resolvedTaskId && preflightTaskId && resolvedTaskId !== preflightTaskId) {
        errors.push(`TaskId '${resolvedTaskId}' does not match preflight.task_id '${preflightTaskId}'.`);
    }
    if (!resolvedTaskId && preflightTaskId) resolvedTaskId = preflightTaskId;
    if (!resolvedTaskId) {
        errors.push('TaskId is required and must be provided either via --task-id or preflight.task_id.');
    }

    const requiredReviews = preflight.required_reviews;
    const requiredFlags = {};
    const requiredKeys = ['code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency'];
    if (!requiredReviews || typeof requiredReviews !== 'object') {
        errors.push('Preflight field `required_reviews` is required and must be an object.');
    }
    for (const key of requiredKeys) {
        const value = requiredReviews ? requiredReviews[key] : undefined;
        if (typeof value !== 'boolean') {
            errors.push(`Preflight field \`required_reviews.${key}\` is required and must be boolean.`);
            requiredFlags[key] = false;
        } else {
            requiredFlags[key] = value;
        }
    }

    return {
        preflight,
        resolved_task_id: resolvedTaskId,
        required_reviews: requiredFlags,
        preflight_path: path.resolve(preflightPath),
        preflight_hash: fileSha256(path.resolve(preflightPath)),
        errors
    };
}

/**
 * Check required reviews validation.
 * Pure-logic core for the required reviews gate.
 */
function checkRequiredReviews(options) {
    const validatedPreflight = options.validatedPreflight;
    const verdicts = options.verdicts || {};
    const skipReviews = options.skipReviews || [];
    const compileGateEvidence = options.compileGateEvidence || null;
    const reviewArtifacts = options.reviewArtifacts || {};

    const errors = [...validatedPreflight.errors];
    const resolvedTaskId = validatedPreflight.resolved_task_id;
    const requiredReviews = validatedPreflight.required_reviews;

    // Validate compile gate
    if (compileGateEvidence) {
        if (compileGateEvidence.status !== 'PASSED') {
            errors.push(`Compile gate did not pass. Status: '${compileGateEvidence.status || 'UNKNOWN'}'.`);
        }
    }

    // Validate each review type
    const reviewChecks = {};
    for (const [reviewKey, passToken] of REVIEW_CONTRACTS) {
        const required = !!requiredReviews[reviewKey];
        const skippedByOverride = skipReviews.includes(reviewKey);
        const actualVerdict = verdicts[reviewKey] || 'NOT_REQUIRED';
        testExpectedVerdict(errors, `Review '${reviewKey}'`, required, skippedByOverride, actualVerdict, passToken);

        let compactionAudit = null;
        if (reviewArtifacts[reviewKey]) {
            const artifactPath = reviewArtifacts[reviewKey].path;
            const artifactContent = reviewArtifacts[reviewKey].content;
            const reviewContext = reviewArtifacts[reviewKey].reviewContext;
            if (artifactPath && artifactContent) {
                compactionAudit = auditReviewArtifactCompaction({
                    artifactPath,
                    content: artifactContent,
                    reviewContext
                });
            }
        }

        reviewChecks[reviewKey] = {
            required,
            skipped_by_override: skippedByOverride,
            verdict: actualVerdict,
            pass_token: passToken,
            compaction_audit: compactionAudit
        };
    }

    const status = errors.length > 0 ? 'FAILED' : 'PASSED';
    const outcome = errors.length > 0 ? 'FAIL' : 'PASS';

    return {
        status,
        outcome,
        task_id: resolvedTaskId,
        preflight_path: normalizePath(validatedPreflight.preflight_path),
        preflight_hash_sha256: validatedPreflight.preflight_hash,
        required_reviews: requiredReviews,
        skip_reviews: skipReviews,
        verdicts,
        review_checks: reviewChecks,
        violations: errors
    };
}

module.exports = {
    REVIEW_CONTRACTS,
    checkRequiredReviews,
    parseSkipReviews,
    testExpectedVerdict,
    validatePreflightForReview
};
