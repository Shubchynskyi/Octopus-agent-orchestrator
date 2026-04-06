import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertValidTaskId, inspectTaskEventFile, forEachJsonlLine } from '../gate-runtime/task-events';
import { coerceIntLike } from '../gate-runtime/token-telemetry';
import { resolvePathInsideRepo, toPosix } from './helpers';

const REVIEW_CONTEXT_LABELS = Object.freeze({
    code: 'code review context',
    db: 'DB review context',
    security: 'security review context',
    refactor: 'refactor review context',
    api: 'API review context',
    test: 'test review context',
    performance: 'performance review context',
    infra: 'infra review context',
    dependency: 'dependency review context'
});

/**
 * Parse an ISO 8601 timestamp to a Date, matching Python parse_timestamp.
 */
export function parseTimestamp(value: unknown): Date {
    if (value == null) return new Date(0);
    const text = String(value).trim();
    if (!text) return new Date(0);
    const candidate = text.replace('Z', '+00:00');
    try {
        const parsed = new Date(candidate);
        if (isNaN(parsed.getTime())) return new Date(0);
        return parsed;
    } catch {
        return new Date(0);
    }
}

/**
 * Format a timestamp to ISO 8601 UTC string.
 */
export function formatTimestamp(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        return value.toISOString();
    }
    const text = String(value).trim();
    if (!text) return null;
    try {
        const parsed = new Date(text.replace('Z', '+00:00'));
        if (isNaN(parsed.getTime())) return text;
        return parsed.toISOString();
    } catch {
        return text;
    }
}

interface AuditCommandOptions {
    mode?: string;
    justification?: string;
}

/**
 * Audit command compactness (simple policy check).
 * Matches Python audit_command_compactness shape.
 */
export function auditCommandCompactness(commandText: string, options: AuditCommandOptions = {}) {
    const mode = options.mode || 'scan';
    const justification = options.justification || '';
    const warnings: string[] = [];

    if (!commandText || !commandText.trim()) {
        return { command: commandText, mode, justification, warnings, warning_count: 0 };
    }

    const unboundedPatterns = [
        {
            pattern: /\bgit\s+diff\b(?!.*--stat)(?!.*--name-only)(?!.*--numstat)/i,
            warning: 'Use `git diff --stat` or a path-scoped `git diff` before full `git diff`.'
        },
        {
            pattern: /\bdocker\s+logs\b(?!.*--tail)(?!.*--since)/i,
            warning: 'Use `docker logs --tail 50` before full container logs.'
        },
        {
            pattern: /\bpytest\b(?!.*-q)(?!.*--tb=short)(?!.*--tb=line)(?!.*--tb=no)/i,
            warning: 'Use `pytest -q --tb=short` first; reserve verbose traceback for localized failures.'
        }
    ];

    for (const { pattern, warning } of unboundedPatterns) {
        if (pattern.test(commandText)) {
            if (justification && justification.trim().length >= 10) continue;
            warnings.push(warning);
        }
    }

    return {
        command: commandText,
        mode,
        justification: justification || '',
        warnings,
        warning_count: warnings.length
    };
}

/**
 * Extract command audit from event details, matching Python get_command_audit_from_details.
 */
export function getCommandAuditFromDetails(details: Record<string, unknown> | null | undefined) {
    if (!details || typeof details !== 'object') return null;

    const existing = details.command_policy_audit;
    if (existing && typeof existing === 'object') return existing as Record<string, unknown>;

    let commandText = '';
    for (const key of ['command', 'command_text', 'shell_command']) {
        const value = details[key];
        if (typeof value === 'string' && value.trim()) {
            commandText = value.trim();
            break;
        }
    }
    if (!commandText) return null;

    const mode = String(details.command_mode || details.mode || 'scan');
    const justification = String(details.command_justification || details.justification || '');
    return auditCommandCompactness(commandText, { mode, justification });
}

function resolveArtifactPathForRead(pathValue: unknown, repoRoot: string | null): string | null {
    if (pathValue == null) {
        return null;
    }
    const text = String(pathValue).trim();
    if (!text) {
        return null;
    }
    if (repoRoot) {
        try {
            return resolvePathInsideRepo(text, repoRoot, { allowMissing: true });
        } catch {
            return null;
        }
    }
    if (path.isAbsolute(text)) {
        return path.resolve(text);
    }
    return null;
}

