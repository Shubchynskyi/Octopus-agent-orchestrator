import { toStringArray } from './text-utils';
import * as fs from 'node:fs';

interface ResolveFilterStrOptions {
    allowEmpty?: boolean;
}

interface AddUniqueLinesOptions {
    limit?: number;
}

interface SelectMatchingLinesOptions {
    limit?: number;
}

interface CompileStrategyConfig {
    display_name: string;
    full_patterns: string[];
    degraded_patterns: string[];
}

interface ParserResult {
    lines: string[];
    parser_mode: string;
    parser_name: string | null;
    parser_strategy: string | null;
    fallback_mode: string;
}

interface FilterProfileResult {
    lines: string[];
    filter_mode: string;
    fallback_mode: string;
    parser_mode: string;
    parser_name: string | null;
    parser_strategy: string | null;
}

interface ApplyOutputFilterProfileOptions {
    context?: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

/**
 * Resolve a context-lookup integer value, matching Python _resolve_filter_int.
 */
export function resolveFilterInt(
    value: unknown,
    context: Record<string, unknown> | null | undefined,
    fieldName: string,
    minimum: number = 0
): number {
    let resolvedValue: unknown = value;
    if (
        resolvedValue
        && typeof resolvedValue === 'object'
        && 'context_key' in resolvedValue
        && typeof resolvedValue.context_key === 'string'
        && resolvedValue.context_key.trim()
    ) {
        const contextKey = resolvedValue.context_key.trim();
        if (!context || typeof context !== 'object' || !(contextKey in context)) {
            throw new Error(`${fieldName} references missing context key '${contextKey}'.`);
        }
        resolvedValue = context[contextKey];
    }

    if (typeof resolvedValue === 'boolean') {
        throw new Error(`${fieldName} must resolve to integer >= ${minimum}.`);
    }
    let result: number;
    if (typeof resolvedValue === 'number' && Number.isInteger(resolvedValue)) {
        result = resolvedValue;
    } else if (typeof resolvedValue === 'number' && Number.isFinite(resolvedValue) && resolvedValue === Math.floor(resolvedValue)) {
        result = Math.floor(resolvedValue);
    } else if (typeof resolvedValue === 'string' && /^\s*-?\d+\s*$/.test(resolvedValue.trim())) {
        result = parseInt(resolvedValue.trim(), 10);
    } else {
        throw new Error(`${fieldName} must resolve to integer >= ${minimum}.`);
    }
    if (result < minimum) {
        throw new Error(`${fieldName} must resolve to integer >= ${minimum}.`);
    }
    return result;
}

/**
 * Resolve a context-lookup string value, matching Python _resolve_filter_str.
 */
export function resolveFilterStr(
    value: unknown,
    context: Record<string, unknown> | null | undefined,
    fieldName: string,
    options: ResolveFilterStrOptions = {}
): string {
    const allowEmpty = options.allowEmpty || false;
    let resolvedValue: unknown = value;
    if (
        resolvedValue
        && typeof resolvedValue === 'object'
        && 'context_key' in resolvedValue
        && typeof resolvedValue.context_key === 'string'
        && resolvedValue.context_key.trim()
    ) {
        const contextKey = resolvedValue.context_key.trim();
        if (!context || typeof context !== 'object' || !(contextKey in context)) {
            throw new Error(`${fieldName} references missing context key '${contextKey}'.`);
        }
        resolvedValue = context[contextKey];
    }

    if (resolvedValue == null) {
        if (allowEmpty) {
            return '';
        }
        throw new Error(`${fieldName} must resolve to non-empty string.`);
    }

    const text = String(resolvedValue).trim();
    if (!text && !allowEmpty) {
        throw new Error(`${fieldName} must resolve to non-empty string.`);
    }
    return text;
}

/**
 * Get filter patterns from operation config, matching Python _get_filter_patterns.
 */
function getFilterPatterns(operation: Record<string, unknown>): string[] {
    const patternsValue = operation.patterns || operation.pattern;
    const patterns = toStringArray(patternsValue, { trimValues: true });
    if (patterns.length === 0) {
        throw new Error("Filter operation requires non-empty `pattern` or `patterns`.");
    }
    for (const pattern of patterns) {
        new RegExp(pattern); // validate
    }
    return patterns;
}

export function selectHeadLines(lines: string[], count: number): string[] {
    if (count <= 0) return [];
    return lines.slice(0, count);
}

export function selectTailLines(lines: string[], count: number): string[] {
    if (count <= 0) return [];
    return lines.slice(-count);
}

function addUniqueLines(
    destination: string[],
    seen: Set<string>,
    lines: unknown,
    options: AddUniqueLinesOptions = {}
): void {
    const limit = options.limit || 0;
    for (const lineValue of toStringArray(lines)) {
        const lineText = String(lineValue);
        if (!lineText.trim() || seen.has(lineText)) {
            continue;
        }
        destination.push(lineText);
        seen.add(lineText);
        if (limit > 0 && destination.length >= limit) {
            break;
        }
    }
}

export function selectMatchingLines(
    lines: string[],
    patterns: string[],
    options: SelectMatchingLinesOptions = {}
): string[] {
    const limit = options.limit || 0;
    const compiledPatterns = patterns.map((pattern) => new RegExp(pattern));
    const matches: string[] = [];
    for (const line of lines) {
        if (compiledPatterns.some((pattern) => pattern.test(line))) {
            matches.push(line);
            if (limit > 0 && matches.length >= limit) {
                break;
            }
        }
    }
    return matches;
}

// --- Compile failure strategy configs ---

const COMPILE_STRATEGY_CONFIGS = {
    maven: {
        display_name: 'maven',
        full_patterns: [
            String.raw`^\[ERROR\]`,
            'BUILD FAILURE',
            'COMPILATION ERROR',
            'Failed to execute goal',
            'There are test failures',
            String.raw`Tests run: .*Failures:`,
            'Re-run Maven'
        ],
        degraded_patterns: [String.raw`^\[ERROR\]`, String.raw`^\[WARNING\]`, 'BUILD FAILURE', 'error']
    },
    gradle: {
        display_name: 'gradle',
        full_patterns: [
            String.raw`^FAILURE: Build failed with an exception\.`,
            '^BUILD FAILED',
            'Execution failed for task',
            String.raw`^\* What went wrong:`,
            '^> .*',
            '^> Task .*FAILED'
        ],
        degraded_patterns: ['^FAILURE:', '^BUILD FAILED', 'FAILED', 'error']
    },
    node: {
        display_name: 'node-build',
        full_patterns: [
            '^npm ERR!',
            '^ERR!',
            'Command failed with exit code',
            'Failed to compile',
            'ERROR in',
            'Type error',
            'Module not found'
        ],
        degraded_patterns: ['^npm ERR!', 'warning', 'error', 'failed']
    },
    cargo: {
        display_name: 'cargo',
        full_patterns: [
            String.raw`^error(\[[A-Z0-9]+\])?:`,
            '^Caused by:',
            'could not compile',
            '^failures:',
            '^test result: FAILED'
        ],
        degraded_patterns: ['^warning:', '^error', 'FAILED']
    },
    dotnet: {
        display_name: 'dotnet',
        full_patterns: [
            String.raw`^Build FAILED\.`,
            String.raw`^\s*error [A-Z]{2,}\d+:`,
            String.raw`^\s*warning [A-Z]{2,}\d+:`,
            String.raw`^Failed!  - Failed:`,
            String.raw`^Test Run Failed\.`
        ],
        degraded_patterns: [String.raw`^\s*error `, String.raw`^\s*warning `, 'FAILED']
    },
    go: {
        display_name: 'go',
        full_patterns: [
            '^# ',
            '^--- FAIL:',
            String.raw`^FAIL(\s|$)`,
            '^panic:',
            'cannot use',
            'undefined:'
        ],
        degraded_patterns: ['^FAIL', '^panic:', 'error']
    }
};

export function getCompileFailureStrategyConfig(strategy: string): CompileStrategyConfig {
    const normalized = (strategy || '').trim().toLowerCase();
    if (normalized in COMPILE_STRATEGY_CONFIGS) {
        return COMPILE_STRATEGY_CONFIGS[normalized as keyof typeof COMPILE_STRATEGY_CONFIGS];
    }
    return {
        display_name: 'generic-compile',
        full_patterns: ['error', 'failed', 'exception', 'cannot ', 'undefined', 'not found'],
        degraded_patterns: ['warning', 'error', 'failed']
    };
}

function invokeCompileFailureParser(
    lines: string[],
    parserConfig: Record<string, unknown>,
    context: Record<string, unknown> | null | undefined
): ParserResult {
    let strategy = resolveFilterStr(parserConfig.strategy, context, 'parser.strategy', { allowEmpty: true });
    if (!strategy) {
        strategy = resolveFilterStr({ context_key: 'command_filter_strategy' }, context, 'parser.strategy_context', { allowEmpty: true });
    }
    if (!strategy) {
        strategy = 'generic';
    }

    const config = getCompileFailureStrategyConfig(strategy);
    const maxMatches = resolveFilterInt(parserConfig.max_matches, context, 'parser.max_matches', 1);
    const tailCount = resolveFilterInt(parserConfig.tail_count, context, 'parser.tail_count', 0);

    const fullMatches = selectMatchingLines(lines, config.full_patterns, { limit: maxMatches });
    if (fullMatches.length > 0) {
        const summaryLines: string[] = [];
        const seen = new Set<string>();
        addUniqueLines(summaryLines, seen, [`CompactSummary: FULL | strategy=${config.display_name}`]);
        addUniqueLines(summaryLines, seen, fullMatches, { limit: maxMatches + 1 });
        if (tailCount > 0) {
            addUniqueLines(summaryLines, seen, selectTailLines(lines, tailCount));
        }
        return {
            lines: summaryLines,
            parser_mode: 'FULL',
            parser_name: 'compile_failure_summary',
            parser_strategy: config.display_name,
            fallback_mode: 'none'
        };
    }

    const degradedMatches = selectMatchingLines(lines, config.degraded_patterns, { limit: Math.max(maxMatches, 8) });
    if (degradedMatches.length > 0) {
        const summaryLines: string[] = [];
        const seen = new Set<string>();
        addUniqueLines(summaryLines, seen, [`CompactSummary: DEGRADED | strategy=${config.display_name}`]);
        addUniqueLines(summaryLines, seen, degradedMatches, { limit: Math.max(maxMatches, 8) + 1 });
        if (tailCount > 0) {
            addUniqueLines(summaryLines, seen, selectTailLines(lines, tailCount));
        }
        return {
            lines: summaryLines,
            parser_mode: 'DEGRADED',
            parser_name: 'compile_failure_summary',
            parser_strategy: config.display_name,
            fallback_mode: 'none'
        };
    }

    return {
        lines: [...lines],
        parser_mode: 'PASSTHROUGH',
        parser_name: 'compile_failure_summary',
        parser_strategy: config.display_name,
        fallback_mode: 'parser_passthrough'
    };
}

function invokeTestFailureParser(
    lines: string[],
    parserConfig: Record<string, unknown>,
    context: Record<string, unknown> | null | undefined
): ParserResult {
    const maxMatches = resolveFilterInt(parserConfig.max_matches, context, 'parser.max_matches', 1);
    const tailCount = resolveFilterInt(parserConfig.tail_count, context, 'parser.tail_count', 0);
    const patterns = [
        '^--- FAIL:',
        String.raw`^FAIL(\s|$)`,
        '^FAILED',
        '^failures?:',
        '^panic:',
        '^AssertionError',
        '^Error:',
        String.raw`[0-9]+\s+failed`,
        'Test Run Failed',
        '[✕×]'
    ];
    const matches = selectMatchingLines(lines, patterns, { limit: maxMatches });
    if (matches.length > 0) {
        const summaryLines: string[] = [];
        const seen = new Set<string>();
        addUniqueLines(summaryLines, seen, ['CompactSummary: FULL | strategy=test']);
        addUniqueLines(summaryLines, seen, matches, { limit: maxMatches + 1 });
        if (tailCount > 0) {
            addUniqueLines(summaryLines, seen, selectTailLines(lines, tailCount));
        }
        return {
            lines: summaryLines,
            parser_mode: 'FULL',
            parser_name: 'test_failure_summary',
            parser_strategy: 'test',
            fallback_mode: 'none'
        };
    }
    return {
        lines: [...lines],
        parser_mode: 'PASSTHROUGH',
        parser_name: 'test_failure_summary',
        parser_strategy: 'test',
        fallback_mode: 'parser_passthrough'
    };
}

function invokeLintFailureParser(
    lines: string[],
    parserConfig: Record<string, unknown>,
    context: Record<string, unknown> | null | undefined
): ParserResult {
    const maxMatches = resolveFilterInt(parserConfig.max_matches, context, 'parser.max_matches', 1);
    const tailCount = resolveFilterInt(parserConfig.tail_count, context, 'parser.tail_count', 0);
    const patterns = [
        String.raw`^\s*error`,
        String.raw`^\s*warning`,
        String.raw`:[0-9]+(:[0-9]+)?\s+(error|warning)`,
        String.raw`^Found\s+[0-9]+\s+errors?`,
        '[✖×]',
        'problems?'
    ];
    const matches = selectMatchingLines(lines, patterns, { limit: maxMatches });
    if (matches.length > 0) {
        const summaryLines: string[] = [];
        const seen = new Set<string>();
        addUniqueLines(summaryLines, seen, ['CompactSummary: FULL | strategy=lint']);
        addUniqueLines(summaryLines, seen, matches, { limit: maxMatches + 1 });
        if (tailCount > 0) {
            addUniqueLines(summaryLines, seen, selectTailLines(lines, tailCount));
        }
        return {
            lines: summaryLines,
            parser_mode: 'FULL',
            parser_name: 'lint_failure_summary',
            parser_strategy: 'lint',
            fallback_mode: 'none'
        };
    }
    return {
        lines: [...lines],
        parser_mode: 'PASSTHROUGH',
        parser_name: 'lint_failure_summary',
        parser_strategy: 'lint',
        fallback_mode: 'parser_passthrough'
    };
}

function invokeReviewSummaryParser(
    lines: string[],
    parserConfig: Record<string, unknown>,
    context: Record<string, unknown> | null | undefined
): ParserResult {
    const maxLines = resolveFilterInt(parserConfig.max_lines, context, 'parser.max_lines', 1);
    const summaryLines = selectHeadLines(lines, maxLines);
    if (summaryLines.length === 0) {
        return {
            lines: [...lines],
            parser_mode: 'PASSTHROUGH',
            parser_name: 'review_gate_summary',
            parser_strategy: 'review',
            fallback_mode: 'parser_passthrough'
        };
    }
    return {
        lines: summaryLines,
        parser_mode: 'FULL',
        parser_name: 'review_gate_summary',
        parser_strategy: 'review',
        fallback_mode: 'none'
    };
}

export function applyOutputParser(
    lines: string[],
    parserConfig: Record<string, unknown> | null | undefined,
    context: Record<string, unknown> | null | undefined
): ParserResult {
    if (parserConfig == null) {
        return {
            lines: [...lines],
            parser_mode: 'NONE',
            parser_name: null,
            parser_strategy: null,
            fallback_mode: 'none'
        };
    }
    if (typeof parserConfig !== 'object') {
        throw new Error('Profile parser must be an object.');
    }

    const parserType = resolveFilterStr(parserConfig.type, context, 'parser.type');
    const normalized = parserType.trim().toLowerCase();
    if (normalized === 'compile_failure_summary') {
        return invokeCompileFailureParser(lines, parserConfig, context);
    }
    if (normalized === 'test_failure_summary') {
        return invokeTestFailureParser(lines, parserConfig, context);
    }
    if (normalized === 'lint_failure_summary') {
        return invokeLintFailureParser(lines, parserConfig, context);
    }
    if (normalized === 'review_gate_summary') {
        return invokeReviewSummaryParser(lines, parserConfig, context);
    }
    throw new Error(`Unsupported profile parser type '${parserType}'.`);
}

/**
 * Apply a single output filter operation, matching Python apply_output_filter_operation.
 */
export function applyOutputFilterOperation(
    lines: unknown,
    operation: Record<string, unknown>,
    context: Record<string, unknown> | null | undefined = null
): string[] {
    if (!operation || typeof operation !== 'object') {
        throw new Error('Filter operation must be an object.');
    }

    const operationType = String(operation.type || '').trim().toLowerCase();
    if (!operationType) {
        throw new Error("Filter operation requires non-empty `type`.");
    }

    const currentLines = toStringArray(lines);

    if (operationType === 'strip_ansi') {
        const ansiPattern = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
        return currentLines.map(line => line.replace(ansiPattern, ''));
    }
    if (operationType === 'regex_replace') {
        const pattern = String(operation.pattern || '').trim();
        if (!pattern) {
            throw new Error("regex_replace requires non-empty `pattern`.");
        }
        const compiled = new RegExp(pattern, 'g');
        const replacement = String(operation.replacement || '');
        return currentLines.map(line => line.replace(compiled, replacement));
    }
    if (operationType === 'drop_lines_matching') {
        const patterns = getFilterPatterns(operation);
        const compiledPatterns = patterns.map(p => new RegExp(p));
        return currentLines.filter(line => !compiledPatterns.some(p => p.test(line)));
    }
    if (operationType === 'keep_lines_matching') {
        const patterns = getFilterPatterns(operation);
        const compiledPatterns = patterns.map(p => new RegExp(p));
        return currentLines.filter(line => compiledPatterns.some(p => p.test(line)));
    }
    if (operationType === 'truncate_line_length') {
        const maxChars = resolveFilterInt(operation.max_chars, context, 'truncate_line_length.max_chars', 1);
        const suffix = String(operation.suffix != null ? operation.suffix : '...');
        const result: string[] = [];
        for (const line of currentLines) {
            if (line.length <= maxChars) {
                result.push(line);
            } else if (suffix.length >= maxChars) {
                result.push(suffix.substring(0, maxChars));
            } else {
                result.push(line.substring(0, maxChars - suffix.length) + suffix);
            }
        }
        return result;
    }
    if (operationType === 'head') {
        const count = resolveFilterInt(operation.count, context, 'head.count', 1);
        return selectHeadLines(currentLines, count);
    }
    if (operationType === 'tail') {
        const count = resolveFilterInt(operation.count, context, 'tail.count', 1);
        return selectTailLines(currentLines, count);
    }
    if (operationType === 'max_total_lines') {
        const maxLines = resolveFilterInt(operation.max_lines, context, 'max_total_lines.max_lines', 0);
        const strategy = String(operation.strategy || 'tail').trim().toLowerCase() || 'tail';
        if (maxLines === 0) return [];
        if (strategy === 'head') return selectHeadLines(currentLines, maxLines);
        if (strategy === 'tail') return selectTailLines(currentLines, maxLines);
        throw new Error("max_total_lines.strategy must be 'head' or 'tail'.");
    }

    throw new Error(`Unsupported filter operation type '${operationType}'.`);
}

/**
 * Apply passthrough ceiling, matching Python _apply_passthrough_ceiling.
 */
export function applyPassthroughCeiling(
    lines: string[],
    config: Record<string, unknown> | null,
    fallbackMode: string
): string[] {
    const DEFAULT_MAX = 60;
    let maxLines = DEFAULT_MAX;
    let strategy = 'tail';

    if (config && typeof config === 'object') {
        const ceilingCfg = asRecord(config.passthrough_ceiling);
        if (ceilingCfg) {
            if (typeof ceilingCfg.max_lines === 'number' && ceilingCfg.max_lines > 0) {
                maxLines = ceilingCfg.max_lines;
            }
            if (ceilingCfg.strategy === 'head') {
                strategy = 'head';
            }
        }
    }

    const total = lines.length;
    if (total <= maxLines) {
        return [...lines];
    }

    const capped = strategy === 'head' ? selectHeadLines(lines, maxLines) : selectTailLines(lines, maxLines);
    const header = `[passthrough-ceiling] fallback=${fallbackMode} total=${total} ceiling=${maxLines} strategy=${strategy}`;
    return [header, ...capped];
}

/**
 * Apply a named output filter profile, matching Python apply_output_filter_profile.
 */
export function applyOutputFilterProfile(
    lines: unknown,
    configPath: string,
    profileName: string,
    options: ApplyOutputFilterProfileOptions = {}
): FilterProfileResult {
    const context = options.context || null;
    const originalLines = toStringArray(lines);
    const passthrough: FilterProfileResult = {
        lines: originalLines,
        filter_mode: 'passthrough',
        fallback_mode: 'none',
        parser_mode: 'NONE',
        parser_name: null,
        parser_strategy: null
    };

    if (!String(profileName || '').trim()) {
        return passthrough;
    }

    if (!configPath || !fs.existsSync(configPath)) {
        process.stderr.write(`WARNING: output filter config missing for profile '${profileName}': ${configPath}\n`);
        passthrough.fallback_mode = 'missing_config_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, null, 'missing_config_passthrough');
        return passthrough;
    }

    let config: Record<string, unknown> | null = null;
    try {
        const parsedConfig: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config = asRecord(parsedConfig) || {};
    } catch (err) {
        process.stderr.write(`WARNING: output filter config is invalid JSON for profile '${profileName}': ${err}\n`);
        passthrough.fallback_mode = 'invalid_config_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, null, 'invalid_config_passthrough');
        return passthrough;
    }

    const profiles = config ? asRecord(config.profiles) : null;
    if (!profiles) {
        process.stderr.write("WARNING: output filter config must contain object 'profiles'.\n");
        passthrough.fallback_mode = 'invalid_config_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, config, 'invalid_config_passthrough');
        return passthrough;
    }

    const profile = profiles[profileName];
    if (profile == null) {
        process.stderr.write(`WARNING: output filter profile '${profileName}' not found in ${configPath}.\n`);
        passthrough.fallback_mode = 'missing_profile_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, config, 'missing_profile_passthrough');
        return passthrough;
    }
    const profileRecord = asRecord(profile);
    if (!profileRecord) {
        process.stderr.write(`WARNING: output filter profile '${profileName}' must be an object.\n`);
        passthrough.fallback_mode = 'invalid_profile_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, config, 'invalid_profile_passthrough');
        return passthrough;
    }

    try {
        let filteredLines = [...originalLines];
        const operations = profileRecord.operations || [];
        if (typeof operations === 'string' || !Array.isArray(operations)) {
            throw new Error(`Profile '${profileName}' field 'operations' must be an array.`);
        }
        for (const operation of operations) {
            filteredLines = applyOutputFilterOperation(filteredLines, operation as Record<string, unknown>, context);
        }

        const parserResult = applyOutputParser(
            filteredLines,
            profileRecord.parser as Record<string, unknown> | null | undefined,
            context
        );
        filteredLines = [...parserResult.lines];
        if (parserResult.parser_mode === 'PASSTHROUGH') {
            filteredLines = applyPassthroughCeiling(filteredLines, config, 'parser_passthrough');
        }
        const emitWhenEmpty = String(profileRecord.emit_when_empty || '').trim();
        if (filteredLines.length === 0 && emitWhenEmpty) {
            filteredLines = [emitWhenEmpty];
        }

        return {
            lines: filteredLines,
            filter_mode: `profile:${profileName}`,
            fallback_mode: parserResult.fallback_mode,
            parser_mode: parserResult.parser_mode,
            parser_name: parserResult.parser_name,
            parser_strategy: parserResult.parser_strategy
        };
    } catch (err) {
        process.stderr.write(`WARNING: output filter profile '${profileName}' is invalid: ${err}\n`);
        passthrough.fallback_mode = 'invalid_profile_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, config, 'invalid_profile_passthrough');
        return passthrough;
    }
}
