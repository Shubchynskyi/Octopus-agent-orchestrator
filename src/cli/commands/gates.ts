const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    buildOutputTelemetry,
    formatVisibleSavingsLine
} = require('../../gate-runtime/token-telemetry.ts');
const { applyOutputFilterProfile } = require('../../gate-runtime/output-filters.ts');
const { auditReviewArtifactCompaction } = require('../../gate-runtime/review-context.ts');
const {
    appendTaskEvent,
    assertValidTaskId
} = require('../../gate-runtime/task-events.ts');
const { auditCommandCompactness } = require('../../gates/task-events-summary.ts');
const {
    classifyChange,
    getClassificationConfig,
    getReviewCapabilities
} = require('../../gates/classify-change.ts');
const {
    getCompileCommandProfile,
    getCompileCommands,
    getOutputStats,
    getPreflightContext,
    getWorkspaceSnapshot
} = require('../../gates/compile-gate.ts');
const { assessDocImpact } = require('../../gates/doc-impact.ts');
const {
    checkRequiredReviews,
    parseSkipReviews,
    REVIEW_CONTRACTS,
    validatePreflightForReview
} = require('../../gates/required-reviews-check.ts');
const gateHelpers = require('../../gates/helpers.ts');

function toStringArray(value, options = {}) {
    return gateHelpers.toStringArray(value, options);
}

function resolveOrchestratorRoot(repoRoot) {
    return gateHelpers.joinOrchestratorPath(repoRoot, '');
}

function normalizeOptionalPath(pathValue) {
    if (!pathValue) {
        return null;
    }
    return gateHelpers.normalizePath(pathValue);
}

function ensureParentDirectory(filePath) {
    if (!filePath) {
        return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonArtifact(filePath, payload) {
    if (!filePath) {
        return;
    }
    ensureParentDirectory(filePath);
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function resolvePathForWrite(pathValue, repoRoot) {
    return gateHelpers.resolvePathInsideRepo(pathValue, repoRoot, { allowMissing: true });
}

function resolveDefaultReviewsPath(repoRoot, suffix) {
    return gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'reviews', suffix));
}

function resolveDefaultMetricsPath(repoRoot) {
    return gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'metrics.jsonl'));
}

