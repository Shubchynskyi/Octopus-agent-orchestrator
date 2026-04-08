import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildBudgetForecast,
    buildBudgetComparison,
    resolveDepthEscalation,
    formatBudgetForecastText,
    type BudgetForecastInput,
    type BudgetForecast
} from '../../../src/gate-runtime/budget-preflight';

// ---------------------------------------------------------------------------
// resolveDepthEscalation
// ---------------------------------------------------------------------------

test('resolveDepthEscalation returns no escalation when depths match', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-001',
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 3,
        changedLinesTotal: 50,
        requiredReviews: { code: true, db: false, security: false, refactor: false }
    });
    assert.equal(result.escalated, false);
    assert.equal(result.escalation_reason, null);
    assert.deepEqual(result.escalation_triggers, []);
    assert.equal(result.requested_depth, 2);
    assert.equal(result.effective_depth, 2);
});

test('resolveDepthEscalation detects full_path escalation', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-002',
        requestedDepth: 1,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 5,
        changedLinesTotal: 100,
        requiredReviews: { code: true, db: false, security: false, refactor: false }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('full_path_minimum_depth_2'));
    assert.ok(result.escalation_reason);
});

test('resolveDepthEscalation detects db_review trigger', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-003',
        requestedDepth: 1,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 3,
        changedLinesTotal: 50,
        requiredReviews: { code: true, db: true, security: false, refactor: false }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('db_review_required'));
});

test('resolveDepthEscalation detects security_review trigger', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-004',
        requestedDepth: 1,
        effectiveDepth: 3,
        pathMode: 'FULL_PATH',
        changedFilesCount: 2,
        changedLinesTotal: 30,
        requiredReviews: { code: true, db: false, security: true, refactor: false }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('security_review_required'));
});

test('resolveDepthEscalation detects refactor_review trigger', () => {
    const result = resolveDepthEscalation({
        taskId: null,
        requestedDepth: 1,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 10,
        changedLinesTotal: 200,
        requiredReviews: { code: true, db: false, security: false, refactor: true }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('refactor_review_required'));
    assert.equal(result.task_id, null);
});

test('resolveDepthEscalation detects specialist review triggers', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-006',
        requestedDepth: 1,
        effectiveDepth: 3,
        pathMode: 'FULL_PATH',
        changedFilesCount: 10,
        changedLinesTotal: 300,
        requiredReviews: { code: true, api: true, test: true, performance: true, infra: true, dependency: true }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('api_review_required'));
    assert.ok(result.escalation_triggers.includes('test_review_required'));
    assert.ok(result.escalation_triggers.includes('performance_review_required'));
    assert.ok(result.escalation_triggers.includes('infra_review_required'));
    assert.ok(result.escalation_triggers.includes('dependency_review_required'));
});

test('resolveDepthEscalation explicit_escalation when no specific trigger matches', () => {
    const result = resolveDepthEscalation({
        taskId: 'T-005',
        requestedDepth: 2,
        effectiveDepth: 3,
        pathMode: 'FAST_PATH',
        changedFilesCount: 1,
        changedLinesTotal: 10,
        requiredReviews: { code: false, db: false, security: false, refactor: false }
    });
    assert.equal(result.escalated, true);
    assert.ok(result.escalation_triggers.includes('explicit_escalation'));
});

// ---------------------------------------------------------------------------
// buildBudgetForecast
// ---------------------------------------------------------------------------

test('buildBudgetForecast produces non-zero estimates for code review', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-010',
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 3,
        changedLinesTotal: 100,
        requiredReviews: { code: true, db: false, security: false, refactor: false },
        tokenEconomyEnabled: true,
        tokenEconomyEnabledDepths: [1, 2]
    });
    assert.equal(forecast.task_id, 'T-010');
    assert.equal(forecast.requested_depth, 2);
    assert.equal(forecast.effective_depth, 2);
    assert.equal(forecast.depth_escalated, false);
    assert.equal(forecast.path_mode, 'FULL_PATH');
    assert.deepEqual(forecast.required_reviews, ['code']);
    assert.equal(forecast.review_budget_estimates.length, 1);
    assert.equal(forecast.review_budget_estimates[0].review_type, 'code');
    assert.ok(forecast.review_budget_estimates[0].estimated_tokens > 0);
    assert.ok(forecast.total_estimated_review_tokens > 0);
    assert.ok(forecast.compile_gate_estimated_tokens > 0);
    assert.ok(forecast.total_forecast_tokens > 0);
    assert.equal(forecast.token_economy_enabled, true);
    assert.equal(forecast.token_economy_active_for_depth, true);
    assert.ok(forecast.forecast_savings_estimate > 0);
    assert.ok(forecast.effective_forecast_tokens < forecast.total_forecast_tokens);
});

