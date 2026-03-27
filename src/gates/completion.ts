import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertValidTaskId } from '../gate-runtime/task-events';
import { fileSha256, normalizePath, joinOrchestratorPath, resolvePathInsideRepo } from './helpers';
import { getRulePackEvidence, getRulePackEvidenceViolations } from './rule-pack';
import { collectTaskTimelineEventTypes, getTaskModeEvidence, getTaskModeEvidenceViolations } from './task-mode';

/**
 * Canonical stage ordering for code-changing tasks.
 * Each entry is the earliest-allowed position (0-based) in the lifecycle.
 * Completion gate fails when a required stage event appears before its prerequisites.
 */
export const STAGE_SEQUENCE_ORDER: readonly string[] = Object.freeze([
    'TASK_MODE_ENTERED',
    'RULE_PACK_LOADED',
    'PREFLIGHT_CLASSIFIED',
    'COMPILE_GATE_PASSED',
    'REVIEW_GATE_PASSED'
]);

export interface TimelineEventEntry {
    event_type: string;
    timestamp_utc: string;
    sequence: number;
}

export interface StageSequenceEvidence {
    observed_order: string[];
    expected_order: string[];
    code_changed: boolean;
    review_skill_ids: string[];
    review_artifact_keys: string[];
    violations: string[];
}

/**
 * Read ordered timeline events from a JSONL file.
 * Returns events in file order (integrity-sequence order) with their event types.
 */
export function collectOrderedTimelineEvents(timelinePath: string, errors: string[]): TimelineEventEntry[] {
    const entries: TimelineEventEntry[] = [];
    const resolvedPath = path.resolve(String(timelinePath || ''));
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        errors.push(`Task timeline not found: ${normalizePath(resolvedPath)}`);
        return entries;
    }

    const lines = fs.readFileSync(resolvedPath, 'utf8').split('\n').filter(line => line.trim().length > 0);
    let seq = 0;
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const eventType = String(parsed.event_type || '').trim().toUpperCase();
            const timestampUtc = String(parsed.timestamp_utc || '').trim();
            if (eventType) {
                entries.push({ event_type: eventType, timestamp_utc: timestampUtc, sequence: seq });
            }
            seq++;
        } catch {
            errors.push(`Task timeline contains invalid JSON line: ${normalizePath(resolvedPath)}`);
            break;
        }
    }

    return entries;
}

/**
 * Validate that required stage events occurred in the canonical order.
 * Returns the first position of each required stage event in the timeline
 * and reports violations when ordering constraints are broken.
 */
export function validateStageSequence(
    events: TimelineEventEntry[],
    codeChanged: boolean,
    timelinePath: string
): StageSequenceEvidence {
    const normalizedTimelinePath = normalizePath(timelinePath);
    const violations: string[] = [];
    const observedOrder: string[] = [];
    const expectedStages = codeChanged
        ? [...STAGE_SEQUENCE_ORDER]
        : ['TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED'];

    const firstOccurrence = new Map<string, number>();
    for (const entry of events) {
        if (!firstOccurrence.has(entry.event_type)) {
            firstOccurrence.set(entry.event_type, entry.sequence);
        }
    }

    for (const stage of STAGE_SEQUENCE_ORDER) {
        if (firstOccurrence.has(stage)) {
            observedOrder.push(stage);
        }
    }

    // Verify each expected stage occurs after its predecessor
    for (let i = 1; i < expectedStages.length; i++) {
        const prev = expectedStages[i - 1];
        const curr = expectedStages[i];
        const prevSeq = firstOccurrence.get(prev);
        const currSeq = firstOccurrence.get(curr);
        if (prevSeq === undefined || currSeq === undefined) {
            continue; // Missing events are caught by other checks
        }
        if (currSeq < prevSeq) {
            violations.push(
                `Stage sequence violation in '${normalizedTimelinePath}': ` +
                `'${curr}' (seq ${currSeq}) appears before '${prev}' (seq ${prevSeq}). ` +
                `Expected order: ${expectedStages.join(' → ')}.`
            );
        }
    }

    // For code-changing tasks, PREFLIGHT_CLASSIFIED is mandatory
    if (codeChanged && !firstOccurrence.has('PREFLIGHT_CLASSIFIED')) {
        violations.push(
            `Task timeline '${normalizedTimelinePath}' is missing PREFLIGHT_CLASSIFIED. ` +
            'Code-changing tasks must carry preflight classification evidence.'
        );
    }

    return {
        observed_order: observedOrder,
        expected_order: expectedStages,
        code_changed: codeChanged,
        review_skill_ids: [],
        review_artifact_keys: [],
        violations
    };
}

