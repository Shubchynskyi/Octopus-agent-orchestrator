/**
 * Legacy PowerShell-style argument adapter for the Node CLI.
 *
 * Converts `-PascalCase` arguments to `--kebab-case` so callers that still
 * emit the old shell-style flag syntax can continue using the Node router
 * without changing their invocation shape immediately.
 */

const PS_ARG_MAP = Object.freeze({
    // Lifecycle parameters
    '-TargetRoot': '--target-root',
    '-InitAnswersPath': '--init-answers-path',
    '-DryRun': '--dry-run',
    '-NoPrompt': '--no-prompt',
    '-SkipVerify': '--skip-verify',
    '-SkipManifestValidation': '--skip-manifest-validation',
    '-AssistantLanguage': '--assistant-language',
    '-AssistantBrevity': '--assistant-brevity',
    '-ActiveAgentFiles': '--active-agent-files',
    '-SourceOfTruth': '--source-of-truth',
    '-EnforceNoAutoCommit': '--enforce-no-auto-commit',
    '-ClaudeOrchestratorFullAccess': '--claude-orchestrator-full-access',
    '-TokenEconomyEnabled': '--token-economy-enabled',
    '-RepoUrl': '--repo-url',
    '-Branch': '--branch',
    '-RunVerify': '--verify',
    '-SkipBackups': '--skip-backups',
    '-KeepPrimaryEntrypoint': '--keep-primary-entrypoint',
    '-KeepTaskFile': '--keep-task-file',
    '-KeepRuntimeArtifacts': '--keep-runtime-artifacts',
    '-Apply': '--apply',
    '-PreserveExisting': '--preserve-existing',
    '-AlignExisting': '--align-existing',
    '-RunInit': '--run-init',
    '-AnswerDependentOnly': '--answer-dependent-only',

    // Gate parameters
    '-ManifestPath': '--manifest-path',
    '-CommandsPath': '--commands-path',
    '-TaskId': '--task-id',
    '-PreflightPath': '--preflight-path',
    '-CompileEvidencePath': '--compile-evidence-path',
    '-CompileOutputPath': '--compile-output-path',
    '-FailTailLines': '--fail-tail-lines',
    '-OutputFiltersPath': '--output-filters-path',
    '-MetricsPath': '--metrics-path',
    '-EmitMetrics': '--emit-metrics',
    '-RepoRoot': '--repo-root',
    '-ChangedFiles': '--changed-files',
    '-UseStaged': '--use-staged',
    '-IncludeUntracked': '--include-untracked',
    '-TaskIntent': '--task-intent',
    '-FastPathMaxFiles': '--fast-path-max-files',
    '-FastPathMaxChangedLines': '--fast-path-max-changed-lines',
    '-PerformanceHeuristicMinLines': '--performance-heuristic-min-lines',
    '-OutputPath': '--output-path',
    '-ReviewType': '--review-type',
    '-Depth': '--depth',
    '-PathsConfigPath': '--paths-config-path',
    '-TokenEconomyConfigPath': '--token-economy-config-path',
    '-ScopedDiffMetadataPath': '--scoped-diff-metadata-path',
    '-FullDiffPath': '--full-diff-path',
    '-Decision': '--decision',
    '-BehaviorChanged': '--behavior-changed',
    '-ArtifactPath': '--artifact-path',
    '-Actor': '--actor',
    '-ApiReviewVerdict': '--api-review-verdict',
    '-ChangelogUpdated': '--changelog-updated',
    '-CodeReviewVerdict': '--code-review-verdict',
    '-DbReviewVerdict': '--db-review-verdict',
    '-DependencyReviewVerdict': '--dependency-review-verdict',
    '-DetailsJson': '--details-json',
    '-DocImpactPath': '--doc-impact-path',
    '-SensitiveScopeReviewed': '--sensitive-scope-reviewed',
    '-SensitiveReviewed': '--sensitive-reviewed',
    '-DocsUpdated': '--docs-updated',
    '-EventType': '--event-type',
    '-InfraReviewVerdict': '--infra-review-verdict',
    '-Message': '--message',
    '-Outcome': '--outcome',
    '-OverrideArtifactPath': '--override-artifact-path',
    '-PerformanceReviewVerdict': '--performance-review-verdict',
    '-Rationale': '--rationale',
    '-ReviewEvidencePath': '--review-evidence-path',
    '-ReviewsRoot': '--reviews-root',
    '-SecurityReviewVerdict': '--security-review-verdict',
    '-SkipReviews': '--skip-reviews',
    '-SkipReason': '--skip-reason',
    '-TestReviewVerdict': '--test-review-verdict',
    '-TimelinePath': '--timeline-path',
    '-EventsRoot': '--events-root',
    '-IncludeDetails': '--include-details',
    '-AsJson': '--as-json',
    '-MetadataPath': '--metadata-path',
    '-RefactorReviewVerdict': '--refactor-review-verdict'
});

/**
 * Convert a single PowerShell-style argument token to CLI-style token(s).
 *
 *   -Name           → ['--name']
 *   -Name:$true     → ['--name']
 *   -Name:$false    → []           (switch is off)
 *   -Name:value     → ['--name', 'value']
 *   --already-cli   → ['--already-cli']  (pass-through)
 */
function convertPsArgToCliTokens(token) {
    if (!token || !token.startsWith('-') || token.startsWith('--')) {
        return [token];
    }

    var colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
        var name = token.substring(0, colonIndex);
        var value = token.substring(colonIndex + 1);
        var mappedName = PS_ARG_MAP[name];
        if (!mappedName) return [token];

        var lower = value.toLowerCase();
        if (lower === '$true' || lower === 'true') return [mappedName];
        if (lower === '$false' || lower === 'false') return [];
        return [mappedName, value];
    }

    var mappedToken = PS_ARG_MAP[token];
    return mappedToken ? [mappedToken] : [token];
}

/**
 * Adapt an array of PowerShell-style arguments to CLI-style.
 * Unknown arguments are passed through unchanged.
 */
function adaptPsArgs(args) {
    var result = [];
    for (var i = 0; i < args.length; i++) {
        var tokens = convertPsArgToCliTokens(args[i]);
        for (var j = 0; j < tokens.length; j++) {
            result.push(tokens[j]);
        }
    }
    return result;
}

module.exports = {
    PS_ARG_MAP,
    adaptPsArgs,
    convertPsArgToCliTokens
};
