import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendTaskEvent } from './task-events';

/**
 * Canonical lifecycle event types that gates auto-emit during task execution.
 * The ordering represents the expected progression; the completion gate
 * enforces that mandatory events appear and follow this sequence.
 */
export const LIFECYCLE_EVENT_TYPES = Object.freeze({
    TASK_MODE_ENTERED: 'TASK_MODE_ENTERED',
    PLAN_CREATED: 'PLAN_CREATED',
    RULE_PACK_LOADED: 'RULE_PACK_LOADED',
    RULE_PACK_LOAD_FAILED: 'RULE_PACK_LOAD_FAILED',
    PREFLIGHT_STARTED: 'PREFLIGHT_STARTED',
    PREFLIGHT_CLASSIFIED: 'PREFLIGHT_CLASSIFIED',
    PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
    IMPLEMENTATION_STARTED: 'IMPLEMENTATION_STARTED',
    COMPILE_GATE_PASSED: 'COMPILE_GATE_PASSED',
    COMPILE_GATE_FAILED: 'COMPILE_GATE_FAILED',
    REVIEW_PHASE_STARTED: 'REVIEW_PHASE_STARTED',
    REVIEW_GATE_PASSED: 'REVIEW_GATE_PASSED',
    REVIEW_GATE_PASSED_WITH_OVERRIDE: 'REVIEW_GATE_PASSED_WITH_OVERRIDE',
    REVIEW_GATE_FAILED: 'REVIEW_GATE_FAILED',
    DOC_IMPACT_ASSESSED: 'DOC_IMPACT_ASSESSED',
    DOC_IMPACT_ASSESSMENT_FAILED: 'DOC_IMPACT_ASSESSMENT_FAILED',
    COMPLETION_GATE_PASSED: 'COMPLETION_GATE_PASSED',
    COMPLETION_GATE_FAILED: 'COMPLETION_GATE_FAILED',
    STATUS_CHANGED: 'STATUS_CHANGED',
    PROVIDER_ROUTING_DECISION: 'PROVIDER_ROUTING_DECISION'
});

/**
 * Mandatory events expected in the timeline for a code-changing task.
 * Used by timeline completeness validation to detect gaps.
 */
export const MANDATORY_CODE_CHANGE_EVENTS: readonly string[] = Object.freeze([
    'TASK_MODE_ENTERED',
    'RULE_PACK_LOADED',
    'PREFLIGHT_CLASSIFIED',
    'IMPLEMENTATION_STARTED',
    'COMPILE_GATE_PASSED',
    'REVIEW_PHASE_STARTED',
    'REVIEW_GATE_PASSED',
    'COMPLETION_GATE_PASSED'
]);

/**
 * Mandatory events expected in the timeline for a non-code-changing task.
 */
export const MANDATORY_NON_CODE_EVENTS: readonly string[] = Object.freeze([
    'TASK_MODE_ENTERED',
    'RULE_PACK_LOADED',
    'COMPILE_GATE_PASSED',
    'REVIEW_PHASE_STARTED',
    'REVIEW_GATE_PASSED',
    'COMPLETION_GATE_PASSED'
]);

/**
 * Get the set of mandatory events for a given task based on whether code changed.
 */
export function getMandatoryEvents(codeChanged: boolean): readonly string[] {
    return codeChanged ? MANDATORY_CODE_CHANGE_EVENTS : MANDATORY_NON_CODE_EVENTS;
}

export interface TimelineCompletenessResult {
    task_id: string;
    timeline_path: string;
    timeline_exists: boolean;
    events_found: string[];
    events_missing: string[];
    status: 'COMPLETE' | 'INCOMPLETE' | 'MISSING_TIMELINE';
    violations: string[];
}

/**
 * Validate that a task timeline JSONL file contains all mandatory lifecycle events.
 * Returns a structured result describing which events are present vs missing.
 */