/**
 * Detect whether a task changed code, based on the preflight artifact.
 * Returns true when the preflight indicates runtime code changes (changed_lines_total > 0
 * and the task is classified as FULL_PATH or required reviews include code).
 */
export function detectCodeChanged(preflight: Record<string, unknown> | null): boolean {
    if (!preflight) return false;
    const metrics = preflight.metrics as Record<string, unknown> | undefined;
    const changedLinesTotal = metrics?.changed_lines_total;
    if (typeof changedLinesTotal === 'number' && changedLinesTotal > 0) {
        return true;
    }
    const changedFiles = preflight.changed_files;
    if (Array.isArray(changedFiles) && changedFiles.length > 0) {
        return true;
    }
    return false;
}

/**
 * Validate review-skill evidence for code-changing tasks.
 * When code changed but the review-gate artifact does not carry evidence
 * of actual review-skill invocations (review_checks with non-NOT_REQUIRED verdicts),
 * the completion gate fails.
 */
export function validateReviewSkillEvidence(
    reviewEvidence: Record<string, unknown> | null,
    requiredReviews: Record<string, unknown>,
    reviewArtifacts: Record<string, unknown>,
    codeChanged: boolean
): { skill_ids: string[]; artifact_keys: string[]; violations: string[] } {
    const result = { skill_ids: [] as string[], artifact_keys: [] as string[], violations: [] as string[] };
    if (!codeChanged) return result;

    // Collect which review types were actually required and had artifacts
    const requiredKeys: string[] = [];
    for (const [key, value] of Object.entries(requiredReviews)) {
        if (value === true) {
            requiredKeys.push(key);
        }
    }

    // Verify review-gate artifact contains review_checks with actual invocation evidence
    if (reviewEvidence) {
        const reviewChecks = reviewEvidence.review_checks as Record<string, Record<string, unknown>> | undefined;
        if (reviewChecks && typeof reviewChecks === 'object') {
            for (const [key, check] of Object.entries(reviewChecks)) {
                if (check && check.required === true) {
                    result.skill_ids.push(key);
                    const verdict = String(check.verdict || '').trim();
                    if (verdict && verdict !== 'NOT_REQUIRED') {
                        result.artifact_keys.push(key);
                    }
                }
            }
        }
    }

    // When code changed, at least one review skill must have been invoked
    if (requiredKeys.length > 0 && result.artifact_keys.length === 0) {
        result.violations.push(
            'Code-changing task has required reviews but no review-skill invocation evidence found in review-gate artifact. ' +
            `Expected evidence for: ${requiredKeys.join(', ')}.`
        );
    }

    // Verify that each required review has a corresponding review artifact
    for (const key of requiredKeys) {
        if (!reviewArtifacts[key]) {
            result.violations.push(
                `Code-changing task is missing review artifact for required review '${key}'. ` +
                'Review skill must be invoked and produce a review artifact before completion.'
            );
        }
    }

    return result;
}

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

export const EMPTY_REVIEW_MARKERS = new Set([
    'none', 'n/a', 'na', 'no findings', 'no residual risks',
    'no deferred findings', 'no open findings', 'no outstanding findings'
]);

/**
 * Extract lines from a markdown section by heading.
 */
export function extractMarkdownSectionLines(lines: string[], heading: string): string[] {
    const sectionLines: string[] = [];
    let capture = false;
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        const headingMatch = /^(#{2,6})\s+(.+?)\s*$/.exec(trimmed);
        if (headingMatch) {
            if (capture) break;
            capture = headingMatch[2].trim().toLowerCase() === heading.trim().toLowerCase();
            continue;
        }
        if (capture) sectionLines.push(rawLine);
    }
    return sectionLines;
}

