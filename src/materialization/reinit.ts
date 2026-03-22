const fs = require('node:fs');
const path = require('node:path');

const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../core/json.ts');
const { validateInitAnswers, serializeInitAnswers } = require('../schemas/init-answers.ts');
const {
    getCanonicalEntrypointFile,
    getActiveAgentEntrypointFiles,
    convertActiveAgentEntrypointFilesToString
} = require('./common.ts');
const { applyAssistantDefaults } = require('./rule-materialization.ts');
const { runInstall } = require('./install.ts');

/**
 * Runs the reinit pipeline.
 * Node implementation of the reinit lifecycle.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root
 * @param {string} options.bundleRoot - Orchestrator bundle dir
 * @param {string} [options.initAnswersPath] - Relative or absolute path to init-answers.json
 * @param {object} [options.overrides] - CLI parameter overrides for answers
 * @param {boolean} [options.skipVerify=false]
 * @param {boolean} [options.skipManifestValidation=false]
 * @returns {object} Reinit result
 */
function runReinit(options) {
    const {
        targetRoot,
        bundleRoot,
        initAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
        overrides = {},
        skipVerify = false,
        skipManifestValidation = false
    } = options;

    const sourceRoot = path.join(bundleRoot, 'template');
    if (!pathExists(sourceRoot)) {
        throw new Error(`Template directory not found: ${sourceRoot}`);
    }

    // Validate target root
    const normalizedTarget = path.resolve(targetRoot);
    const normalizedBundle = path.resolve(bundleRoot);
    if (normalizedTarget.toLowerCase() === normalizedBundle.toLowerCase()) {
        throw new Error(
            `TargetRoot points to orchestrator bundle directory '${bundleRoot}'. Use the project root parent directory instead.`
        );
    }

    // Resolve init answers path
    const resolvedInitPath = path.isAbsolute(initAnswersPath)
        ? initAnswersPath
        : path.resolve(targetRoot, initAnswersPath);

    // Load existing answers if present
    let existingAnswers = null;
    if (pathExists(resolvedInitPath)) {
        try {
            existingAnswers = readJsonFile(resolvedInitPath);
        } catch {
            existingAnswers = null;
        }
    }

    // Load existing live/version.json for inference
    const liveVersionPath = path.join(bundleRoot, 'live', 'version.json');
    let existingLiveVersion = null;
    if (pathExists(liveVersionPath)) {
        try {
            existingLiveVersion = readJsonFile(liveVersionPath);
        } catch {
            existingLiveVersion = null;
        }
    }

    // Load existing token-economy config
    const tokenEconomyConfigPath = path.join(bundleRoot, 'live', 'config', 'token-economy.json');
    let existingTokenEconomyConfig = null;
    if (pathExists(tokenEconomyConfigPath)) {
        try {
            existingTokenEconomyConfig = readJsonFile(tokenEconomyConfigPath);
        } catch {
            existingTokenEconomyConfig = null;
        }
    }

    // Recollect init answers (apply overrides, preserve existing, use defaults)
    const changes = [];
    const initAnswers = recollectInitAnswers({
        existingAnswers,
        liveVersion: existingLiveVersion,
        tokenEconomyConfig: existingTokenEconomyConfig,
        overrides,
        changes
    });

    // Validate final answers
    const validated = validateInitAnswers(initAnswers);
    const resolvedLanguage = validated.AssistantLanguage;
    const resolvedBrevity = validated.AssistantBrevity;
    const resolvedSourceOfTruth = validated.SourceOfTruth;
    const resolvedEnforceNoAutoCommit = validated.EnforceNoAutoCommit;
    const resolvedClaudeOrchestratorFullAccess = validated.ClaudeOrchestratorFullAccess;
    const resolvedTokenEconomyEnabled = validated.TokenEconomyEnabled;

    // Resolve active agent files
    let existingActiveAgentFiles = getOptionalValue(existingAnswers, 'ActiveAgentFiles');
    if (!existingActiveAgentFiles) {
        existingActiveAgentFiles = getOptionalValue(existingLiveVersion, 'ActiveAgentFiles');
    }
    if (!existingActiveAgentFiles) {
        let entrypoint = getOptionalValue(existingLiveVersion, 'CanonicalEntrypoint');
        if (!entrypoint) {
            const sot = getOptionalValue(existingLiveVersion, 'SourceOfTruth');
            if (sot) {
                try { entrypoint = getCanonicalEntrypointFile(sot); } catch { /* ignore */ }
            }
        }
        if (entrypoint) existingActiveAgentFiles = entrypoint;
    }

    const resolvedActiveFiles = getActiveAgentEntrypointFiles(existingActiveAgentFiles, resolvedSourceOfTruth);
    const resolvedActiveAgentFilesStr = convertActiveAgentEntrypointFilesToString(resolvedActiveFiles);

    // Prepare serializable answers
    const serializedAnswers = serializeInitAnswers({
        ...initAnswers,
        ActiveAgentFiles: resolvedActiveAgentFilesStr || undefined
    });

    // Validate git dir if enforceNoAutoCommit
    if (resolvedEnforceNoAutoCommit) {
        const gitDir = path.join(targetRoot, '.git');
        if (!pathExists(gitDir)) {
            throw new Error(
                `EnforceNoAutoCommit=true but .git directory is missing at '${gitDir}'. Initialize git or rerun reinit with EnforceNoAutoCommit=false.`
            );
        }
    }

    // Write init answers
    ensureDirectory(path.dirname(resolvedInitPath));
    writeJsonFile(resolvedInitPath, serializedAnswers);

    // Update core rule file
    const coreRuleUpdated = updateCoreRuleFile(bundleRoot, sourceRoot, resolvedLanguage, resolvedBrevity);

    // Update token economy config
    const tokenEconomyUpdated = updateTokenEconomyConfig(bundleRoot, sourceRoot, resolvedTokenEconomyEnabled);

    // Run answer-dependent install pass
    runInstall({
        targetRoot,
        bundleRoot,
        preserveExisting: true,
        alignExisting: true,
        runInit: false,
        answerDependentOnly: true,
        skipBackups: true,
        assistantLanguage: resolvedLanguage,
        assistantBrevity: resolvedBrevity,
        sourceOfTruth: resolvedSourceOfTruth,
        initAnswersPath: resolvedInitPath
    });

    const canonicalEntrypoint = getCanonicalEntrypointFile(resolvedSourceOfTruth);

    return {
        targetRoot: normalizedTarget,
        initAnswersPath: resolvedInitPath,
        interactivePrompting: false,
        changes,
        assistantLanguage: resolvedLanguage,
        assistantBrevity: resolvedBrevity,
        sourceOfTruth: resolvedSourceOfTruth,
        canonicalEntrypoint,
        activeAgentFiles: resolvedActiveAgentFilesStr || 'n/a',
        enforceNoAutoCommit: resolvedEnforceNoAutoCommit,
        claudeOrchestratorFullAccess: resolvedClaudeOrchestratorFullAccess,
        tokenEconomyEnabled: resolvedTokenEconomyEnabled,
        coreRuleUpdated,
        tokenEconomyConfigUpdated: tokenEconomyUpdated.updated,
        tokenEconomyConfigPath: tokenEconomyUpdated.path,
        verifyStatus: skipVerify ? 'SKIPPED' : 'NOT_RUN',
        manifestValidationStatus: skipManifestValidation ? 'SKIPPED' : 'NOT_RUN'
    };
}