export function validateTimelineCompleteness(
    timelinePath: string,
    taskId: string,
    codeChanged: boolean
): TimelineCompletenessResult {
    const normalizedPath = timelinePath.replace(/\\/g, '/');
    const result: TimelineCompletenessResult = {
        task_id: taskId,
        timeline_path: normalizedPath,
        timeline_exists: false,
        events_found: [],
        events_missing: [],
        status: 'MISSING_TIMELINE',
        violations: []
    };

    const resolvedPath = path.resolve(timelinePath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        result.violations.push(
            `Task timeline not found for '${taskId}': ${normalizedPath}`
        );
        return result;
    }

    result.timeline_exists = true;
    const eventTypes = new Set<string>();

    try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        for (const rawLine of content.split('\n')) {
            if (!rawLine.trim()) continue;
            try {
                const parsed = JSON.parse(rawLine) as Record<string, unknown>;
                const eventType = String(parsed.event_type || '').trim().toUpperCase();
                if (eventType) {
                    eventTypes.add(eventType);
                }
            } catch {
                // Skip parse errors; integrity inspection handles them.
            }
        }
    } catch {
        result.violations.push(
            `Task timeline unreadable for '${taskId}': ${normalizedPath}`
        );
        return result;
    }

    const mandatory = getMandatoryEvents(codeChanged);
    for (const expectedEvent of mandatory) {
        // Accept REVIEW_GATE_PASSED_WITH_OVERRIDE as satisfying REVIEW_GATE_PASSED
        if (expectedEvent === 'REVIEW_GATE_PASSED') {
            if (eventTypes.has('REVIEW_GATE_PASSED') || eventTypes.has('REVIEW_GATE_PASSED_WITH_OVERRIDE')) {
                result.events_found.push(expectedEvent);
            } else {
                result.events_missing.push(expectedEvent);
                result.violations.push(
                    `Task timeline '${normalizedPath}' is missing mandatory lifecycle event: ${expectedEvent}.`
                );
            }
            continue;
        }

        if (eventTypes.has(expectedEvent)) {
            result.events_found.push(expectedEvent);
        } else {
            result.events_missing.push(expectedEvent);
            result.violations.push(
                `Task timeline '${normalizedPath}' is missing mandatory lifecycle event: ${expectedEvent}.`
            );
        }
    }

    result.status = result.events_missing.length > 0 ? 'INCOMPLETE' : 'COMPLETE';
    return result;
}

export interface AutoEmitOptions {
    actor?: string;
    passThru?: boolean;
    eventsRoot?: string;
}

function getTimelinePath(repoRoot: string, taskId: string, eventsRoot?: string): string {
    const root = eventsRoot
        ? path.resolve(String(eventsRoot))
        : path.join(repoRoot, 'runtime', 'task-events');
    return path.join(root, `${taskId}.jsonl`);
}

function hasTaskEvent(repoRoot: string, taskId: string, eventType: string, eventsRoot?: string): boolean {
    if (!repoRoot || !taskId || !eventType) {
        return false;
    }
    const timelinePath = getTimelinePath(repoRoot, taskId, eventsRoot);
    const resolvedPath = path.resolve(timelinePath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return false;
    }

    try {
        const lines = fs.readFileSync(resolvedPath, 'utf8').split('\n');
        for (const rawLine of lines) {
            if (!rawLine.trim()) {
                continue;
            }
            try {
                const parsed = JSON.parse(rawLine) as Record<string, unknown>;
                if (String(parsed.event_type || '').trim().toUpperCase() === String(eventType).trim().toUpperCase()) {
                    return true;
                }
            } catch {
                // Integrity inspection handles malformed lines elsewhere.
            }
        }
    } catch {
        return false;
    }

    return false;
}

function emitLifecycleEvent(
    repoRoot: string,
    taskId: string,
    eventType: string,
    outcome: string,
    message: string,
    details: unknown,
    options: AutoEmitOptions = {},
    emitOnce = false
): ReturnType<typeof appendTaskEvent> {
    if (!repoRoot || !taskId) {
        return null;
    }
    try {
        if (emitOnce && hasTaskEvent(repoRoot, taskId, eventType, options.eventsRoot)) {
            return null;
        }
        return appendTaskEvent(
            repoRoot,
            taskId,
            eventType,
            outcome,
            message,
            details,
            {
                actor: options.actor || 'gate',
                passThru: options.passThru ?? true,
                eventsRoot: options.eventsRoot
            }
        );
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`WARNING: ${String(eventType).toLowerCase()} event emit failed: ${msg}\n`);
        return null;
    }
}

export function emitPlanCreatedEvent(
    repoRoot: string,
    taskId: string,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    return emitLifecycleEvent(
        repoRoot,
        taskId,
        LIFECYCLE_EVENT_TYPES.PLAN_CREATED,
        'INFO',
        'Task plan created.',
        details,
        options,
        true
    );
}

