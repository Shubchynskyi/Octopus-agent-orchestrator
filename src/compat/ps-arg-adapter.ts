/**
 * PowerShell argument adapter for Node compatibility shims.
 *
 * Converts -PascalCase arguments (used by PowerShell scripts) to
 * --kebab-case format (used by the Node CLI router). This enables
 * .sh and .ps1 entrypoints to delegate transparently to
 *   node bin/octopus.js <command> <translated-args>
 * without requiring callers to change their invocation syntax.
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
    '-ChangelogUpdated': '--changelog-updated',
    '-SensitiveReviewed': '--sensitive-reviewed',
    '-DocsUpdated': '--docs-updated',
    '-Rationale': '--rationale',
    '-SkipReviews': '--skip-reviews',
    '-EventsRoot': '--events-root',
    '-IncludeDetails': '--include-details',
    '-AsJson': '--as-json',
    '-MetadataPath': '--metadata-path'
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
        var mapped = PS_ARG_MAP[name];
        if (!mapped) return [token];

        var lower = value.toLowerCase();
        if (lower === '$true' || lower === 'true') return [mapped];
        if (lower === '$false' || lower === 'false') return [];
        return [mapped, value];
    }

    var mapped = PS_ARG_MAP[token];
    return mapped ? [mapped] : [token];
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
