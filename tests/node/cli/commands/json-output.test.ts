import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatStatusSnapshotCompact,
    formatStatusSnapshotJson
} from '../../../../src/validators/status';
import {
    formatDoctorResultCompact,
    formatDoctorResultJson
} from '../../../../src/validators/doctor';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function makeReadyStatusSnapshot(): Record<string, unknown> {
    return {
        targetRoot: '/tmp/test',
        bundlePath: '/tmp/test/Octopus-agent-orchestrator',
        initAnswersResolvedPath: '/tmp/test/init-answers.json',
        collectedVia: 'setup',
        activeAgentFiles: 'AGENTS.md',
        sourceOfTruth: 'Claude',
        canonicalEntrypoint: 'CLAUDE.md',
        bundlePresent: true,
        primaryInitializationComplete: true,
        agentInitializationComplete: true,
        readyForTasks: true,
        agentInitializationPendingReason: null,
        missingProjectCommands: [],
        initAnswersError: null,
        liveVersionError: null,
        agentInitStateError: null,
        commandsRulePath: '/tmp/test/commands.md',
        recommendedNextCommand: 'Execute task T-001 depth=2',
        parityResult: {
            isSourceCheckout: false,
            isStale: false,
            violations: [],
            remediation: null
        },
        timelineTaskCount: 0,
        timelineHealthy: 0,
        timelineWarnings: [],
        providerComplianceResult: null,
        protectedManifestEvidence: null,
        initAnswersPathForDisplay: '/tmp/test/init-answers.json',
        initAnswersPresent: true,
        taskPresent: true,
        livePresent: true,
        usagePresent: true,
        agentInitStatePath: '/tmp/test/state.json',
        agentInitState: null
    };
}

function makeNotReadyStatusSnapshot(): Record<string, unknown> {
    return {
        ...makeReadyStatusSnapshot(),
        bundlePresent: false,
        primaryInitializationComplete: false,
        agentInitializationComplete: false,
        readyForTasks: false,
        collectedVia: null,
        activeAgentFiles: null,
        sourceOfTruth: null,
        canonicalEntrypoint: null,
        initAnswersPresent: false,
        taskPresent: false,
        livePresent: false,
        usagePresent: false,
        recommendedNextCommand: 'octopus setup'
    };
}

const DEFAULT_DOCTOR_EVIDENCE = {
    runtimeMismatchEvidence: { checked: false, mismatches: [] },
    permissionEvidence: { checked: false, failures: [] },
    partialStateEvidence: { checked: false, sentinels: [] },
    rollbackHealthEvidence: { checked: false, snapshots: [] }
};

function makePassingDoctorResult(): Record<string, unknown> {
    return {
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
            manifestPath: '/tmp/MANIFEST.md',
            entriesChecked: 5,
            duplicates: [],
            diagnostics: []
        },
        manifestError: null,
        timelineEvidence: [],
        timelineWarnings: [],
        lockHealth: {
            lock_root: '/tmp/test/runtime/task-events',
            subsystem_scope_note: 'task-event lock subsystem',
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
        nestedBundleDuplication: { duplicatesFound: false, duplicatePaths: [] },
        protectedManifestEvidence: null,
        ...DEFAULT_DOCTOR_EVIDENCE
    };
}

// ---------------------------------------------------------------------------
// formatStatusSnapshotJson
// ---------------------------------------------------------------------------

test('formatStatusSnapshotJson returns valid JSON for ready snapshot', () => {
    const snapshot = makeReadyStatusSnapshot();
    const output = formatStatusSnapshotJson(snapshot as any);
    const parsed = JSON.parse(output);
    assert.equal(parsed.readyForTasks, true);
    assert.equal(parsed.sourceOfTruth, 'Claude');
    assert.equal(parsed.bundlePresent, true);
    assert.equal(parsed.targetRoot, '/tmp/test');
});

test('formatStatusSnapshotJson returns valid JSON for not-ready snapshot', () => {
    const snapshot = makeNotReadyStatusSnapshot();
    const output = formatStatusSnapshotJson(snapshot as any);
    const parsed = JSON.parse(output);
    assert.equal(parsed.readyForTasks, false);
    assert.equal(parsed.bundlePresent, false);
    assert.equal(parsed.sourceOfTruth, null);
});