function parseJsonOption(value, label) {
    const text = String(value || '').trim();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} is not valid JSON: ${String((error && error.message) || error)}`);
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toDetailsMap(detailsObject) {
    if (detailsObject == null) {
        return {};
    }
    if (isPlainObject(detailsObject)) {
        return { ...detailsObject };
    }
    return {
        input_details: detailsObject
    };
}

function getCommandAuditPayload(detailsObject) {
    if (!isPlainObject(detailsObject)) {
        return null;
    }

    let commandText = '';
    for (const candidateKey of ['command', 'command_text', 'shell_command']) {
        const value = detailsObject[candidateKey];
        if (typeof value === 'string' && value.trim()) {
            commandText = value.trim();
            break;
        }
    }
    if (!commandText) {
        return null;
    }

    return {
        command_text: commandText,
        mode: String(detailsObject.command_mode || detailsObject.mode || 'scan'),
        justification: String(detailsObject.command_justification || detailsObject.justification || '')
    };
}

function cleanupTerminalCompileLogs(repoRoot, taskId) {
    const result = {
        triggered: true,
        attempted_paths: 0,
        discovered_paths: [],
        deleted_paths: [],
        missing_paths: [],
        errors: []
    };
    const reviewsRoot = gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'reviews'));
    const candidatePaths = new Set();

    if (fs.existsSync(reviewsRoot) && fs.statSync(reviewsRoot).isDirectory()) {
        const prefix = `${taskId}-compile-output`;
        for (const entry of fs.readdirSync(reviewsRoot, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            if (entry.name.startsWith(prefix) && entry.name.endsWith('.log')) {
                candidatePaths.add(path.join(reviewsRoot, entry.name));
            }
        }
    }

    const compileEvidencePath = path.join(reviewsRoot, `${taskId}-compile-gate.json`);
    if (fs.existsSync(compileEvidencePath) && fs.statSync(compileEvidencePath).isFile()) {
        try {
            const compileEvidence = JSON.parse(fs.readFileSync(compileEvidencePath, 'utf8'));
            const compileOutputPath = compileEvidence && typeof compileEvidence.compile_output_path === 'string'
                ? compileEvidence.compile_output_path
                : '';
            if (compileOutputPath.trim()) {
                candidatePaths.add(gateHelpers.resolvePathInsideRepo(compileOutputPath, repoRoot, { allowMissing: true }));
            }
        } catch (error) {
            result.errors.push(
                `Failed to read compile evidence '${gateHelpers.normalizePath(compileEvidencePath)}': ${String((error && error.message) || error)}`
            );
        }
    }

    for (const candidatePath of [...candidatePaths].sort()) {
        let resolvedCandidatePath;
        try {
            resolvedCandidatePath = gateHelpers.resolvePathInsideRepo(candidatePath, repoRoot, { allowMissing: true });
        } catch (error) {
            result.errors.push(
                `Compile output path is invalid '${String(candidatePath)}': ${String((error && error.message) || error)}`
            );
            continue;
        }

        const normalizedPath = gateHelpers.normalizePath(resolvedCandidatePath);
        result.discovered_paths.push(normalizedPath);
        result.attempted_paths = result.discovered_paths.length;

        if (!fs.existsSync(resolvedCandidatePath) || !fs.statSync(resolvedCandidatePath).isFile()) {
            result.missing_paths.push(normalizedPath);
            continue;
        }

        try {
            fs.unlinkSync(resolvedCandidatePath);
            result.deleted_paths.push(normalizedPath);
        } catch (error) {
            result.errors.push(
                `Failed to delete compile output '${normalizedPath}': ${String((error && error.message) || error)}`
            );
        }
    }

    return result;
}

function parseIntOption(value, fallback, minimum = 0) {
    if (value == null || String(value).trim() === '') {
        return fallback;
    }
    const parsed = Number.parseInt(String(value).trim(), 10);
    if (!Number.isInteger(parsed) || parsed < minimum) {
        throw new Error(`Expected integer >= ${minimum}, got '${value}'.`);
    }
    return parsed;
}

function parseBooleanOption(value, fallback) {
    if (value == null || String(value).trim() === '') {
        return fallback;
    }
    return gateHelpers.parseBool(value, fallback);
}

function expandValueList(value, options = {}) {
    const splitDelimiters = options.splitDelimiters || false;
    const values = [];
    for (const item of toStringArray(value)) {
        if (!splitDelimiters) {
            values.push(String(item).trim());
            continue;
        }
        for (const part of String(item).split(/[\r\n,;]+/)) {
            const trimmed = part.trim();
            if (trimmed) {
                values.push(trimmed);
            }
        }
    }
    return [...new Set(values.filter(Boolean))];
}

function splitOutputLines(text) {
    if (!text) {
        return [];
    }
    const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function appendCompileOutputEntry(outputPath, commandIndex, totalCommands, command, outputLines) {
    if (!outputPath) {
        return;
    }
    ensureParentDirectory(outputPath);
    const lines = [
        `==== COMMAND ${commandIndex}/${totalCommands} ====`,
        `COMMAND: ${command}`,
        `TIMESTAMP_UTC: ${new Date().toISOString()}`,
        '---- OUTPUT START ----',
        ...outputLines,
        '---- OUTPUT END ----',
        ''
    ];
    fs.appendFileSync(outputPath, `${lines.join(os.EOL)}${os.EOL}`, 'utf8');
}

function splitCommandLine(commandText) {
    const text = String(commandText || '').trim();
    if (!text) {
        return [];
    }

    const tokens = [];
    let current = '';
    let quote = '';
    let escaping = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (escaping) {
            current += character;
            escaping = false;
            continue;
        }

        if (character === '\\' && quote === '"') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (character === quote) {
                quote = '';
            } else {
                current += character;
            }
            continue;
        }

        if (character === '"' || character === '\'') {
            quote = character;
            continue;
        }

        if (/\s/.test(character)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += character;
    }

    if (escaping || quote) {
        throw new Error(`Command contains unterminated escaping or quotes: ${commandText}`);
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}

function findExecutableCandidate(candidatePath, extensions) {
    if (path.extname(candidatePath)) {
        return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile() ? candidatePath : null;
    }
    for (const extension of extensions) {
        const resolved = `${candidatePath}${extension}`;
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            return resolved;
        }
    }
    return null;
}

function resolveExecutablePath(executableName, cwd, envPath) {
    const requested = String(executableName || '').trim();
    if (!requested) {
        throw new Error('Executable name must not be empty.');
    }

    const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];

    if (path.isAbsolute(requested) || requested.includes('/') || requested.includes('\\')) {
        const absoluteCandidate = path.isAbsolute(requested)
            ? requested
            : path.resolve(cwd || process.cwd(), requested);
        const resolved = findExecutableCandidate(absoluteCandidate, extensions);
        if (resolved) {
            return resolved;
        }
        throw new Error(`Executable not found: ${requested}`);
    }

    const pathValue = envPath != null ? envPath : (process.env.PATH || '');
    for (const dirPath of String(pathValue).split(path.delimiter)) {
        if (!dirPath) {
            continue;
        }
        const resolved = findExecutableCandidate(path.join(dirPath, requested), extensions);
        if (resolved) {
            return resolved;
        }
    }

    if (process.platform !== 'win32') {
        return requested;
    }
    throw new Error(`${requested} is required but was not found in PATH.`);
}

function quoteWindowsArgument(argument) {
    const text = String(argument || '');
    if (!text || !/[ \t"]/u.test(text)) {
        return text;
    }
    let escaped = '"';
    let backslashCount = 0;
    for (const character of text) {
        if (character === '\\') {
            backslashCount += 1;
            continue;
        }
        if (character === '"') {
            escaped += '\\'.repeat(backslashCount * 2 + 1);
            escaped += '"';
            backslashCount = 0;
            continue;
        }
        if (backslashCount > 0) {
            escaped += '\\'.repeat(backslashCount);
            backslashCount = 0;
        }
        escaped += character;
    }
    if (backslashCount > 0) {
        escaped += '\\'.repeat(backslashCount * 2);
    }
    escaped += '"';
    return escaped;
}

function executeCommand(commandText, options = {}) {
    const cwd = options.cwd || process.cwd();
    const tokens = splitCommandLine(commandText);
    if (tokens.length === 0) {
        throw new Error('Command must not be empty.');
    }

    const executablePath = resolveExecutablePath(tokens[0], cwd, options.envPath);
    const args = tokens.slice(1);

    let result;
    if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath)) {
        const commandLine = [quoteWindowsArgument(executablePath), ...args.map(quoteWindowsArgument)].join(' ');
        result = childProcess.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
            cwd,
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } else {
        result = childProcess.spawnSync(executablePath, args, {
            cwd,
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    }

    const outputLines = [
        ...splitOutputLines(result.stdout),
        ...splitOutputLines(result.stderr)
    ];

    if (result.error) {
        if (result.error.code === 'ENOENT') {
            throw new Error(`${tokens[0]} is required but was not found in PATH.`);
        }
        throw result.error;
    }

    return {
        exitCode: result.status == null ? 1 : result.status,
        outputLines
    };
}

function getRenameCount(repoRoot, detectionSource, explicitChangedFiles) {
    const args = ['-C', repoRoot, 'diff', '--name-status', '--diff-filter=ACMRTUXB'];
    if (detectionSource === 'git_staged_only' || detectionSource === 'git_staged_plus_untracked') {
        args.push('--cached');
    } else {
        args.push('HEAD');
    }
    if (detectionSource === 'explicit_changed_files' && explicitChangedFiles.length > 0) {
        args.push('--', ...explicitChangedFiles);
    }
    const result = childProcess.spawnSync('git', args, {
        cwd: repoRoot,
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });
    if (result.error || result.status !== 0) {
        return 0;
    }
    return splitOutputLines(result.stdout).filter(function (line) {
        return /^R\d*\t/i.test(line);
    }).length;
}

function resolveOutputFiltersPath(repoRoot, explicitPath) {
    if (explicitPath) {
        return gateHelpers.resolvePathInsideRepo(explicitPath, repoRoot, { allowMissing: true });
    }
    return gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'config', 'output-filters.json'));
}

function writeCompileEvidence(evidencePath, resolvedTaskId, gateContext, status, outcome, errorMessage) {
    if (!evidencePath || !resolvedTaskId) {
        return;
    }
    const payload = {
        timestamp_utc: new Date().toISOString(),
        event_source: 'compile-gate',
        task_id: resolvedTaskId,
        status,
        outcome,
        error: errorMessage || null,
        ...gateContext
    };
    writeJsonArtifact(evidencePath, payload);
}

function resolvePreflightPath(repoRoot, explicitPath, taskId) {
    if (explicitPath) {
        return gateHelpers.resolvePathInsideRepo(explicitPath, repoRoot);
    }
    return resolveDefaultReviewsPath(repoRoot, `${taskId}-preflight.json`);
}

function runClassifyChangeCommand(options) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const orchestratorRoot = resolveOrchestratorRoot(repoRoot);
    const explicitChangedFiles = expandValueList(options.changedFiles, { splitDelimiters: true });
    const includeUntracked = parseBooleanOption(options.includeUntracked, true);
    const detectionSource = explicitChangedFiles.length > 0
        ? 'explicit_changed_files'
        : (options.useStaged ? (includeUntracked ? 'git_staged_plus_untracked' : 'git_staged_only') : 'git_auto');
    const workspaceSnapshot = getWorkspaceSnapshot(repoRoot, detectionSource, includeUntracked, explicitChangedFiles);
    const renameCount = getRenameCount(repoRoot, workspaceSnapshot.detection_source, workspaceSnapshot.changed_files);
    const classificationConfig = getClassificationConfig(repoRoot);
    const reviewCapabilities = getReviewCapabilities(repoRoot);
    const result = classifyChange({
        normalizedFiles: workspaceSnapshot.changed_files,
        taskIntent: String(options.taskIntent || ''),
        fastPathMaxFiles: parseIntOption(options.fastPathMaxFiles, 2, 1),
        fastPathMaxChangedLines: parseIntOption(options.fastPathMaxChangedLines, 40, 1),
        performanceHeuristicMinLines: parseIntOption(options.performanceHeuristicMinLines, 120, 1),
        changedLinesTotal: workspaceSnapshot.changed_lines_total,
        additionsTotal: workspaceSnapshot.additions_total,
        deletionsTotal: workspaceSnapshot.deletions_total,
        renameCount,
        detectionSource: workspaceSnapshot.detection_source,
        classificationConfig,
        reviewCapabilities
    });

    const resolvedTaskId = gateHelpers.resolveTaskId(options.taskId || '', options.outputPath || '');
    if (resolvedTaskId) {
        assertValidTaskId(resolvedTaskId);
        result.task_id = resolvedTaskId;
    }

    const outputPath = options.outputPath ? resolvePathForWrite(options.outputPath, repoRoot) : null;
    if (outputPath) {
        writeJsonArtifact(outputPath, result);
    }

    const metricsPath = options.metricsPath
        ? resolvePathForWrite(options.metricsPath, repoRoot)
        : resolvePathForWrite(classificationConfig.metrics_path, repoRoot);
    gateHelpers.appendMetricsEvent(metricsPath, {
        timestamp_utc: new Date().toISOString(),
        event_type: 'preflight_classification',
        repo_root: gateHelpers.normalizePath(repoRoot),
        task_id: resolvedTaskId || null,
        output_path: normalizeOptionalPath(outputPath),
        result
    }, parseBooleanOption(options.emitMetrics, true));

    if (resolvedTaskId) {
        appendTaskEvent(
            orchestratorRoot,
            resolvedTaskId,
            'PREFLIGHT_CLASSIFIED',
            'INFO',
            `Preflight completed with mode ${result.mode}.`,
            {
                mode: result.mode,
                output_path: normalizeOptionalPath(outputPath),
                changed_files_count: result.metrics.changed_files_count,
                changed_lines_total: result.metrics.changed_lines_total,
                required_reviews: result.required_reviews
            }
        );
    }

    return {
        outputText: `${JSON.stringify(result, null, 2)}\n`
    };
}

function runCompileGateCommand(options) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const orchestratorRoot = resolveOrchestratorRoot(repoRoot);
    const resolvedTaskId = assertValidTaskId(String(options.taskId || '').trim());
    const failTailLines = parseIntOption(options.failTailLines, 50, 1);
    const metricsPath = options.metricsPath
        ? resolvePathForWrite(options.metricsPath, repoRoot)
        : resolveDefaultMetricsPath(repoRoot);
    const outputFiltersPath = resolveOutputFiltersPath(repoRoot, options.outputFiltersPath || '');
    const compileEvidencePath = options.compileEvidencePath
        ? resolvePathForWrite(options.compileEvidencePath, repoRoot)
        : resolveDefaultReviewsPath(repoRoot, `${resolvedTaskId}-compile-gate.json`);
    const compileOutputPath = options.compileOutputPath
        ? resolvePathForWrite(options.compileOutputPath, repoRoot)
        : resolveDefaultReviewsPath(repoRoot, `${resolvedTaskId}-compile-output.log`);

    let resolvedCommandsPath = null;
    let compileCommands = [];
    let resolvedPreflightPath = null;
    let preflightHash = null;
    let preflightContext = null;
    let workspaceSnapshot = null;
    let warningCount = 0;
    let errorCount = 0;
    let exitCode = 0;
    let exceptionMessage = null;
    let selectedCommandProfile = null;
    let selectedCommandIndex = 0;
    const compileOutputLines = [];
    const startedAt = Date.now();

    try {
        const commandsPathValue = options.commandsPath
            ? options.commandsPath
            : gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'docs', 'agent-rules', '40-commands.md'));
        resolvedCommandsPath = gateHelpers.resolvePathInsideRepo(commandsPathValue, repoRoot);
        compileCommands = getCompileCommands(resolvedCommandsPath);
        resolvedPreflightPath = resolvePreflightPath(repoRoot, options.preflightPath || '', resolvedTaskId);
        preflightContext = getPreflightContext(resolvedPreflightPath, resolvedTaskId);
        workspaceSnapshot = getWorkspaceSnapshot(
            repoRoot,
            preflightContext.detection_source,
            preflightContext.include_untracked,
            preflightContext.changed_files
        );

        const scopeViolations = [];
        if (workspaceSnapshot.changed_files_sha256 !== preflightContext.changed_files_sha256) {
            scopeViolations.push('Preflight changed_files differ from current workspace snapshot.');
        }
        if (workspaceSnapshot.changed_lines_total !== preflightContext.changed_lines_total) {
            scopeViolations.push(
                `Preflight changed_lines_total=${preflightContext.changed_lines_total} differs from current snapshot changed_lines_total=${workspaceSnapshot.changed_lines_total}.`
            );
        }
        if (scopeViolations.length > 0) {
            exitCode = 1;
            exceptionMessage = `Preflight scope drift detected. Re-run classify-change before compile gate. ${scopeViolations.join(' ')}`;
        } else {
            preflightHash = gateHelpers.fileSha256(resolvedPreflightPath);
            ensureParentDirectory(compileOutputPath);
            fs.writeFileSync(compileOutputPath, '', 'utf8');

            for (let index = 0; index < compileCommands.length; index += 1) {
                const compileCommand = compileCommands[index];
                const commandProfile = getCompileCommandProfile(compileCommand);
                const execution = executeCommand(compileCommand, { cwd: repoRoot });
                const stats = getOutputStats(execution.outputLines);

                compileOutputLines.push(...execution.outputLines);
                warningCount += stats.warningLines;
                errorCount += stats.errorLines;
                appendCompileOutputEntry(compileOutputPath, index + 1, compileCommands.length, compileCommand, execution.outputLines);

                if (execution.exitCode !== 0) {
                    exitCode = execution.exitCode;
                    exceptionMessage = `Compile command #${index + 1} exited with code ${execution.exitCode}.`;
                    selectedCommandProfile = commandProfile;
                    selectedCommandIndex = index + 1;
                    break;
                }

                if (index === 0) {
                    selectedCommandProfile = commandProfile;
                    selectedCommandIndex = 1;
                }
            }
        }
    } catch (error) {
        exceptionMessage = String((error && error.message) || error);
        if (exitCode === 0) {
            exitCode = 1;
        }
    }

    const durationMs = Math.max(0, Date.now() - startedAt);
    const fallbackProfile = compileCommands.length > 0
        ? getCompileCommandProfile(compileCommands[0])
        : {
            kind: 'compile',
            strategy: 'generic',
            label: 'compile',
            failure_profile: 'compile_failure_console_generic',
            success_profile: 'compile_success_console'
        };
    const effectiveProfile = selectedCommandProfile || fallbackProfile;
    const selectedOutputProfile = exceptionMessage ? effectiveProfile.failure_profile : effectiveProfile.success_profile;
    const filteredOutput = applyOutputFilterProfile(compileOutputLines, outputFiltersPath, selectedOutputProfile, {
        context: {
            fail_tail_lines: failTailLines,
            command_filter_strategy: effectiveProfile.strategy,
            command_kind: effectiveProfile.kind
        }
    });
    const outputTelemetry = buildOutputTelemetry(compileOutputLines, filteredOutput.lines, {
        filterMode: filteredOutput.filter_mode,
        fallbackMode: filteredOutput.fallback_mode,
        parserMode: filteredOutput.parser_mode,
        parserName: filteredOutput.parser_name,
        parserStrategy: filteredOutput.parser_strategy
    });
    const visibleSavingsLine = formatVisibleSavingsLine(outputTelemetry);

    const gateContext = {
        commands_path: normalizeOptionalPath(resolvedCommandsPath),
        compile_commands: compileCommands,
        compile_command: compileCommands.length > 0 ? compileCommands[0] : null,
        preflight_path: normalizeOptionalPath(resolvedPreflightPath),
        preflight_hash_sha256: preflightHash,
        preflight_detection_source: preflightContext ? preflightContext.detection_source : null,
        preflight_include_untracked: preflightContext ? !!preflightContext.include_untracked : null,
        preflight_changed_files_count: preflightContext ? preflightContext.changed_files_count : null,
        preflight_changed_lines_total: preflightContext ? preflightContext.changed_lines_total : null,
        preflight_changed_files_sha256: preflightContext ? preflightContext.changed_files_sha256 : null,
        scope_detection_source: workspaceSnapshot ? workspaceSnapshot.detection_source : null,
        scope_use_staged: workspaceSnapshot ? !!workspaceSnapshot.use_staged : null,
        scope_include_untracked: workspaceSnapshot ? !!workspaceSnapshot.include_untracked : null,
        scope_changed_files: workspaceSnapshot ? workspaceSnapshot.changed_files : [],
        scope_changed_files_count: workspaceSnapshot ? workspaceSnapshot.changed_files_count : 0,
        scope_changed_lines_total: workspaceSnapshot ? workspaceSnapshot.changed_lines_total : 0,
        scope_changed_files_sha256: workspaceSnapshot ? workspaceSnapshot.changed_files_sha256 : null,
        scope_sha256: workspaceSnapshot ? workspaceSnapshot.scope_sha256 : null,
        evidence_path: normalizeOptionalPath(compileEvidencePath),
        compile_output_path: normalizeOptionalPath(compileOutputPath),
        output_filters_path: normalizeOptionalPath(outputFiltersPath),
        command_kind: effectiveProfile.kind,
        command_filter_strategy: effectiveProfile.strategy,
        command_profile_label: effectiveProfile.label,
        selected_output_profile: selectedOutputProfile,
        selected_command_index: selectedCommandIndex,
        compile_output_lines: compileOutputLines.length,
        compile_output_warning_lines: warningCount,
        compile_output_error_lines: errorCount,
        duration_ms: durationMs,
        exit_code: exceptionMessage ? exitCode : 0,
        ...outputTelemetry
    };

    if (exceptionMessage) {
        const failureEvent = {
            timestamp_utc: new Date().toISOString(),
            event_type: 'compile_gate_check',
            status: 'FAILED',
            task_id: resolvedTaskId,
            error: exceptionMessage,
            ...gateContext
        };
        gateHelpers.appendMetricsEvent(metricsPath, failureEvent, parseBooleanOption(options.emitMetrics, true));
        writeCompileEvidence(compileEvidencePath, resolvedTaskId, gateContext, 'FAILED', 'FAIL', exceptionMessage);
        appendTaskEvent(orchestratorRoot, resolvedTaskId, 'COMPILE_GATE_FAILED', 'FAIL', 'Compile gate failed.', failureEvent);

        const outputLines = [
            'COMPILE_GATE_FAILED',
            `CompileSummary: FAILED | duration_ms=${durationMs} | exit_code=${exitCode} | errors=${errorCount} | warnings=${warningCount}`
        ];
        if (compileOutputPath) {
            outputLines.push(`CompileOutputPath: ${gateHelpers.normalizePath(compileOutputPath)}`);
        }
        if (filteredOutput.lines.length > 0) {
            if (outputTelemetry.parser_mode === 'FULL' || outputTelemetry.parser_mode === 'DEGRADED') {
                outputLines.push(
                    `CompileOutputCompactSummary: parser=${outputTelemetry.parser_name} mode=${outputTelemetry.parser_mode} strategy=${outputTelemetry.parser_strategy}`
                );
            } else if (outputTelemetry.filter_mode.startsWith('profile:') && outputTelemetry.fallback_mode === 'none') {
                outputLines.push(`CompileOutputFilteredLines: profile=${outputTelemetry.filter_mode}`);
            } else {
                outputLines.push('CompileOutputFilteredLines:');
            }
            outputLines.push(...filteredOutput.lines);
        }
        if (visibleSavingsLine) {
            outputLines.push(visibleSavingsLine);
        }
        outputLines.push(`Reason: ${exceptionMessage}`);
        return { outputLines, exitCode: 1 };
    }

    const successEvent = {
        timestamp_utc: new Date().toISOString(),
        event_type: 'compile_gate_check',
        status: 'PASSED',
        task_id: resolvedTaskId,
        ...gateContext
    };
    gateHelpers.appendMetricsEvent(metricsPath, successEvent, parseBooleanOption(options.emitMetrics, true));
    writeCompileEvidence(compileEvidencePath, resolvedTaskId, gateContext, 'PASSED', 'PASS', null);
    appendTaskEvent(orchestratorRoot, resolvedTaskId, 'COMPILE_GATE_PASSED', 'PASS', 'Compile gate passed.', successEvent);

    const outputLines = [
        'COMPILE_GATE_PASSED',
        `CompileSummary: PASSED | duration_ms=${durationMs} | exit_code=0 | errors=${errorCount} | warnings=${warningCount}`
    ];
    if (compileOutputPath) {
        outputLines.push(`CompileOutputPath: ${gateHelpers.normalizePath(compileOutputPath)}`);
    }
    if (visibleSavingsLine) {
        outputLines.push(visibleSavingsLine);
    }
    return { outputLines, exitCode: 0 };
}

