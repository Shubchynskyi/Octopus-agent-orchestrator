import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_INIT_ANSWERS_RELATIVE_PATH } from '../core/constants';
import { pathExists } from '../core/fs';
import { inspectTaskEventFile } from '../gate-runtime/task-events';
import { validateTimelineCompleteness } from '../gate-runtime/lifecycle-events';
import { validateManifest, formatManifestResult } from './validate-manifest';
import { formatVerifyResult } from './verify';
import { runVerify } from './verify';
import { getBundlePath } from './workspace-layout';

interface DoctorOptions {
    targetRoot: string;
    sourceOfTruth: string;
    initAnswersPath?: string;
}

interface TimelineEvidence {
    task_id: string;
    timeline_path: string;
    status: string;
    completeness_status: string;
    events_missing: string[];
    code_changed: boolean;
    events_scanned: number;
    integrity_event_count: number;
    violations: string[];
}

interface DoctorResult {
    passed: boolean;
    targetRoot: string;
    verifyResult: ReturnType<typeof runVerify>;
    manifestResult: ReturnType<typeof validateManifest> | null;
    manifestError: string | null;
    timelineEvidence: TimelineEvidence[];
    timelineWarnings: string[];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function detectTimelineCodeChanged(bundlePath: string, taskId: string): boolean {
    const preflightPath = path.join(bundlePath, 'runtime', 'reviews', `${taskId}-preflight.json`);
    if (!pathExists(preflightPath)) {
        return false;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(preflightPath, 'utf8')) as Record<string, unknown>;
        const metrics = parsed.metrics && typeof parsed.metrics === 'object' && !Array.isArray(parsed.metrics)
            ? parsed.metrics as Record<string, unknown>
            : null;
        if (metrics && typeof metrics.changed_lines_total === 'number' && metrics.changed_lines_total > 0) {
            return true;
        }
        return Array.isArray(parsed.changed_files) && parsed.changed_files.length > 0;
    } catch {
        return false;
    }
}

/**
 * Scan task-events directory for JSONL timeline files and validate each.
 * Makes missing or broken timeline evidence visible in doctor output.
 */
function scanTimelineEvidence(bundlePath: string): { evidence: TimelineEvidence[]; warnings: string[] } {
    const eventsRoot = path.join(bundlePath, 'runtime', 'task-events');
    const evidence: TimelineEvidence[] = [];
    const warnings: string[] = [];

    if (!pathExists(eventsRoot)) {
        return { evidence, warnings };
    }

    let entries: string[];
    try {
        entries = fs.readdirSync(eventsRoot).filter(function (name: string) {
            return name.endsWith('.jsonl') && name !== 'all-tasks.jsonl';
        });
    } catch {
        warnings.push('Unable to read task-events directory: ' + eventsRoot);
        return { evidence, warnings };
    }

    for (const entry of entries) {
        const taskId = entry.replace(/\.jsonl$/, '');
        const timelinePath = path.join(eventsRoot, entry);

        try {
            const inspectResult = inspectTaskEventFile(timelinePath, taskId);
            const codeChanged = detectTimelineCodeChanged(bundlePath, taskId);
            const completeness = validateTimelineCompleteness(timelinePath, taskId, codeChanged);
            const item: TimelineEvidence = {
                task_id: taskId,
                timeline_path: timelinePath.replace(/\\/g, '/'),
                status: inspectResult.status,
                completeness_status: completeness.status,
                events_missing: completeness.events_missing.slice(),
                code_changed: codeChanged,
                events_scanned: inspectResult.events_scanned,
                integrity_event_count: inspectResult.integrity_event_count,
                violations: inspectResult.violations.slice()
            };
            evidence.push(item);

            if (inspectResult.status === 'FAILED') {
                warnings.push(
                    'Timeline integrity FAILED for ' + taskId + ': ' +
                    inspectResult.violations.join('; ')
                );
            } else if (inspectResult.status === 'EMPTY') {
                warnings.push('Timeline is EMPTY for ' + taskId + ': ' + timelinePath.replace(/\\/g, '/'));
            } else if (completeness.status !== 'COMPLETE') {
                warnings.push(
                    'Timeline completeness ' + completeness.status + ' for ' + taskId + ': ' +
                    completeness.events_missing.join(', ')
                );
            }
        } catch (err: unknown) {
            warnings.push('Timeline scan error for ' + taskId + ': ' + getErrorMessage(err));
        }
    }

    return { evidence, warnings };
}

export function runDoctor(options: DoctorOptions): DoctorResult {
    var targetRoot = path.resolve(options.targetRoot);
    var initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    var bundlePath = getBundlePath(targetRoot);

    if (!pathExists(bundlePath)) {
        throw new Error(
            'Deployed bundle not found: '+bundlePath+'\n'+
            "Run 'npx octopus-agent-orchestrator' first, then rerun 'doctor'."
        );
    }

    var verifyResult = runVerify({
        targetRoot: targetRoot,
        sourceOfTruth: options.sourceOfTruth,
        initAnswersPath: initAnswersPath
    });

    var manifestPath = path.join(bundlePath, 'MANIFEST.md');
    var manifestResult = null;
    var manifestError = null;

    try { manifestResult = validateManifest(manifestPath, targetRoot); }
    catch (err: unknown) { manifestError = getErrorMessage(err); }

    // T-004: scan task timelines for integrity and completeness
    var timelineScan = scanTimelineEvidence(bundlePath);

    var manifestPassed = manifestResult ? manifestResult.passed : false;
    var passed = verifyResult.passed && manifestPassed && !manifestError;

    return {
        passed: passed,
        targetRoot: targetRoot,
        verifyResult: verifyResult,
        manifestResult: manifestResult,
        manifestError: manifestError,
        timelineEvidence: timelineScan.evidence,
        timelineWarnings: timelineScan.warnings
    };
}

export function formatDoctorResult(result: DoctorResult): string {
    var lines: string[] = [];
    lines.push(formatVerifyResult(result.verifyResult));
    lines.push('');
    if (result.manifestResult) lines.push(formatManifestResult(result.manifestResult));
    else if (result.manifestError) { lines.push('MANIFEST_VALIDATION_FAILED'); lines.push('Error: '+result.manifestError); }
    lines.push('');

    // T-004: timeline evidence summary
    if (result.timelineEvidence.length > 0) {
        lines.push('Timeline Evidence');
        for (var i = 0; i < result.timelineEvidence.length; i++) {
            var te = result.timelineEvidence[i];
            lines.push(
                '  ' + te.task_id + ': integrity=' + te.status +
                ', completeness=' + te.completeness_status +
                ' (' + te.integrity_event_count + ' events)'
            );
        }
        if (result.timelineWarnings.length > 0) {
            lines.push('Timeline Warnings');
            for (var j = 0; j < result.timelineWarnings.length; j++) {
                lines.push('  - ' + result.timelineWarnings[j]);
            }
        }
        lines.push('');
    }

    if (result.passed) { lines.push('Doctor: PASS'); lines.push('Next: Execute task T-001 depth=2'); }
    else { lines.push('Doctor: FAIL'); lines.push('Resolve listed issues and rerun doctor.'); }
    return lines.join('\n');
}
