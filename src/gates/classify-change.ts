const fs = require('node:fs');
const path = require('node:path');

const { matchAnyRegex } = require('../gate-runtime/text-utils.ts');
const {
    joinOrchestratorPath,
    normalizeRootPrefixes,
    orchestratorRelativePath,
    testPathPrefix,
    toPosix,
    toStringArray
} = require('./helpers.ts');

/**
 * Default classification config for the Node gate runtime.
 */
function getDefaultClassificationConfig(repoRoot) {
    return {
        metrics_path: orchestratorRelativePath(repoRoot, 'runtime/metrics.jsonl'),
        runtime_roots: ['src/', 'app/', 'apps/', 'backend/', 'frontend/', 'web/', 'api/', 'services/', 'packages/'],
        fast_path_roots: ['frontend/', 'web/', 'ui/', 'mobile/', 'apps/'],
        fast_path_allowed_regexes: [
            '^.+\\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$',
            '^.+\\.(svg|png|jpg|jpeg|webp|ico)$'
        ],
        fast_path_sensitive_regexes: [
            '(^|/)(auth|security|payment|checkout|webhook|token|jwt|guard|middleware|service|repository|query|migration|sql|datasource)(/|\\.|$)'
        ],
        sql_or_migration_regexes: ['\\.sql$', '(^|/)(db|database|migrations?|schema)(/|$)'],
        triggers: {
            db: [
                '(^|/)(db|database|migrations?|schema)(/|$)',
                '\\.sql$',
                '(Repository|Dao|Specification|Query|Migration)[^/]*\\.(java|kt|ts|js|py|go|cs|rb|php)$',
                '(typeorm|prisma|flyway|liquibase|alembic|knex|sequelize)'
            ],
            security: [
                '(^|/)(auth|security|oauth|jwt|token|rbac|acl|keycloak|okta|saml|openid|mfa|crypt|encryption|certificate|secret|vault|webhook|payment|checkout|billing)(/|\\.|$)'
            ],
            api: [
                '(^|/)(controllers?|routes?|handlers?|endpoints?|graphql)(/|\\.|$)',
                '(Request|Response|Dto|DTO|Contract|Schema)[^/]*\\.(java|kt|ts|tsx|js|jsx|py|go|cs|rb|php)$',
                '(^|/)(openapi|swagger)\\.(ya?ml|json)$'
            ],
            dependency: [
                '(^|/)pom\\.xml$',
                '(^|/)build\\.gradle(\\.kts)?$',
                '(^|/)settings\\.gradle(\\.kts)?$',
                '(^|/)package\\.json$',
                '(^|/)package-lock\\.json$',
                '(^|/)pnpm-lock\\.yaml$',
                '(^|/)yarn\\.lock$',
                '(^|/)requirements(\\.txt|-dev\\.txt)?$',
                '(^|/)poetry\\.lock$',
                '(^|/)pyproject\\.toml$',
                '(^|/)go\\.mod$',
                '(^|/)go\\.sum$',
                '(^|/)Cargo\\.toml$',
                '(^|/)Cargo\\.lock$',
                '(^|/)composer\\.json$',
                '(^|/)Gemfile(\\.lock)?$'
            ],
            infra: [
                '(^|/)Dockerfile(\\..+)?$',
                '(^|/)docker-compose(\\.[^/]+)?\\.ya?ml$',
                '(^|/)(terraform|infra|infrastructure|helm|k8s|kubernetes)(/|$)',
                '(^|/)\\.github/workflows/'
            ],
            test: [
                '/src/test/',
                '(^|/)(__tests__|tests?)/',
                '\\.(spec|test)\\.(ts|tsx|js|jsx|java|kt|go|py|rb|php)$'
            ],
            performance: [
                '(Cache|Redis|Elasticsearch|Search|Query|Benchmark|Profil(e|ing))[^/]*\\.(java|kt|ts|js|py|go|cs|rb|php)$',
                '(^|/)(performance|perf|benchmark)/'
            ]
        },
        code_like_regexes: [
            '\\.(java|kt|kts|groovy|ts|tsx|js|jsx|cjs|mjs|cs|go|py|rb|php|rs)$'
        ]
    };
}

/**
 * Load classification config from paths.json with defaults.
 */