function runDocImpactGateCommand(options) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const orchestratorRoot = resolveOrchestratorRoot(repoRoot);
    const resolvedPreflightPath = gateHelpers.resolvePathInsideRepo(String(options.preflightPath || '').trim(), repoRoot);
    const docsUpdated = expandValueList(options.docsUpdated, { splitDelimiters: false });
    const artifact = assessDocImpact({
        preflightPath: resolvedPreflightPath,
        taskId: String(options.taskId || ''),
        decision: options.decision || 'NO_DOC_UPDATES',
        behaviorChanged: parseBooleanOption(options.behaviorChanged, false),
        changelogUpdated: parseBooleanOption(options.changelogUpdated, false),
        sensitiveReviewed: parseBooleanOption(options.sensitiveScopeReviewed != null ? options.sensitiveScopeReviewed : options.sensitiveReviewed, false),
        docsUpdated,
        rationale: String(options.rationale || ''),
        repoRoot
    });

    const resolvedTaskId = artifact.task_id || null;
    const artifactPath = options.artifactPath
        ? resolvePathForWrite(options.artifactPath, repoRoot)
        : (resolvedTaskId ? resolveDefaultReviewsPath(repoRoot, `${resolvedTaskId}-doc-impact.json`) : null);
    if (artifactPath) {
        writeJsonArtifact(artifactPath, artifact);
    }

    const metricsPath = options.metricsPath
        ? resolvePathForWrite(options.metricsPath, repoRoot)
        : resolveDefaultMetricsPath(repoRoot);
    gateHelpers.appendMetricsEvent(metricsPath, {
        timestamp_utc: new Date().toISOString(),
        event_type: 'doc_impact_gate_check',
        status: artifact.status,
        task_id: resolvedTaskId,
        artifact_path: normalizeOptionalPath(artifactPath),
        artifact
    }, parseBooleanOption(options.emitMetrics, true));

    if (resolvedTaskId) {
        appendTaskEvent(
            orchestratorRoot,
            resolvedTaskId,
            artifact.violations.length > 0 ? 'DOC_IMPACT_ASSESSMENT_FAILED' : 'DOC_IMPACT_ASSESSED',
            artifact.outcome,
            artifact.violations.length > 0 ? 'Doc impact gate failed.' : 'Doc impact gate passed.',
            artifact
        );
    }

    if (artifact.violations.length > 0) {
        return {
            outputLines: [
                'DOC_IMPACT_GATE_FAILED',
                'Violations:',
                ...artifact.violations.map(function (item) { return `- ${item}`; })
            ],
            exitCode: 1
        };
    }

    const outputLines = ['DOC_IMPACT_GATE_PASSED'];
    if (artifactPath) {
        outputLines.push(`DocImpactArtifactPath: ${gateHelpers.normalizePath(artifactPath)}`);
    }
    return { outputLines, exitCode: 0 };
}