/**
 * Normalize review list text: strip bullets, backticks.
 */
export function normalizeReviewListText(value: unknown): string {
    if (value == null) return '';
    let text = String(value).trim();
    text = text.replace(/^(?:[-*+]\s+|\d+\.\s+)+/, '').trim();
    while (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) {
        text = text.slice(1, -1).trim();
    }
    return text;
}

/**
 * Check if a review entry is meaningful (not an empty marker).
 */
export function isMeaningfulReviewEntry(value: unknown): boolean {
    const text = normalizeReviewListText(value);
    if (!text) return false;
    const normalized = text.trim().replace(/\.$/, '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
    return !EMPTY_REVIEW_MARKERS.has(normalized);
}

/**
 * Get meaningful entries from a markdown section.
 */
export function getMarkdownMeaningfulEntries(sectionLines: string[]): string[] {
    const entries: string[] = [];
    let currentEntry: string | null = null;

    for (const rawLine of sectionLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const bulletMatch = /^(?:[-*+]\s+|\d+\.\s+)(.*)$/.exec(trimmed);
        if (bulletMatch) {
            if (isMeaningfulReviewEntry(currentEntry)) {
                entries.push(normalizeReviewListText(currentEntry));
            }
            const candidate = normalizeReviewListText(bulletMatch[1]);
            currentEntry = isMeaningfulReviewEntry(candidate) ? candidate : null;
            continue;
        }

        const candidate = normalizeReviewListText(trimmed);
        if (!isMeaningfulReviewEntry(candidate)) continue;
        currentEntry = currentEntry ? `${currentEntry} ${candidate}`.trim() : candidate;
    }

    if (isMeaningfulReviewEntry(currentEntry)) {
        entries.push(normalizeReviewListText(currentEntry));
    }

    return entries;
}

/**
 * Parse findings by severity from section lines.
 */
type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export function getFindingsBySeverity(sectionLines: string[]): Record<SeverityLevel, string[]> {
    const findings: Record<SeverityLevel, string[]> = { critical: [], high: [], medium: [], low: [] };
    let currentSeverity: SeverityLevel | null = null;

    for (const rawLine of sectionLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const severityMatch = /^(?:[-*+]\s*)?(Critical|High|Medium|Low)\s*:\s*(.*)$/i.exec(trimmed);
        if (severityMatch) {
            currentSeverity = severityMatch[1].trim().toLowerCase() as SeverityLevel;
            const remainder = normalizeReviewListText(severityMatch[2]);
            if (isMeaningfulReviewEntry(remainder)) {
                findings[currentSeverity].push(remainder);
            }
            continue;
        }

        if (!currentSeverity) continue;

        const bulletMatch = /^(?:[-*+]\s+|\d+\.\s+)(.*)$/.exec(trimmed);
        if (bulletMatch) {
            const entry = normalizeReviewListText(bulletMatch[1]);
            if (isMeaningfulReviewEntry(entry)) {
                findings[currentSeverity].push(entry);
            }
            continue;
        }

        const entry = normalizeReviewListText(trimmed);
        if (!isMeaningfulReviewEntry(entry)) continue;
        if (findings[currentSeverity].length > 0) {
            findings[currentSeverity][findings[currentSeverity].length - 1] =
                `${findings[currentSeverity][findings[currentSeverity].length - 1]} ${entry}`.trim();
        } else {
            findings[currentSeverity].push(entry);
        }
    }

    return findings;
}

/**
 * Analyze review artifact for findings evidence.
 * Matches Python get_review_artifact_findings_evidence.
 */
export function getReviewArtifactFindingsEvidence(artifactPath: string, content: string) {
    const artifactPathNormalized = normalizePath(artifactPath);
    const result: {
        status: string;
        findings_section_present: boolean;
        residual_risks_section_present: boolean;
        deferred_findings_section_present: boolean;
        findings_by_severity: Record<SeverityLevel, string[]>;
        residual_risks: string[];
        deferred_findings: string[];
        missing_sections: string[];
        invalid_deferred_findings: string[];
        violations: string[];
    } = {
        status: 'UNKNOWN',
        findings_section_present: false,
        residual_risks_section_present: false,
        deferred_findings_section_present: false,
        findings_by_severity: { critical: [], high: [], medium: [], low: [] },
        residual_risks: [],
        deferred_findings: [],
        missing_sections: [],
        invalid_deferred_findings: [],
        violations: []
    };

    const lines = (content || '').split('\n');

    // Findings by Severity section
    const findingsLines = extractMarkdownSectionLines(lines, 'Findings by Severity');
    if (!findingsLines.length) {
        result.missing_sections.push('Findings by Severity');
        result.violations.push(
            `Review artifact '${artifactPathNormalized}' is missing required section '## Findings by Severity' for completion audit.`
        );
    } else {
        result.findings_section_present = true;
        const findingsBySeverity = getFindingsBySeverity(findingsLines);
        result.findings_by_severity = findingsBySeverity;
        for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
            if (findingsBySeverity[severity].length > 0) {
                const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
                result.violations.push(
                    `Review artifact '${artifactPathNormalized}' still contains active ${severityLabel} findings. ` +
                    "Resolve them or move accepted non-blocking follow-up to 'Deferred Findings' with 'Justification:'."
                );
            }
        }
    }

    // Residual Risks section
    const residualLines = extractMarkdownSectionLines(lines, 'Residual Risks');
    if (!residualLines.length) {
        result.missing_sections.push('Residual Risks');
        result.violations.push(
            `Review artifact '${artifactPathNormalized}' is missing required section '## Residual Risks' for completion audit.`
        );
    } else {
        result.residual_risks_section_present = true;
        const residualRisks = getMarkdownMeaningfulEntries(residualLines);
        result.residual_risks = residualRisks;
        if (residualRisks.length > 0) {
            result.violations.push(
                `Review artifact '${artifactPathNormalized}' still contains active residual risks. ` +
                "Move accepted non-blocking follow-up to 'Deferred Findings' with 'Justification:' before DONE."
            );
        }
    }

    // Deferred Findings section
    const deferredLines = extractMarkdownSectionLines(lines, 'Deferred Findings');
    if (deferredLines.length > 0) {
        result.deferred_findings_section_present = true;
        const deferredFindings = getMarkdownMeaningfulEntries(deferredLines);
        result.deferred_findings = deferredFindings;
        for (const entry of deferredFindings) {
            const justificationMatch = /\bJustification\s*:\s*(.+)$/i.exec(entry);
            const justification = justificationMatch ? justificationMatch[1].trim() : '';
            if (!justification || justification.length < 12) {
                result.invalid_deferred_findings.push(entry);
                result.violations.push(
                    `Review artifact '${artifactPathNormalized}' has deferred finding without usable 'Justification:': ${entry}`
                );
            }
        }
    }

    result.status = result.violations.length > 0 ? 'FAILED' : 'PASS';
    return result;
}