function getClassificationConfig(repoRoot) {
    const defaults = getDefaultClassificationConfig(repoRoot);
    const configPath = joinOrchestratorPath(repoRoot, 'live/config/paths.json');
    let source = 'defaults';

    if (fs.existsSync(configPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            for (const key of [
                'metrics_path', 'runtime_roots', 'fast_path_roots',
                'fast_path_allowed_regexes', 'fast_path_sensitive_regexes',
                'sql_or_migration_regexes', 'code_like_regexes'
            ]) {
                if (key in raw) defaults[key] = raw[key];
            }
            if (raw.triggers && typeof raw.triggers === 'object') {
                for (const triggerKey of ['db', 'security', 'api', 'dependency', 'infra', 'test', 'performance']) {
                    if (triggerKey in raw.triggers) {
                        defaults.triggers[triggerKey] = raw.triggers[triggerKey];
                    }
                }
            }
            source = 'paths_json';
        } catch {
            source = 'defaults_with_config_parse_error';
        }
    }

    return {
        source,
        config_path: toPosix(path.resolve(configPath)),
        metrics_path: String(defaults.metrics_path),
        runtime_roots: normalizeRootPrefixes(toStringArray(defaults.runtime_roots)),
        fast_path_roots: normalizeRootPrefixes(toStringArray(defaults.fast_path_roots)),
        fast_path_allowed_regexes: toStringArray(defaults.fast_path_allowed_regexes),
        fast_path_sensitive_regexes: toStringArray(defaults.fast_path_sensitive_regexes),
        sql_or_migration_regexes: toStringArray(defaults.sql_or_migration_regexes),
        db_trigger_regexes: toStringArray(defaults.triggers.db),
        security_trigger_regexes: toStringArray(defaults.triggers.security),
        api_trigger_regexes: toStringArray(defaults.triggers.api),
        dependency_trigger_regexes: toStringArray(defaults.triggers.dependency),
        infra_trigger_regexes: toStringArray(defaults.triggers.infra),
        test_trigger_regexes: toStringArray(defaults.triggers.test),
        performance_trigger_regexes: toStringArray(defaults.triggers.performance),
        code_like_regexes: toStringArray(defaults.triggers.code_like_regexes || defaults.code_like_regexes)
    };
}

/**
 * Load review capabilities from config file.
 */
function getReviewCapabilities(repoRoot) {
    const capabilities = {
        code: true, db: true, security: true, refactor: true,
        api: false, test: false, performance: false, infra: false, dependency: false
    };
    const configPath = joinOrchestratorPath(repoRoot, 'live/config/review-capabilities.json');
    if (!fs.existsSync(configPath)) return capabilities;
    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        for (const key of Object.keys(capabilities)) {
            if (key in raw) capabilities[key] = !!raw[key];
        }
    } catch { /* use defaults */ }
    return capabilities;
}

/**
 * Pure-logic classification of changed files.
 * Produces the canonical classify-change output shape.
 */