function runLogTaskEventCommand(options) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const orchestratorRoot = resolveOrchestratorRoot(repoRoot);
    const eventsRoot = options.eventsRoot
        ? resolvePathForWrite(options.eventsRoot, repoRoot)
        : gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'task-events'));
    const taskId = assertValidTaskId(String(options.taskId || '').trim());
    const eventType = String(options.eventType || '').trim();
    const outcome = String(options.outcome || 'INFO').trim().toUpperCase();
    const actor = String(options.actor || 'orchestrator').trim() || 'orchestrator';
    const message = String(options.message || '');
    const details = parseJsonOption(options.detailsJson || '', 'DetailsJson');

    if (!eventType) {
        throw new Error('EventType must not be empty.');
    }
    if (!['INFO', 'PASS', 'FAIL', 'BLOCKED'].includes(outcome)) {
        throw new Error(`Outcome must be one of INFO, PASS, FAIL, BLOCKED. Got '${outcome}'.`);
    }
    if (/^(COMPILE_GATE_|REVIEW_GATE_|PREFLIGHT_)/.test(eventType)) {
        throw new Error(`EventType '${eventType}' is reserved and cannot be emitted via log-task-event.`);
    }

    fs.mkdirSync(eventsRoot, { recursive: true });

    let eventDetails = details;
    let terminalLogCleanup = {
        triggered: false,
        attempted_paths: 0,
        discovered_paths: [],
        deleted_paths: [],
        missing_paths: [],
        errors: []
    };
    const isTerminalEvent = eventType === 'TASK_DONE' || eventType === 'TASK_BLOCKED';
    if (isTerminalEvent) {
        terminalLogCleanup = cleanupTerminalCompileLogs(repoRoot, taskId);
        const detailsMap = toDetailsMap(eventDetails);
        detailsMap.terminal_log_cleanup = terminalLogCleanup;
        eventDetails = detailsMap;
    }

    let commandCompactnessAudit = null;
    const auditPayload = getCommandAuditPayload(eventDetails);
    if (auditPayload) {
        commandCompactnessAudit = auditCommandCompactness(auditPayload.command_text, {
            mode: auditPayload.mode,
            justification: auditPayload.justification
        });
        const detailsMap = toDetailsMap(eventDetails);
        detailsMap.command_policy_audit = commandCompactnessAudit;
        eventDetails = detailsMap;
    }

    const appendResult = appendTaskEvent(
        orchestratorRoot,
        taskId,
        eventType,
        outcome,
        message,
        eventDetails,
        {
            actor,
            passThru: true,
            eventsRoot
        }
    );
    const result = {
        status: 'TASK_EVENT_LOGGED',
        task_id: taskId,
        event_type: eventType,
        outcome,
        actor,
        task_event_log_path: gateHelpers.normalizePath(path.join(eventsRoot, `${taskId}.jsonl`)),
        all_tasks_log_path: gateHelpers.normalizePath(path.join(eventsRoot, 'all-tasks.jsonl'))
    };

    if (appendResult && isPlainObject(appendResult.integrity)) {
        result.integrity = appendResult.integrity;
    }
    if (appendResult && Array.isArray(appendResult.warnings) && appendResult.warnings.length > 0) {
        result.warnings = [...appendResult.warnings];
    }
    if (commandCompactnessAudit) {
        result.command_policy_audit = commandCompactnessAudit;
        if (commandCompactnessAudit.warning_count > 0) {
            result.warnings = [...(result.warnings || []), ...(commandCompactnessAudit.warnings || [])];
        }
    }
    if (isTerminalEvent) {
        result.terminal_log_cleanup = terminalLogCleanup;
    }

    const cleanupFailed = isTerminalEvent && terminalLogCleanup.errors.length > 0;
    if (cleanupFailed) {
        result.status = 'TASK_EVENT_LOGGED_CLEANUP_FAILED';
    }

    return {
        outputText: `${JSON.stringify(result, null, 2)}\n`,
        exitCode: cleanupFailed ? 1 : 0
    };
}