/**
 * Recollects init answers, applying overrides and preserving existing values.
 */
function recollectInitAnswers(opts) {
    const { existingAnswers, liveVersion, tokenEconomyConfig, overrides = {}, changes = [] } = opts;

    const schema = getInitAnswerSchema();
    const result = {};

    for (const def of schema) {
        const key = def.key;

        // Check override
        if (overrides[key] !== undefined && overrides[key] !== null && String(overrides[key]).trim()) {
            result[key] = String(overrides[key]).trim();
            changes.push({ key, action: 'overridden', value: result[key], source: 'cli_parameter', note: '' });
            continue;
        }

        // Check existing
        const existingVal = getOptionalValue(existingAnswers, key);
        if (existingVal) {
            result[key] = existingVal;
            changes.push({ key, action: 'preserved', value: result[key], source: 'existing_answers', note: '' });
            continue;
        }

        // Try infer from live version
        if (def.inferFrom) {
            for (const inference of def.inferFrom) {
                const source = inference.source === 'version.json' ? liveVersion
                    : inference.source === 'token-economy.json' ? tokenEconomyConfig : null;
                if (source) {
                    const val = getOptionalValue(source, inference.property);
                    if (val) {
                        result[key] = String(val);
                        changes.push({ key, action: 'inferred', value: result[key], source: inference.source, note: `from ${inference.property}` });
                        break;
                    }
                }
            }
            if (result[key] !== undefined) continue;
        }

        // Use default
        result[key] = def.defaultValue;
        changes.push({ key, action: 'recommended_default', value: result[key], source: 'schema_default', note: '' });
    }

    // Ensure CollectedVia
    if (!result.CollectedVia) {
        result.CollectedVia = 'CLI_NONINTERACTIVE';
    }

    return result;
}