function readJsonArtifactForSummary(pathValue: unknown, repoRoot: string | null): { path: string; payload: Record<string, unknown> } | null {
    const resolvedPath = resolveArtifactPathForRead(pathValue, repoRoot);
    if (!resolvedPath) {
        return null;
    }
    try {
        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
            return null;
        }
        return {
            path: toPosix(resolvedPath),
            payload: JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
        };
    } catch {
        return null;
    }
}

export function getOutputTelemetryFromPayload(payload: Record<string, unknown> | null | undefined) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const candidate = (payload.output_telemetry && typeof payload.output_telemetry === 'object'
        ? payload.output_telemetry
        : payload) as Record<string, unknown>;
    const savedTokens = coerceIntLike(candidate.estimated_saved_tokens);
    if (savedTokens == null || savedTokens <= 0) {
        return null;
    }
    const rawTokenEstimate = coerceIntLike(candidate.raw_token_count_estimate);
    const outputTokenEstimate = coerceIntLike(candidate.filtered_token_count_estimate);
    return {
        raw_token_count_estimate: rawTokenEstimate != null && rawTokenEstimate > 0 ? rawTokenEstimate : 0,
        output_token_count_estimate: outputTokenEstimate != null && outputTokenEstimate >= 0 ? outputTokenEstimate : null,
        estimated_saved_tokens: savedTokens,
        baseline_known: rawTokenEstimate != null && rawTokenEstimate > 0
    };
}

function getReviewContextSummary(payload: Record<string, unknown> | null | undefined) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const ruleContext = payload.rule_context as Record<string, unknown> | null | undefined;
    if (!ruleContext || typeof ruleContext !== 'object') {
        return null;
    }
    const summary = ruleContext.summary as Record<string, unknown> | null | undefined;
    if (!summary || typeof summary !== 'object') {
        return null;
    }
    const savedTokens = coerceIntLike(summary.estimated_saved_tokens);
    if (savedTokens == null || savedTokens <= 0) {
        return null;
    }
    const rawTokenEstimate = coerceIntLike(summary.original_token_count_estimate);
    const outputTokenEstimate = coerceIntLike(summary.output_token_count_estimate);
    return {
        raw_token_count_estimate: rawTokenEstimate != null && rawTokenEstimate > 0 ? rawTokenEstimate : 0,
        output_token_count_estimate: outputTokenEstimate != null && outputTokenEstimate >= 0 ? outputTokenEstimate : null,
        estimated_saved_tokens: savedTokens,
        baseline_known: rawTokenEstimate != null && rawTokenEstimate > 0
    };
}

function getReviewContextLabel(reviewType: string): string {
    const normalized = String(reviewType || '').trim().toLowerCase();
    return (REVIEW_CONTEXT_LABELS as Record<string, string>)[normalized] || 'review context';
}

function getCommandOutputLabel(eventType: string): string {
    const normalized = String(eventType || '').trim().toUpperCase();
    if (normalized.startsWith('COMPILE_GATE_')) {
        return 'compile gate output';
    }
    if (normalized.startsWith('REVIEW_GATE_')) {
        return 'review gate output';
    }
    return 'gate output';
}

interface TokenContributionEntry {
    label: string;
    estimated_saved_tokens: number;
    raw_token_count_estimate: number;
    output_token_count_estimate: number | null;
    source_kind: string;
    source_key: string;
    source_path?: string | null;
    source_event_type?: string | null;
    source_index?: number | null;
}

function addTokenEconomyContribution(breakdown: TokenContributionEntry[], seenKeys: Set<string>, contribution: Partial<TokenContributionEntry> & { estimated_saved_tokens: number; source_key?: string; label?: string }): void {
    if (!contribution || contribution.estimated_saved_tokens <= 0) {
        return;
    }
    const sourceKey = String(contribution.source_key || '').trim();
    if (!sourceKey || seenKeys.has(sourceKey)) {
        return;
    }
    seenKeys.add(sourceKey);
    breakdown.push({
        label: contribution.label || '',
        estimated_saved_tokens: contribution.estimated_saved_tokens,
        raw_token_count_estimate: contribution.raw_token_count_estimate || 0,
        output_token_count_estimate: contribution.output_token_count_estimate ?? null,
        source_kind: contribution.source_kind || '',
        source_key: sourceKey,
        source_path: contribution.source_path || null,
        source_event_type: contribution.source_event_type || null,
        source_index: contribution.source_index || null
    });
}