function resolveReviewContextPath(reviewsRoot, taskId, reviewKey) {
    const preferred = path.join(reviewsRoot, `${taskId}-${reviewKey}-review-context.json`);
    if (fs.existsSync(preferred) && fs.statSync(preferred).isFile()) {
        return preferred;
    }
    return path.join(reviewsRoot, `${taskId}-${reviewKey}-context.json`);
}

function testReviewArtifacts(repoRoot, resolvedTaskId, requiredReviews, verdicts, skipReviewsList, reviewsRootValue) {
    const reviewsRoot = reviewsRootValue
        ? gateHelpers.resolvePathInsideRepo(reviewsRootValue, repoRoot, { allowMissing: true })
        : gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'reviews'));
    const result = {
        reviews_root: gateHelpers.normalizePath(reviewsRoot),
        checked: [],
        violations: [],
        compaction_warnings: [],
        compaction_warning_count: 0
    };
    const skipSet = new Set(skipReviewsList.map(function (item) { return String(item || '').toLowerCase(); }));

    for (const [reviewKey, passToken] of REVIEW_CONTRACTS) {
        if (!requiredReviews[reviewKey]) {
            continue;
        }
        const actualVerdict = verdicts[reviewKey] || 'NOT_REQUIRED';
        if (actualVerdict !== passToken || skipSet.has(reviewKey)) {
            continue;
        }

        const artifactPath = path.join(reviewsRoot, `${resolvedTaskId}-${reviewKey}.md`);
        const entry = {
            review: reviewKey,
            path: gateHelpers.normalizePath(artifactPath),
            pass_token: passToken,
            present: false,
            token_found: false,
            sha256: null,
            review_context_path: null,
            review_context_present: false,
            review_context_valid: false,
            compaction_audit: null
        };

        if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
            result.violations.push(`Review artifact not found for claimed '${passToken}': ${entry.path}`);
            result.checked.push(entry);
            continue;
        }

        entry.present = true;
        entry.sha256 = gateHelpers.fileSha256(artifactPath);
        const content = fs.readFileSync(artifactPath, 'utf8');
        entry.token_found = content.includes(passToken);
        if (!entry.token_found) {
            result.violations.push(`Review artifact '${entry.path}' does not contain pass token '${passToken}'.`);
        }

        const reviewContextPath = resolveReviewContextPath(reviewsRoot, resolvedTaskId, reviewKey);
        entry.review_context_path = gateHelpers.normalizePath(reviewContextPath);
        let reviewContext = null;
        if (fs.existsSync(reviewContextPath) && fs.statSync(reviewContextPath).isFile()) {
            entry.review_context_present = true;
            try {
                reviewContext = JSON.parse(fs.readFileSync(reviewContextPath, 'utf8'));
                entry.review_context_valid = true;
            } catch (error) {
                result.compaction_warnings.push(
                    `Review context artifact '${entry.review_context_path}' is invalid JSON: ${String((error && error.message) || error)}`
                );
            }
        }

        const compactionAudit = auditReviewArtifactCompaction({
            artifactPath: entry.path,
            content,
            reviewContext
        });
        entry.compaction_audit = compactionAudit;
        if (compactionAudit.warning_count > 0) {
            result.compaction_warnings.push(...compactionAudit.warnings);
        }

        result.checked.push(entry);
    }

    result.compaction_warning_count = result.compaction_warnings.length;
    return result;
}

