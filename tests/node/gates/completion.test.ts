import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    extractMarkdownSectionLines,
    normalizeReviewListText,
    isMeaningfulReviewEntry,
    getMarkdownMeaningfulEntries,
    getFindingsBySeverity,
    getReviewArtifactFindingsEvidence,
    collectOrderedTimelineEvents,
    validateStageSequence,
    detectCodeChanged,
    validateReviewSkillEvidence,
    STAGE_SEQUENCE_ORDER
} from '../../../src/gates/completion';

import type { TimelineEventEntry } from '../../../src/gates/completion';

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

    describe('STAGE_SEQUENCE_ORDER', () => {
        it('contains the canonical stage events', () => {
            assert.ok(STAGE_SEQUENCE_ORDER.includes('TASK_MODE_ENTERED'));
            assert.ok(STAGE_SEQUENCE_ORDER.includes('PREFLIGHT_CLASSIFIED'));
            assert.ok(STAGE_SEQUENCE_ORDER.includes('COMPILE_GATE_PASSED'));
            assert.ok(STAGE_SEQUENCE_ORDER.includes('REVIEW_GATE_PASSED'));
            assert.equal(STAGE_SEQUENCE_ORDER.length, 5);
        });
    });

    describe('validateStageSequence', () => {
        function makeEvents(...types: string[]): TimelineEventEntry[] {
            return types.map((t, i) => ({ event_type: t, timestamp_utc: `2026-01-01T00:0${i}:00.000Z`, sequence: i }));
        }

        it('passes when stages are in correct order for code-changing task', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'PREFLIGHT_CLASSIFIED',
                'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.equal(result.violations.length, 0);
            assert.equal(result.code_changed, true);
            assert.deepEqual(result.observed_order, [
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'PREFLIGHT_CLASSIFIED',
                'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED'
            ]);
        });

        it('passes for non-code task without PREFLIGHT_CLASSIFIED', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED',
                'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, false, '/timeline.jsonl');
            assert.equal(result.violations.length, 0);
            assert.equal(result.code_changed, false);
        });

        it('fails when REVIEW_GATE_PASSED appears before COMPILE_GATE_PASSED', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'PREFLIGHT_CLASSIFIED',
                'REVIEW_GATE_PASSED', 'COMPILE_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.ok(result.violations.length > 0);
            assert.ok(result.violations.some(v => v.includes('REVIEW_GATE_PASSED') && v.includes('before') && v.includes('COMPILE_GATE_PASSED')));
        });

        it('fails when COMPILE_GATE_PASSED appears before PREFLIGHT_CLASSIFIED for code-changing task', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED',
                'COMPILE_GATE_PASSED', 'PREFLIGHT_CLASSIFIED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.ok(result.violations.some(v => v.includes('COMPILE_GATE_PASSED') && v.includes('before') && v.includes('PREFLIGHT_CLASSIFIED')));
        });

        it('fails when PREFLIGHT_CLASSIFIED is missing for code-changing task', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED',
                'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.ok(result.violations.some(v => v.includes('PREFLIGHT_CLASSIFIED')));
        });

        it('handles extra non-canonical events without error', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'PLAN_CREATED',
                'PREFLIGHT_CLASSIFIED', 'COMPILE_GATE_PASSED',
                'REVIEW_PHASE_STARTED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.equal(result.violations.length, 0);
        });
    });

    describe('detectCodeChanged', () => {
        it('returns true when changed_lines_total > 0', () => {
            assert.equal(detectCodeChanged({ metrics: { changed_lines_total: 42 } }), true);
        });

        it('returns true when changed_files is non-empty', () => {
            assert.equal(detectCodeChanged({ changed_files: ['src/foo.ts'], metrics: { changed_lines_total: 0 } }), true);
        });

        it('returns false when no changes', () => {
            assert.equal(detectCodeChanged({ changed_files: [], metrics: { changed_lines_total: 0 } }), false);
        });

        it('returns false for null preflight', () => {
            assert.equal(detectCodeChanged(null), false);
        });

        it('returns false when metrics missing', () => {
            assert.equal(detectCodeChanged({}), false);
        });
    });

    describe('validateReviewSkillEvidence', () => {
        it('returns no violations when no code changed', () => {
            const result = validateReviewSkillEvidence(null, {}, {}, false);
            assert.equal(result.violations.length, 0);
        });

        it('returns no violations when code changed and review evidence present', () => {
            const reviewEvidence = {
                status: 'PASSED',
                outcome: 'PASS',
                review_checks: {
                    code: { required: true, verdict: 'REVIEW PASSED' },
                    test: { required: true, verdict: 'TEST REVIEW PASSED' }
                }
            };
            const requiredReviews = { code: true, test: true };
            const reviewArtifacts = { code: { path: '/r/code.md' }, test: { path: '/r/test.md' } };
            const result = validateReviewSkillEvidence(reviewEvidence, requiredReviews, reviewArtifacts, true);
            assert.equal(result.violations.length, 0);
            assert.deepEqual(result.skill_ids, ['code', 'test']);
            assert.deepEqual(result.artifact_keys, ['code', 'test']);
        });

        it('fails when code changed but review evidence has no invocations', () => {
            const reviewEvidence = {
                status: 'PASSED',
                outcome: 'PASS',
                review_checks: {
                    code: { required: true, verdict: 'NOT_REQUIRED' }
                }
            };
            const requiredReviews = { code: true };
            const reviewArtifacts = {};
            const result = validateReviewSkillEvidence(reviewEvidence, requiredReviews, reviewArtifacts, true);
            assert.ok(result.violations.some(v => v.includes('no review-skill invocation evidence')));
        });

        it('fails when code changed and required review artifact is missing', () => {
            const reviewEvidence = {
                status: 'PASSED',
                outcome: 'PASS',
                review_checks: {
                    code: { required: true, verdict: 'REVIEW PASSED' }
                }
            };
            const requiredReviews = { code: true, test: true };
            const reviewArtifacts = { code: { path: '/r/code.md' } };
            const result = validateReviewSkillEvidence(reviewEvidence, requiredReviews, reviewArtifacts, true);
            assert.ok(result.violations.some(v => v.includes("missing review artifact") && v.includes("'test'")));
        });

        it('passes when no reviews required even with code change', () => {
            const reviewEvidence = {
                status: 'PASSED',
                outcome: 'PASS',
                review_checks: {}
            };
            const requiredReviews = {};
            const result = validateReviewSkillEvidence(reviewEvidence, requiredReviews, {}, true);
            assert.equal(result.violations.length, 0);
        });
    });
});
