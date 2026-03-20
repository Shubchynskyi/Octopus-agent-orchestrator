const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    runDoctor,
    formatDoctorResult
} = require('../../../src/validators/doctor.ts');

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
        '- bin/octopus.js\n- scripts/install.ps1\n',
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
                ruleFileViolations: [],
                templatePlaceholderViolations: [],
                commandsContractViolations: [],
                manifestContractViolations: [],
                coreRuleContractViolations: [],
                entrypointContractViolations: [],
                taskContractViolations: [],
                qwenSettingsViolations: [],
                gitignoreMissing: []
            },
            totalViolationCount: 0
        },
        manifestResult: {
            passed: true,
            manifestPath: '/tmp/test/MANIFEST.md',
            entriesChecked: 5,
            duplicates: []
        },
        manifestError: null
    };

    const output = formatDoctorResult(fakeResult);
    assert.ok(output.includes('Doctor: PASS'));
    assert.ok(output.includes('Next: Execute task T-001 depth=2'));
});
