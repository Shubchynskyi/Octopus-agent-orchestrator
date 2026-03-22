const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    parseTimestamp,
    formatTimestamp,
    auditCommandCompactness,
    getCommandAuditFromDetails,
    buildTaskEventsSummary,
    formatTaskEventsSummaryText,
    getOutputTelemetryFromPayload
} = require('../../../src/gates/task-events-summary.ts');

describe('gates/task-events-summary', () => {
    describe('parseTimestamp', () => {
        it('parses ISO 8601 timestamp', () => {
            const date = parseTimestamp('2024-01-15T10:30:00Z');
            assert.ok(date instanceof Date);
            assert.ok(date.getTime() > 0);
        });
        it('returns epoch for null', () => {
            const date = parseTimestamp(null);
            assert.equal(date.getTime(), 0);
        });
        it('returns epoch for empty string', () => {
            const date = parseTimestamp('');
            assert.equal(date.getTime(), 0);
        });
    });

    describe('formatTimestamp', () => {
        it('formats Date to ISO string', () => {
            const result = formatTimestamp(new Date('2024-01-15T10:30:00Z'));
            assert.ok(result.includes('2024-01-15'));
        });
        it('formats string timestamp', () => {
            const result = formatTimestamp('2024-01-15T10:30:00Z');
            assert.ok(result.includes('2024-01-15'));
        });
        it('returns null for null', () => {
            assert.equal(formatTimestamp(null), null);
        });
    });

    describe('auditCommandCompactness', () => {
        it('warns about unbounded git diff', () => {
            const result = auditCommandCompactness('git diff HEAD');
            assert.ok(result.warning_count > 0);
            assert.ok(result.warnings.some(w => w.includes('git diff')));
        });
        it('does not warn about bounded git diff', () => {
            const result = auditCommandCompactness('git diff --stat HEAD');
            assert.equal(result.warning_count, 0);
        });
        it('warns about unbounded docker logs', () => {
            const result = auditCommandCompactness('docker logs container-name');
            assert.ok(result.warning_count > 0);
        });
        it('does not warn about bounded docker logs', () => {
            const result = auditCommandCompactness('docker logs --tail 100 container-name');
            assert.equal(result.warning_count, 0);
        });
        it('skips warning with valid justification', () => {
            const result = auditCommandCompactness('git diff HEAD', { justification: 'localized failure reproduction needed' });
            assert.equal(result.warning_count, 0);
        });
        it('returns zero warnings for safe commands', () => {
            const result = auditCommandCompactness('npm run build');
            assert.equal(result.warning_count, 0);
        });
    });

    describe('getCommandAuditFromDetails', () => {
        it('extracts command from details.command', () => {
            const result = getCommandAuditFromDetails({ command: 'git diff HEAD' });
            assert.ok(result);
            assert.ok(result.warning_count > 0);
        });
        it('returns existing command_policy_audit if present', () => {
            const existing = { warnings: [], warning_count: 0 };
            const result = getCommandAuditFromDetails({ command_policy_audit: existing });
            assert.deepEqual(result, existing);
        });
        it('returns null when no command found', () => {
            assert.equal(getCommandAuditFromDetails({}), null);
            assert.equal(getCommandAuditFromDetails(null), null);
        });
    });

    describe('buildTaskEventsSummary', () => {
        function createTaskEvents(tmpDir, taskId, events) {
            const eventsDir = path.join(tmpDir, 'runtime', 'task-events');
            fs.mkdirSync(eventsDir, { recursive: true });
            const filePath = path.join(eventsDir, `${taskId}.jsonl`);
            const lines = events.map(e => JSON.stringify(e));
            fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
            return eventsDir;
        }

        it('builds summary from task events', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-summary-'));
            const events = [
                {
                    timestamp_utc: '2024-01-15T10:00:00Z',
                    task_id: 'T-001',
                    event_type: 'PREFLIGHT_CLASSIFIED',
                    outcome: 'INFO',
                    actor: 'gate',
                    message: 'Preflight completed.'
                },
                {
                    timestamp_utc: '2024-01-15T10:05:00Z',
                    task_id: 'T-001',
                    event_type: 'COMPILE_GATE_PASSED',
                    outcome: 'PASS',
                    actor: 'gate',
                    message: 'Compile gate passed.'
                }
            ];
            const eventsRoot = createTaskEvents(tmpDir, 'T-001', events);
            const summary = buildTaskEventsSummary({ taskId: 'T-001', eventsRoot });
            assert.equal(summary.task_id, 'T-001');
            assert.equal(summary.events_count, 2);
            assert.equal(summary.parse_errors, 0);
            assert.equal(summary.timeline.length, 2);
            assert.equal(summary.timeline[0].event_type, 'PREFLIGHT_CLASSIFIED');
            assert.equal(summary.timeline[1].event_type, 'COMPILE_GATE_PASSED');
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('handles empty events file', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-summary-'));
            const eventsRoot = createTaskEvents(tmpDir, 'T-002', []);
            // Remove the file and create an empty one
            const filePath = path.join(eventsRoot, 'T-002.jsonl');
            fs.writeFileSync(filePath, '\n', 'utf8');
            const summary = buildTaskEventsSummary({ taskId: 'T-002', eventsRoot });
            assert.equal(summary.events_count, 0);
            assert.equal(summary.timeline.length, 0);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('throws for missing events file', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-summary-'));
            const eventsDir = path.join(tmpDir, 'runtime', 'task-events');
            fs.mkdirSync(eventsDir, { recursive: true });
            assert.throws(() => buildTaskEventsSummary({ taskId: 'T-999', eventsRoot: eventsDir }), /not found/);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('aggregates measurable token savings from command output and review context artifacts', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-summary-'));
            const eventsDir = path.join(tmpDir, 'runtime', 'task-events');
            const reviewsDir = path.join(tmpDir, 'runtime', 'reviews');
            fs.mkdirSync(eventsDir, { recursive: true });
            fs.mkdirSync(reviewsDir, { recursive: true });

            const reviewContextPath = path.join(reviewsDir, 'T-003-code-review-context.json');
            fs.writeFileSync(reviewContextPath, JSON.stringify({
                review_type: 'code',
                rule_context: {
                    summary: {
                        original_token_count_estimate: 180,
                        output_token_count_estimate: 60,
                        estimated_saved_tokens: 120
                    }
                }
            }, null, 2), 'utf8');

            const reviewEvidencePath = path.join(reviewsDir, 'T-003-review-gate.json');
            fs.writeFileSync(reviewEvidencePath, JSON.stringify({
                output_telemetry: {
                    raw_token_count_estimate: 18,
                    filtered_token_count_estimate: 6,
                    estimated_saved_tokens: 12
                },
                artifact_evidence: {
                    checked: [{
                        review: 'code',
                        review_context_path: reviewContextPath.replace(/\\/g, '/')
                    }]
                }
            }, null, 2), 'utf8');

            const events = [
                {
                    timestamp_utc: '2024-01-15T10:00:00Z',
                    task_id: 'T-003',
                    event_type: 'COMPILE_GATE_PASSED',
                    outcome: 'PASS',
                    actor: 'gate',
                    message: 'Compile gate passed.',
                    details: {
                        raw_token_count_estimate: 50,
                        filtered_token_count_estimate: 17,
                        estimated_saved_tokens: 33
                    }
                },
                {
                    timestamp_utc: '2024-01-15T10:05:00Z',
                    task_id: 'T-003',
                    event_type: 'REVIEW_GATE_PASSED',
                    outcome: 'PASS',
                    actor: 'gate',
                    message: 'Review gate passed.',
                    details: {
                        review_evidence_path: reviewEvidencePath.replace(/\\/g, '/')
                    }
                }
            ];
            fs.writeFileSync(
                path.join(eventsDir, 'T-003.jsonl'),
                events.map(e => JSON.stringify(e)).join('\n') + '\n',
                'utf8'
            );

            const summary = buildTaskEventsSummary({ taskId: 'T-003', eventsRoot: eventsDir, repoRoot: tmpDir });
            assert.equal(summary.token_economy.total_estimated_saved_tokens, 165);
            assert.equal(summary.token_economy.total_raw_token_count_estimate, 248);
            assert.match(summary.token_economy.visible_summary_line, /Saved tokens: ~165/);
            assert.match(summary.token_economy.visible_summary_line, /120 code review context/);
            assert.match(summary.token_economy.visible_summary_line, /33 compile gate output/);
            assert.match(summary.token_economy.visible_summary_line, /12 review gate output/);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    describe('formatTaskEventsSummaryText', () => {
        it('formats summary as human-readable text', () => {
            const summary = {
                task_id: 'T-001',
                source_path: '/events/T-001.jsonl',
                events_count: 1,
                parse_errors: 0,
                integrity: {
                    status: 'PASS',
                    integrity_event_count: 1,
                    legacy_event_count: 0,
                    violations: []
                },
                command_policy_warnings: [],
                command_policy_warning_count: 0,
                token_economy: {
                    visible_summary_line: 'Saved tokens: ~33 (~66%) (33 compile gate output).'
                },
                first_event_utc: '2024-01-15T10:00:00.000Z',
                last_event_utc: '2024-01-15T10:00:00.000Z',
                timeline: [{
                    index: 1,
                    timestamp_utc: '2024-01-15T10:00:00.000Z',
                    event_type: 'PREFLIGHT_CLASSIFIED',
                    outcome: 'INFO',
                    actor: 'gate',
                    message: 'Done.'
                }]
            };
            const text = formatTaskEventsSummaryText(summary);
            assert.ok(text.includes('Task: T-001'));
            assert.ok(text.includes('Events: 1'));
            assert.ok(text.includes('IntegrityStatus: PASS'));
            assert.ok(text.includes('Saved tokens: ~33 (~66%) (33 compile gate output).'));
            assert.ok(text.includes('PREFLIGHT_CLASSIFIED'));
            assert.ok(text.includes('Timeline:'));
        });
    });

    describe('getOutputTelemetryFromPayload', () => {
        it('extracts telemetry from nested output_telemetry payloads', () => {
            const result = getOutputTelemetryFromPayload({
                output_telemetry: {
                    raw_token_count_estimate: 20,
                    filtered_token_count_estimate: 10,
                    estimated_saved_tokens: 10
                }
            });

            assert.equal(result.raw_token_count_estimate, 20);
            assert.equal(result.output_token_count_estimate, 10);
            assert.equal(result.estimated_saved_tokens, 10);
            assert.equal(result.baseline_known, true);
        });
    });
});