/**
 * Validate preflight for completion gate.
 */
export function validatePreflightForCompletion(preflightPath: string, explicitTaskId: string) {
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

    return {
        preflight,
        resolved_task_id: resolvedTaskId,
        preflight_path: path.resolve(preflightPath),
        preflight_hash: fileSha256(path.resolve(preflightPath)),
        errors
    };
}

function readJsonArtifact(artifactPath: string, label: string, errors: string[], { required = true } = {}): Record<string, unknown> | null {
    const resolvedPath = path.resolve(String(artifactPath || ''));
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        if (required) {
            errors.push(`${label} artifact not found: ${normalizePath(resolvedPath)}`);
        }
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch {
        errors.push(`${label} artifact is not valid JSON: ${normalizePath(resolvedPath)}`);
        return null;
    }
}

function ensurePassedArtifactStatus(artifact: Record<string, unknown> | null, label: string, errors: string[]): void {
    if (!artifact) {
        return;
    }
    if (String(artifact.status || '').trim().toUpperCase() !== 'PASSED') {
        errors.push(`${label} artifact status must be PASSED, got '${String(artifact.status || 'UNKNOWN')}'.`);
    }
    if (String(artifact.outcome || '').trim().toUpperCase() !== 'PASS') {
        errors.push(`${label} artifact outcome must be PASS, got '${String(artifact.outcome || 'UNKNOWN')}'.`);
    }
}

