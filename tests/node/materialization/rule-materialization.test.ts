const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    RULE_FILES,
    CONTEXT_RULE_FILES,
    selectRuleSource,
    applyContextDefaults,
    applyAssistantDefaults
} = require('../../../src/materialization/rule-materialization.ts');

describe('RULE_FILES', () => {
    it('contains all 11 standard rule files', () => {
        assert.equal(RULE_FILES.length, 11);
        assert.ok(RULE_FILES.includes('00-core.md'));
        assert.ok(RULE_FILES.includes('80-task-workflow.md'));
        assert.ok(RULE_FILES.includes('90-skill-catalog.md'));
    });
});

describe('CONTEXT_RULE_FILES', () => {
    it('contains the 6 context rules', () => {
        assert.equal(CONTEXT_RULE_FILES.length, 6);
        assert.ok(CONTEXT_RULE_FILES.includes('10-project-context.md'));
        assert.ok(CONTEXT_RULE_FILES.includes('60-operating-rules.md'));
    });
});

describe('selectRuleSource', () => {
    it('prefers template for 00-core.md', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-rules-'));
        try {
            const templateRuleRoot = path.join(tmpDir, 'template');
            const liveRuleRoot = path.join(tmpDir, 'live');
            const targetRoot = path.join(tmpDir, 'project');
            fs.mkdirSync(templateRuleRoot, { recursive: true });
            fs.mkdirSync(liveRuleRoot, { recursive: true });
            fs.mkdirSync(path.join(targetRoot, 'docs/agent-rules'), { recursive: true });
            fs.writeFileSync(path.join(templateRuleRoot, '00-core.md'), 'template');
            fs.writeFileSync(path.join(liveRuleRoot, '00-core.md'), 'live');
            fs.writeFileSync(path.join(targetRoot, 'docs/agent-rules/00-core.md'), 'legacy');

            const result = selectRuleSource('00-core.md', { targetRoot, liveRuleRoot, templateRuleRoot });
            assert.equal(result.origin, 'template');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('prefers legacy for context rules', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-rules-ctx-'));
        try {
            const templateRuleRoot = path.join(tmpDir, 'template');
            const liveRuleRoot = path.join(tmpDir, 'live');
            const targetRoot = path.join(tmpDir, 'project');
            fs.mkdirSync(templateRuleRoot, { recursive: true });
            fs.mkdirSync(liveRuleRoot, { recursive: true });
            fs.mkdirSync(path.join(targetRoot, 'docs/agent-rules'), { recursive: true });
            fs.writeFileSync(path.join(templateRuleRoot, '10-project-context.md'), 'template');
            fs.writeFileSync(path.join(liveRuleRoot, '10-project-context.md'), 'live');
            fs.writeFileSync(path.join(targetRoot, 'docs/agent-rules/10-project-context.md'), 'legacy');

            const result = selectRuleSource('10-project-context.md', { targetRoot, liveRuleRoot, templateRuleRoot });
            assert.equal(result.origin, 'legacy-docs');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('prefers live for non-context, non-core rules', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-rules-live-'));
        try {
            const templateRuleRoot = path.join(tmpDir, 'template');
            const liveRuleRoot = path.join(tmpDir, 'live');
            const targetRoot = path.join(tmpDir, 'project');
            fs.mkdirSync(templateRuleRoot, { recursive: true });
            fs.mkdirSync(liveRuleRoot, { recursive: true });
            fs.writeFileSync(path.join(templateRuleRoot, '70-security.md'), 'template');
            fs.writeFileSync(path.join(liveRuleRoot, '70-security.md'), 'live');

            const result = selectRuleSource('70-security.md', { targetRoot, liveRuleRoot, templateRuleRoot });
            assert.equal(result.origin, 'live-existing');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns null when no source found', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-rules-none-'));
        try {
            const result = selectRuleSource('missing.md', {
                targetRoot: tmpDir,
                liveRuleRoot: path.join(tmpDir, 'live'),
                templateRuleRoot: path.join(tmpDir, 'template')
            });
            assert.equal(result, null);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('applyContextDefaults', () => {
    it('appends discovery overlay to context rules', () => {
        const content = '# 10-project-context\n\nSome content.';
        const overlay = '## Project Discovery Snapshot\n- Stacks: Node.js';
        const result = applyContextDefaults(content, '10-project-context.md', overlay);
        assert.ok(result.includes('Project Discovery Snapshot'));
        assert.ok(result.includes('Some content'));
    });

    it('does not modify non-context rules', () => {
        const content = '# Security rules\n\nContent.';
        const result = applyContextDefaults(content, '70-security.md', 'overlay');
        assert.equal(result, content);
    });

    it('replaces existing overlay section', () => {
        const content = '# Context\n\n## Project Discovery Snapshot\n- Old data\n\n## Other Section';
        const overlay = '## Project Discovery Snapshot\n- New data';
        const result = applyContextDefaults(content, '10-project-context.md', overlay);
        assert.ok(result.includes('New data'));
    });
});

describe('applyAssistantDefaults', () => {
    it('replaces placeholders in 00-core.md', () => {
        const content = [
            '{{ASSISTANT_RESPONSE_LANGUAGE}}',
            '{{ASSISTANT_RESPONSE_BREVITY}}',
            'Respond in English for explanations and assistance.',
            '1. Respond in English.',
            'Default response brevity: concise.',
            '2. Keep responses concise unless the user explicitly asks for more or less detail.'
        ].join('\n');

        const result = applyAssistantDefaults(content, '00-core.md', 'Russian', 'detailed');
        assert.ok(result.includes('Russian'));
        assert.ok(result.includes('detailed'));
        assert.ok(!result.includes('{{ASSISTANT_RESPONSE_LANGUAGE}}'));
        assert.ok(!result.includes('{{ASSISTANT_RESPONSE_BREVITY}}'));
        assert.ok(result.includes('Respond in Russian for explanations and assistance.'));
        assert.ok(result.includes('Default response brevity: detailed.'));
    });

    it('does not modify non-core rules', () => {
        const content = '{{ASSISTANT_RESPONSE_LANGUAGE}}';
        const result = applyAssistantDefaults(content, '10-project-context.md', 'Russian', 'detailed');
        assert.equal(result, content);
    });
});
