const { toStringArray } = require('./text-utils.ts');

/**
 * Resolve a context-lookup integer value, matching Python _resolve_filter_int.
 */
function resolveFilterInt(value, context, fieldName, minimum = 0) {
    let resolvedValue = value;
    if (resolvedValue && typeof resolvedValue === 'object' && typeof resolvedValue.context_key === 'string' && resolvedValue.context_key.trim()) {
        const contextKey = resolvedValue.context_key.trim();
        if (!context || typeof context !== 'object' || !(contextKey in context)) {
            throw new Error(`${fieldName} references missing context key '${contextKey}'.`);
        }
        resolvedValue = context[contextKey];
    }

    if (typeof resolvedValue === 'boolean') {
        throw new Error(`${fieldName} must resolve to integer >= ${minimum}.`);
    }
    let result;
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
function resolveFilterStr(value, context, fieldName, options = {}) {
    const allowEmpty = options.allowEmpty || false;
    let resolvedValue = value;
    if (resolvedValue && typeof resolvedValue === 'object' && typeof resolvedValue.context_key === 'string' && resolvedValue.context_key.trim()) {
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
function getFilterPatterns(operation) {
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

function selectHeadLines(lines, count) {
    if (count <= 0) return [];
    return lines.slice(0, count);
}

function selectTailLines(lines, count) {
    if (count <= 0) return [];
    return lines.slice(-count);
}

function addUniqueLines(destination, seen, lines, options = {}) {
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

function selectMatchingLines(lines, patterns, options = {}) {
    const limit = options.limit || 0;
    const compiledPatterns = patterns.map(p => new RegExp(p));
    const matches = [];
    for (const line of lines) {
        if (compiledPatterns.some(p => p.test(line))) {
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

function getCompileFailureStrategyConfig(strategy) {
    const normalized = (strategy || '').trim().toLowerCase();
    if (COMPILE_STRATEGY_CONFIGS[normalized]) {
        return COMPILE_STRATEGY_CONFIGS[normalized];
    }
    return {
        display_name: 'generic-compile',
        full_patterns: ['error', 'failed', 'exception', 'cannot ', 'undefined', 'not found'],
        degraded_patterns: ['warning', 'error', 'failed']
    };
}

function invokeCompileFailureParser(lines, parserConfig, context) {
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
        const summaryLines = [];
        const seen = new Set();
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
        const summaryLines = [];
        const seen = new Set();
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

function invokeTestFailureParser(lines, parserConfig, context) {
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
        const summaryLines = [];
        const seen = new Set();
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

function invokeLintFailureParser(lines, parserConfig, context) {
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
        const summaryLines = [];
        const seen = new Set();
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

function invokeReviewSummaryParser(lines, parserConfig, context) {
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

function applyOutputParser(lines, parserConfig, context) {
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
function applyOutputFilterOperation(lines, operation, context) {
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
        const result = [];
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
function applyPassthroughCeiling(lines, config, fallbackMode) {
    const DEFAULT_MAX = 60;
    let maxLines = DEFAULT_MAX;
    let strategy = 'tail';

    if (config && typeof config === 'object') {
        const ceilingCfg = config.passthrough_ceiling;
        if (ceilingCfg && typeof ceilingCfg === 'object') {
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
function applyOutputFilterProfile(lines, configPath, profileName, options = {}) {
    const fs = require('node:fs');
    const context = options.context || null;
    const originalLines = toStringArray(lines);
    const passthrough = {
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

    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        process.stderr.write(`WARNING: output filter config is invalid JSON for profile '${profileName}': ${err}\n`);
        passthrough.fallback_mode = 'invalid_config_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, null, 'invalid_config_passthrough');
        return passthrough;
    }

    const profiles = config.profiles;
    if (!profiles || typeof profiles !== 'object') {
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
    if (typeof profile !== 'object') {
        process.stderr.write(`WARNING: output filter profile '${profileName}' must be an object.\n`);
        passthrough.fallback_mode = 'invalid_profile_passthrough';
        passthrough.lines = applyPassthroughCeiling(originalLines, config, 'invalid_profile_passthrough');
        return passthrough;
    }

    try {
        let filteredLines = [...originalLines];
        const operations = profile.operations || [];
        if (typeof operations === 'string' || !Array.isArray(operations)) {
            throw new Error(`Profile '${profileName}' field 'operations' must be an array.`);
        }
        for (const operation of operations) {
            filteredLines = applyOutputFilterOperation(filteredLines, operation, context);
        }

        const parserResult = applyOutputParser(filteredLines, profile.parser, context);
        filteredLines = [...parserResult.lines];
        if (parserResult.parser_mode === 'PASSTHROUGH') {
            filteredLines = applyPassthroughCeiling(filteredLines, config, 'parser_passthrough');
        }
        const emitWhenEmpty = String(profile.emit_when_empty || '').trim();
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

module.exports = {
    applyOutputFilterOperation,
    applyOutputFilterProfile,
    applyOutputParser,
    applyPassthroughCeiling,
    getCompileFailureStrategyConfig,
    resolveFilterInt,
    resolveFilterStr,
    selectHeadLines,
    selectMatchingLines,
    selectTailLines
};
