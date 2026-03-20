const fs = require('node:fs');
const path = require('node:path');

const { assertValidTaskId, inspectTaskEventFile } = require('../gate-runtime/task-events.ts');
const { joinOrchestratorPath, normalizePath, resolvePathInsideRepo, toPosix } = require('./helpers.ts');

/**
 * Parse an ISO 8601 timestamp to a Date, matching Python parse_timestamp.
 */
function parseTimestamp(value) {
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
function formatTimestamp(value) {
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

/**
 * Audit command compactness (simple policy check).
 * Matches Python audit_command_compactness shape.
 */
function auditCommandCompactness(commandText, options = {}) {
    const mode = options.mode || 'scan';
    const justification = options.justification || '';
    const warnings = [];

    if (!commandText || !commandText.trim()) {
        return { command: commandText, mode, justification, warnings, warning_count: 0 };
    }

    const unboundedPatterns = [
        { pattern: /\bgit\s+diff\b(?!.*--stat)(?!.*--name-only)(?!.*--numstat)/i, label: 'unbounded git diff' },
        { pattern: /\bdocker\s+logs\b(?!.*--tail)(?!.*--since)/i, label: 'unbounded docker logs' },
        { pattern: /\bpytest\b(?!.*-q)(?!.*--tb=short)(?!.*--tb=line)(?!.*--tb=no)/i, label: 'verbose pytest' }
    ];

    for (const { pattern, label } of unboundedPatterns) {
        if (pattern.test(commandText)) {
            if (justification && justification.trim().length >= 10) continue;
            warnings.push(`Command may produce unbounded output: ${label}`);
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
function getCommandAuditFromDetails(details) {
    if (!details || typeof details !== 'object') return null;

    const existing = details.command_policy_audit;
    if (existing && typeof existing === 'object') return existing;

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

/**
 * Build task events summary.
 * Matches task-events-summary.sh output shape.
 */
function buildTaskEventsSummary(options) {
    const taskId = options.taskId;
    const eventsRoot = options.eventsRoot;
    const includeDetails = options.includeDetails || false;
    const asJson = options.asJson || false;

    const safeTaskId = assertValidTaskId(taskId);
    const taskEventFile = path.join(eventsRoot, `${safeTaskId}.jsonl`);

    if (!fs.existsSync(taskEventFile) || !fs.statSync(taskEventFile).isFile()) {
        throw new Error(`Task events file not found: ${taskEventFile}`);
    }

    const rawLines = fs.readFileSync(taskEventFile, 'utf8').split('\n').filter(l => l.trim());
    const events = [];
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

    events.sort((a, b) => {
        const ta = parseTimestamp(typeof a === 'object' ? a.timestamp_utc : null);
        const tb = parseTimestamp(typeof b === 'object' ? b.timestamp_utc : null);
        return ta.getTime() - tb.getTime();
    });

    const summary = {
        task_id: safeTaskId,
        source_path: toPosix(taskEventFile),
        events_count: events.length,
        parse_errors: parseErrors,
        integrity: integrityReport,
        command_policy_warnings: [],
        command_policy_warning_count: 0,
        first_event_utc: events.length > 0 ? formatTimestamp(events[0].timestamp_utc) : null,
        last_event_utc: events.length > 0 ? formatTimestamp(events[events.length - 1].timestamp_utc) : null,
        timeline: []
    };

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const index = i + 1;
        const details = event.details;
        const commandPolicyAudit = getCommandAuditFromDetails(details);
        if (commandPolicyAudit && typeof commandPolicyAudit === 'object' && parseInt(commandPolicyAudit.warning_count || 0) > 0) {
            summary.command_policy_warnings.push(...(commandPolicyAudit.warnings || []));
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

    return summary;
}

/**
 * Format task events summary as text.
 */
function formatTaskEventsSummaryText(summary, includeDetails = false) {
    const lines = [
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

module.exports = {
    auditCommandCompactness,
    buildTaskEventsSummary,
    formatTaskEventsSummaryText,
    formatTimestamp,
    getCommandAuditFromDetails,
    parseTimestamp
};
