import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compactMarkdownContent,
    getCompactReviewBudget,
    auditReviewArtifactCompaction,
    buildReviewContextSections
} from '../../../src/gate-runtime/review-context';
import { stringSha256 } from '../../../src/gate-runtime/hash';

// --- compactMarkdownContent ---

test('compactMarkdownContent returns empty for null', () => {
    const result = compactMarkdownContent(null);
    assert.equal(result.content, '');
    assert.equal(result.original_char_count, 0);
    assert.equal(result.removed_code_blocks, 0);
});

test('compactMarkdownContent preserves content with no stripping', () => {
    const input = '# Title\n\nSome text.\n';
    const result = compactMarkdownContent(input);
    assert.equal(result.content, input);
    assert.equal(result.removed_code_blocks, 0);
    assert.equal(result.removed_example_sections, 0);
});

test('compactMarkdownContent strips example sections', () => {
    const input = '# Title\n\n## Examples\n\nExample text.\nMore example.\n\n## Next Section\n\nKeep this.\n';
    const result = compactMarkdownContent(input, { stripExamples: true });
    assert.ok(result.content.includes('> Example section omitted due to token economy.'));
    assert.ok(!result.content.includes('Example text.'));
    assert.ok(!result.content.includes('More example.'));
    assert.ok(result.content.includes('Next Section'));
    assert.ok(result.content.includes('Keep this.'));
    assert.equal(result.removed_example_sections, 1);
});

test('compactMarkdownContent strips code blocks', () => {
    const input = 'Some text.\n\n```python\nprint("hello")\n```\n\nMore text.\n';
    const result = compactMarkdownContent(input, { stripCodeBlocks: true });
    assert.ok(result.content.includes('> Code block omitted due to token economy.'));
    assert.ok(!result.content.includes('print("hello")'));
    assert.ok(result.content.includes('More text.'));
    assert.equal(result.removed_code_blocks, 1);
});

test('compactMarkdownContent strips both examples and code blocks', () => {
    const input = '# Title\n\n## Example\n\n```js\nconsole.log("test")\n```\n\n## Other\n\nKeep.\n';
    const result = compactMarkdownContent(input, { stripExamples: true, stripCodeBlocks: true });
    assert.ok(!result.content.includes('console.log'));
    assert.ok(result.content.includes('Keep.'));
});

test('compactMarkdownContent preserves trailing newline', () => {
    const input = 'Hello\n';
    const result = compactMarkdownContent(input);
    assert.ok(result.content.endsWith('\n'));
});

test('compactMarkdownContent normalizes CRLF to LF', () => {
    const input = 'Hello\r\nWorld\r\n';
    const result = compactMarkdownContent(input);
    assert.ok(!result.content.includes('\r'));
});

test('compactMarkdownContent strips example label pattern', () => {
    const input = 'Rule text.\n\nExamples:\n\n```bash\necho hello\n```\n\nMore text.\n';
    const result = compactMarkdownContent(input, { stripExamples: true });
    assert.ok(result.content.includes('> Example content omitted'));
    assert.ok(result.content.includes('> Code block omitted'));
    assert.ok(!result.content.includes('echo hello'));
    assert.equal(result.removed_example_labels, 1);
    assert.equal(result.removed_code_blocks, 1);
});

test('compactMarkdownContent counts correctly', () => {
    const input = 'Line 1\nLine 2\nLine 3\n';
    const result = compactMarkdownContent(input);
    assert.equal(result.original_line_count, 4); // split "Line 1\nLine 2\nLine 3\n" → 4 elements
    assert.equal(result.original_char_count, input.replace(/\r\n/g, '\n').length);
});

// --- getCompactReviewBudget ---

test('getCompactReviewBudget returns default for null', () => {
    const budget = getCompactReviewBudget(null);
    assert.equal(budget.fail_tail_lines, 50);
    assert.equal(budget.max_lines, 120);
    assert.equal(budget.max_chars, 12000);
    assert.equal(budget.max_code_fence_lines, 4);
    assert.equal(budget.max_example_markers, 0);
});