export function emitPreflightStartedEvent(
    repoRoot: string,
    taskId: string,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    return emitLifecycleEvent(
        repoRoot,
        taskId,
        LIFECYCLE_EVENT_TYPES.PREFLIGHT_STARTED,
        'INFO',
        'Preflight classification started.',
        details,
        options
    );
}

export function emitPreflightFailedEvent(
    repoRoot: string,
    taskId: string,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    return emitLifecycleEvent(
        repoRoot,
        taskId,
        LIFECYCLE_EVENT_TYPES.PREFLIGHT_FAILED,
        'FAIL',
        'Preflight classification failed.',
        details,
        options
    );
}

export function emitImplementationStartedEvent(
    repoRoot: string,
    taskId: string,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    return emitLifecycleEvent(
        repoRoot,
        taskId,
        LIFECYCLE_EVENT_TYPES.IMPLEMENTATION_STARTED,
        'INFO',
        'Implementation started.',
        details,
        options,
        true
    );
}

export function emitReviewPhaseStartedEvent(
    repoRoot: string,
    taskId: string,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    return emitLifecycleEvent(
        repoRoot,
        taskId,
        LIFECYCLE_EVENT_TYPES.REVIEW_PHASE_STARTED,
        'INFO',
        'Review phase started.',
        details,
        options,
        true
    );
}

/**
 * Auto-emit COMPLETION_GATE_PASSED or COMPLETION_GATE_FAILED to the task timeline.
 * Called as a side effect of the completion-gate command.
 */
export function emitCompletionGateEvent(
    repoRoot: string,
    taskId: string,
    passed: boolean,
    details: unknown,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    if (!repoRoot || !taskId) return null;
    try {
        return appendTaskEvent(
            repoRoot,
            taskId,
            passed ? LIFECYCLE_EVENT_TYPES.COMPLETION_GATE_PASSED : LIFECYCLE_EVENT_TYPES.COMPLETION_GATE_FAILED,
            passed ? 'PASS' : 'FAIL',
            passed ? 'Completion gate passed.' : 'Completion gate failed.',
            details,
            {
                actor: options.actor || 'gate',
                passThru: options.passThru ?? true,
                eventsRoot: options.eventsRoot
            }
        );
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`WARNING: completion-gate event emit failed: ${msg}\n`);
        return null;
    }
}

/**
 * Auto-emit STATUS_CHANGED to the task timeline.
 * Called when a task transitions between lifecycle statuses.
 */
export function emitStatusChangedEvent(
    repoRoot: string,
    taskId: string,
    previousStatus: string,
    newStatus: string,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    if (!repoRoot || !taskId) return null;
    try {
        return appendTaskEvent(
            repoRoot,
            taskId,
            LIFECYCLE_EVENT_TYPES.STATUS_CHANGED,
            'INFO',
            `Task status changed: ${previousStatus} → ${newStatus}.`,
            {
                previous_status: previousStatus,
                new_status: newStatus
            },
            {
                actor: options.actor || 'orchestrator',
                passThru: options.passThru ?? true,
                eventsRoot: options.eventsRoot
            }
        );
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`WARNING: status-changed event emit failed: ${msg}\n`);
        return null;
    }
}

/**
 * Auto-emit PROVIDER_ROUTING_DECISION to the task timeline.
 * Called when a provider bridge routes to a specific skill or profile.
 */
export function emitProviderRoutingEvent(
    repoRoot: string,
    taskId: string,
    provider: string,
    routedTo: string,
    reason: string,
    options: AutoEmitOptions = {}
): ReturnType<typeof appendTaskEvent> {
    if (!repoRoot || !taskId) return null;
    try {
        return appendTaskEvent(
            repoRoot,
            taskId,
            LIFECYCLE_EVENT_TYPES.PROVIDER_ROUTING_DECISION,
            'INFO',
            `Provider routing: ${provider} → ${routedTo}.`,
            {
                provider,
                routed_to: routedTo,
                reason
            },
            {
                actor: options.actor || 'orchestrator',
                passThru: options.passThru ?? true,
                eventsRoot: options.eventsRoot
            }
        );
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`WARNING: provider-routing event emit failed: ${msg}\n`);
        return null;
    }
}