test('buildBudgetForecast with multiple reviews', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-011',
        requestedDepth: 3,
        effectiveDepth: 3,
        pathMode: 'FULL_PATH',
        changedFilesCount: 5,
        changedLinesTotal: 200,
        requiredReviews: { code: true, db: true, security: true, refactor: false, test: true },
        tokenEconomyEnabled: true,
        tokenEconomyEnabledDepths: [1, 2]
    });
    assert.deepEqual(forecast.required_reviews.sort(), ['code', 'db', 'security', 'test']);
    assert.equal(forecast.review_budget_estimates.length, 4);
    assert.equal(forecast.token_economy_active_for_depth, false);
    assert.equal(forecast.forecast_savings_estimate, 0);
    assert.equal(forecast.effective_forecast_tokens, forecast.total_forecast_tokens);
});

test('buildBudgetForecast with no required reviews', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-012',
        requestedDepth: 1,
        effectiveDepth: 1,
        pathMode: 'FAST_PATH',
        changedFilesCount: 1,
        changedLinesTotal: 5,
        requiredReviews: { code: false, db: false, security: false, refactor: false }
    });
    assert.deepEqual(forecast.required_reviews, []);
    assert.equal(forecast.review_budget_estimates.length, 0);
    assert.equal(forecast.total_estimated_review_tokens, 0);
    assert.ok(forecast.compile_gate_estimated_tokens > 0);
    assert.equal(forecast.total_forecast_tokens, forecast.compile_gate_estimated_tokens);
});

test('buildBudgetForecast token economy disabled', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-013',
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 3,
        changedLinesTotal: 50,
        requiredReviews: { code: true },
        tokenEconomyEnabled: false
    });
    assert.equal(forecast.token_economy_enabled, false);
    assert.equal(forecast.token_economy_active_for_depth, false);
    assert.equal(forecast.forecast_savings_estimate, 0);
});

test('buildBudgetForecast depth escalated flag', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-014',
        requestedDepth: 1,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 2,
        changedLinesTotal: 30,
        requiredReviews: { code: true }
    });
    assert.equal(forecast.depth_escalated, true);
    assert.equal(forecast.requested_depth, 1);
    assert.equal(forecast.effective_depth, 2);
});

test('buildBudgetForecast zero files and lines', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-015',
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 0,
        changedLinesTotal: 0,
        requiredReviews: { code: true }
    });
    assert.ok(forecast.total_forecast_tokens > 0);
    assert.ok(forecast.review_budget_estimates[0].estimated_tokens > 0);
});

test('buildBudgetForecast null taskId', () => {
    const forecast = buildBudgetForecast({
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 1,
        changedLinesTotal: 10,
        requiredReviews: { code: true }
    });
    assert.equal(forecast.task_id, null);
});

// ---------------------------------------------------------------------------
// buildBudgetComparison
// ---------------------------------------------------------------------------

test('buildBudgetComparison with forecast and actuals', () => {
    const forecast: BudgetForecast = {
        timestamp_utc: new Date().toISOString(),
        task_id: 'T-020',
        requested_depth: 2,
        effective_depth: 2,
        depth_escalated: false,
        path_mode: 'FULL_PATH',
        changed_files_count: 3,
        changed_lines_total: 100,
        required_reviews: ['code'],
        review_budget_estimates: [{ review_type: 'code', estimated_tokens: 1280, basis: 'heuristic_base_plus_scope' }],
        total_estimated_review_tokens: 1280,
        compile_gate_estimated_tokens: 420,
        total_forecast_tokens: 1700,
        token_economy_enabled: true,
        token_economy_active_for_depth: true,
        forecast_savings_estimate: 595,
        effective_forecast_tokens: 1105
    };
    const comparison = buildBudgetComparison('T-020', forecast, 500, 1500);
    assert.equal(comparison.task_id, 'T-020');
    assert.equal(comparison.forecast_total_tokens, 1700);
    assert.equal(comparison.actual_total_saved_tokens, 500);
    assert.equal(comparison.actual_total_raw_tokens, 1500);
    assert.ok(comparison.forecast_accuracy_ratio != null);
    assert.equal(comparison.requested_depth, 2);
    assert.equal(comparison.effective_depth, 2);
    assert.equal(comparison.depth_escalated, false);
    assert.ok(comparison.summary_line.includes('forecast'));
    assert.ok(comparison.summary_line.includes('actual raw'));
});

