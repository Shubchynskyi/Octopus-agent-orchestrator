import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    parseBooleanLike,
    readVerifyInitAnswers,
    runVerify,
    formatVerifyResult,
    detectCommandsViolations,
    detectCoreRuleViolations,
    detectEntrypointViolations,
    detectTaskViolations,
    detectQwenSettingsViolations,
    detectManifestContractViolations
} from '../../../src/validators/verify';

test('parseBooleanLike handles true values', () => {
    assert.equal(parseBooleanLike(true, false), true);
    assert.equal(parseBooleanLike('true', false), true);
    assert.equal(parseBooleanLike('yes', false), true);
    assert.equal(parseBooleanLike('1', false), true);
    assert.equal(parseBooleanLike('on', false), true);
    assert.equal(parseBooleanLike('да', false), true);
});

test('parseBooleanLike handles false values', () => {
    assert.equal(parseBooleanLike(false, true), false);
    assert.equal(parseBooleanLike('false', true), false);
    assert.equal(parseBooleanLike('no', true), false);
    assert.equal(parseBooleanLike('0', true), false);
    assert.equal(parseBooleanLike('off', true), false);
    assert.equal(parseBooleanLike('нет', true), false);
});

test('parseBooleanLike returns default for null/undefined', () => {
    assert.equal(parseBooleanLike(null, true), true);
    assert.equal(parseBooleanLike(undefined, false), false);
});