function getInitAnswerSchema() {
    return [
        {
            key: 'AssistantLanguage',
            defaultValue: 'English',
            inferFrom: [{ source: 'version.json', property: 'AssistantLanguage' }]
        },
        {
            key: 'AssistantBrevity',
            defaultValue: 'concise',
            inferFrom: [{ source: 'version.json', property: 'AssistantBrevity' }]
        },
        {
            key: 'SourceOfTruth',
            defaultValue: 'Claude',
            inferFrom: [{ source: 'version.json', property: 'SourceOfTruth' }]
        },
        {
            key: 'EnforceNoAutoCommit',
            defaultValue: 'true',
            inferFrom: [{ source: 'version.json', property: 'EnforceNoAutoCommit' }]
        },
        {
            key: 'ClaudeOrchestratorFullAccess',
            defaultValue: 'false',
            inferFrom: [{ source: 'version.json', property: 'ClaudeOrchestratorFullAccess' }]
        },
        {
            key: 'TokenEconomyEnabled',
            defaultValue: 'true',
            inferFrom: [
                { source: 'version.json', property: 'TokenEconomyEnabled' },
                { source: 'token-economy.json', property: 'enabled' }
            ]
        },
        {
            key: 'CollectedVia',
            defaultValue: 'CLI_NONINTERACTIVE',
            inferFrom: null
        }
    ];
}

function getOptionalValue(obj, key) {
    if (!obj || typeof obj !== 'object') return null;
    // Case-insensitive lookup
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    for (const prop of Object.keys(obj)) {
        if (prop.toLowerCase().replace(/[_-]/g, '') === normalizedKey) {
            const val = obj[prop];
            if (val === null || val === undefined) return null;
            const str = String(val).trim();
            return str || null;
        }
    }
    return null;
}

/**
 * Updates the core rule file (00-core.md) with language/brevity values.
 */
function updateCoreRuleFile(bundleRoot, sourceRoot, language, brevity) {
    const livePath = path.join(bundleRoot, 'live/docs/agent-rules/00-core.md');
    const templatePath = path.join(sourceRoot, 'docs/agent-rules/00-core.md');

    const sourcePath = pathExists(livePath) ? livePath : pathExists(templatePath) ? templatePath : null;
    if (!sourcePath) {
        throw new Error(`Core rule source not found. Checked: ${livePath} and ${templatePath}`);
    }

    const content = readTextFile(sourcePath);
    if (!content || !content.trim()) {
        throw new Error(`Core rule source is empty: ${sourcePath}`);
    }

    const updatedContent = applyAssistantDefaults(content, '00-core.md', language, brevity);

    let existingContent = null;
    if (pathExists(livePath)) {
        existingContent = readTextFile(livePath);
    }

    if (existingContent === updatedContent) {
        return false;
    }

    ensureDirectory(path.dirname(livePath));
    fs.writeFileSync(livePath, updatedContent, 'utf8');
    return true;
}

/**
 * Updates the token economy config with the enabled flag.
 */
function updateTokenEconomyConfig(bundleRoot, sourceRoot, enabled) {
    const templatePath = path.join(sourceRoot, 'config/token-economy.json');
    const destPath = path.join(bundleRoot, 'live/config/token-economy.json');

    if (!pathExists(templatePath)) {
        throw new Error(`Token economy template config not found: ${templatePath}`);
    }

    const templateConfig = readJsonFile(templatePath);
    let existingConfig = null;
    if (pathExists(destPath)) {
        try {
            existingConfig = readJsonFile(destPath);
        } catch {
            existingConfig = null;
        }
    }

    // Merge (simple for token economy)
    const merged = existingConfig || JSON.parse(JSON.stringify(templateConfig));
    merged.enabled = enabled;

    const json = JSON.stringify(merged, null, 2);
    let existingJson = null;
    if (pathExists(destPath)) {
        existingJson = readTextFile(destPath);
    }

    const updated = existingJson !== json;
    if (updated) {
        ensureDirectory(path.dirname(destPath));
        fs.writeFileSync(destPath, json, 'utf8');
    }

    return { updated, path: destPath };
}

module.exports = {
    getOptionalValue,
    recollectInitAnswers,
    runReinit,
    updateCoreRuleFile,
    updateTokenEconomyConfig
};