test('buildBudgetComparison with null forecast', () => {
    const comparison = buildBudgetComparison('T-021', null, 100, 800);
    assert.equal(comparison.forecast_total_tokens, 0);
    assert.equal(comparison.forecast_accuracy_ratio, null);
    assert.equal(comparison.requested_depth, 0);
    assert.equal(comparison.depth_escalated, false);
});

test('buildBudgetComparison with zero actuals', () => {
    const forecast: BudgetForecast = {
        timestamp_utc: new Date().toISOString(),
        task_id: 'T-022',
        requested_depth: 1,
        effective_depth: 2,
        depth_escalated: true,
        path_mode: 'FULL_PATH',
        changed_files_count: 1,
        changed_lines_total: 10,
        required_reviews: ['code'],
        review_budget_estimates: [{ review_type: 'code', estimated_tokens: 932, basis: 'heuristic_base_plus_scope' }],
        total_estimated_review_tokens: 932,
        compile_gate_estimated_tokens: 340,
        total_forecast_tokens: 1272,
        token_economy_enabled: true,
        token_economy_active_for_depth: true,
        forecast_savings_estimate: 445,
        effective_forecast_tokens: 827
    };
    const comparison = buildBudgetComparison('T-022', forecast, 0, 0);
    assert.equal(comparison.forecast_total_tokens, 1272);
    assert.equal(comparison.forecast_accuracy_ratio, null);
    assert.equal(comparison.depth_escalated, true);
    assert.ok(comparison.summary_line.includes('escalated'));
});

// ---------------------------------------------------------------------------
// formatBudgetForecastText
// ---------------------------------------------------------------------------

test('formatBudgetForecastText includes key fields', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-030',
        requestedDepth: 1,
        effectiveDepth: 2,
        pathMode: 'FULL_PATH',
        changedFilesCount: 3,
        changedLinesTotal: 80,
        requiredReviews: { code: true, security: true },
        tokenEconomyEnabled: true,
        tokenEconomyEnabledDepths: [1, 2]
    });
    const text = formatBudgetForecastText(forecast);
    assert.ok(text.includes('Budget Forecast:'));
    assert.ok(text.includes('1 -> 2 (escalated)'));
    assert.ok(text.includes('FULL_PATH'));
    assert.ok(text.includes('code:'));
    assert.ok(text.includes('security:'));
    assert.ok(text.includes('Total forecast:'));
    assert.ok(text.includes('Token economy savings estimate:'));
    assert.ok(text.includes('Effective forecast:'));
});

test('formatBudgetForecastText no escalation and no token economy', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-031',
        requestedDepth: 3,
        effectiveDepth: 3,
        pathMode: 'FULL_PATH',
        changedFilesCount: 1,
        changedLinesTotal: 10,
        requiredReviews: { code: true },
        tokenEconomyEnabled: true,
        tokenEconomyEnabledDepths: [1, 2]
    });
    const text = formatBudgetForecastText(forecast);
    assert.ok(text.includes('Depth: 3'));
    assert.ok(!text.includes('escalated'));
    assert.ok(!text.includes('Token economy savings'));
});

test('formatBudgetForecastText no reviews', () => {
    const forecast = buildBudgetForecast({
        taskId: 'T-032',
        requestedDepth: 2,
        effectiveDepth: 2,
        pathMode: 'FAST_PATH',
        changedFilesCount: 1,
        changedLinesTotal: 5,
        requiredReviews: {}
    });
    const text = formatBudgetForecastText(forecast);
    assert.ok(text.includes('Required reviews: none'));
});