test('readVerifyInitAnswers reports missing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const result = readVerifyInitAnswers(
            tmpDir,
            'Octopus-agent-orchestrator/runtime/init-answers.json',
            'Claude'
        );
        assert.ok(result.violations.some(v => v.includes('missing')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readVerifyInitAnswers validates fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    const answersDir = path.join(tmpDir, 'Octopus-agent-orchestrator', 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'Claude',
            EnforceNoAutoCommit: 'false',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true',
            CollectedVia: 'CLI_INTERACTIVE'
        }),
        'utf8'
    );

    try {
        const result = readVerifyInitAnswers(
            tmpDir,
            'Octopus-agent-orchestrator/runtime/init-answers.json',
            'Claude'
        );
        assert.equal(result.violations.length, 0);
        assert.equal(result.assistantLanguage, 'English');
        assert.equal(result.assistantBrevity, 'concise');
        assert.equal(result.enforceNoAutoCommit, false);
        assert.equal(result.claudeOrchestratorFullAccess, false);
        assert.equal(result.tokenEconomyEnabled, true);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readVerifyInitAnswers catches source-of-truth mismatch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    const answersDir = path.join(tmpDir, 'Octopus-agent-orchestrator', 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'Codex',
            EnforceNoAutoCommit: 'false',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true'
        }),
        'utf8'
    );

    try {
        const result = readVerifyInitAnswers(
            tmpDir,
            'Octopus-agent-orchestrator/runtime/init-answers.json',
            'Claude'
        );
        assert.ok(result.violations.some(v => v.includes('does not match')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('readVerifyInitAnswers catches invalid brevity', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    const answersDir = path.join(tmpDir, 'Octopus-agent-orchestrator', 'runtime');
    fs.mkdirSync(answersDir, { recursive: true });
    fs.writeFileSync(
        path.join(answersDir, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'English',
            AssistantBrevity: 'verbose',
            SourceOfTruth: 'Claude',
            EnforceNoAutoCommit: 'false',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true'
        }),
        'utf8'
    );

    try {
        const result = readVerifyInitAnswers(
            tmpDir,
            'Octopus-agent-orchestrator/runtime/init-answers.json',
            'Claude'
        );
        assert.ok(result.violations.some(v => v.includes('AssistantBrevity')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectCommandsViolations returns empty for missing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectCommandsViolations(tmpDir);
        assert.deepEqual(violations, []);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectCoreRuleViolations catches missing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectCoreRuleViolations(tmpDir, null, null);
        assert.ok(violations.some(v => v.includes('00-core.md missing')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectCoreRuleViolations validates language and brevity lines', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    const coreDir = path.join(
        tmpDir,
        'Octopus-agent-orchestrator', 'live', 'docs', 'agent-rules'
    );
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
        path.join(coreDir, '00-core.md'),
        'Respond in English for explanations and assistance.\nDefault response brevity: concise.\nimplementation summary\ngit commit -m "<message>"\nDo you want me to commit now? (yes/no)\n80-task-workflow.md\n',
        'utf8'
    );

    try {
        const violations = detectCoreRuleViolations(tmpDir, 'English', 'concise');
        assert.equal(violations.length, 0);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectCoreRuleViolations catches language mismatch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    const coreDir = path.join(
        tmpDir,
        'Octopus-agent-orchestrator', 'live', 'docs', 'agent-rules'
    );
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
        path.join(coreDir, '00-core.md'),
        'Respond in English for explanations and assistance.\nDefault response brevity: concise.\n',
        'utf8'
    );

    try {
        const violations = detectCoreRuleViolations(tmpDir, 'Russian', 'concise');
        assert.ok(violations.some(v => v.includes('language does not match')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectTaskViolations catches missing TASK.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectTaskViolations(tmpDir, 'CLAUDE.md');
        assert.ok(violations.some(v => v.includes('TASK.md missing')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectEntrypointViolations catches missing entrypoint', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectEntrypointViolations(tmpDir, 'CLAUDE.md');
        assert.ok(violations.some(v => v.includes('Canonical entrypoint missing')));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectEntrypointViolations returns empty for null entrypoint', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectEntrypointViolations(tmpDir, null);
        assert.deepEqual(violations, []);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('detectQwenSettingsViolations returns empty for missing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const violations = detectQwenSettingsViolations(tmpDir, 'CLAUDE.md');
        assert.deepEqual(violations, []);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runVerify returns failed result for empty workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const result = runVerify({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude',
            initAnswersPath: 'Octopus-agent-orchestrator/runtime/init-answers.json'
        });
        assert.equal(result.passed, false);
        assert.ok(result.totalViolationCount > 0);
        assert.equal(result.sourceOfTruth, 'Claude');
        assert.equal(result.canonicalEntrypoint, 'CLAUDE.md');
        assert.ok(!result.violations.gitignoreMissing.includes('.qwen/'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatVerifyResult includes diagnostic markers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    try {
        const result = runVerify({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude',
            initAnswersPath: 'Octopus-agent-orchestrator/runtime/init-answers.json'
        });
        const output = formatVerifyResult(result);
        assert.ok(output.includes('TargetRoot:'));
        assert.ok(output.includes('SourceOfTruth: Claude'));
        assert.ok(output.includes('MissingPathCount:'));
        assert.ok(output.includes('Verification failed'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatVerifyResult shows PASS when all checks pass', () => {
    const fakeResult = {
        passed: true,
        targetRoot: '/tmp/test',
        sourceOfTruth: 'Claude',
        canonicalEntrypoint: 'CLAUDE.md',
        bundleVersion: '1.0.0',
        requiredPathsChecked: 10,
        violations: {
            missingPaths: [],
            initAnswersContractViolations: [],
            versionContractViolations: [],
            reviewCapabilitiesContractViolations: [],
            pathsContractViolations: [],
            tokenEconomyContractViolations: [],
            outputFiltersContractViolations: [],
            skillPacksConfigContractViolations: [],
            skillsIndexConfigContractViolations: [],
            ruleFileViolations: [],
            templatePlaceholderViolations: [],
            commandsContractViolations: [],
            manifestContractViolations: [],
            coreRuleContractViolations: [],
            entrypointContractViolations: [],
            taskContractViolations: [],
            qwenSettingsViolations: [],
            skillsIndexContractViolations: [],
            skillPackContractViolations: [],
            gitignoreMissing: []
        },
        totalViolationCount: 0
    };

    const output = formatVerifyResult(fakeResult);
    assert.ok(output.includes('Verification: PASS'));
    assert.ok(!output.includes('Verification failed'));
});