function getCompileGateEvidence(repoRoot, resolvedTaskId, preflightPathValue, preflightHashValue, compileEvidencePathValue) {
    const result = {
        task_id: resolvedTaskId,
        evidence_path: null,
        evidence_hash: null,
        evidence_status: null,
        evidence_outcome: null,
        evidence_task_id: null,
        evidence_preflight_path: null,
        evidence_preflight_hash: null,
        evidence_source: null,
        evidence_scope_detection_source: null,
        evidence_scope_include_untracked: null,
        evidence_scope_changed_files: [],
        evidence_scope_changed_files_count: 0,
        evidence_scope_changed_lines_total: 0,
        evidence_scope_changed_files_sha256: null,
        evidence_scope_sha256: null,
        status: 'UNKNOWN'
    };

    if (!resolvedTaskId) {
        result.status = 'TASK_ID_MISSING';
        return result;
    }

    const resolvedEvidencePath = compileEvidencePathValue
        ? gateHelpers.resolvePathInsideRepo(compileEvidencePathValue, repoRoot, { allowMissing: true })
        : resolveDefaultReviewsPath(repoRoot, `${resolvedTaskId}-compile-gate.json`);
    result.evidence_path = gateHelpers.normalizePath(resolvedEvidencePath);

    if (!fs.existsSync(resolvedEvidencePath) || !fs.statSync(resolvedEvidencePath).isFile()) {
        result.status = 'EVIDENCE_FILE_MISSING';
        return result;
    }

    result.evidence_hash = gateHelpers.fileSha256(resolvedEvidencePath);

    let evidenceObject;
    try {
        evidenceObject = JSON.parse(fs.readFileSync(resolvedEvidencePath, 'utf8'));
    } catch (_error) {
        result.status = 'EVIDENCE_INVALID_JSON';
        return result;
    }

    result.evidence_task_id = String(evidenceObject.task_id || '');
    result.evidence_status = String(evidenceObject.status || '');
    result.evidence_outcome = String(evidenceObject.outcome || '');
    result.evidence_preflight_path = gateHelpers.normalizePath(String(evidenceObject.preflight_path || ''));
    result.evidence_preflight_hash = String(evidenceObject.preflight_hash_sha256 || '');
    result.evidence_source = String(evidenceObject.event_source || '');
    result.evidence_scope_detection_source = String(evidenceObject.scope_detection_source || '');
    result.evidence_scope_include_untracked = evidenceObject.scope_include_untracked == null ? true : !!evidenceObject.scope_include_untracked;
    result.evidence_scope_changed_files = expandValueList(evidenceObject.scope_changed_files || [], { splitDelimiters: false });
    result.evidence_scope_changed_files_count = Number.parseInt(evidenceObject.scope_changed_files_count || 0, 10) || 0;
    result.evidence_scope_changed_lines_total = Number.parseInt(evidenceObject.scope_changed_lines_total || 0, 10) || 0;
    result.evidence_scope_changed_files_sha256 = String(evidenceObject.scope_changed_files_sha256 || '');
    result.evidence_scope_sha256 = String(evidenceObject.scope_sha256 || '');

    if (result.evidence_task_id.trim() !== resolvedTaskId) {
        result.status = 'EVIDENCE_TASK_MISMATCH';
        return result;
    }
    if (result.evidence_source.trim().toLowerCase() !== 'compile-gate') {
        result.status = 'EVIDENCE_SOURCE_INVALID';
        return result;
    }
    if (result.evidence_preflight_hash.trim().toLowerCase() !== String(preflightHashValue || '').trim().toLowerCase()) {
        result.status = 'EVIDENCE_PREFLIGHT_HASH_MISMATCH';
        return result;
    }
    if (result.evidence_preflight_path) {
        const expectedPreflightPath = gateHelpers.normalizePath(preflightPathValue);
        if (result.evidence_preflight_path.toLowerCase() !== expectedPreflightPath.toLowerCase()) {
            result.status = 'EVIDENCE_PREFLIGHT_PATH_MISMATCH';
            return result;
        }
    }
    if (!result.evidence_scope_detection_source || !result.evidence_scope_changed_files_sha256 || !result.evidence_scope_sha256) {
        result.status = 'EVIDENCE_SCOPE_MISSING';
        return result;
    }
    if (result.evidence_status.trim().toUpperCase() === 'PASSED' && result.evidence_outcome.trim().toUpperCase() === 'PASS') {
        result.status = 'PASS';
        return result;
    }
    result.status = 'EVIDENCE_NOT_PASS';
    return result;
}

function testCompileScopeDrift(repoRoot, compileEvidence) {
    const result = {
        status: 'UNKNOWN',
        detection_source: null,
        include_untracked: null,
        current_scope: null,
        evidence_scope_sha256: null,
        evidence_changed_files_sha256: null,
        evidence_changed_lines_total: null,
        violations: []
    };

    if (!compileEvidence || !compileEvidence.evidence_scope_detection_source) {
        result.status = 'EVIDENCE_SCOPE_MISSING';
        result.violations.push('Compile gate evidence does not include scope snapshot.');
        return result;
    }

    const snapshot = getWorkspaceSnapshot(
        repoRoot,
        compileEvidence.evidence_scope_detection_source,
        !!compileEvidence.evidence_scope_include_untracked,
        compileEvidence.evidence_scope_changed_files
    );
    result.status = 'PASS';
    result.detection_source = compileEvidence.evidence_scope_detection_source;
    result.include_untracked = !!compileEvidence.evidence_scope_include_untracked;
    result.current_scope = snapshot;
    result.evidence_scope_sha256 = compileEvidence.evidence_scope_sha256;
    result.evidence_changed_files_sha256 = compileEvidence.evidence_scope_changed_files_sha256;
    result.evidence_changed_lines_total = compileEvidence.evidence_scope_changed_lines_total;

    if (compileEvidence.evidence_scope_sha256 !== snapshot.scope_sha256) {
        result.violations.push('Workspace scope fingerprint changed after compile gate.');
    }
    if (compileEvidence.evidence_scope_changed_files_sha256 !== snapshot.changed_files_sha256) {
        result.violations.push('Workspace changed_files fingerprint differs from compile evidence.');
    }
    if (compileEvidence.evidence_scope_changed_lines_total !== snapshot.changed_lines_total) {
        result.violations.push(
            `Workspace changed_lines_total=${snapshot.changed_lines_total} differs from compile evidence changed_lines_total=${compileEvidence.evidence_scope_changed_lines_total}.`
        );
    }
    if (result.violations.length > 0) {
        result.status = 'DRIFT_DETECTED';
    }
    return result;
}

function writeReviewEvidence(evidencePath, resolvedTaskId, context, status, outcome, violations) {
    if (!evidencePath || !resolvedTaskId) {
        return;
    }
    writeJsonArtifact(evidencePath, {
        timestamp_utc: new Date().toISOString(),
        event_source: 'required-reviews-check',
        task_id: resolvedTaskId,
        status,
        outcome,
        violations: violations || [],
        ...context
    });
}

