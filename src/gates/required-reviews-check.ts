import * as fs from 'node:fs';
import * as path from 'node:path';
import { auditReviewArtifactCompaction, buildReviewReceipt, type ReviewReceipt } from '../gate-runtime/review-context';
import { assertValidTaskId } from '../gate-runtime/task-events';
import { fileSha256, normalizePath } from './helpers';
import { getNoOpEvidence, type NoOpEvidenceResult } from './no-op';

export const REVIEW_CONTRACTS = [
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
export function parseSkipReviews(value: unknown): string[] {
    if (!value || !String(value).trim()) return [];
    const parts = String(value).trim().toLowerCase().split(/[,; ]+/).filter(s => s.trim());
    return [...new Set(parts)].sort();
}

/**
 * Test expected verdict for a review type.
 * Matches Python test_expected_verdict.
 */
export function testExpectedVerdict(errors: string[], label: string, required: boolean, skippedByOverride: boolean, actualVerdict: string, passVerdict: string): void {
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
export function validatePreflightForReview(preflightPath: string, explicitTaskId: string) {
    let preflight;
    try {
        preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
    } catch {
        throw new Error(`Preflight artifact is not valid JSON: ${preflightPath}`);
    }

    const errors: string[] = [];
    let resolvedTaskId: string | null = null;
    if (explicitTaskId && explicitTaskId.trim()) {
        try {
            resolvedTaskId = assertValidTaskId(explicitTaskId);
        } catch (exc: unknown) {
            const message = exc instanceof Error ? exc.message : String(exc);
            errors.push(String(message));
        }
    }

    let preflightTaskId: string | null = preflight.task_id != null ? String(preflight.task_id).trim() : '';
    if (preflightTaskId) {
        try {
            preflightTaskId = assertValidTaskId(preflightTaskId);
        } catch (exc: unknown) {
            const message = exc instanceof Error ? exc.message : String(exc);
            errors.push(`preflight.task_id: ${message}`);
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
    const requiredFlags: Record<string, boolean> = {};
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

interface ReviewArtifactEntry {
    path: string;
    content: string;
    reviewContext?: Record<string, unknown>;
}

export interface CheckRequiredReviewsOptions {
    validatedPreflight: {
        errors: string[];
        resolved_task_id: string | null;
        required_reviews: Record<string, boolean>;
        preflight_path: string;
        preflight_hash: string | null;
    };
    verdicts?: Record<string, string>;
    skipReviews?: string[];
    compileGateEvidence?: Record<string, unknown> | null;
    reviewArtifacts?: Record<string, ReviewArtifactEntry>;
}

/**
 * Check required reviews validation.
 * Pure-logic core for the required reviews gate.
 */
export function checkRequiredReviews(options: CheckRequiredReviewsOptions) {
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
    const reviewChecks: Record<string, unknown> = {};
    for (const [reviewKey, passToken] of REVIEW_CONTRACTS) {
        const required = !!requiredReviews[reviewKey];
        const skippedByOverride = skipReviews.includes(reviewKey);
        const actualVerdict = verdicts[reviewKey] || 'NOT_REQUIRED';
        testExpectedVerdict(errors, `Review '${reviewKey}'`, required, skippedByOverride, actualVerdict, passToken);

        let compactionAudit = null;
        let receiptValid = false;
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

                // T-043: Authenticity hardening - Check for machine-verifiable receipt
                const receiptPath = artifactPath.replace(/\.md$/, '-receipt.json');
                if (fs.existsSync(receiptPath)) {
                    try {
                        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as ReviewReceipt;
                        const currentArtifactHash = fileSha256(artifactPath);
                        if (receipt.task_id !== resolvedTaskId) {
                            errors.push(`Review receipt for '${reviewKey}' belongs to a different task: ${receipt.task_id}.`);
                        } else if (receipt.review_type !== reviewKey) {
                            errors.push(`Review receipt for '${reviewKey}' has mismatched review type: ${receipt.review_type}.`);
                        } else if (receipt.review_artifact_sha256 !== currentArtifactHash) {
                            errors.push(`Review artifact hash mismatch for '${reviewKey}'. Artifact was modified after receipt was issued.`);
                        } else {
                            receiptValid = true;
                        }
                    } catch {
                        errors.push(`Review receipt for '${reviewKey}' is invalid JSON: ${normalizePath(receiptPath)}.`);
                    }
                } else if (required && !skippedByOverride) {
                    errors.push(`Verifiable review receipt missing for '${reviewKey}': ${normalizePath(receiptPath)}. Run 'gate record-review-receipt' to fix.`);
                }
            }
        } else if (required && !skippedByOverride) {
            errors.push(`Review artifact missing for '${reviewKey}'.`);
        }

        reviewChecks[reviewKey] = {
            required,
            skipped_by_override: skippedByOverride,
            verdict: actualVerdict,
            pass_token: passToken,
            compaction_audit: compactionAudit,
            receipt_valid: receiptValid
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

// --- T-033: zero-diff noop guard for review gate ---

export interface ZeroDiffReviewGuardResult {
    zero_diff_detected: boolean;
    status: 'NOT_APPLICABLE' | 'REQUIRES_DIFF_OR_NO_OP' | 'SATISFIED_BY_AUDITED_NO_OP';
    no_op_evidence_status: string | null;
    violations: string[];
}

/**
 * Detect whether a preflight artifact represents a zero-diff (clean tree) classification.
 * Reads the preflight's zero_diff_guard block or falls back to metrics/changed_files.
 */
export function detectZeroDiffFromPreflight(preflight: Record<string, unknown> | null): boolean {
    if (!preflight) return false;

    const guard = preflight.zero_diff_guard;
    if (guard && typeof guard === 'object' && !Array.isArray(guard)) {
        const guardObj = guard as Record<string, unknown>;
        if (guardObj.zero_diff_detected === true) return true;
        if (guardObj.zero_diff_detected === false) return false;
    }

    const metrics = preflight.metrics && typeof preflight.metrics === 'object' && !Array.isArray(preflight.metrics)
        ? preflight.metrics as Record<string, unknown>
        : null;
    const changedLinesTotal = metrics && typeof metrics.changed_lines_total === 'number'
        ? metrics.changed_lines_total
        : 0;
    const changedFilesCount = Array.isArray(preflight.changed_files) ? preflight.changed_files.length : 0;
    return changedLinesTotal === 0 && changedFilesCount === 0;
}

/**
 * Validate zero-diff guard for the review gate.
 * When the preflight shows zero-diff, the review gate blocks unless an audited no-op
 * artifact exists. This prevents clean-tree preflights from drifting toward task
 * completion without any produced diff.
 */
export function validateZeroDiffForReviewGate(
    preflight: Record<string, unknown> | null,
    taskId: string,
    repoRoot: string,
    noOpArtifactPath?: string
): ZeroDiffReviewGuardResult {
    const zeroDiffDetected = detectZeroDiffFromPreflight(preflight);

    if (!zeroDiffDetected) {
        return {
            zero_diff_detected: false,
            status: 'NOT_APPLICABLE',
            no_op_evidence_status: null,
            violations: []
        };
    }

    const noOpEvidence = getNoOpEvidence(repoRoot, taskId, noOpArtifactPath || '');

    if (noOpEvidence.evidence_status === 'PASS') {
        return {
            zero_diff_detected: true,
            status: 'SATISFIED_BY_AUDITED_NO_OP',
            no_op_evidence_status: noOpEvidence.evidence_status,
            violations: []
        };
    }

    return {
        zero_diff_detected: true,
        status: 'REQUIRES_DIFF_OR_NO_OP',
        no_op_evidence_status: noOpEvidence.evidence_status,
        violations: [
            `Task '${taskId}' has zero-diff preflight (clean tree). ` +
            'Review gate cannot pass without produced changes. ' +
            'Either implement changes and re-run preflight, record an audited no-op artifact ' +
            `('node Octopus-agent-orchestrator/bin/octopus.js gate record-no-op --task-id "${taskId}" --reason "..."'), ` +
            'or set the task to BLOCKED.'
        ]
    };
}