function collectReviewContextContributions(container: Record<string, unknown>, repoRoot: string | null, breakdown: TokenContributionEntry[], seenKeys: Set<string>): void {
    if (!container || typeof container !== 'object') {
        return;
    }
    const artifactEvidence = container.artifact_evidence as Record<string, unknown> | null | undefined;
    const checked = artifactEvidence && Array.isArray((artifactEvidence as Record<string, unknown>).checked)
        ? (artifactEvidence as Record<string, unknown>).checked as Record<string, unknown>[]
        : [];
    for (const entry of checked) {
        if (!entry || typeof entry !== 'object' || !entry.review_context_path) {
            continue;
        }
        const reviewContextArtifact = readJsonArtifactForSummary(entry.review_context_path, repoRoot);
        if (!reviewContextArtifact) {
            continue;
        }
        const summary = getReviewContextSummary(reviewContextArtifact.payload);
        if (!summary) {
            continue;
        }
        addTokenEconomyContribution(breakdown, seenKeys, {
            label: getReviewContextLabel(String(reviewContextArtifact.payload.review_type || entry.review || '')),
            estimated_saved_tokens: summary.estimated_saved_tokens,
            raw_token_count_estimate: summary.raw_token_count_estimate,
            output_token_count_estimate: summary.output_token_count_estimate,
            source_kind: 'review_context',
            source_key: `review-context:${reviewContextArtifact.path}`,
            source_path: reviewContextArtifact.path
        });
    }
}

function buildTokenEconomySummary(events: Record<string, unknown>[], repoRoot: string | null) {
    const breakdown: TokenContributionEntry[] = [];
    const seenKeys = new Set<string>();

    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const rawDetails = event && typeof event === 'object' ? event.details : null;
        if (!rawDetails || typeof rawDetails !== 'object') {
            continue;
        }
        const details = rawDetails as Record<string, unknown>;

        const eventType = String(event.event_type || 'UNKNOWN');
        let reviewEvidencePayload: Record<string, unknown> | null = null;

        if (typeof details.review_evidence_path === 'string' && details.review_evidence_path.trim()) {
            const reviewEvidence = readJsonArtifactForSummary(details.review_evidence_path, repoRoot);
            if (reviewEvidence) {
                reviewEvidencePayload = reviewEvidence.payload;
                const reviewTelemetry = getOutputTelemetryFromPayload(reviewEvidence.payload);
                if (reviewTelemetry) {
                    addTokenEconomyContribution(breakdown, seenKeys, {
                        label: getCommandOutputLabel(eventType),
                        estimated_saved_tokens: reviewTelemetry.estimated_saved_tokens,
                        raw_token_count_estimate: reviewTelemetry.raw_token_count_estimate,
                        output_token_count_estimate: reviewTelemetry.output_token_count_estimate,
                        source_kind: 'command_output',
                        source_key: `command-output:${reviewEvidence.path}`,
                        source_path: reviewEvidence.path,
                        source_event_type: eventType,
                        source_index: index + 1
                    });
                }
                collectReviewContextContributions(reviewEvidence.payload, repoRoot, breakdown, seenKeys);
            }
        }

        if (!reviewEvidencePayload) {
            const directTelemetry = getOutputTelemetryFromPayload(details);
            if (directTelemetry) {
                addTokenEconomyContribution(breakdown, seenKeys, {
                    label: getCommandOutputLabel(eventType),
                    estimated_saved_tokens: directTelemetry.estimated_saved_tokens,
                    raw_token_count_estimate: directTelemetry.raw_token_count_estimate,
                    output_token_count_estimate: directTelemetry.output_token_count_estimate,
                    source_kind: 'command_output',
                    source_key: `command-output:event:${index + 1}:${eventType}`,
                    source_event_type: eventType,
                    source_index: index + 1
                });
            }
            collectReviewContextContributions(details, repoRoot, breakdown, seenKeys);
        }
    }

    const totalSavedTokens = breakdown.reduce(function (total, item) {
        return total + item.estimated_saved_tokens;
    }, 0);
    const totalRawTokens = breakdown.reduce(function (total, item) {
        return total + (item.raw_token_count_estimate || 0);
    }, 0);
    const totalOutputTokens = breakdown.reduce(function (total, item) {
        return total + (item.output_token_count_estimate != null ? item.output_token_count_estimate : 0);
    }, 0);
    const baselineKnown = breakdown.length > 0 && breakdown.every(function (item) {
        return (item.raw_token_count_estimate || 0) > 0;
    });

    let visibleSummaryLine = null;
    if (totalSavedTokens > 0 && breakdown.length > 0) {
        const parts = breakdown.map(function (item) {
            return `${item.estimated_saved_tokens} ${item.label}`;
        }).join(' + ');
        if (baselineKnown && totalRawTokens > 0) {
            const savedPercent = Math.round((totalSavedTokens * 100.0) / totalRawTokens);
            visibleSummaryLine = `Saved tokens: ~${totalSavedTokens} (~${savedPercent}%) (${parts}).`;
        } else {
            visibleSummaryLine = `Saved tokens: ~${totalSavedTokens} (${parts}).`;
        }
    }

    return {
        total_estimated_saved_tokens: totalSavedTokens,
        total_raw_token_count_estimate: totalRawTokens,
        total_output_token_count_estimate: totalOutputTokens,
        baseline_known: baselineKnown,
        measurable_part_count: breakdown.length,
        breakdown,
        visible_summary_line: visibleSummaryLine
    };
}

