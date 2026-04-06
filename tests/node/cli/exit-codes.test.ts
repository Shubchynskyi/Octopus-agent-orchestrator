import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXIT_SUCCESS,
    EXIT_GENERAL_FAILURE,
    EXIT_USAGE_ERROR,
    EXIT_GATE_FAILURE,
    EXIT_VALIDATION_FAILURE,
    EXIT_LOCK_CONTENTION,
    EXIT_PRECONDITION_FAILURE,
    EXIT_SIGNAL_INTERRUPT,
    classifyErrorExitCode,
    exitCodeLabel
} from '../../../src/cli/exit-codes';

// ---------------------------------------------------------------------------
// Constant stability – automation depends on these never changing
// ---------------------------------------------------------------------------

test('exit code constants are stable', () => {
    assert.equal(EXIT_SUCCESS, 0);
    assert.equal(EXIT_GENERAL_FAILURE, 1);
    assert.equal(EXIT_USAGE_ERROR, 2);
    assert.equal(EXIT_GATE_FAILURE, 3);
    assert.equal(EXIT_VALIDATION_FAILURE, 4);
    assert.equal(EXIT_LOCK_CONTENTION, 5);
    assert.equal(EXIT_PRECONDITION_FAILURE, 6);
    assert.equal(EXIT_SIGNAL_INTERRUPT, 130);
});

test('all exit codes are distinct', () => {
    const codes = [
        EXIT_SUCCESS,
        EXIT_GENERAL_FAILURE,
        EXIT_USAGE_ERROR,
        EXIT_GATE_FAILURE,
        EXIT_VALIDATION_FAILURE,
        EXIT_LOCK_CONTENTION,
        EXIT_PRECONDITION_FAILURE,
        EXIT_SIGNAL_INTERRUPT
    ];
    const unique = new Set(codes);
    assert.equal(unique.size, codes.length, 'All exit codes must be unique');
});

// ---------------------------------------------------------------------------
// classifyErrorExitCode
// ---------------------------------------------------------------------------

test('classifies unknown command as USAGE_ERROR', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Unsupported command: fizzbuzz')),
        EXIT_USAGE_ERROR
    );
});

test('classifies unknown gate as USAGE_ERROR', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Unknown gate: nonexistent-gate. Run "octopus gate --help" for available gates.')),
        EXIT_USAGE_ERROR
    );
});

test('classifies missing required arg as USAGE_ERROR', () => {
    assert.equal(
        classifyErrorExitCode(new Error('TaskId is required')),
        EXIT_USAGE_ERROR
    );
});

test('classifies "must be one of" as USAGE_ERROR', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Stage must be one of: TASK_ENTRY, POST_PREFLIGHT.')),
        EXIT_USAGE_ERROR
    );
});

test('classifies "Provide git commit arguments" as USAGE_ERROR', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Provide git commit arguments, for example: -m "feat: message"')),
        EXIT_USAGE_ERROR
    );
});

test('classifies lifecycle lock contention as LOCK_CONTENTION', () => {
    assert.equal(
        classifyErrorExitCode(new Error(
            "Another lifecycle operation is already running for '/project' (operation='update', pid=1234, host=***, lock='/project/.lock')."
        )),
        EXIT_LOCK_CONTENTION
    );
});

test('classifies missing bundle as PRECONDITION_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Deployed bundle not found: /project/Octopus-agent-orchestrator')),
        EXIT_PRECONDITION_FAILURE
    );
});

test('classifies missing runtime build as PRECONDITION_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Octopus runtime build output not found.')),
        EXIT_PRECONDITION_FAILURE
    );
});

test('classifies source parity violation as PRECONDITION_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Source Parity Violation: The deployed bundle is stale.')),
        EXIT_PRECONDITION_FAILURE
    );
});

test('classifies missing tool in PATH as PRECONDITION_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('tsc is required but was not found in PATH')),
        EXIT_PRECONDITION_FAILURE
    );
});

test('classifies doctor failures as VALIDATION_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Workspace doctor detected validation failures.')),
        EXIT_VALIDATION_FAILURE
    );
});

test('classifies unrecognised error as GENERAL_FAILURE', () => {
    assert.equal(
        classifyErrorExitCode(new Error('Something unexpected happened')),
        EXIT_GENERAL_FAILURE
    );
});

test('classifies null/undefined as GENERAL_FAILURE', () => {
    assert.equal(classifyErrorExitCode(null), EXIT_GENERAL_FAILURE);
    assert.equal(classifyErrorExitCode(undefined), EXIT_GENERAL_FAILURE);
});

test('classifies non-Error throwable as GENERAL_FAILURE', () => {
    assert.equal(classifyErrorExitCode('plain string error'), EXIT_GENERAL_FAILURE);
});

// ---------------------------------------------------------------------------
// exitCodeLabel
// ---------------------------------------------------------------------------

test('exitCodeLabel returns human label for known codes', () => {
    assert.equal(exitCodeLabel(EXIT_SUCCESS), 'SUCCESS');
    assert.equal(exitCodeLabel(EXIT_GENERAL_FAILURE), 'GENERAL_FAILURE');
    assert.equal(exitCodeLabel(EXIT_USAGE_ERROR), 'USAGE_ERROR');
    assert.equal(exitCodeLabel(EXIT_GATE_FAILURE), 'GATE_FAILURE');
    assert.equal(exitCodeLabel(EXIT_VALIDATION_FAILURE), 'VALIDATION_FAILURE');
    assert.equal(exitCodeLabel(EXIT_LOCK_CONTENTION), 'LOCK_CONTENTION');
    assert.equal(exitCodeLabel(EXIT_PRECONDITION_FAILURE), 'PRECONDITION_FAILURE');
    assert.equal(exitCodeLabel(EXIT_SIGNAL_INTERRUPT), 'SIGNAL_INTERRUPT');
});

test('exitCodeLabel returns generic label for unknown codes', () => {
    assert.equal(exitCodeLabel(42), 'EXIT_42');
    assert.equal(exitCodeLabel(99), 'EXIT_99');
});
