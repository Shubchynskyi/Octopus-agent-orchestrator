const fs = require('node:fs');
const path = require('node:path');

const { assertValidTaskId, inspectTaskEventFile, appendTaskEvent } = require('../gate-runtime/task-events.ts');
const { auditReviewArtifactCompaction } = require('../gate-runtime/review-context.ts');
const { fileSha256, normalizePath, joinOrchestratorPath, parseBool, resolvePathInsideRepo, toPosix } = require('./helpers.ts');

const REVIEW_CONTRACTS = [
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

const EMPTY_REVIEW_MARKERS = new Set([
    'none', 'n/a', 'na', 'no findings', 'no residual risks',
    'no deferred findings', 'no open findings', 'no outstanding findings'
]);

/**
 * Extract lines from a markdown section by heading.
 */
function extractMarkdownSectionLines(lines, heading) {
    const sectionLines = [];
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
function normalizeReviewListText(value) {
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
function isMeaningfulReviewEntry(value) {
    const text = normalizeReviewListText(value);
    if (!text) return false;
    const normalized = text.trim().replace(/\.$/, '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
    return !EMPTY_REVIEW_MARKERS.has(normalized);
}

/**
 * Get meaningful entries from a markdown section.
 */
function getMarkdownMeaningfulEntries(sectionLines) {
    const entries = [];
    let currentEntry = null;

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
function getFindingsBySeverity(sectionLines) {
    const findings = { critical: [], high: [], medium: [], low: [] };
    let currentSeverity = null;

    for (const rawLine of sectionLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const severityMatch = /^(?:[-*+]\s*)?(Critical|High|Medium|Low)\s*:\s*(.*)$/i.exec(trimmed);
        if (severityMatch) {
            currentSeverity = severityMatch[1].trim().toLowerCase();
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
function getReviewArtifactFindingsEvidence(artifactPath, content) {
    const artifactPathNormalized = normalizePath(artifactPath);
    const result = {
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
        for (const severity of ['critical', 'high', 'medium', 'low']) {
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
function validatePreflightForCompletion(preflightPath, explicitTaskId) {
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

    let preflightTaskId = preflight.task_id != null ? String(preflight.task_id).trim() : '';
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

module.exports = {
    EMPTY_REVIEW_MARKERS,
    REVIEW_CONTRACTS,
    extractMarkdownSectionLines,
    getFindingsBySeverity,
    getMarkdownMeaningfulEntries,
    getReviewArtifactFindingsEvidence,
    isMeaningfulReviewEntry,
    normalizeReviewListText,
    validatePreflightForCompletion
};