function runRequiredReviewsCheckCommand(options) {
    const repoRoot = path.resolve(String(options.repoRoot || '.'));
    const orchestratorRoot = resolveOrchestratorRoot(repoRoot);
    const resolvedPreflightPath = gateHelpers.resolvePathInsideRepo(String(options.preflightPath || '').trim(), repoRoot);
    const validatedBase = validatePreflightForReview(resolvedPreflightPath, String(options.taskId || ''));
    const preflight = validatedBase.preflight || {};
    const validatedPreflight = {
        ...validatedBase,
        mode: String(preflight.mode || 'FULL_PATH').trim() || 'FULL_PATH',
        changed_files_count: Array.isArray(preflight.changed_files) ? preflight.changed_files.length : 0,
        changed_lines_total: preflight.metrics && typeof preflight.metrics.changed_lines_total === 'number'
            ? preflight.metrics.changed_lines_total
            : 0
    };

    const resolvedTaskId = validatedPreflight.resolved_task_id;
    const metricsPath = options.metricsPath
        ? resolvePathForWrite(options.metricsPath, repoRoot)
        : resolveDefaultMetricsPath(repoRoot);
    const outputFiltersPath = resolveOutputFiltersPath(repoRoot, options.outputFiltersPath || '');
    const skipReviewsList = parseSkipReviews(options.skipReviews || '');
    const verdicts = {
        code: options.codeReviewVerdict || 'NOT_REQUIRED',
        db: options.dbReviewVerdict || 'NOT_REQUIRED',
        security: options.securityReviewVerdict || 'NOT_REQUIRED',
        refactor: options.refactorReviewVerdict || 'NOT_REQUIRED',
        api: options.apiReviewVerdict || 'NOT_REQUIRED',
        test: options.testReviewVerdict || 'NOT_REQUIRED',
        performance: options.performanceReviewVerdict || 'NOT_REQUIRED',
        infra: options.infraReviewVerdict || 'NOT_REQUIRED',
        dependency: options.dependencyReviewVerdict || 'NOT_REQUIRED'
    };

    const compileGateEvidence = getCompileGateEvidence(
        repoRoot,
        resolvedTaskId,
        validatedPreflight.preflight_path,
        validatedPreflight.preflight_hash,
        options.compileEvidencePath || ''
    );
    const scopeDrift = compileGateEvidence.status === 'PASS'
        ? testCompileScopeDrift(repoRoot, compileGateEvidence)
        : null;

    const errors = [...validatedPreflight.errors];
    for (const skipItem of skipReviewsList) {
        if (skipItem !== 'code') {
            errors.push(`Unsupported skip-review value '${skipItem}'. Allowed values: code.`);
        }
    }

    const skipReason = String(options.skipReason || '').trim();
    if (skipReviewsList.length > 0 && !skipReason) {
        errors.push('Skip-review override requires --skip-reason.');
    }
    if (skipReason && skipReason.length < 12) {
        errors.push('Skip-review reason is too short. Provide a concrete justification (>= 12 chars).');
    }

    switch (compileGateEvidence.status) {
        case 'TASK_ID_MISSING':
            errors.push('Compile gate evidence cannot be verified: task id is missing.');
            break;
        case 'EVIDENCE_FILE_MISSING':
            errors.push(`Compile gate evidence missing: file not found at '${compileGateEvidence.evidence_path}'. Run compile-gate first.`);
            break;
        case 'EVIDENCE_INVALID_JSON':
            errors.push(`Compile gate evidence is invalid JSON at '${compileGateEvidence.evidence_path}'. Re-run compile-gate.`);
            break;
        case 'EVIDENCE_TASK_MISMATCH':
            errors.push(`Compile gate evidence task mismatch. Expected '${resolvedTaskId}', got '${compileGateEvidence.evidence_task_id}'.`);
            break;
        case 'EVIDENCE_SOURCE_INVALID':
            errors.push(`Compile gate evidence source is invalid. Expected 'compile-gate', got '${compileGateEvidence.evidence_source}'.`);
            break;
        case 'EVIDENCE_PREFLIGHT_HASH_MISMATCH':
            errors.push('Compile gate evidence preflight hash mismatch. Re-run compile-gate for the current preflight artifact.');
            break;
        case 'EVIDENCE_PREFLIGHT_PATH_MISMATCH':
            errors.push(`Compile gate evidence preflight path mismatch. Evidence path='${compileGateEvidence.evidence_preflight_path}'.`);
            break;
        case 'EVIDENCE_SCOPE_MISSING':
            errors.push('Compile gate evidence is missing scope snapshot fields. Re-run compile-gate.');
            break;
        case 'EVIDENCE_NOT_PASS':
            errors.push(`Compile gate did not pass. Evidence status='${compileGateEvidence.evidence_status}', outcome='${compileGateEvidence.evidence_outcome}'.`);
            break;
        default:
            break;
    }

    if (scopeDrift) {
        if (scopeDrift.status === 'EVIDENCE_SCOPE_MISSING') {
            errors.push(...scopeDrift.violations);
        } else if (scopeDrift.status === 'DRIFT_DETECTED') {
            errors.push('Workspace changed after compile gate; rerun compile-gate before review gate.');
            errors.push(...scopeDrift.violations);
        }
    }

    const required = validatedPreflight.required_reviews;
    const skipCode = skipReviewsList.includes('code');
    const canSkipCode = !!required.code
        && !required.db
        && !required.security
        && !required.refactor
        && !required.api
        && !required.test
        && !required.performance
        && !required.infra
        && !required.dependency
        && validatedPreflight.changed_files_count <= 1
        && validatedPreflight.changed_lines_total <= 8;

    if (skipCode && !canSkipCode) {
        errors.push('Code review override is not allowed for this change scope. Allowed only for tiny low-risk code changes (<=1 file and <=8 changed lines, with no specialized reviews).');
    }
    if (skipCode && !required.code) {
        errors.push('Code review override was requested but code review is not required by preflight.');
    }

    const artifactEvidence = testReviewArtifacts(
        repoRoot,
        resolvedTaskId,
        required,
        verdicts,
        skipReviewsList,
        options.reviewsRoot || ''
    );

    const baseResult = checkRequiredReviews({
        validatedPreflight: { ...validatedPreflight, errors },
        verdicts,
        skipReviews: skipReviewsList,
        compileGateEvidence: compileGateEvidence.status === 'PASS' ? { status: 'PASSED' } : null,
        reviewArtifacts: {}
    });
    const allViolations = [...baseResult.violations, ...artifactEvidence.violations];
    const status = allViolations.length > 0 ? 'FAILED' : 'PASSED';
    const reviewEvidencePath = options.reviewEvidencePath
        ? resolvePathForWrite(options.reviewEvidencePath, repoRoot)
        : (resolvedTaskId ? resolveDefaultReviewsPath(repoRoot, `${resolvedTaskId}-review-gate.json`) : null);

    let overrideArtifactPath = options.overrideArtifactPath
        ? resolvePathForWrite(options.overrideArtifactPath, repoRoot)
        : '';

    if (status === 'PASSED' && skipCode && resolvedTaskId) {
        if (!overrideArtifactPath) {
            const preflightDir = path.dirname(validatedPreflight.preflight_path);
            const preflightName = path.basename(validatedPreflight.preflight_path, path.extname(validatedPreflight.preflight_path));
            const baseName = preflightName.replace(/-preflight$/i, '');
            overrideArtifactPath = path.join(preflightDir, `${baseName}-override.json`);
        }
        writeJsonArtifact(overrideArtifactPath, {
            timestamp_utc: new Date().toISOString(),
            preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
            mode: validatedPreflight.mode,
            skipped_reviews: ['code'],
            reason: skipReason,
            guardrails: {
                required_db: !!required.db,
                required_security: !!required.security,
                required_refactor: !!required.refactor,
                required_api: !!required.api,
                required_test: !!required.test,
                required_performance: !!required.performance,
                required_infra: !!required.infra,
                required_dependency: !!required.dependency,
                changed_files_count: validatedPreflight.changed_files_count,
                changed_lines_total: validatedPreflight.changed_lines_total
            }
        });
    }

    const reviewEvidenceContext = {
        preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
        preflight_hash_sha256: validatedPreflight.preflight_hash,
        mode: validatedPreflight.mode,
        compile_evidence_path: compileGateEvidence.evidence_path,
        compile_evidence_hash_sha256: compileGateEvidence.evidence_hash,
        output_filters_path: normalizeOptionalPath(outputFiltersPath),
        scope_drift: scopeDrift,
        required_reviews: baseResult.required_reviews,
        verdicts,
        review_checks: baseResult.review_checks,
        skip_reviews: skipReviewsList,
        skip_reason: skipReason,
        override_artifact: normalizeOptionalPath(overrideArtifactPath),
        artifact_evidence: artifactEvidence
    };

    if (status === 'FAILED') {
        const failureOutputLines = [
            'REVIEW_GATE_FAILED',
            `Mode: ${validatedPreflight.mode}`,
            'Violations:',
            ...allViolations.map(function (item) { return `- ${item}`; })
        ];
        const filteredFailureOutput = applyOutputFilterProfile(failureOutputLines, outputFiltersPath, 'review_gate_failure_console');
        const failureTelemetry = buildOutputTelemetry(failureOutputLines, filteredFailureOutput.lines, {
            filterMode: filteredFailureOutput.filter_mode,
            fallbackMode: filteredFailureOutput.fallback_mode,
            parserMode: filteredFailureOutput.parser_mode,
            parserName: filteredFailureOutput.parser_name,
            parserStrategy: filteredFailureOutput.parser_strategy
        });
        const failureVisibleSavingsLine = formatVisibleSavingsLine(failureTelemetry);
        reviewEvidenceContext.output_telemetry = failureTelemetry;
        writeReviewEvidence(reviewEvidencePath, resolvedTaskId, reviewEvidenceContext, 'FAILED', 'FAIL', allViolations);

        const failureEvent = {
            timestamp_utc: new Date().toISOString(),
            event_type: 'review_gate_check',
            status: 'FAILED',
            task_id: resolvedTaskId,
            review_evidence_path: normalizeOptionalPath(reviewEvidencePath),
            preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
            mode: validatedPreflight.mode,
            skip_reviews: skipReviewsList,
            skip_reason: skipReason,
            output_filters_path: normalizeOptionalPath(outputFiltersPath),
            compile_gate: compileGateEvidence,
            artifact_evidence: artifactEvidence,
            violations: allViolations,
            ...failureTelemetry
        };
        gateHelpers.appendMetricsEvent(metricsPath, failureEvent, parseBooleanOption(options.emitMetrics, true));
        if (resolvedTaskId) {
            appendTaskEvent(orchestratorRoot, resolvedTaskId, 'REVIEW_GATE_FAILED', 'FAIL', 'Required reviews gate failed.', {
                review_evidence_path: normalizeOptionalPath(reviewEvidencePath),
                preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
                mode: validatedPreflight.mode,
                skip_reviews: skipReviewsList,
                skip_reason: skipReason,
                compile_gate: compileGateEvidence,
                artifact_evidence: artifactEvidence,
                violations: allViolations
            });
        }

        const outputLines = [...filteredFailureOutput.lines];
        if (failureVisibleSavingsLine) {
            outputLines.push(failureVisibleSavingsLine);
        }
        return { outputLines, exitCode: 1 };
    }

    const successOutputLines = skipCode
        ? [
            'REVIEW_GATE_PASSED_WITH_OVERRIDE',
            `Mode: ${validatedPreflight.mode}`,
            'SkippedReviews: code',
            ...(overrideArtifactPath ? [`OverrideArtifact: ${gateHelpers.normalizePath(overrideArtifactPath)}`] : [])
        ]
        : [
            'REVIEW_GATE_PASSED',
            `Mode: ${validatedPreflight.mode}`
        ];
    if (artifactEvidence.compaction_warning_count > 0) {
        successOutputLines.push(`CompactionWarnings: ${artifactEvidence.compaction_warning_count}`);
    }
    const filteredSuccessOutput = applyOutputFilterProfile(successOutputLines, outputFiltersPath, 'review_gate_success_console');
    const successTelemetry = buildOutputTelemetry(successOutputLines, filteredSuccessOutput.lines, {
        filterMode: filteredSuccessOutput.filter_mode,
        fallbackMode: filteredSuccessOutput.fallback_mode,
        parserMode: filteredSuccessOutput.parser_mode,
        parserName: filteredSuccessOutput.parser_name,
        parserStrategy: filteredSuccessOutput.parser_strategy
    });
    const successVisibleSavingsLine = formatVisibleSavingsLine(successTelemetry);
    reviewEvidenceContext.output_telemetry = successTelemetry;
    writeReviewEvidence(reviewEvidencePath, resolvedTaskId, reviewEvidenceContext, 'PASSED', 'PASS', []);

    const successEvent = {
        timestamp_utc: new Date().toISOString(),
        event_type: 'review_gate_check',
        status: 'PASSED',
        task_id: resolvedTaskId,
        review_evidence_path: normalizeOptionalPath(reviewEvidencePath),
        preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
        mode: validatedPreflight.mode,
        skip_reviews: skipReviewsList,
        skip_reason: skipReason,
        output_filters_path: normalizeOptionalPath(outputFiltersPath),
        compile_gate: compileGateEvidence,
        override_artifact: normalizeOptionalPath(overrideArtifactPath),
        artifact_evidence: artifactEvidence,
        ...successTelemetry
    };
    gateHelpers.appendMetricsEvent(metricsPath, successEvent, parseBooleanOption(options.emitMetrics, true));
    if (resolvedTaskId) {
        appendTaskEvent(
            orchestratorRoot,
            resolvedTaskId,
            skipCode ? 'REVIEW_GATE_PASSED_WITH_OVERRIDE' : 'REVIEW_GATE_PASSED',
            'PASS',
            skipCode ? 'Required reviews gate passed with audited override.' : 'Required reviews gate passed.',
            {
                review_evidence_path: normalizeOptionalPath(reviewEvidencePath),
                preflight_path: gateHelpers.normalizePath(validatedPreflight.preflight_path),
                mode: validatedPreflight.mode,
                skip_reviews: skipReviewsList,
                skip_reason: skipReason,
                compile_gate: compileGateEvidence,
                override_artifact: normalizeOptionalPath(overrideArtifactPath),
                artifact_evidence: artifactEvidence
            }
        );
    }

    const outputLines = [...filteredSuccessOutput.lines];
    if (successVisibleSavingsLine) {
        outputLines.push(successVisibleSavingsLine);
    }
    return { outputLines, exitCode: 0 };
}

function runHumanCommitCommand(gitArgs, options = {}) {
    const finalArgs = toStringArray(gitArgs).filter(function (item) {
        return String(item || '').trim() !== '';
    });
    if (finalArgs.length === 0) {
        throw new Error('Provide git commit arguments, for example: -m "feat: message"');
    }

    const result = childProcess.spawnSync('git', ['commit', ...finalArgs], {
        cwd: options.cwd || process.cwd(),
        windowsHide: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            OCTOPUS_ALLOW_COMMIT: '1'
        }
    });

    if (result.error) {
        if (result.error.code === 'ENOENT') {
            throw new Error('git is required but was not found in PATH.');
        }
        throw result.error;
    }

    return result.status == null ? 1 : result.status;
}

module.exports = {
    executeCommand,
    resolveExecutablePath,
    runClassifyChangeCommand,
    runCompileGateCommand,
    runDocImpactGateCommand,
    runHumanCommitCommand,
    runLogTaskEventCommand,
    runRequiredReviewsCheckCommand,
    splitCommandLine
};
