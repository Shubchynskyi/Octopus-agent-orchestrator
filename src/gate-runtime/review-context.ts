import { stringSha256 } from './hash';
import { estimateTokenCount, DEFAULT_TOKEN_ESTIMATOR, LEGACY_TOKEN_ESTIMATOR } from './token-telemetry';

interface CompactMarkdownOptions {
    stripExamples?: boolean;
    stripCodeBlocks?: boolean;
}

interface CompactMarkdownResult {
    content: string;
    original_line_count: number;
    output_line_count: number;
    original_char_count: number;
    output_char_count: number;
    removed_code_blocks: number;
    removed_example_sections: number;
    removed_example_labels: number;
    removed_example_content_lines: number;
}

/**
 * Compact markdown content by stripping examples and/or code blocks.
 * Matches Python compact_markdown_content exactly.
 */
export function compactMarkdownContent(content: unknown, options: CompactMarkdownOptions = {}): CompactMarkdownResult {
    const stripExamples = options.stripExamples || false;
    const stripCodeBlocks = options.stripCodeBlocks || false;

    let sourceText = content == null ? '' : String(content);
    sourceText = sourceText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = sourceText.split('\n');
    const outputLines: string[] = [];
    let exampleHeadingLevel = null;
    let insideRemovedCodeBlock = false;
    let pendingExampleLabel = false;
    let removedCodeBlocks = 0;
    let removedExampleSections = 0;
    let removedExampleLabels = 0;
    let removedExampleContentLines = 0;
    let insertedExamplePlaceholder = false;
    let insertedCodeBlockPlaceholder = false;

    const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;
    const exampleLabelPattern = /^\s*(?:bad|good)?\s*examples?\s*:\s*$/i;
    const codeFencePattern = /^\s*```/;

    function ensureBlankLine() {
        if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '') {
            outputLines.push('');
        }
    }

    function addExamplePlaceholder() {
        if (insertedExamplePlaceholder) return;
        ensureBlankLine();
        outputLines.push('> Example content omitted due to token economy.');
        insertedExamplePlaceholder = true;
    }

    function addCodeBlockPlaceholder() {
        if (insertedCodeBlockPlaceholder) return;
        ensureBlankLine();
        outputLines.push('> Code block omitted due to token economy.');
        insertedCodeBlockPlaceholder = true;
    }

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const headingMatch = headingPattern.exec(line);

        if (exampleHeadingLevel != null) {
            if (headingMatch && headingMatch[1].length <= exampleHeadingLevel) {
                exampleHeadingLevel = null;
                insertedExamplePlaceholder = false;
                continue; // re-process this line
            }
            removedExampleContentLines++;
            index++;
            continue;
        }

        if (insideRemovedCodeBlock) {
            if (codeFencePattern.test(line)) {
                insideRemovedCodeBlock = false;
                insertedCodeBlockPlaceholder = false;
            }
            index++;
            continue;
        }

        if (stripExamples && headingMatch && headingMatch[2].toLowerCase().includes('example')) {
            ensureBlankLine();
            outputLines.push(line);
            outputLines.push('> Example section omitted due to token economy.');
            removedExampleSections++;
            exampleHeadingLevel = headingMatch[1].length;
            insertedExamplePlaceholder = true;
            index++;
            continue;
        }

        if (stripExamples && exampleLabelPattern.test(line)) {
            addExamplePlaceholder();
            removedExampleLabels++;
            pendingExampleLabel = true;
            index++;
            continue;
        }

        if (pendingExampleLabel) {
            if (codeFencePattern.test(line)) {
                addCodeBlockPlaceholder();
                removedCodeBlocks++;
                insideRemovedCodeBlock = true;
                pendingExampleLabel = false;
                index++;
                continue;
            }
            if (!line.trim()) {
                index++;
                continue;
            }
            if (headingMatch) {
                pendingExampleLabel = false;
                continue; // re-process
            }
            removedExampleContentLines++;
            index++;
            continue;
        }

        if (stripCodeBlocks && codeFencePattern.test(line)) {
            addCodeBlockPlaceholder();
            removedCodeBlocks++;
            insideRemovedCodeBlock = true;
            index++;
            continue;
        }

        outputLines.push(line);
        index++;
    }

    let sanitizedText = outputLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (sourceText.endsWith('\n')) {
        sanitizedText += '\n';
    }

    return {
        content: sanitizedText,
        original_line_count: lines.length,
        output_line_count: sanitizedText ? sanitizedText.split('\n').length : 0,
        original_char_count: sourceText.length,
        output_char_count: sanitizedText.length,
        removed_code_blocks: removedCodeBlocks,
        removed_example_sections: removedExampleSections,
        removed_example_labels: removedExampleLabels,
        removed_example_content_lines: removedExampleContentLines
    };
}

/**
 * Get compact review budget, matching Python get_compact_review_budget.
 */
export function getCompactReviewBudget(failTailLines: unknown): Record<string, number> {
    let resolvedFailTailLines = 50;
    if (typeof failTailLines === 'boolean') {
        resolvedFailTailLines = 50;
    } else if (typeof failTailLines === 'number' && Number.isInteger(failTailLines)) {
        resolvedFailTailLines = failTailLines;
    } else if (failTailLines != null) {
        const parsed = parseInt(String(failTailLines).trim(), 10);
        if (!isNaN(parsed)) {
            resolvedFailTailLines = parsed;
        }
    }

    resolvedFailTailLines = Math.max(resolvedFailTailLines, 1);
    const maxLines = Math.max(120, resolvedFailTailLines + 70);
    const maxChars = Math.max(12000, maxLines * 100);
    return {
        fail_tail_lines: resolvedFailTailLines,
        max_lines: maxLines,
        max_chars: maxChars,
        max_code_fence_lines: 4,
        max_example_markers: 0
    };
}

interface AuditReviewArtifactOptions {
    artifactPath: string;
    content: string;
    reviewContext?: Record<string, unknown>;
}

export interface AuditReviewArtifactResult {
    expected: boolean;
    token_economy_active: boolean;
    review_context_path: string | null;
    line_count: number;
    char_count: number;
    code_fence_line_count: number;
    example_marker_count: number;
    budget: ReturnType<typeof getCompactReviewBudget>;
    warnings: string[];
    warning_count: number;
}

/**
 * Audit review artifact compaction, matching Python audit_review_artifact_compaction.
 */
export function auditReviewArtifactCompaction(options: AuditReviewArtifactOptions): AuditReviewArtifactResult {
    const artifactPath = options.artifactPath;
    const content = options.content;
    let reviewContext: Record<string, unknown> = (options.reviewContext && typeof options.reviewContext === 'object') ? options.reviewContext : {};
    const tokenEconomy = (reviewContext.token_economy && typeof reviewContext.token_economy === 'object' ? reviewContext.token_economy : {}) as Record<string, unknown>;
    const flags = (tokenEconomy.flags && typeof tokenEconomy.flags === 'object' ? tokenEconomy.flags : {}) as Record<string, unknown>;
    const tokenEconomyActive = !!(reviewContext.token_economy_active) || !!(tokenEconomy.active);
    const compactExpected = tokenEconomyActive && !!(flags.compact_reviewer_output);
    const budget = getCompactReviewBudget(flags.fail_tail_lines);

    const lines = content.split('\n');
    const codeFenceLines = lines.filter(line => /^\s*```/.test(line)).length;
    const exampleMarkerLines = lines.filter(
        line => /^\s*(?:#{1,6}\s+.*example.*|(?:bad|good)?\s*examples?\s*:)\s*$/i.test(line)
    ).length;

    const warnings: string[] = [];
    if (compactExpected) {
        if (lines.length > budget.max_lines) {
            warnings.push(
                `Review artifact '${String(artifactPath).replace(/\\/g, '/')}' exceeds compact line budget (${lines.length} > ${budget.max_lines}).`
            );
        }
        if (content.length > budget.max_chars) {
            warnings.push(
                `Review artifact '${String(artifactPath).replace(/\\/g, '/')}' exceeds compact char budget (${content.length} > ${budget.max_chars}).`
            );
        }
        if (codeFenceLines > budget.max_code_fence_lines) {
            warnings.push(
                `Review artifact '${String(artifactPath).replace(/\\/g, '/')}' exceeds code-fence budget (${codeFenceLines} > ${budget.max_code_fence_lines}).`
            );
        }
        if (flags.strip_examples && exampleMarkerLines > budget.max_example_markers) {
            warnings.push(
                `Review artifact '${String(artifactPath).replace(/\\/g, '/')}' still contains example markers while strip_examples=true.`
            );
        }
    }

    return {
        expected: compactExpected,
        token_economy_active: tokenEconomyActive,
        review_context_path: reviewContext.output_path
            ? String(reviewContext.output_path).replace(/\\/g, '/')
            : null,
        line_count: lines.length,
        char_count: content.length,
        code_fence_line_count: codeFenceLines,
        example_marker_count: exampleMarkerLines,
        budget: budget,
        warnings: warnings,
        warning_count: warnings.length
    };
}

