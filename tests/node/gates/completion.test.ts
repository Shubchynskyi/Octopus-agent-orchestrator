import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    collectOrderedTimelineEvents,
    extractMarkdownSectionLines,
    formatCompletionGateResult,
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
    describe('collectOrderedTimelineEvents', () => {
        it('continues scanning valid events after an invalid JSON line', () => {
            const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-completion-timeline-'));
            const timelinePath = path.join(tempDir, 'timeline.jsonl');

            try {
                fs.writeFileSync(
                    timelinePath,
                    [
                        JSON.stringify({ event_type: 'TASK_MODE_ENTERED', timestamp_utc: '2026-01-01T00:00:00.000Z' }),
                        '{"event_type":',
                        JSON.stringify({ event_type: 'COMPILE_GATE_PASSED', timestamp_utc: '2026-01-01T00:02:00.000Z' }),
                        JSON.stringify({ event_type: 'REVIEW_GATE_PASSED', timestamp_utc: '2026-01-01T00:03:00.000Z' })
                    ].join('\n') + '\n',
                    'utf8'
                );

                const errors: string[] = [];
                const events = collectOrderedTimelineEvents(timelinePath, errors);

                assert.equal(errors.length, 1);
                assert.deepEqual(
                    events.map((entry) => entry.event_type),
                    ['TASK_MODE_ENTERED', 'COMPILE_GATE_PASSED', 'REVIEW_GATE_PASSED']
                );
                assert.deepEqual(
                    events.map((entry) => entry.sequence),
                    [0, 2, 3]
                );
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

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
                makeEvent('REVIEWER_DELEGATION_ROUTED', 4, {
                    review_type: 'code',
                    reviewer_execution_mode: 'delegated_subagent'
                }),
                makeEvent('REVIEW_RECORDED', 5, { review_type: 'code' }),
                makeEvent('SKILL_SELECTED', 6, { skill_id: 'testing-strategy' }),
                makeEvent('SKILL_REFERENCE_LOADED', 7, {
                    skill_id: 'testing-strategy',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/testing-strategy/SKILL.md'
                }),
                makeEvent('REVIEWER_DELEGATION_ROUTED', 8, {
                    review_type: 'test',
                    reviewer_execution_mode: 'delegated_subagent'
                }),
                makeEvent('REVIEW_RECORDED', 9, { review_type: 'test' }),
                makeEvent('REVIEW_GATE_PASSED', 10)
            ];
            const requiredReviews = { code: true, test: true };
            const reviewArtifacts = {
                code: {
                    path: '/reviews/T-123-code.md',
                    reviewContext: {
                        reviewer_routing: {
                            actual_execution_mode: 'delegated_subagent',
                            reviewer_session_id: 'agent:code-reviewer'
                        }
                    },
                    receipt: {
                        schema_version: 2,
                        task_id: 'T-123',
                        review_type: 'code',
                        preflight_sha256: null,
                        scope_sha256: null,
                        review_context_sha256: null,
                        review_artifact_sha256: null,
                        reviewer_execution_mode: 'delegated_subagent',
                        reviewer_identity: 'agent:code-reviewer',
                        reviewer_fallback_reason: null,
                        recorded_at_utc: '2026-01-01T00:00:00.000Z'
                    }
                },
                test: {
                    path: '/reviews/T-123-test.md',
                    reviewContext: {
                        reviewer_routing: {
                            actual_execution_mode: 'delegated_subagent',
                            reviewer_session_id: 'agent:test-reviewer'
                        }
                    },
                    receipt: {
                        schema_version: 2,
                        task_id: 'T-123',
                        review_type: 'test',
                        preflight_sha256: null,
                        scope_sha256: null,
                        review_context_sha256: null,
                        review_artifact_sha256: null,
                        reviewer_execution_mode: 'delegated_subagent',
                        reviewer_identity: 'agent:test-reviewer',
                        reviewer_fallback_reason: null,
                        recorded_at_utc: '2026-01-01T00:00:00.000Z'
                    }
                }
            };

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
                const result = validateReviewSkillEvidence(
                    events,
                    requiredReviews,
                    reviewArtifacts,
                    true,
                    '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl',
                    'Codex'
                );
                if (result.violations.length > 0) {
                    console.log('VIOLATIONS:', result.violations);
                }
                assert.equal(result.violations.length, 0);
                assert.deepEqual(result.reviewer_execution_modes, ['delegated_subagent']);
            } finally {
                fsMock.existsSync = originalExists;
                fsMock.readFileSync = originalRead;
            }
        });

        it('fails when delegation-required provider records same-agent fallback for a required review', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'testing-strategy' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'testing-strategy',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/testing-strategy/SKILL.md'
                }),
                makeEvent('REVIEWER_DELEGATION_ROUTED', 4, {
                    review_type: 'test',
                    reviewer_execution_mode: 'same_agent_fallback'
                }),
                makeEvent('REVIEW_RECORDED', 5, { review_type: 'test' }),
                makeEvent('REVIEW_GATE_PASSED', 6)
            ];
            const result = validateReviewSkillEvidence(
                events,
                { test: true },
                {
                    test: {
                        path: '/reviews/T-123-test.md',
                        reviewContext: {
                            reviewer_routing: {
                                actual_execution_mode: 'same_agent_fallback',
                                reviewer_session_id: 'self:T-123'
                            }
                        }
                    }
                },
                true,
                '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl',
                'Codex'
            );

            assert.ok(result.violations.some((entry) => entry.includes('delegated_subagent')));
        });

        it('fails when a single-agent provider records delegated_subagent for a required review', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'code-review' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'code-review',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
                }),
                makeEvent('REVIEWER_DELEGATION_ROUTED', 4, {
                    review_type: 'code',
                    reviewer_execution_mode: 'delegated_subagent',
                    reviewer_session_id: 'agent:code-reviewer'
                }),
                makeEvent('REVIEW_RECORDED', 5, { review_type: 'code' }),
                makeEvent('REVIEW_GATE_PASSED', 6)
            ];
            const result = validateReviewSkillEvidence(
                events,
                { code: true },
                {
                    code: {
                        path: '/reviews/T-123-code.md',
                        reviewContext: {
                            reviewer_routing: {
                                actual_execution_mode: 'delegated_subagent',
                                reviewer_session_id: 'agent:code-reviewer'
                            }
                        }
                    }
                },
                true,
                '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl',
                'Qwen'
            );

            assert.ok(result.violations.some((entry) => entry.includes('single-agent providers')));
        });

        it('fails when review-context uses an invalid reviewer execution mode', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'code-review' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'code-review',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
                }),
                makeEvent('REVIEWER_DELEGATION_ROUTED', 4, {
                    review_type: 'code',
                    reviewer_execution_mode: 'delegated_subagent',
                    reviewer_session_id: 'agent:code-reviewer'
                }),
                makeEvent('REVIEW_RECORDED', 5, { review_type: 'code' }),
                makeEvent('REVIEW_GATE_PASSED', 6)
            ];
            const result = validateReviewSkillEvidence(
                events,
                { code: true },
                {
                    code: {
                        path: '/reviews/T-123-code.md',
                        reviewContext: {
                            reviewer_routing: {
                                actual_execution_mode: 'delegated_magic',
                                reviewer_session_id: 'agent:code-reviewer'
                            }
                        },
                        receipt: {
                            schema_version: 2,
                            task_id: 'T-123',
                            review_type: 'code',
                            preflight_sha256: null,
                            scope_sha256: null,
                            review_context_sha256: null,
                            review_artifact_sha256: null,
                            reviewer_execution_mode: 'delegated_subagent',
                            reviewer_identity: 'agent:code-reviewer',
                            reviewer_fallback_reason: null,
                            recorded_at_utc: '2026-01-01T00:00:00.000Z'
                        }
                    }
                },
                true,
                '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl',
                'Codex'
            );

            assert.ok(result.violations.some((entry) => entry.includes('invalid reviewer_routing.actual_execution_mode')));
        });

        it('fails when receipt reviewer identity disagrees with review-context reviewer session', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'code-review' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'code-review',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
                }),
                makeEvent('REVIEWER_DELEGATION_ROUTED', 4, {
                    review_type: 'code',
                    reviewer_execution_mode: 'delegated_subagent',
                    reviewer_session_id: 'agent:code-reviewer'
                }),
                makeEvent('REVIEW_RECORDED', 5, { review_type: 'code' }),
                makeEvent('REVIEW_GATE_PASSED', 6)
            ];
            const result = validateReviewSkillEvidence(
                events,
                { code: true },
                {
                    code: {
                        path: '/reviews/T-123-code.md',
                        reviewContext: {
                            reviewer_routing: {
                                actual_execution_mode: 'delegated_subagent',
                                reviewer_session_id: 'agent:code-reviewer'
                            }
                        },
                        receipt: {
                            schema_version: 2,
                            task_id: 'T-123',
                            review_type: 'code',
                            preflight_sha256: null,
                            scope_sha256: null,
                            review_context_sha256: null,
                            review_artifact_sha256: null,
                            reviewer_execution_mode: 'delegated_subagent',
                            reviewer_identity: 'agent:other-reviewer',
                            reviewer_fallback_reason: null,
                            recorded_at_utc: '2026-01-01T00:00:00.000Z'
                        }
                    }
                },
                true,
                '/repo/Octopus-agent-orchestrator/runtime/task-events/T-123.jsonl',
                'Codex'
            );

            assert.ok(result.violations.some((entry) => entry.includes('inconsistent reviewer identity')));
        });

        it('fails when code changed but review telemetry is missing', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('REVIEW_GATE_PASSED', 2)
            ];
            const requiredReviews = { code: true };
            const result = validateReviewSkillEvidence(events, requiredReviews, {}, true, '/T-123.jsonl', 'Codex');
            assert.ok(result.violations.some(v => v.includes('SKILL_SELECTED telemetry') && v.includes("'code'")));
        });

        it('fails when reviewer delegation telemetry is missing', () => {
            const events = [
                makeEvent('COMPILE_GATE_PASSED', 0),
                makeEvent('REVIEW_PHASE_STARTED', 1),
                makeEvent('SKILL_SELECTED', 2, { skill_id: 'code-review' }),
                makeEvent('SKILL_REFERENCE_LOADED', 3, {
                    skill_id: 'code-review',
                    reference_path: '/repo/Octopus-agent-orchestrator/live/skills/code-review/SKILL.md'
                }),
                makeEvent('REVIEW_RECORDED', 4, { review_type: 'code' }),
                makeEvent('REVIEW_GATE_PASSED', 5)
            ];
            const requiredReviews = { code: true };
            const result = validateReviewSkillEvidence(
                events,
                requiredReviews,
                { code: { path: '/reviews/T-123-code.md' } },
                true,
                '/T-123.jsonl',
                'Codex'
            );
            assert.ok(result.violations.some(v => v.includes('REVIEWER_DELEGATION_ROUTED telemetry')));
        });
    });

    describe('formatCompletionGateResult', () => {
        it('includes TrustStatus when review receipts carry trust levels', () => {
            const output = formatCompletionGateResult({
                task_id: 'T-1001',
                status: 'PASSED',
                outcome: 'PASS',
                review_artifacts: {
                    code: {
                        receipt: {
                            trust_level: 'LOCAL_AUDITED'
                        }
                    }
                }
            });

            assert.match(output, /TrustStatus: LOCAL_AUDITED/);
        });
    });
});
