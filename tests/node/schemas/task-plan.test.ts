import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TASK_PLAN_SCHEMA_VERSION,
    taskPlanSchema,
    validateTaskPlan,
    computeTaskPlanDigest,
    serializeTaskPlan,
    isApprovedPlan
} from '../../../src/schemas/task-plan';

import { validateAgainstSchema } from '../../../src/schemas/config-schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalValidPlan(): Record<string, unknown> {
    return {
        schema_version: 1,
        task_id: 'T-099',
        status: 'draft',
        goal: 'Implement the widget',
        scope_files: ['src/widget.ts'],
        risk_level: 'low',
        steps: [
            { id: 'step-1', title: 'Create widget module' }
        ]
    };
}

function fullValidPlan(): Record<string, unknown> {
    return {
        schema_version: 1,
        task_id: 'T-100',
        status: 'approved',
        goal: 'Add optional planner support',
        scope_files: ['src/planner.ts', 'tests/planner.test.ts'],
        risk_level: 'medium',
        steps: [
            { id: 'design', title: 'Design schema', description: 'Draft the JSON schema', files: ['src/schema.ts'] },
            { id: 'implement', title: 'Implement validator', files: ['src/validator.ts'], depends_on: ['design'] },
            { id: 'test', title: 'Write tests', depends_on: ['implement'] }
        ],
        validation_strategy: {
            approach: 'Run npm test and verify schema validation',
            commands: ['npm test']
        },
        notes: 'Keep it opt-in.',
        created_by: 'planner-agent',
        created_at: '2026-04-08T12:00:00Z'
    };
}

// ---------------------------------------------------------------------------
// JSON Schema (structural)
// ---------------------------------------------------------------------------

test('taskPlanSchema is a valid JSON Schema object', () => {
    assert.equal(taskPlanSchema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(taskPlanSchema.$id, 'octopus-agent-orchestrator/task-plan.schema.json');
    assert.equal(taskPlanSchema.type, 'object');

    const required = taskPlanSchema.required as string[];
    assert.ok(required.includes('schema_version'));
    assert.ok(required.includes('task_id'));
    assert.ok(required.includes('status'));
    assert.ok(required.includes('goal'));
    assert.ok(required.includes('scope_files'));
    assert.ok(required.includes('risk_level'));
    assert.ok(required.includes('steps'));
});

test('taskPlanSchema validates minimal valid plan via validateAgainstSchema', () => {
    const result = validateAgainstSchema(minimalValidPlan(), taskPlanSchema);
    assert.ok(result.valid, `Errors: ${result.errors.map((e) => e.message).join('; ')}`);
});

test('taskPlanSchema validates full valid plan via validateAgainstSchema', () => {
    const result = validateAgainstSchema(fullValidPlan(), taskPlanSchema);
    assert.ok(result.valid, `Errors: ${result.errors.map((e) => e.message).join('; ')}`);
});

test('taskPlanSchema rejects missing required fields', () => {
    const result = validateAgainstSchema({}, taskPlanSchema);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 7);
});

// ---------------------------------------------------------------------------
// Validator (runtime normalisation)
// ---------------------------------------------------------------------------

test('validateTaskPlan accepts minimal valid plan', () => {
    const plan = validateTaskPlan(minimalValidPlan());
    assert.equal(plan.schema_version, 1);
    assert.equal(plan.task_id, 'T-099');
    assert.equal(plan.status, 'draft');
    assert.equal(plan.goal, 'Implement the widget');
    assert.deepEqual(plan.scope_files, ['src/widget.ts']);
    assert.equal(plan.risk_level, 'low');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].id, 'step-1');
});

test('validateTaskPlan accepts full valid plan with optional fields', () => {
    const plan = validateTaskPlan(fullValidPlan());
    assert.equal(plan.status, 'approved');
    assert.equal(plan.steps.length, 3);
    assert.deepEqual(plan.steps[1].depends_on, ['design']);
    assert.ok(plan.validation_strategy);
    assert.equal(plan.validation_strategy!.approach, 'Run npm test and verify schema validation');
    assert.deepEqual(plan.validation_strategy!.commands, ['npm test']);
    assert.equal(plan.notes, 'Keep it opt-in.');
    assert.equal(plan.created_by, 'planner-agent');
    assert.equal(plan.created_at, '2026-04-08T12:00:00Z');
});