export interface BuildTaskEventsSummaryOptions {
    taskId: string;
    eventsRoot: string;
    repoRoot?: string | null;
}

/**
 * Build task events summary.
 * Produces the canonical task-events summary output shape.
 */
export function buildTaskEventsSummary(options: BuildTaskEventsSummaryOptions) {
    const taskId = options.taskId;
    const eventsRoot = options.eventsRoot;
    const repoRoot = options.repoRoot ? path.resolve(String(options.repoRoot)) : null;

    const safeTaskId = assertValidTaskId(taskId);
    const taskEventFile = path.join(eventsRoot, `${safeTaskId}.jsonl`);

    if (!fs.existsSync(taskEventFile) || !fs.statSync(taskEventFile).isFile()) {
        throw new Error(`Task events file not found: ${taskEventFile}`);
    }

    const rawLines: string[] = [];
    forEachJsonlLine(taskEventFile, (line: string) => {
        rawLines.push(line);
    });
    const events: Record<string, unknown>[] = [];
    let parseErrors = 0;
    const integrityReport = inspectTaskEventFile(taskEventFile, safeTaskId);

    for (const line of rawLines) {
        try {
            const event = JSON.parse(line);
            if (event != null) events.push(event);
        } catch {
            parseErrors++;
        }
    }

    events.sort(function (a, b) {
        const ta = parseTimestamp(typeof a === 'object' ? a.timestamp_utc : null);
        const tb = parseTimestamp(typeof b === 'object' ? b.timestamp_utc : null);
        return ta.getTime() - tb.getTime();
    });

    interface TimelineEntry {
        index: number;
        timestamp_utc: string | null;
        event_type: string;
        outcome: string;
        actor: string | null;
        message: string;
        details: unknown;
        command_policy_audit: ReturnType<typeof getCommandAuditFromDetails>;
    }

    const summary: {
        task_id: string;
        source_path: string;
        events_count: number;
        parse_errors: number;
        integrity: ReturnType<typeof inspectTaskEventFile>;
        command_policy_warnings: string[];
        command_policy_warning_count: number;
        first_event_utc: string | null;
        last_event_utc: string | null;
        token_economy: ReturnType<typeof buildTokenEconomySummary> | null;
        timeline: TimelineEntry[];
    } = {
        task_id: safeTaskId,
        source_path: toPosix(taskEventFile),
        events_count: events.length,
        parse_errors: parseErrors,
        integrity: integrityReport,
        command_policy_warnings: [],
        command_policy_warning_count: 0,
        first_event_utc: events.length > 0 ? formatTimestamp(events[0].timestamp_utc) : null,
        last_event_utc: events.length > 0 ? formatTimestamp(events[events.length - 1].timestamp_utc) : null,
        token_economy: null,
        timeline: []
    };

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const index = i + 1;
        const details = event.details as Record<string, unknown> | null | undefined;
        const commandPolicyAudit = getCommandAuditFromDetails(details) as Record<string, unknown> | null;
        if (commandPolicyAudit && typeof commandPolicyAudit === 'object' && parseInt(String(commandPolicyAudit.warning_count || 0), 10) > 0) {
            summary.command_policy_warnings.push(...((commandPolicyAudit.warnings as string[]) || []));
        }
        summary.timeline.push({
            index,
            timestamp_utc: formatTimestamp(event.timestamp_utc),
            event_type: String(event.event_type || 'UNKNOWN'),
            outcome: String(event.outcome || 'UNKNOWN'),
            actor: event.actor != null ? String(event.actor) : null,
            message: String(event.message || ''),
            details,
            command_policy_audit: commandPolicyAudit
        });
    }
    summary.command_policy_warning_count = summary.command_policy_warnings.length;
    summary.token_economy = buildTokenEconomySummary(events, repoRoot);

    return summary;
}

