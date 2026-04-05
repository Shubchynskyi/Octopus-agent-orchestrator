import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    runDoctor,
    formatDoctorResult
} from '../../../src/validators/doctor';

test('runDoctor throws for missing bundle', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    try {
        assert.throws(
            () => runDoctor({
                targetRoot: tmpDir,
                sourceOfTruth: 'Claude'
            }),
            /Deployed bundle not found/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runDoctor runs verify and manifest validation when bundle exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- src/index.ts\n',
        'utf8'
    );

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude'
        });
        assert.equal(typeof result.passed, 'boolean');
        assert.ok(result.verifyResult);
        assert.ok(result.manifestResult);
        assert.equal(result.manifestResult.passed, true);
        assert.equal(result.manifestError, null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runDoctor reports manifest error for missing MANIFEST.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude'
        });
        assert.equal(result.passed, false);
        assert.ok(result.manifestError !== null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runDoctor detects manifest duplicates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- file.txt\n- file.txt\n',
        'utf8'
    );

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude'
        });
        assert.equal(result.passed, false);
        assert.ok(result.manifestResult);
        assert.equal(result.manifestResult.passed, false);
        assert.equal(result.manifestResult.duplicates.length, 1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatDoctorResult includes verify and manifest output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- package.json\n',
        'utf8'
    );

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude'
        });
        const output = formatDoctorResult(result);
        assert.ok(output.includes('TargetRoot:'));
        assert.ok(output.includes('SourceOfTruth: Claude'));
        assert.ok(output.includes('MANIFEST_VALIDATION_PASSED'));
        assert.ok(output.includes('Doctor:'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatDoctorResult shows PASS for clean doctor', () => {
    const fakeResult = {
        passed: true,
        targetRoot: '/tmp/test',
        verifyResult: {
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
        },
        manifestResult: {
            passed: true,
            manifestPath: '/tmp/test/MANIFEST.md',
            entriesChecked: 5,
            duplicates: [],
            diagnostics: []
        },
        manifestError: null,
        timelineEvidence: [],
        timelineWarnings: [],
        lockHealth: {
            lock_root: '/tmp/test/runtime/task-events',
            subsystem_scope_note: 'Only runtime/task-events/*.lock participates in the task-event lock subsystem. runtime/reviews/ is never cleaned by these diagnostics.',
            locks: [],
            active_count: 0,
            stale_count: 0
        },
        lockCleanup: null,
        parityResult: {
            isSourceCheckout: false,
            isStale: false,
            violations: [],
            rootVersion: null,
            bundleVersion: null,
            remediation: null
        },
        providerComplianceResult: null,
        nestedBundleDuplication: { duplicatesFound: false, duplicatePaths: [] }
    };

    const output = formatDoctorResult(fakeResult);
    assert.ok(output.includes('Doctor: PASS'));
    assert.ok(output.includes('Next: Execute task T-001 depth=2'));
});