test('formatStatusSnapshotJson output is pretty-printed', () => {
    const snapshot = makeReadyStatusSnapshot();
    const output = formatStatusSnapshotJson(snapshot as any);
    assert.ok(output.includes('\n'), 'JSON output must be pretty-printed');
    assert.ok(output.startsWith('{'), 'JSON output must start with {');
});

test('formatStatusSnapshotJson preserves nested structures', () => {
    const snapshot = makeReadyStatusSnapshot();
    const output = formatStatusSnapshotJson(snapshot as any);
    const parsed = JSON.parse(output);
    assert.equal(typeof parsed.parityResult, 'object');
    assert.equal(parsed.parityResult.isSourceCheckout, false);
    assert.ok(Array.isArray(parsed.missingProjectCommands));
});

// ---------------------------------------------------------------------------
// formatDoctorResultJson
// ---------------------------------------------------------------------------

test('formatDoctorResultJson returns valid JSON for passing result', () => {
    const result = makePassingDoctorResult();
    const output = formatDoctorResultJson(result as any);
    const parsed = JSON.parse(output);
    assert.equal(parsed.passed, true);
    assert.equal(parsed.targetRoot, '/tmp/test');
    assert.equal(parsed.verifyResult.passed, true);
});

test('formatDoctorResultJson returns valid JSON for failing result', () => {
    const result = {
        ...makePassingDoctorResult(),
        passed: false,
        verifyResult: {
            ...(makePassingDoctorResult().verifyResult as Record<string, unknown>),
            passed: false,
            totalViolationCount: 1,
            violations: {
                ...((makePassingDoctorResult().verifyResult as Record<string, unknown>).violations as Record<string, unknown>),
                missingPaths: ['some/path']
            }
        }
    };
    const output = formatDoctorResultJson(result as any);
    const parsed = JSON.parse(output);
    assert.equal(parsed.passed, false);
    assert.ok(Array.isArray(parsed.verifyResult.violations.missingPaths));
    assert.equal(parsed.verifyResult.violations.missingPaths.length, 1);
});

test('formatDoctorResultJson output is pretty-printed', () => {
    const result = makePassingDoctorResult();
    const output = formatDoctorResultJson(result as any);
    assert.ok(output.includes('\n'), 'JSON output must be pretty-printed');
    assert.ok(output.startsWith('{'), 'JSON output must start with {');
});

test('formatDoctorResultJson preserves manifest evidence', () => {
    const result = makePassingDoctorResult();
    const output = formatDoctorResultJson(result as any);
    const parsed = JSON.parse(output);
    assert.equal(parsed.manifestResult.passed, true);
    assert.equal(parsed.manifestResult.entriesChecked, 5);
});

// ---------------------------------------------------------------------------
// CLI handler integration: --json flag wiring via spawnSync
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function isWorkspaceRoot(candidate: string): boolean {
    return fs.existsSync(path.join(candidate, 'package.json')) &&
        fs.existsSync(path.join(candidate, 'VERSION')) &&
        fs.existsSync(path.join(candidate, 'bin', 'octopus.js')) &&
        fs.existsSync(path.join(candidate, 'src', 'index.ts'));
}