export interface TaskEventsSummaryResult {
    task_id: string;
    source_path: string;
    events_count: number;
    parse_errors: number;
    integrity: {
        status: string;
        integrity_event_count: number;
        legacy_event_count: number;
        violations: string[];
    };
    command_policy_warnings: string[];
    command_policy_warning_count: number;
    first_event_utc: string | null;
    last_event_utc: string | null;
    token_economy: {
        visible_summary_line: string | null;
    } | null;
    timeline: {
        index: number;
        timestamp_utc: string | null;
        event_type: string;
        outcome: string;
        actor: string | null;
        message: string;
        details: unknown;
    }[];
}

/**
 * Format task events summary as text.
 */
export function formatTaskEventsSummaryText(summary: TaskEventsSummaryResult, includeDetails = false): string {
    const lines: string[] = [
        `Task: ${summary.task_id}`,
        `Source: ${summary.source_path}`,
        `Events: ${summary.events_count}`,
        `IntegrityStatus: ${summary.integrity.status}`
    ];

    if (summary.parse_errors > 0) lines.push(`ParseErrors: ${summary.parse_errors}`);
    if (summary.integrity.integrity_event_count > 0) lines.push(`IntegrityEvents: ${summary.integrity.integrity_event_count}`);
    if (summary.integrity.legacy_event_count > 0) lines.push(`LegacyEvents: ${summary.integrity.legacy_event_count}`);
    if (summary.integrity.violations.length > 0) lines.push(`IntegrityViolations: ${summary.integrity.violations.length}`);
    if (summary.first_event_utc) lines.push(`FirstEventUTC: ${summary.first_event_utc}`);
    if (summary.last_event_utc) lines.push(`LastEventUTC: ${summary.last_event_utc}`);
    if (summary.command_policy_warning_count > 0) lines.push(`CommandPolicyWarnings: ${summary.command_policy_warning_count}`);
    if (summary.token_economy && summary.token_economy.visible_summary_line) lines.push(summary.token_economy.visible_summary_line);

    lines.push('', 'Timeline:');

    for (const item of summary.timeline) {
        const timestamp = item.timestamp_utc || '';
        let line = `[${String(item.index).padStart(2, '0')}] ${timestamp} | ${item.event_type} | ${item.outcome}`;
        if (item.actor && item.actor.trim()) line += ` | actor=${item.actor}`;
        if (item.message && item.message.trim()) line += ` | ${item.message}`;
        lines.push(line);

        if (includeDetails && item.details != null) {
            const detailsJson = JSON.stringify(item.details, null, 0).replace(/\n/g, '');
            lines.push(`       details=${detailsJson}`);
        }
    }

    if (summary.integrity.violations.length > 0) {
        lines.push('', 'IntegrityViolations:');
        for (const violation of summary.integrity.violations) {
            lines.push(`- ${violation}`);
        }
    }
    if (summary.command_policy_warning_count > 0) {
        lines.push('', 'CommandPolicyWarnings:');
        for (const warning of summary.command_policy_warnings) {
            lines.push(`- ${warning}`);
        }
    }

    return lines.join('\n');
}