test('formatDoctorResult includes timeline completeness warnings', () => {
    const fakeResult = {
        passed: false,
        targetRoot: '/tmp/test',
        verifyResult: {
            passed: false,
            targetRoot: '/tmp/test',
            sourceOfTruth: 'Claude',
            canonicalEntrypoint: 'CLAUDE.md',
            bundleVersion: '1.0.0',
            requiredPathsChecked: 10,
            violations: {
                missingPaths: ['TASK.md missing.'],
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
            totalViolationCount: 1
        },
        manifestResult: {
            passed: true,
            manifestPath: '/tmp/test/MANIFEST.md',
            entriesChecked: 5,
            duplicates: [],
            diagnostics: []
        },
        manifestError: null,
        timelineEvidence: [{
            task_id: 'T-004',
            timeline_path: '/tmp/test/runtime/task-events/T-004.jsonl',
            status: 'PASS',
            completeness_status: 'INCOMPLETE',
            events_missing: ['REVIEW_PHASE_STARTED', 'COMPLETION_GATE_PASSED'],
            code_changed: true,
            events_scanned: 5,
            integrity_event_count: 5,
            violations: []
        }],
        timelineWarnings: ['Timeline completeness INCOMPLETE for T-004: REVIEW_PHASE_STARTED, COMPLETION_GATE_PASSED'],
        lockHealth: {
            lock_root: '/tmp/test/runtime/task-events',
            subsystem_scope_note: 'Only runtime/task-events/*.lock participates in the task-event lock subsystem. runtime/reviews/ is never cleaned by these diagnostics.',
            locks: [],
            active_count: 0,
            stale_count: 0
        },
        lockCleanup: null,
        parityResult: {
            isSourceCheckout: false,
            isStale: false,
            violations: [],
            rootVersion: null,
            bundleVersion: null,
            remediation: null
        },
        providerComplianceResult: null,
        nestedBundleDuplication: { duplicatesFound: false, duplicatePaths: [] }
    };

    const output = formatDoctorResult(fakeResult);
    assert.ok(output.includes('Timeline Evidence'));
    assert.ok(output.includes('T-004: integrity=PASS, completeness=INCOMPLETE'));
    assert.ok(output.includes('Timeline Warnings'));
    assert.ok(output.includes('REVIEW_PHASE_STARTED'));
    assert.ok(output.includes('Doctor: FAIL'));
});

test('runDoctor reports stale task-event locks and supports dry-run cleanup output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-locks-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const eventsRoot = path.join(bundlePath, 'runtime', 'task-events');
    const staleLockPath = path.join(eventsRoot, '.T-005.lock');
    fs.mkdirSync(staleLockPath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- package.json\n',
        'utf8'
    );
    fs.writeFileSync(path.join(staleLockPath, 'owner.json'), JSON.stringify({
        pid: 999999,
        hostname: 'stale-host',
        created_at_utc: '2026-03-30T10:00:00.000Z'
    }, null, 2) + '\n', 'utf8');

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude',
            cleanupStaleLocks: true,
            dryRun: true
        });
        assert.equal(result.passed, false);
        assert.equal(result.lockHealth.stale_count, 1);
        assert.ok(result.lockCleanup !== null);
        assert.deepEqual(result.lockCleanup!.removable_stale_locks, ['.T-005.lock']);
        assert.ok(fs.existsSync(staleLockPath), 'dry-run must not remove stale locks');

        const output = formatDoctorResult(result);
        assert.ok(output.includes('Task-Event Lock Cleanup'));
        assert.ok(output.includes('Mode: DRY_RUN'));
        assert.ok(output.includes('.T-005.lock: STALE'));
        assert.ok(output.includes('runtime/reviews/ is never cleaned'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runDoctor includes provider compliance result when activeAgentFiles provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-compliance-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const MANAGED_START = '<!-- Octopus-agent-orchestrator:managed-start -->';
    const MANAGED_END = '<!-- Octopus-agent-orchestrator:managed-end -->';
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- package.json\n',
        'utf8'
    );
    // Create compliant entrypoint and router
    fs.mkdirSync(path.join(tmpDir, '.agents', 'workflows'), { recursive: true });
    fs.writeFileSync(
        path.join(tmpDir, '.agents', 'workflows', 'start-task.md'),
        [MANAGED_START, '# Start Task', 'Shared router.', MANAGED_END].join('\n'),
        'utf8'
    );
    fs.writeFileSync(
        path.join(tmpDir, 'AGENTS.md'),
        [MANAGED_START, '# AGENTS.md', 'open `.agents/workflows/start-task.md`.', MANAGED_END].join('\n'),
        'utf8'
    );

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Codex',
            activeAgentFiles: ['AGENTS.md']
        });
        assert.ok(result.providerComplianceResult !== null);
        assert.equal(result.providerComplianceResult!.passed, true);
        assert.equal(result.providerComplianceResult!.routerExists, true);

        const output = formatDoctorResult(result);
        assert.ok(output.includes('Provider Control Compliance'));
        assert.ok(output.includes('Status: PASS'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('runDoctor fails when active entrypoint has compliance drift', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-drift-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const MANAGED_START = '<!-- Octopus-agent-orchestrator:managed-start -->';
    const MANAGED_END = '<!-- Octopus-agent-orchestrator:managed-end -->';
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- package.json\n',
        'utf8'
    );
    // Create router but entrypoint without router reference
    fs.mkdirSync(path.join(tmpDir, '.agents', 'workflows'), { recursive: true });
    fs.writeFileSync(
        path.join(tmpDir, '.agents', 'workflows', 'start-task.md'),
        [MANAGED_START, '# Start Task', 'Shared router.', MANAGED_END].join('\n'),
        'utf8'
    );
    fs.writeFileSync(
        path.join(tmpDir, 'CLAUDE.md'),
        [MANAGED_START, '# CLAUDE.md', 'No router ref.', MANAGED_END].join('\n'),
        'utf8'
    );

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude',
            activeAgentFiles: ['CLAUDE.md']
        });
        assert.ok(result.providerComplianceResult !== null);
        assert.equal(result.providerComplianceResult!.passed, false);
        assert.equal(result.passed, false);

        const output = formatDoctorResult(result);
        assert.ok(output.includes('DRIFT_DETECTED'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatDoctorResult shows nested bundle duplication warning', () => {
    const fakeResult = {
        passed: true,
        targetRoot: '/tmp/test',
        verifyResult: {
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
        },
        manifestResult: {
            passed: true,
            manifestPath: '/tmp/test/MANIFEST.md',
            entriesChecked: 5,
            duplicates: [],
            diagnostics: []
        },
        manifestError: null,
        timelineEvidence: [],
        timelineWarnings: [],
        lockHealth: {
            lock_root: '/tmp/test/runtime/task-events',
            subsystem_scope_note: 'Only runtime/task-events/*.lock participates in the task-event lock subsystem. runtime/reviews/ is never cleaned by these diagnostics.',
            locks: [],
            active_count: 0,
            stale_count: 0
        },
        lockCleanup: null,
        parityResult: {
            isSourceCheckout: false,
            isStale: false,
            violations: [],
            rootVersion: null,
            bundleVersion: null,
            remediation: null
        },
        providerComplianceResult: null,
        nestedBundleDuplication: {
            duplicatesFound: true,
            duplicatePaths: ['Octopus-agent-orchestrator/Octopus-agent-orchestrator']
        }
    };

    const output = formatDoctorResult(fakeResult);
    assert.ok(output.includes('Nested Bundle Duplication'));
    assert.ok(output.includes('DUPLICATES_FOUND'));
    assert.ok(output.includes('Octopus-agent-orchestrator/Octopus-agent-orchestrator'));
});

test('runDoctor detects nested bundle duplication in real workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-nested-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(
        path.join(bundlePath, 'MANIFEST.md'),
        '- bin/octopus.js\n- package.json\n',
        'utf8'
    );

    // Create nested bundle with launcher
    const nestedBundlePath = path.join(bundlePath, 'Octopus-agent-orchestrator', 'bin');
    fs.mkdirSync(nestedBundlePath, { recursive: true });
    fs.writeFileSync(path.join(nestedBundlePath, 'octopus.js'), '#!/usr/bin/env node', 'utf8');

    try {
        const result = runDoctor({
            targetRoot: tmpDir,
            sourceOfTruth: 'Claude'
        });
        assert.equal(result.nestedBundleDuplication.duplicatesFound, true);
        assert.ok(result.nestedBundleDuplication.duplicatePaths.length > 0);
        assert.equal(result.passed, false, 'doctor overall verdict should fail when nested duplication is detected');

        const output = formatDoctorResult(result);
        assert.ok(output.includes('Nested Bundle Duplication'));
        assert.ok(output.includes('DUPLICATES_FOUND'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
