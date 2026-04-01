import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { isTrivialReview } from '../../../src/gates/completion';
import { checkRequiredReviews } from '../../../src/gates/required-reviews-check';

describe('gates/authenticity (T-043)', () => {
    describe('isTrivialReview', () => {
        it('returns true for very short content', () => {
            assert.equal(isTrivialReview('REVIEW PASSED'), true);
            assert.equal(isTrivialReview('Short review. REVIEW PASSED.'), true);
        });

        it('returns true for boilerplate content with no findings/risks', () => {
            const content = `
# Code Review T-043
## Summary
This is a summary that is long enough to pass the initial length check but contains absolutely no implementation details, no code references, and no findings.
## Findings by Severity
none
## Residual Risks
none
## Verdict
REVIEW PASSED
            `.trim();
            assert.equal(isTrivialReview(content), true);
        });

        it('returns false for meaningful content with code references', () => {
            const content = `
# Code Review T-043
## Summary
The changes in \`src/gates/completion.ts\` correctly implement the triviality check.
The logic handles word count and backtick detection.
## Findings by Severity
none
## Residual Risks
none
## Verdict
REVIEW PASSED
            `.trim();
            // Length > 100 and contains backticks
            assert.equal(isTrivialReview(content), false);
        });

        it('returns false for content with findings', () => {
            const content = `
# Code Review T-043
## Summary
I found some issues.
## Findings by Severity
- Low: Missing comment on line 42 in \`src/main.ts\`.
## Residual Risks
none
## Verdict
REVIEW PASSED
            `.trim();
            // Length > 100 and contains meaningful finding
            assert.equal(isTrivialReview(content), false);
        });
    });

    describe('checkRequiredReviews receipt validation', () => {
        const tempDir = path.join(os.tmpdir(), `octopus-test-authenticity-${Date.now()}`);
        
        it('fails when verifiable receipt is missing for required review', () => {
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const artifactPath = path.join(tempDir, 'T-043-code.md');
            fs.writeFileSync(artifactPath, '# Review\nREVIEW PASSED\n'.repeat(10));

            const options = {
                validatedPreflight: {
                    errors: [],
                    resolved_task_id: 'T-043',
                    required_reviews: { code: true } as any,
                    preflight_path: 'preflight.json',
                    preflight_hash: 'abc'
                },
                verdicts: { code: 'REVIEW PASSED' },
                reviewArtifacts: {
                    code: {
                        path: artifactPath,
                        content: fs.readFileSync(artifactPath, 'utf8')
                    }
                }
            };

            const result = checkRequiredReviews(options);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations[0].includes('Verifiable review receipt missing'));
        });

        it('fails when artifact hash mismatch with receipt', () => {
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const artifactPath = path.join(tempDir, 'T-043-hash-mismatch-code.md');
            const receiptPath = path.join(tempDir, 'T-043-hash-mismatch-code-receipt.json');
            
            fs.writeFileSync(artifactPath, '# Original Review\nREVIEW PASSED\n'.repeat(10));
            const receipt = {
                schema_version: 1,
                task_id: 'T-043',
                review_type: 'code',
                review_artifact_sha256: 'fake-hash'
            };
            fs.writeFileSync(receiptPath, JSON.stringify(receipt));

            const options = {
                validatedPreflight: {
                    errors: [],
                    resolved_task_id: 'T-043',
                    required_reviews: { code: true } as any,
                    preflight_path: 'preflight.json',
                    preflight_hash: 'abc'
                },
                verdicts: { code: 'REVIEW PASSED' },
                reviewArtifacts: {
                    code: {
                        path: artifactPath,
                        content: fs.readFileSync(artifactPath, 'utf8')
                    }
                }
            };

            const result = checkRequiredReviews(options);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations[0].includes('artifact hash mismatch'));
        });

        it('fails when task_id mismatch in receipt', () => {
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const artifactPath = path.join(tempDir, 'T-043-task-mismatch-code.md');
            const receiptPath = path.join(tempDir, 'T-043-task-mismatch-code-receipt.json');
            
            const content = '# Valid Review\nREVIEW PASSED\n'.repeat(10);
            fs.writeFileSync(artifactPath, content);
            
            // We need a real hash for the next check to pass and trigger task_id check
            const crypto = require('node:crypto');
            const hash = crypto.createHash('sha256').update(content).digest('hex');

            const receipt = {
                schema_version: 1,
                task_id: 'WRONG-TASK',
                review_type: 'code',
                review_artifact_sha256: hash
            };
            fs.writeFileSync(receiptPath, JSON.stringify(receipt));

            const options = {
                validatedPreflight: {
                    errors: [],
                    resolved_task_id: 'T-043',
                    required_reviews: { code: true } as any,
                    preflight_path: 'preflight.json',
                    preflight_hash: 'abc'
                },
                verdicts: { code: 'REVIEW PASSED' },
                reviewArtifacts: {
                    code: {
                        path: artifactPath,
                        content: fs.readFileSync(artifactPath, 'utf8')
                    }
                }
            };

            const result = checkRequiredReviews(options);
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations[0].includes('belongs to a different task'));
        });
    });
});