/**
 * Build a rule context artifact, matching Python build_rule_context_artifact.
 * Returns metadata without writing files (caller handles IO for testability).
 */
export interface ReviewContextSourceFile {
    path: string;
    original_line_count: number;
    output_line_count: number;
    original_char_count: number;
    output_char_count: number;
    removed_code_blocks: number;
    removed_example_sections: number;
    removed_example_labels: number;
    removed_example_content_lines: number;
    content_sha256: string | null;
}

export interface ReviewContextSectionsResult {
    artifact_text: string;
    artifact_sha256: string | null;
    source_file_count: number;
    source_files: ReviewContextSourceFile[];
    summary: Record<string, unknown>;
}

export interface ReviewReceipt {
    schema_version: number;
    task_id: string;
    review_type: string;
    preflight_sha256: string | null;
    scope_sha256: string | null;
    review_context_sha256: string | null;
    review_artifact_sha256: string | null;
    recorded_at_utc: string;
}

/**
 * Build a review receipt artifact.
 */
export function buildReviewReceipt(options: {
    taskId: string;
    reviewType: string;
    preflightSha256: string | null;
    scopeSha256: string | null;
    reviewContextSha256: string | null;
    reviewArtifactSha256: string | null;
}): ReviewReceipt {
    return {
        schema_version: 1,
        task_id: options.taskId,
        review_type: options.reviewType,
        preflight_sha256: options.preflightSha256,
        scope_sha256: options.scopeSha256,
        review_context_sha256: options.reviewContextSha256,
        review_artifact_sha256: options.reviewArtifactSha256,
        recorded_at_utc: new Date().toISOString()
    };
}