function findRepoRoot(): string {
    const cwd = path.resolve(process.cwd());
    if (isWorkspaceRoot(cwd)) {
        return cwd;
    }

    let current = __dirname;
    while (current !== path.dirname(current)) {
        if (isWorkspaceRoot(current)) {
            return current;
        }
        current = path.dirname(current);
    }
    throw new Error('Cannot resolve repo root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();
const CLI_ENTRY = path.join(REPO_ROOT, 'bin', 'octopus.js');
const NEUTRAL_CWD = path.join(REPO_ROOT, 'tests');

function runCliJson(args: string[]) {
    return spawnSync(process.execPath, [CLI_ENTRY, ...args], {
        cwd: NEUTRAL_CWD,
        encoding: 'utf8',
        timeout: 30_000
    });
}

function parseJsonStdout(result: ReturnType<typeof runCliJson>, message: string) {
    assert.ok(result.status !== 1 && result.status !== 2, `${message}: ${result.stderr}`);
    const trimmed = result.stdout.trim();
    assert.ok(trimmed.startsWith('{'), 'stdout must start with JSON object');
    return JSON.parse(trimmed);
}

test('status --json emits valid JSON to stdout', () => {
    const result = runCliJson(['status', '--target-root', REPO_ROOT, '--json']);
    assert.equal(result.status, 0, `status --json exited non-zero: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.readyForTasks, 'boolean');
    assert.equal(typeof parsed.bundlePresent, 'boolean');
    assert.ok('targetRoot' in parsed);
});

test('status --json output does not include banner text', () => {
    const result = runCliJson(['status', '--target-root', REPO_ROOT, '--json']);
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes('Workspace status'), 'JSON mode must suppress banner');
    const trimmed = result.stdout.trim();
    assert.ok(trimmed.startsWith('{'), 'stdout must start with JSON object');
});

test('doctor --json emits valid JSON to stdout', () => {
    const result = runCliJson(['doctor', '--target-root', REPO_ROOT, '--json']);
    // doctor exits 4 (EXIT_VALIDATION_FAILURE) when issues are found, which is expected on a live repo
    assert.ok(result.status !== 1 && result.status !== 2, `doctor --json crashed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.passed, 'boolean');
    assert.ok('targetRoot' in parsed);
    assert.ok('verifyResult' in parsed);
});

test('doctor --json output does not include banner text', () => {
    const result = runCliJson(['doctor', '--target-root', REPO_ROOT, '--json']);
    // doctor exits 4 (EXIT_VALIDATION_FAILURE) when issues are found, which is expected on a live repo
    assert.ok(result.status !== 1 && result.status !== 2, `doctor --json crashed: ${result.stderr}`);
    assert.ok(!result.stdout.includes('Workspace doctor'), 'JSON mode must suppress banner');
    const trimmed = result.stdout.trim();
    assert.ok(trimmed.startsWith('{'), 'stdout must start with JSON object');
});

test('check-update --json emits valid JSON to stdout in dry-run mode', () => {
    const parsed = parseJsonStdout(
        runCliJson([
            'check-update',
            '--target-root', REPO_ROOT,
            '--source-path', REPO_ROOT,
            '--dry-run',
            '--trust-override',
            '--no-prompt',
            '--json'
        ]),
        'check-update --json crashed'
    );
    assert.equal(parsed.targetRoot, REPO_ROOT);
    assert.equal(parsed.dryRun, true);
    assert.equal(typeof parsed.updateAvailable, 'boolean');
    assert.ok('checkUpdateResult' in parsed);
});

test('update --json emits valid JSON to stdout in dry-run mode', () => {
    const parsed = parseJsonStdout(
        runCliJson([
            'update',
            '--target-root', REPO_ROOT,
            '--source-path', REPO_ROOT,
            '--dry-run',
            '--trust-override',
            '--no-prompt',
            '--json'
        ]),
        'update --json crashed'
    );
    assert.equal(parsed.targetRoot, REPO_ROOT);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.applyRequested, true);
    assert.ok('checkUpdateResult' in parsed);
});

test('rollback --json emits valid JSON to stdout in dry-run mode', () => {
    const parsed = parseJsonStdout(
        runCliJson(['rollback', '--target-root', REPO_ROOT, '--dry-run', '--json']),
        'rollback --json crashed'
    );
    assert.equal(parsed.targetRoot, REPO_ROOT);
    assert.equal(parsed.dryRun, true);
    assert.ok('rollbackMode' in parsed);
    assert.ok('previewAffectedItems' in parsed);
});

test('uninstall --json emits valid JSON to stdout in dry-run mode', () => {
    const parsed = parseJsonStdout(
        runCliJson(['uninstall', '--target-root', REPO_ROOT, '--dry-run', '--json']),
        'uninstall --json crashed'
    );
    assert.equal(parsed.targetRoot, REPO_ROOT);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.result, 'DRY_RUN');
    assert.ok(Array.isArray(parsed.previewAffectedFiles));
});