export interface RunCompletionGateOptions {
    repoRoot?: string;
    preflightPath: string;
    taskId?: string;
    taskModePath?: string;
    rulePackPath?: string;
    reviewsRoot?: string;
    compileEvidencePath?: string;
    reviewEvidencePath?: string;
    docImpactPath?: string;
    timelinePath?: string;
}

export function runCompletionGate(options: RunCompletionGateOptions) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const preflightPath = resolvePathInsideRepo(options.preflightPath, repoRoot) as string;
    const validatedPreflight = validatePreflightForCompletion(preflightPath, options.taskId || '');
    const errors: string[] = [...validatedPreflight.errors];
    const resolvedTaskId = validatedPreflight.resolved_task_id;

    const reviewsRoot = options.reviewsRoot
        ? resolvePathInsideRepo(options.reviewsRoot, repoRoot, { allowMissing: true }) as string
        : path.dirname(preflightPath);
    const compileEvidencePath = options.compileEvidencePath
        ? resolvePathInsideRepo(options.compileEvidencePath, repoRoot, { allowMissing: true }) as string
        : path.join(reviewsRoot, `${resolvedTaskId}-compile-gate.json`);
    const reviewEvidencePath = options.reviewEvidencePath
        ? resolvePathInsideRepo(options.reviewEvidencePath, repoRoot, { allowMissing: true }) as string
        : path.join(reviewsRoot, `${resolvedTaskId}-review-gate.json`);
    const docImpactPath = options.docImpactPath
        ? resolvePathInsideRepo(options.docImpactPath, repoRoot, { allowMissing: true }) as string
        : path.join(reviewsRoot, `${resolvedTaskId}-doc-impact.json`);
    const timelinePath = options.timelinePath
        ? resolvePathInsideRepo(options.timelinePath, repoRoot, { allowMissing: true }) as string
        : joinOrchestratorPath(repoRoot, path.join('runtime', 'task-events', `${resolvedTaskId}.jsonl`));
    const taskModeEvidence = getTaskModeEvidence(repoRoot, resolvedTaskId, options.taskModePath || '');
    const rulePackEvidence = getRulePackEvidence(repoRoot, resolvedTaskId, 'POST_PREFLIGHT', {
        artifactPath: options.rulePackPath || '',
        preflightPath,
        taskModePath: options.taskModePath || ''
    });

    const compileEvidence = readJsonArtifact(compileEvidencePath, 'Compile gate', errors);
    const reviewEvidence = readJsonArtifact(reviewEvidencePath, 'Review gate', errors);
    const docImpactEvidence = readJsonArtifact(docImpactPath, 'Doc impact gate', errors);

    ensurePassedArtifactStatus(compileEvidence, 'Compile gate', errors);
    ensurePassedArtifactStatus(reviewEvidence, 'Review gate', errors);
    ensurePassedArtifactStatus(docImpactEvidence, 'Doc impact gate', errors);
    errors.push(...getTaskModeEvidenceViolations(taskModeEvidence));
    errors.push(...getRulePackEvidenceViolations(rulePackEvidence));

    // --- T-003: ordered timeline + stage-sequence enforcement ---
    const timelineErrors: string[] = [];
    const orderedEvents = collectOrderedTimelineEvents(timelinePath, timelineErrors);
    const timelineEventTypes = new Set(orderedEvents.map(e => e.event_type));

    // Propagate timeline parse errors
    errors.push(...timelineErrors);

    if (!timelineEventTypes.has('TASK_MODE_ENTERED')) {
        errors.push(`Task timeline '${normalizePath(timelinePath)}' is missing TASK_MODE_ENTERED.`);
    }
    if (!timelineEventTypes.has('RULE_PACK_LOADED')) {
        errors.push(`Task timeline '${normalizePath(timelinePath)}' is missing RULE_PACK_LOADED.`);
    }
    if (!timelineEventTypes.has('COMPILE_GATE_PASSED')) {
        errors.push(`Task timeline '${normalizePath(timelinePath)}' is missing COMPILE_GATE_PASSED.`);
    }
    if (!timelineEventTypes.has('REVIEW_GATE_PASSED')) {
        errors.push(`Task timeline '${normalizePath(timelinePath)}' is missing REVIEW_GATE_PASSED.`);
    }

    // Detect code changes from preflight
    const codeChanged = detectCodeChanged(validatedPreflight.preflight);

    // Validate stage sequence ordering
    const stageSequence = validateStageSequence(orderedEvents, codeChanged, timelinePath);
    errors.push(...stageSequence.violations);

    const requiredReviews = validatedPreflight.preflight && typeof validatedPreflight.preflight.required_reviews === 'object'
        ? validatedPreflight.preflight.required_reviews
        : {};
    const reviewArtifacts: Record<string, { path: string; findings_evidence: ReturnType<typeof getReviewArtifactFindingsEvidence> }> = {};

    for (const [reviewKey] of REVIEW_CONTRACTS) {
        const artifactPath = path.join(reviewsRoot, `${resolvedTaskId}-${reviewKey}.md`);
        const artifactExists = fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile();
        const required = !!requiredReviews[reviewKey];

        if (!artifactExists) {
            if (required) {
                errors.push(`Required review artifact not found: ${normalizePath(artifactPath)}`);
            }
            continue;
        }

        const artifactContent = fs.readFileSync(artifactPath, 'utf8');
        const findingsEvidence = getReviewArtifactFindingsEvidence(artifactPath, artifactContent);
        reviewArtifacts[reviewKey] = {
            path: normalizePath(artifactPath),
            findings_evidence: findingsEvidence
        };
        if (Array.isArray(findingsEvidence.violations) && findingsEvidence.violations.length > 0) {
            errors.push(...findingsEvidence.violations);
        }
    }

    // T-003: review-skill invocation evidence for code-changing tasks
    const reviewSkillEvidence = validateReviewSkillEvidence(
        reviewEvidence,
        requiredReviews,
        reviewArtifacts,
        codeChanged
    );
    errors.push(...reviewSkillEvidence.violations);

    // Merge skill evidence into stage-sequence record
    stageSequence.review_skill_ids = reviewSkillEvidence.skill_ids;
    stageSequence.review_artifact_keys = reviewSkillEvidence.artifact_keys;

    const status = errors.length > 0 ? 'FAILED' : 'PASSED';
    const outcome = errors.length > 0 ? 'FAIL' : 'PASS';

    return {
        status,
        outcome,
        task_id: resolvedTaskId,
        preflight_path: normalizePath(preflightPath),
        reviews_root: normalizePath(reviewsRoot),
        task_mode_path: taskModeEvidence.evidence_path,
        rule_pack_path: rulePackEvidence.evidence_path,
        compile_evidence_path: normalizePath(compileEvidencePath),
        review_evidence_path: normalizePath(reviewEvidencePath),
        doc_impact_path: normalizePath(docImpactPath),
        timeline_path: normalizePath(timelinePath),
        review_artifacts: reviewArtifacts,
        stage_sequence_evidence: stageSequence,
        violations: errors
    };
}

export function formatCompletionGateResult(result: Record<string, unknown>): string {
    const lines: string[] = [
        result.outcome === 'PASS' ? 'COMPLETION_GATE_PASSED' : 'COMPLETION_GATE_FAILED',
        `TaskId: ${result.task_id}`,
        `Status: ${result.status}`,
        `Outcome: ${result.outcome}`
    ];

    if (Array.isArray(result.violations) && result.violations.length > 0) {
        lines.push('Violations:');
        for (const violation of result.violations) {
            lines.push(`- ${violation}`);
        }
    }

    return lines.join('\n');
}
