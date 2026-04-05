import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_INIT_ANSWERS_RELATIVE_PATH } from '../core/constants';
import { pathExists } from '../core/fs';
import {
    cleanupStaleTaskEventLocks,
    inspectTaskEventFile,
    scanTaskEventLocks,
    type TaskEventLockCleanupResult,
    type TaskEventLockHealth,
    type TaskEventLockScanResult
} from '../gate-runtime/task-events';
import { validateTimelineCompleteness } from '../gate-runtime/lifecycle-events';
import { validateManifest, formatManifestResult } from './validate-manifest';
import { formatVerifyResult } from './verify';
import { runVerify } from './verify';
import { getBundlePath, detectSourceBundleParity as getSourceBundleParity, detectNestedBundleDuplication, type NestedBundleDuplicationResult } from './workspace-layout';
import {
    scanProviderCompliance,
    formatProviderComplianceDetail,
    type ProviderComplianceResult
} from './provider-compliance';

interface DoctorOptions {
    targetRoot: string;
    sourceOfTruth: string;
    initAnswersPath?: string;
    cleanupStaleLocks?: boolean;
    dryRun?: boolean;
    activeAgentFiles?: readonly string[];
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
    lockHealth: TaskEventLockScanResult;
    lockCleanup: TaskEventLockCleanupResult | null;
    parityResult: ReturnType<typeof getSourceBundleParity>;
    providerComplianceResult: ProviderComplianceResult | null;
    nestedBundleDuplication: NestedBundleDuplicationResult;
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

    // T-034: detect stale deployed bundle in self-hosted checkouts
    var parityResult = getSourceBundleParity(targetRoot);

    // T-004: scan task timelines for integrity and completeness
    var timelineScan = scanTimelineEvidence(bundlePath);
    var lockCleanup = options.cleanupStaleLocks
        ? cleanupStaleTaskEventLocks(bundlePath, { dryRun: options.dryRun === true })
        : null;
    var lockHealth = scanTaskEventLocks(bundlePath);

    // T-1006: provider-control compliance scan
    var providerComplianceResult: ProviderComplianceResult | null = null;
    var activeAgentFiles = options.activeAgentFiles || [];
    if (activeAgentFiles.length > 0) {
        try {
            providerComplianceResult = scanProviderCompliance(targetRoot, activeAgentFiles);
        } catch {
            // compliance scan failure is non-fatal; will show as null in output
        }
    }

    // T-1008: detect nested deployed bundle duplication
    var nestedBundleDuplication = detectNestedBundleDuplication(targetRoot);

    var manifestPassed = manifestResult ? manifestResult.passed : false;
    var compliancePassed = providerComplianceResult === null || providerComplianceResult.passed;
    var passed = verifyResult.passed && manifestPassed && !manifestError && lockHealth.stale_count === 0 && !parityResult.isStale && compliancePassed && !nestedBundleDuplication.duplicatesFound;

    return {
        passed: passed,
        targetRoot: targetRoot,
        verifyResult: verifyResult,
        manifestResult: manifestResult,
        manifestError: manifestError,
        timelineEvidence: timelineScan.evidence,
        timelineWarnings: timelineScan.warnings,
        lockHealth: lockHealth,
        lockCleanup: lockCleanup,
        parityResult: parityResult,
        providerComplianceResult: providerComplianceResult,
        nestedBundleDuplication: nestedBundleDuplication
    };
}

export function formatDoctorResult(result: DoctorResult): string {
    var lines: string[] = [];
    lines.push(formatVerifyResult(result.verifyResult));
    lines.push('');

    // T-034: source-vs-bundle parity summary
    if (result.parityResult.isSourceCheckout) {
        lines.push('Source Parity (Self-hosted)');
        if (result.parityResult.isStale) {
            lines.push('  Status: STALE');
            for (var k = 0; k < result.parityResult.violations.length; k++) {
                lines.push('  Violation: ' + result.parityResult.violations[k]);
            }
            if (result.parityResult.remediation) {
                lines.push('  Fix: ' + result.parityResult.remediation);
            }
        } else {
            lines.push('  Status: MATCH');
            lines.push('  Version: ' + (result.parityResult.rootVersion || 'unknown'));
        }
        lines.push('');
    }

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

    if (result.lockCleanup) {
        lines.push('Task-Event Lock Cleanup');
        lines.push('  Mode: ' + (result.lockCleanup.dry_run ? 'DRY_RUN' : 'APPLY'));
        lines.push('  LockRoot: ' + result.lockCleanup.lock_root);
        lines.push('  StaleCandidates: ' + result.lockCleanup.removable_stale_locks.length);
        lines.push('  Removed: ' + result.lockCleanup.removed_locks.length);
        if (result.lockCleanup.retained_live_locks.length > 0) {
            lines.push('  LiveLocksRetained: ' + result.lockCleanup.retained_live_locks.join(', '));
        }
        if (result.lockCleanup.failed_locks.length > 0) {
            lines.push('  CleanupFailures: ' + result.lockCleanup.failed_locks.join(', '));
        }
        for (const warning of result.lockCleanup.warnings) {
            lines.push('  Warning: ' + warning);
        }
        lines.push('');
    }

    if (result.lockHealth.locks.length > 0 || result.lockCleanup) {
        lines.push('Task-Event Locks');
        lines.push('  Scope: ' + result.lockHealth.subsystem_scope_note);
        lines.push(
            '  Summary: active=' + result.lockHealth.active_count +
            ', stale=' + result.lockHealth.stale_count
        );
        for (const lock of result.lockHealth.locks) {
            const ageText = lock.age_ms === null ? 'unknown' : `${lock.age_ms}ms`;
            const ownerPidText = lock.owner_pid === null ? 'unknown' : String(lock.owner_pid);
            const ownerAliveText = lock.owner_alive === null ? 'unknown' : (lock.owner_alive ? 'yes' : 'no');
            const ownerHostText = lock.owner_hostname || 'unknown';
            lines.push(
                '  ' + lock.lock_name + ': ' + lock.status +
                ' scope=' + lock.scope +
                (lock.task_id ? ' task=' + lock.task_id : '') +
                ' age=' + ageText +
                ' owner_pid=' + ownerPidText +
                ' owner_alive=' + ownerAliveText +
                ' owner_host=' + ownerHostText +
                ' metadata=' + lock.owner_metadata_status +
                ' stale_reason=' + (lock.stale_reason || 'none')
            );
            lines.push('    Fix: ' + lock.remediation);
        }
        lines.push('');
    }

    // T-1006: provider control compliance detail
    if (result.providerComplianceResult) {
        var complianceLines = formatProviderComplianceDetail(result.providerComplianceResult);
        for (const cl of complianceLines) {
            lines.push(cl);
        }
        lines.push('');
    }

    // T-1008: nested bundle duplication warning
    if (result.nestedBundleDuplication.duplicatesFound) {
        lines.push('Nested Bundle Duplication (IDE Index Risk)');
        lines.push('  Status: DUPLICATES_FOUND');
        for (const dp of result.nestedBundleDuplication.duplicatePaths) {
            lines.push('  Duplicate: ' + dp);
        }
        lines.push('  Fix: Remove nested copies or ensure .vscode/settings.json excludes them from indexing.');
        lines.push('');
    }

    if (result.passed) { lines.push('Doctor: PASS'); lines.push('Next: Execute task T-001 depth=2'); }
    else { lines.push('Doctor: FAIL'); lines.push('Resolve listed issues and rerun doctor.'); }
    return lines.join('\n');
}
