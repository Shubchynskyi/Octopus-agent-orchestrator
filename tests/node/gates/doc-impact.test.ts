import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { assessDocImpact } from '../../../src/gates/doc-impact';

function createPreflight(tmpDir: string, overrides: Record<string, unknown> = {}): string {
    const preflight = {
        task_id: 'T-001',
        detection_source: 'git_auto',
        mode: 'FULL_PATH',
        metrics: { changed_lines_total: 50 },
        triggers: {},
        required_reviews: {
            code: true, db: false, security: false, refactor: false,
            api: false, test: false, performance: false, infra: false, dependency: false
        },
        changed_files: ['src/app.ts'],
        ...overrides
    };
    const filePath = path.join(tmpDir, 'T-001-preflight.json');
    fs.writeFileSync(filePath, JSON.stringify(preflight, null, 2), 'utf8');
    return filePath;
}

describe('gates/doc-impact', () => {
    describe('assessDocImpact', () => {
        it('passes with valid DOCS_UPDATED decision', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir);
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'DOCS_UPDATED',
                behaviorChanged: true,
                changelogUpdated: true,
                sensitiveReviewed: false,
                docsUpdated: ['README.md'],
                rationale: 'Updated README with new API docs for the user endpoint.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'PASSED');
            assert.equal(result.outcome, 'PASS');
            assert.equal(result.violations.length, 0);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('passes with NO_DOC_UPDATES when no sensitive triggers', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir);
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'NO_DOC_UPDATES',
                behaviorChanged: false,
                changelogUpdated: false,
                sensitiveReviewed: false,
                docsUpdated: [],
                rationale: 'Only internal refactor, no public API changes.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'PASSED');
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('fails when rationale too short', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir);
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'NO_DOC_UPDATES',
                behaviorChanged: false,
                changelogUpdated: false,
                sensitiveReviewed: false,
                docsUpdated: [],
                rationale: 'short',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Rationale')));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('fails when DOCS_UPDATED has empty docs list', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir);
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'DOCS_UPDATED',
                behaviorChanged: false,
                changelogUpdated: false,
                sensitiveReviewed: false,
                docsUpdated: [],
                rationale: 'Updated some documentation files.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('non-empty docs_updated')));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('fails when behavior changed but no changelog', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir);
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'DOCS_UPDATED',
                behaviorChanged: true,
                changelogUpdated: false,
                sensitiveReviewed: false,
                docsUpdated: ['README.md'],
                rationale: 'Updated README with new behavior docs.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('ChangelogUpdated')));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('fails when sensitive triggers and NO_DOC_UPDATES without reviewed flag', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir, {
                triggers: { security: true, api: true }
            });
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'NO_DOC_UPDATES',
                behaviorChanged: false,
                changelogUpdated: false,
                sensitiveReviewed: false,
                docsUpdated: [],
                rationale: 'No public API changes detected in this update.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'FAILED');
            assert.ok(result.violations.some(v => v.includes('Sensitive scope triggers')));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('passes when sensitive triggers with reviewed flag', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-impact-'));
            const preflightPath = createPreflight(tmpDir, {
                triggers: { security: true }
            });
            const result = assessDocImpact({
                preflightPath,
                taskId: 'T-001',
                decision: 'NO_DOC_UPDATES',
                behaviorChanged: false,
                changelogUpdated: false,
                sensitiveReviewed: true,
                docsUpdated: [],
                rationale: 'Security fix is internal-only, no doc change needed.',
                repoRoot: tmpDir
            });
            assert.equal(result.status, 'PASSED');
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });
});