test('validateTaskPlan rejects non-object input', () => {
    assert.throws(() => validateTaskPlan('string'), /must be a JSON object/);
    assert.throws(() => validateTaskPlan(null), /must be a JSON object/);
    assert.throws(() => validateTaskPlan(42), /must be a JSON object/);
});

test('validateTaskPlan rejects missing task_id', () => {
    const input = minimalValidPlan();
    delete input.task_id;
    assert.throws(() => validateTaskPlan(input), /task_id/);
});

test('validateTaskPlan rejects empty goal', () => {
    const input = minimalValidPlan();
    input.goal = '  ';
    assert.throws(() => validateTaskPlan(input), /goal/);
});

test('validateTaskPlan rejects invalid status', () => {
    const input = minimalValidPlan();
    input.status = 'completed';
    assert.throws(() => validateTaskPlan(input), /status/);
});

test('validateTaskPlan rejects invalid risk_level', () => {
    const input = minimalValidPlan();
    input.risk_level = 'critical';
    assert.throws(() => validateTaskPlan(input), /risk_level/);
});

test('validateTaskPlan rejects empty scope_files', () => {
    const input = minimalValidPlan();
    input.scope_files = [];
    assert.throws(() => validateTaskPlan(input), /scope_files/);
});

test('validateTaskPlan rejects empty steps', () => {
    const input = minimalValidPlan();
    input.steps = [];
    assert.throws(() => validateTaskPlan(input), /steps/);
});

test('validateTaskPlan rejects duplicate step ids', () => {
    const input = minimalValidPlan();
    input.steps = [
        { id: 'dup', title: 'First' },
        { id: 'dup', title: 'Second' }
    ];
    assert.throws(() => validateTaskPlan(input), /Duplicate step id/);
});

test('validateTaskPlan rejects unknown depends_on reference', () => {
    const input = minimalValidPlan();
    input.steps = [
        { id: 'a', title: 'Step A', depends_on: ['nonexistent'] }
    ];
    assert.throws(() => validateTaskPlan(input), /depends on unknown step/);
});

test('validateTaskPlan rejects unsupported schema_version', () => {
    const input = minimalValidPlan();
    input.schema_version = 999;
    assert.throws(() => validateTaskPlan(input), /Unsupported task-plan schema_version/);
});

test('validateTaskPlan rejects non-integer schema_version', () => {
    const input = minimalValidPlan();
    input.schema_version = 'one';
    assert.throws(() => validateTaskPlan(input), /schema_version/);
});

test('validateTaskPlan accepts superseded status', () => {
    const input = minimalValidPlan();
    input.status = 'superseded';
    const plan = validateTaskPlan(input);
    assert.equal(plan.status, 'superseded');
});

test('validateTaskPlan accepts high risk_level', () => {
    const input = minimalValidPlan();
    input.risk_level = 'high';
    const plan = validateTaskPlan(input);
    assert.equal(plan.risk_level, 'high');
});

test('validateTaskPlan normalizes whitespace in string fields', () => {
    const input = minimalValidPlan();
    input.task_id = '  T-099  ';
    input.goal = '  Implement the widget  ';
    const plan = validateTaskPlan(input);
    assert.equal(plan.task_id, 'T-099');
    assert.equal(plan.goal, 'Implement the widget');
});

test('validateTaskPlan preserves plan_sha256 when present', () => {
    const input = { ...fullValidPlan(), plan_sha256: 'abc123' };
    const plan = validateTaskPlan(input);
    assert.equal(plan.plan_sha256, 'abc123');
});

// ---------------------------------------------------------------------------
// Digest and serialization
// ---------------------------------------------------------------------------

test('computeTaskPlanDigest returns a 64-char hex string', () => {
    const plan = validateTaskPlan(minimalValidPlan());
    const digest = computeTaskPlanDigest(plan);
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/);
});

