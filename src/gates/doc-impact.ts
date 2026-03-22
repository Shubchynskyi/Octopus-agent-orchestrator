const fs = require('node:fs');
const path = require('node:path');

const { assertValidTaskId } = require('../gate-runtime/task-events.ts');
const { fileSha256, normalizePath, parseBool, toStringArray } = require('./helpers.ts');

/**
 * Validate preflight for doc-impact gate.
 */
function validatePreflightForDocImpact(preflightPath, explicitTaskId) {
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

    let preflightTaskId = String(preflight.task_id || '').trim();
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

    return {
        preflight,
        resolved_task_id: resolvedTaskId,
        preflight_path: path.resolve(preflightPath),
        preflight_hash: fileSha256(path.resolve(preflightPath)),
        errors
    };
}

/**
 * Run doc-impact gate assessment.
 * Produces the canonical doc-impact gate output shape.
 */
function assessDocImpact(options) {
    const preflightPath = options.preflightPath;
    const taskId = options.taskId || '';
    const decision = (options.decision || 'NO_DOC_UPDATES').trim().toUpperCase();
    const behaviorChanged = parseBool(options.behaviorChanged);
    const changelogUpdated = parseBool(options.changelogUpdated);
    const sensitiveReviewed = parseBool(options.sensitiveReviewed);
    const docsUpdated = [...new Set(toStringArray(options.docsUpdated, { trimValues: true }).filter(Boolean))].sort();
    const rationale = (options.rationale || '').trim();
    const validated = validatePreflightForDocImpact(preflightPath, taskId);
    const resolvedTaskId = validated.resolved_task_id;
    const errors = [...validated.errors];

    // Detect sensitive triggers
    const sensitiveTriggersFired = [];
    const preflightObj = validated.preflight || {};
    const triggersObj = preflightObj.triggers || {};
    for (const triggerName of ['api', 'security', 'infra', 'dependency', 'db']) {
        if (triggersObj[triggerName]) sensitiveTriggersFired.push(triggerName);
    }

    // Validation rules
    if (!rationale || rationale.length < 12) {
        errors.push('Rationale is required (>= 12 chars).');
    }
    if (decision === 'DOCS_UPDATED' && !docsUpdated.length) {
        errors.push('Decision DOCS_UPDATED requires non-empty docs_updated list.');
    }
    if (behaviorChanged && decision !== 'DOCS_UPDATED') {
        errors.push('BehaviorChanged=true requires Decision=DOCS_UPDATED.');
    }
    if (behaviorChanged && !changelogUpdated) {
        errors.push('BehaviorChanged=true requires ChangelogUpdated=true.');
    }
    if (sensitiveTriggersFired.length > 0 && decision === 'NO_DOC_UPDATES' && !sensitiveReviewed) {
        const triggersStr = sensitiveTriggersFired.join(', ');
        errors.push(
            `Sensitive scope triggers detected (${triggersStr}): NO_DOC_UPDATES requires ` +
            '--sensitive-scope-reviewed true with rationale explaining why no documentation updates are needed.'
        );
    }

    const status = errors.length > 0 ? 'FAILED' : 'PASSED';
    const outcome = errors.length > 0 ? 'FAIL' : 'PASS';

    return {
        timestamp_utc: new Date().toISOString(),
        event_source: 'doc-impact-gate',
        task_id: resolvedTaskId,
        status,
        outcome,
        preflight_path: normalizePath(validated.preflight_path),
        preflight_hash_sha256: validated.preflight_hash,
        decision,
        behavior_changed: behaviorChanged,
        changelog_updated: changelogUpdated,
        sensitive_triggers_detected: sensitiveTriggersFired,
        sensitive_scope_reviewed: sensitiveReviewed,
        docs_updated: docsUpdated,
        rationale,
        violations: errors
    };
}

module.exports = {
    assessDocImpact,
    validatePreflightForDocImpact
};