function classifyChange(options) {
    const normalizedFiles = options.normalizedFiles || [];
    const taskIntent = options.taskIntent || '';
    const fastPathMaxFiles = options.fastPathMaxFiles || 2;
    const fastPathMaxChangedLines = options.fastPathMaxChangedLines || 40;
    const performanceHeuristicMinLines = options.performanceHeuristicMinLines || 120;
    const changedLinesTotal = options.changedLinesTotal || 0;
    const additionsTotal = options.additionsTotal || 0;
    const deletionsTotal = options.deletionsTotal || 0;
    const renameCount = options.renameCount || 0;
    const detectionSource = options.detectionSource || 'explicit_changed_files';
    const classificationConfig = options.classificationConfig;
    const reviewCapabilities = options.reviewCapabilities || {};

    const runtimeRoots = classificationConfig.runtime_roots;
    const fastPathRoots = classificationConfig.fast_path_roots;
    const fastPathAllowed = classificationConfig.fast_path_allowed_regexes;
    const fastPathSensitive = classificationConfig.fast_path_sensitive_regexes;
    const sqlOrMigration = classificationConfig.sql_or_migration_regexes;
    const codeLike = classificationConfig.code_like_regexes;

    const testMatch = (p, regexes) => matchAnyRegex(p, regexes, { skipInvalidRegex: true });

    const runtimeChanged = normalizedFiles.some(p => testPathPrefix(p, runtimeRoots));
    const dbTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.db_trigger_regexes));
    const securityTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.security_trigger_regexes));
    const apiTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.api_trigger_regexes));
    const dependencyTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.dependency_trigger_regexes));
    const infraTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.infra_trigger_regexes));
    const testTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.test_trigger_regexes));
    const performancePathTriggered = normalizedFiles.some(p => testMatch(p, classificationConfig.performance_trigger_regexes));
    const sqlOrMigrationCount = normalizedFiles.filter(p => testMatch(p, sqlOrMigration)).length;
    const onlySqlOrMigration = normalizedFiles.length > 0 && sqlOrMigrationCount === normalizedFiles.length;

    const refactorIntentTriggered = /\b(refactor|cleanup|restructure|extract|rename|modularization|simplify)\b/i.test(taskIntent);
    const codeLikeCount = normalizedFiles.filter(p => testMatch(p, codeLike)).length;
    const runtimeCodeLikeCount = normalizedFiles.filter(
        p => testPathPrefix(p, runtimeRoots) && testMatch(p, codeLike)
    ).length;
    const runtimeCodeChanged = runtimeCodeLikeCount > 0;

    const refactorHeuristicReasons = [];
    if (runtimeChanged && normalizedFiles.length > 0) {
        const renameRatio = normalizedFiles.length > 0 ? Math.round((renameCount / normalizedFiles.length) * 10000) / 10000 : 0;
        if (normalizedFiles.length >= 2 && renameRatio >= 0.4) {
            refactorHeuristicReasons.push('rename_ratio_high');
        }
        const totalChurn = additionsTotal + deletionsTotal;
        const deltaBalanceThreshold = Math.max(20, Math.floor(totalChurn * 0.15));
        const balancedChurn = Math.abs(additionsTotal - deletionsTotal) <= deltaBalanceThreshold;
        if (codeLikeCount >= 3 && totalChurn >= 80 && balancedChurn && !dbTriggered && !securityTriggered) {
            refactorHeuristicReasons.push('balanced_structural_churn');
        }
    }
    const refactorHeuristicTriggered = refactorHeuristicReasons.length > 0;
    const refactorTriggered = refactorIntentTriggered || refactorHeuristicTriggered;

    const performanceHeuristicTriggered = (
        !performancePathTriggered
        && (apiTriggered || (dbTriggered && runtimeCodeChanged))
        && !onlySqlOrMigration
        && changedLinesTotal >= performanceHeuristicMinLines
    );
    const performanceTriggered = performancePathTriggered || performanceHeuristicTriggered;

    const allUnderFastRoots = normalizedFiles.length > 0 && normalizedFiles.every(p => testPathPrefix(p, fastPathRoots));
    const allFastAllowedTypes = normalizedFiles.length > 0 && normalizedFiles.every(p => testMatch(p, fastPathAllowed));
    const hasFastSensitiveMatch = normalizedFiles.some(p => testMatch(p, fastPathSensitive));

    const fastPathEligible = (
        runtimeChanged
        && allUnderFastRoots
        && allFastAllowedTypes
        && !hasFastSensitiveMatch
        && normalizedFiles.length <= fastPathMaxFiles
        && changedLinesTotal <= fastPathMaxChangedLines
    );

    let mode = 'FULL_PATH';
    if (fastPathEligible && !dbTriggered && !securityTriggered && !refactorTriggered
        && !apiTriggered && !dependencyTriggered && !infraTriggered && !performanceTriggered) {
        mode = 'FAST_PATH';
    }

    const requiredCodeReview = runtimeCodeChanged && mode === 'FULL_PATH';
    const requiredDbReview = dbTriggered;
    const requiredSecurityReview = securityTriggered;
    const requiredRefactorReview = refactorTriggered;
    const requiredApiReview = apiTriggered && !!reviewCapabilities.api;
    const requiredTestReview = testTriggered && !!reviewCapabilities.test;
    const requiredPerformanceReview = performanceTriggered && !!reviewCapabilities.performance;
    const requiredInfraReview = infraTriggered && !!reviewCapabilities.infra;
    const requiredDependencyReview = dependencyTriggered && !!reviewCapabilities.dependency;

    return {
        detection_source: detectionSource,
        mode,
        metrics: {
            classification_config_source: classificationConfig.source,
            classification_config_path: classificationConfig.config_path,
            changed_files_count: normalizedFiles.length,
            changed_lines_total: changedLinesTotal,
            additions_total: additionsTotal,
            deletions_total: deletionsTotal,
            rename_count: renameCount,
            code_like_changed_count: codeLikeCount,
            runtime_code_like_changed_count: runtimeCodeLikeCount,
            review_capabilities: reviewCapabilities,
            fast_path_max_files: fastPathMaxFiles,
            fast_path_max_changed_lines: fastPathMaxChangedLines,
            performance_heuristic_min_lines: performanceHeuristicMinLines
        },
        triggers: {
            runtime_changed: runtimeChanged,
            runtime_code_changed: runtimeCodeChanged,
            db: dbTriggered,
            security: securityTriggered,
            api: apiTriggered,
            test: testTriggered,
            performance: performanceTriggered,
            infra: infraTriggered,
            dependency: dependencyTriggered,
            refactor: refactorTriggered,
            refactor_intent: refactorIntentTriggered,
            refactor_heuristic: refactorHeuristicTriggered,
            refactor_heuristic_reasons: refactorHeuristicReasons,
            performance_heuristic: performanceHeuristicTriggered,
            fast_path_eligible: fastPathEligible,
            fast_path_sensitive_match: hasFastSensitiveMatch
        },
        required_reviews: {
            code: requiredCodeReview,
            db: requiredDbReview,
            security: requiredSecurityReview,
            refactor: requiredRefactorReview,
            api: requiredApiReview,
            test: requiredTestReview,
            performance: requiredPerformanceReview,
            infra: requiredInfraReview,
            dependency: requiredDependencyReview
        },
        changed_files: normalizedFiles
    };
}

module.exports = {
    classifyChange,
    getClassificationConfig,
    getDefaultClassificationConfig,
    getReviewCapabilities
};