test('computeTaskPlanDigest is stable across calls', () => {
    const plan = validateTaskPlan(minimalValidPlan());
    const d1 = computeTaskPlanDigest(plan);
    const d2 = computeTaskPlanDigest(plan);
    assert.equal(d1, d2);
});

test('computeTaskPlanDigest changes when plan content changes', () => {
    const planA = validateTaskPlan(minimalValidPlan());
    const planB = validateTaskPlan({ ...minimalValidPlan(), goal: 'Different goal' });
    assert.notEqual(computeTaskPlanDigest(planA), computeTaskPlanDigest(planB));
});

test('computeTaskPlanDigest excludes plan_sha256 from computation', () => {
    const plan = validateTaskPlan(minimalValidPlan());
    const d1 = computeTaskPlanDigest(plan);
    const planWithHash = { ...plan, plan_sha256: 'ignored' };
    const d2 = computeTaskPlanDigest(planWithHash);
    assert.equal(d1, d2);
});

test('computeTaskPlanDigest detects nested step title change', () => {
    const inputA = fullValidPlan();
    const inputB = JSON.parse(JSON.stringify(fullValidPlan()));
    (inputB.steps as Array<Record<string, string>>)[0].title = 'Completely different title';
    const planA = validateTaskPlan(inputA);
    const planB = validateTaskPlan(inputB);
    assert.notEqual(computeTaskPlanDigest(planA), computeTaskPlanDigest(planB));
});

test('computeTaskPlanDigest detects nested validation_strategy change', () => {
    const inputA = fullValidPlan();
    const inputB = JSON.parse(JSON.stringify(fullValidPlan()));
    (inputB.validation_strategy as Record<string, string>).approach = 'Different approach';
    const planA = validateTaskPlan(inputA);
    const planB = validateTaskPlan(inputB);
    assert.notEqual(computeTaskPlanDigest(planA), computeTaskPlanDigest(planB));
});

test('computeTaskPlanDigest detects step depends_on change', () => {
    const inputA = fullValidPlan();
    const inputB = JSON.parse(JSON.stringify(fullValidPlan()));
    (inputB.steps as Array<Record<string, unknown>>)[2].depends_on = ['design'];
    const planA = validateTaskPlan(inputA);
    const planB = validateTaskPlan(inputB);
    assert.notEqual(computeTaskPlanDigest(planA), computeTaskPlanDigest(planB));
});

test('serializeTaskPlan produces valid JSON with embedded plan_sha256', () => {
    const plan = validateTaskPlan(fullValidPlan());
    const json = serializeTaskPlan(plan);
    const parsed = JSON.parse(json);
    assert.equal(parsed.task_id, 'T-100');
    assert.ok(parsed.plan_sha256);
    assert.equal(parsed.plan_sha256.length, 64);
});

test('serializeTaskPlan JSON can be round-tripped through validateTaskPlan', () => {
    const plan = validateTaskPlan(fullValidPlan());
    const json = serializeTaskPlan(plan);
    const roundTripped = validateTaskPlan(JSON.parse(json));
    assert.equal(roundTripped.task_id, plan.task_id);
    assert.equal(roundTripped.status, plan.status);
    assert.equal(roundTripped.steps.length, plan.steps.length);
    assert.ok(roundTripped.plan_sha256);
});

// ---------------------------------------------------------------------------
// isApprovedPlan helper
// ---------------------------------------------------------------------------

test('isApprovedPlan returns true for approved status', () => {
    const plan = validateTaskPlan(fullValidPlan());
    assert.ok(isApprovedPlan(plan));
});

test('isApprovedPlan returns false for draft status', () => {
    const plan = validateTaskPlan(minimalValidPlan());
    assert.equal(isApprovedPlan(plan), false);
});

test('isApprovedPlan returns false for superseded status', () => {
    const plan = validateTaskPlan({ ...minimalValidPlan(), status: 'superseded' });
    assert.equal(isApprovedPlan(plan), false);
});

// ---------------------------------------------------------------------------
// TASK_PLAN_SCHEMA_VERSION constant
// ---------------------------------------------------------------------------

test('TASK_PLAN_SCHEMA_VERSION is 1', () => {
    assert.equal(TASK_PLAN_SCHEMA_VERSION, 1);
});
