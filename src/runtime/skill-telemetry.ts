const { appendTaskEvent } = require('../gate-runtime/task-events.ts');

/**
 * Telemetry event types for skill activation and reference loading.
 * Used by the runtime task-event stream to track which skills and
 * references were suggested, selected, or loaded during a task.
 */
const SKILL_TELEMETRY_EVENT_TYPES = Object.freeze({
    SKILL_SUGGESTED: 'SKILL_SUGGESTED',
    SKILL_SELECTED: 'SKILL_SELECTED',
    SKILL_REFERENCE_LOADED: 'SKILL_REFERENCE_LOADED'
});

const SKILL_TELEMETRY_ACTOR = 'skill-telemetry';

function buildSkillTelemetryDetails(options) {
    const details = {
        telemetry_type: 'skill_activation',
        skill_id: options.skillId || null,
        reference_path: options.referencePath || null,
        trigger_reason: options.triggerReason || null
    };

    if (typeof options.score === 'number') {
        details.score = options.score;
    }
    if (options.packId) {
        details.pack_id = options.packId;
    }
    if (options.matches) {
        details.matches = options.matches;
    }

    return details;
}

/**
 * Core emit helper. Wraps appendTaskEvent with non-blocking semantics:
 * errors are caught and logged to stderr, never propagated.
 */
function emitSkillTelemetryEvent(bundleRoot, taskId, eventType, message, detailOptions, appendOptions) {
    if (!bundleRoot || !taskId) {
        return null;
    }

    const details = buildSkillTelemetryDetails(detailOptions || {});

    try {
        return appendTaskEvent(
            bundleRoot,
            taskId,
            eventType,
            'INFO',
            message,
            details,
            Object.assign({ actor: SKILL_TELEMETRY_ACTOR }, appendOptions || {})
        );
    } catch (error) {
        try {
            process.stderr.write(
                `WARNING: skill-telemetry emit failed: ${(error && error.message) || error}\n`
            );
        } catch {
            // swallow
        }
        return null;
    }
}

function emitSkillSuggestedEvent(bundleRoot, taskId, suggestion, triggerReason, appendOptions) {
    return emitSkillTelemetryEvent(
        bundleRoot,
        taskId,
        SKILL_TELEMETRY_EVENT_TYPES.SKILL_SUGGESTED,
        `Skill suggested: ${suggestion && suggestion.id}`,
        {
            skillId: suggestion && suggestion.id,
            packId: (suggestion && suggestion.pack) || null,
            triggerReason: triggerReason || 'context_match',
            score: suggestion && suggestion.score,
            matches: (suggestion && suggestion.matches) || null
        },
        appendOptions
    );
}

function emitSkillSelectedEvent(bundleRoot, taskId, skillId, packId, triggerReason, appendOptions) {
    return emitSkillTelemetryEvent(
        bundleRoot,
        taskId,
        SKILL_TELEMETRY_EVENT_TYPES.SKILL_SELECTED,
        `Skill selected: ${skillId}`,
        {
            skillId: skillId,
            packId: packId || null,
            triggerReason: triggerReason || 'user_selected'
        },
        appendOptions
    );
}

function emitSkillReferenceLoadedEvent(bundleRoot, taskId, referencePath, skillId, triggerReason, appendOptions) {
    return emitSkillTelemetryEvent(
        bundleRoot,
        taskId,
        SKILL_TELEMETRY_EVENT_TYPES.SKILL_REFERENCE_LOADED,
        `Reference loaded: ${referencePath}`,
        {
            skillId: skillId || null,
            referencePath: referencePath,
            triggerReason: triggerReason || 'bridge_route'
        },
        appendOptions
    );
}

module.exports = {
    SKILL_TELEMETRY_ACTOR,
    SKILL_TELEMETRY_EVENT_TYPES,
    buildSkillTelemetryDetails,
    emitSkillTelemetryEvent,
    emitSkillSuggestedEvent,
    emitSkillSelectedEvent,
    emitSkillReferenceLoadedEvent
};