test('getCompactReviewBudget respects custom fail_tail_lines', () => {
    const budget = getCompactReviewBudget(100);
    assert.equal(budget.fail_tail_lines, 100);
    assert.equal(budget.max_lines, 170); // max(120, 100+70)
    assert.equal(budget.max_chars, 17000); // max(12000, 170*100)
});

test('getCompactReviewBudget clamps to minimum 1', () => {
    const budget = getCompactReviewBudget(-10);
    assert.equal(budget.fail_tail_lines, 1);
});

test('getCompactReviewBudget handles boolean as default', () => {
    const budget = getCompactReviewBudget(true);
    assert.equal(budget.fail_tail_lines, 50);
});

test('getCompactReviewBudget handles string input', () => {
    const budget = getCompactReviewBudget('75');
    assert.equal(budget.fail_tail_lines, 75);
});

// --- auditReviewArtifactCompaction ---

test('auditReviewArtifactCompaction not expected when not active', () => {
    const result = auditReviewArtifactCompaction({
        artifactPath: 'test.md',
        content: 'Some content.',
        reviewContext: {}
    });
    assert.equal(result.expected, false);
    assert.equal(result.warning_count, 0);
});

test('auditReviewArtifactCompaction warns on budget exceed', () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join('\n');
    const result = auditReviewArtifactCompaction({
        artifactPath: 'test.md',
        content: longContent,
        reviewContext: {
            token_economy_active: true,
            token_economy: {
                active: true,
                flags: { compact_reviewer_output: true, fail_tail_lines: 50 }
            }
        }
    });
    assert.equal(result.expected, true);
    assert.ok(result.warning_count > 0);
    assert.ok(result.warnings.some((w: string) => w.includes('exceeds compact line budget')));
});

// --- buildReviewContextSections ---

test('buildReviewContextSections builds artifact from mock files', () => {
    const files: Record<string, string> = {
        'rules/rule-1.md': '# Rule 1\n\nSome content.\n',
        'rules/rule-2.md': '# Rule 2\n\n## Example\n\nSkip this.\n\n## Important\n\nKeep this.\n'
    };

    const result = buildReviewContextSections(
        Object.keys(files),
        (path) => files[path],
        { stripExamples: true }
    );

    assert.equal(result.source_file_count, 2);
    assert.ok(result.artifact_text.includes('# Reviewer Rule Context'));
    assert.ok(result.artifact_text.includes('## Source: rules/rule-1.md'));
    assert.ok(result.artifact_text.includes('## Source: rules/rule-2.md'));
    assert.ok(result.artifact_text.includes('Some content.'));
    assert.ok(!result.artifact_text.includes('Skip this.'));
    assert.ok(result.artifact_text.includes('Keep this.'));
    assert.ok(result.artifact_text.includes('> Example section omitted'));
    assert.match(result.artifact_sha256!, /^[0-9a-f]{64}$/);

    // Verify summary totals
    const summary = result.summary as Record<string, number>;
    assert.ok(summary.original_line_count > 0);
    assert.ok(summary.original_char_count > 0);
    assert.ok(summary.original_token_count_estimate > 0);

    // Verify each file entry has content_sha256
    for (const entry of result.source_files) {
        assert.match(entry.content_sha256!, /^[0-9a-f]{64}$/);
    }
});

test('buildReviewContextSections handles empty rule file', () => {
    const result = buildReviewContextSections(
        ['empty.md'],
        () => '',
        { stripExamples: true, stripCodeBlocks: true }
    );

    assert.equal(result.source_file_count, 1);
    assert.ok(result.artifact_text.includes('_No remaining content after token-economy compaction._'));
});

test('buildReviewContextSections includes strip flags in header', () => {
    const result = buildReviewContextSections(
        ['test.md'],
        () => '# Test\nContent.\n',
        { stripExamples: true, stripCodeBlocks: false }
    );

    assert.ok(result.artifact_text.includes('- strip_examples: true'));
    assert.ok(result.artifact_text.includes('- strip_code_blocks: false'));
});
