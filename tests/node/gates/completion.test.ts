import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    extractMarkdownSectionLines,
    isMeaningfulReviewEntry,
    getFindingsBySeverity,
    validateStageSequence,
    detectCodeChanged,
    validateReviewSkillEvidence,
    STAGE_SEQUENCE_ORDER,
    isTrivialReview
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
    });

    describe('isMeaningfulReviewEntry', () => {
        it('returns false for "none" variations', () => {
            assert.equal(isMeaningfulReviewEntry('none'), false);
            assert.equal(isMeaningfulReviewEntry('N/A'), false);
        });
        it('returns true for real content', () => {
            assert.equal(isMeaningfulReviewEntry('Found a bug'), true);
        });
    });

    describe('validateStageSequence', () => {
        function makeEvents(...types: (string | { type: string, details: any })[]): TimelineEventEntry[] {
            return types.map((t, i) => {
                const type = typeof t === 'string' ? t : t.type;
                const details = typeof t === 'object' ? t.details : null;
                return {
                    event_type: type,
                    timestamp_utc: `2026-01-01T00:0${i}:00.000Z`,
                    sequence: i,
                    details
                };
            });
        }

        it('passes when stages are in correct order for code-changing task', () => {
            const events = makeEvents(
                'TASK_MODE_ENTERED', 'RULE_PACK_LOADED', 'PREFLIGHT_CLASSIFIED',
                'IMPLEMENTATION_STARTED', 'COMPILE_GATE_PASSED',
                'REVIEW_PHASE_STARTED', 'REVIEW_RECORDED', 'REVIEW_GATE_PASSED'
            );
            const result = validateStageSequence(events, true, '/timeline.jsonl');
            assert.equal(result.violations.length, 0);
        });
    });

    describe('validateReviewSkillEvidence', () => {
        function makeEvent(
            eventType: string,
            sequence: number,
            details: Record<string, unknown> | null = null
        ): TimelineEventEntry {
            return {
                event_type: eventType,
                timestamp_utc: `2026-01-01T00:0${sequence}:00.000Z`,
                sequence,
                details
            };
        }

        it('returns no violations when code changed and review telemetry plus artifacts are present', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'code-review' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'code-review',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
                }),
                makeEvent('REVIEW_RECORDED', 4, { review_type: 'code' }),
                makeEvent('SKILL_SELECTED', 5, { skill_id: 'testing-strategy' }),
                makeEvent('SKILL_REFERENCE_LOADED', 6, {
                    skill_id: 'testing-strategy',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/testing-strategy/SKILL.md'
                }),
                makeEvent('REVIEW_RECORDED', 7, { review_type: 'test' }),
                makeEvent('REVIEW_GATE_PASSED', 8)
            ];
            const requiredReviews = { code: true, test: true };
            const reviewArtifacts = { code: { path: '/reviews/T-123-code.md' }, test: { path: '/reviews/T-123-test.md' } };

            const fsMock = require('node:fs');
            const originalExists = fsMock.existsSync;
            const originalRead = fsMock.readFileSync;
            
            // normalize slashes for cross-platform matching in mocks
            const norm = (p: string) => p.replace(/\\/g, '/');

            fsMock.existsSync = (p: string) => norm(p).includes('T-123-code.md') || norm(p).includes('T-123-test.md') || originalExists(p);
            fsMock.readFileSync = (p: string, e: string) => {
                if (norm(p).includes('T-123-code.md') || norm(p).includes('T-123-test.md')) {
                    return '# Review\nVerified changes in `src/main.ts`. This content is now intentionally made much longer so that it easily exceeds the thirty word minimum threshold required to pass the triviality check implemented in the completion gate logic.\n## Findings by Severity\nnone\n## Residual Risks\nnone\n## Verdict\nREVIEW PASSED';
                }
                return originalRead(p, e);
            };

            try {
                // timelinePath must be such that construction yields the mocked paths
                const result = validateReviewSkillEvidence(events, requiredReviews, reviewArtifacts, true, '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl');
                if (result.violations.length > 0) {
                    console.log('VIOLATIONS:', result.violations);
                }
                assert.equal(result.violations.length, 0);
            } finally {
                fsMock.existsSync = originalExists;
                fsMock.readFileSync = originalRead;
            }
        });

        it('fails when code changed but review telemetry is missing', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('REVIEW_GATE_PASSED', 2)
            ];
            const requiredReviews = { code: true };
            const result = validateReviewSkillEvidence(events, requiredReviews, {}, true, '/T-123.jsonl');
            assert.ok(result.violations.some(v => v.includes('SKILL_SELECTED telemetry') && v.includes("'code'")));
        });
    });
});