export function buildReviewContextSections(selectedRulePaths: string[], readFileCallback: (path: string) => string, options: CompactMarkdownOptions = {}): ReviewContextSectionsResult {
    const stripExamples = options.stripExamples || false;
    const stripCodeBlocks = options.stripCodeBlocks || false;

    const outputSections = [
        '# Reviewer Rule Context',
        '',
        `- strip_examples: ${String(!!stripExamples).toLowerCase()}`,
        `- strip_code_blocks: ${String(!!stripCodeBlocks).toLowerCase()}`,
        ''
    ];

    const fileEntries = [];
    let originalLineTotal = 0;
    let outputLineTotal = 0;
    let originalCharTotal = 0;
    let outputCharTotal = 0;
    let originalTokenTotal = 0;
    let outputTokenTotal = 0;
    let legacyOriginalTokenTotal = 0;
    let legacyOutputTokenTotal = 0;

    for (const selectedRulePath of selectedRulePaths) {
        const rawContent = readFileCallback(selectedRulePath);
        const compacted = compactMarkdownContent(rawContent, { stripExamples, stripCodeBlocks });
        let artifactContent = compacted.content;
        if (!artifactContent || !artifactContent.trim()) {
            artifactContent = '_No remaining content after token-economy compaction._\n';
        } else if (!artifactContent.endsWith('\n')) {
            artifactContent += '\n';
        }

        outputSections.push(
            `## Source: ${selectedRulePath}`,
            '',
            artifactContent.replace(/\n+$/, ''),
            '',
            '---',
            ''
        );

        originalLineTotal += compacted.original_line_count;
        outputLineTotal += compacted.output_line_count;
        originalCharTotal += compacted.original_char_count;
        outputCharTotal += compacted.output_char_count;
        originalTokenTotal += estimateTokenCount(rawContent, { estimator: DEFAULT_TOKEN_ESTIMATOR });
        outputTokenTotal += estimateTokenCount(compacted.content, { estimator: DEFAULT_TOKEN_ESTIMATOR });
        legacyOriginalTokenTotal += estimateTokenCount(rawContent, { estimator: LEGACY_TOKEN_ESTIMATOR });
        legacyOutputTokenTotal += estimateTokenCount(compacted.content, { estimator: LEGACY_TOKEN_ESTIMATOR });

        fileEntries.push({
            path: selectedRulePath,
            original_line_count: compacted.original_line_count,
            output_line_count: compacted.output_line_count,
            original_char_count: compacted.original_char_count,
            output_char_count: compacted.output_char_count,
            removed_code_blocks: compacted.removed_code_blocks,
            removed_example_sections: compacted.removed_example_sections,
            removed_example_labels: compacted.removed_example_labels,
            removed_example_content_lines: compacted.removed_example_content_lines,
            content_sha256: stringSha256(compacted.content || '')
        });
    }

    const artifactText = outputSections.join('\n').replace(/\s+$/, '') + '\n';

    return {
        artifact_text: artifactText,
        artifact_sha256: stringSha256(artifactText),
        source_file_count: fileEntries.length,
        source_files: fileEntries,
        summary: {
            original_line_count: originalLineTotal,
            output_line_count: outputLineTotal,
            original_char_count: originalCharTotal,
            output_char_count: outputCharTotal,
            original_token_count_estimate: originalTokenTotal,
            output_token_count_estimate: outputTokenTotal,
            estimated_saved_chars: Math.max(originalCharTotal - outputCharTotal, 0),
            estimated_saved_tokens: Math.max(originalTokenTotal - outputTokenTotal, 0),
            estimated_saved_tokens_chars_per_4: Math.max(legacyOriginalTokenTotal - legacyOutputTokenTotal, 0),
            token_estimator: DEFAULT_TOKEN_ESTIMATOR,
            legacy_token_estimator: LEGACY_TOKEN_ESTIMATOR
        }
    };
}

