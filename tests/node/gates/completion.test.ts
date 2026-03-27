import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    extractMarkdownSectionLines,
    normalizeReviewListText,
    isMeaningfulReviewEntry,
    getMarkdownMeaningfulEntries,
    getFindingsBySeverity,
    getReviewArtifactFindingsEvidence
} from '../../../src/gates/completion';

describe('gates/completion', () => {
    describe('extractMarkdownSectionLines', () => {
        it('extracts lines under matching heading', () => {
            const lines = [
                '## Introduction',
                'Some intro text.',
                '',
                '## Findings by Severity',
                '- Critical: SQL injection',
                '- High: XSS vulnerability',
                '',
                '## Residual Risks',
                '- None'
            ];
            const result = extractMarkdownSectionLines(lines, 'Findings by Severity');
            assert.ok(result.length >= 2);
            assert.ok(result.some(l => l.includes('Critical')));
        });

        it('stops at next heading', () => {
            const lines = [
                '## Findings by Severity',
                '- Low: minor issue',
                '## Next Section',
                '- irrelevant'
            ];
            const result = extractMarkdownSectionLines(lines, 'Findings by Severity');
            assert.equal(result.length, 1);
        });

        it('returns empty for missing section', () => {
            const result = extractMarkdownSectionLines(['## Other'], 'Findings by Severity');
            assert.equal(result.length, 0);
        });
    });

    describe('normalizeReviewListText', () => {
        it('strips bullet prefixes', () => {
            assert.equal(normalizeReviewListText('- Some finding'), 'Some finding');
            assert.equal(normalizeReviewListText('* Other finding'), 'Other finding');
            assert.equal(normalizeReviewListText('1. Numbered finding'), 'Numbered finding');
        });
        it('strips backtick wrappers', () => {
            assert.equal(normalizeReviewListText('`wrapped text`'), 'wrapped text');
        });
        it('returns empty for null', () => {
            assert.equal(normalizeReviewListText(null), '');
        });
    });

    describe('isMeaningfulReviewEntry', () => {
        it('returns false for empty markers', () => {
            assert.equal(isMeaningfulReviewEntry('None'), false);
            assert.equal(isMeaningfulReviewEntry('N/A'), false);
            assert.equal(isMeaningfulReviewEntry('No findings'), false);
            assert.equal(isMeaningfulReviewEntry('no residual risks'), false);
            assert.equal(isMeaningfulReviewEntry('no deferred findings'), false);
        });
        it('returns true for meaningful content', () => {
            assert.equal(isMeaningfulReviewEntry('SQL injection in UserService'), true);
        });
        it('returns false for empty string', () => {
            assert.equal(isMeaningfulReviewEntry(''), false);
        });
    });

    describe('getMarkdownMeaningfulEntries', () => {
        it('collects meaningful bullet entries', () => {
            const lines = [
                '- First finding',
                '- None',
                '- Second finding',
                ''
            ];
            const result = getMarkdownMeaningfulEntries(lines);
            assert.deepEqual(result, ['First finding', 'Second finding']);
        });
    });

    describe('getFindingsBySeverity', () => {
        it('parses severity categories', () => {
            const lines = [
                'Critical: SQL injection found',
                'High: XSS vulnerability',
                '- Another high finding',
                'Medium: Minor issue',
                'Low: Cosmetic problem'
            ];
            const result = getFindingsBySeverity(lines);
            assert.equal(result.critical.length, 1);
            assert.equal(result.high.length, 2);
            assert.equal(result.medium.length, 1);
            assert.equal(result.low.length, 1);
        });

        it('handles empty findings', () => {
            const result = getFindingsBySeverity([]);
            assert.deepEqual(result, { critical: [], high: [], medium: [], low: [] });
        });
    });

    describe('getReviewArtifactFindingsEvidence', () => {
        it('returns PASS when all sections are clean', () => {
            const content = [
                '# Review',
                '',
                '## Findings by Severity',
                'Critical: None',
                'High: None',
                'Medium: None',
                'Low: None',
                '',
                '## Residual Risks',
                'None',
                '',
                '## Deferred Findings',
                'None',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001-code-review.md', content);
            assert.equal(result.status, 'PASS');
            assert.equal(result.violations.length, 0);
        });

        it('fails when findings section has active findings', () => {
            const content = [
                '## Findings by Severity',
                'Low: Minor unused import',
                '',
                '## Residual Risks',
                'None',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001-code-review.md', content);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Low findings')));
        });

        it('fails when Findings by Severity section missing', () => {
            const content = [
                '## Residual Risks',
                'None',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001-code-review.md', content);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Findings by Severity')));
        });

        it('fails when Residual Risks section missing', () => {
            const content = [
                '## Findings by Severity',
                'Critical: None',
                'High: None',
                'Medium: None',
                'Low: None',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001-code-review.md', content);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Residual Risks')));
        });

        it('fails when residual risks have active entries', () => {
            const content = [
                '## Findings by Severity',
                'Critical: None',
                'High: None',
                'Medium: None',
                'Low: None',
                '',
                '## Residual Risks',
                '- Some remaining risk that needs attention',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001.md', content);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('residual risks')));
        });

        it('fails when deferred findings lack justification', () => {
            const content = [
                '## Findings by Severity',
                'Critical: None',
                'High: None',
                'Medium: None',
                'Low: None',
                '',
                '## Residual Risks',
                'None',
                '',
                '## Deferred Findings',
                '- Deferred cleanup of legacy code',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001.md', content);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Justification')));
        });

        it('passes when deferred findings have valid justification', () => {
            const content = [
                '## Findings by Severity',
                'Critical: None',
                'High: None',
                'Medium: None',
                'Low: None',
                '',
                '## Residual Risks',
                'None',
                '',
                '## Deferred Findings',
                '- Legacy code cleanup Justification: Tracked in JIRA-1234, will address in next sprint',
            ].join('\n');
            const result = getReviewArtifactFindingsEvidence('/reviews/T-001.md', content);
            assert.equal(result.status, 'PASS');
            assert.equal(result.violations.length, 0);
        });
    });
});
