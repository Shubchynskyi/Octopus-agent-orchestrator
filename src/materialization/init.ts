const fs = require('node:fs');
const path = require('node:path');

const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { readJsonFile } = require('../core/json.ts');
const {
    getCanonicalEntrypointFile
} = require('./common.ts');
const {
    getProjectDiscovery,
    buildProjectDiscoveryLines,
    buildDiscoveryOverlaySection
} = require('./project-discovery.ts');
const {
    RULE_FILES,
    selectRuleSource,
    applyContextDefaults,
    applyAssistantDefaults
} = require('./rule-materialization.ts');
const {
    NODE_HUMAN_COMMIT_COMMAND,
    NODE_INTERACTIVE_UPDATE_COMMAND,
    NODE_NON_INTERACTIVE_UPDATE_COMMAND
} = require('./command-constants.ts');

/**
 * Runs the init materialization pipeline.
 * Node implementation of live materialization.
 *
 * @param {object} options
 * @param {string} options.targetRoot - Project root
 * @param {string} options.bundleRoot - Orchestrator bundle dir
 * @param {boolean} [options.dryRun=false]
 * @param {string} [options.assistantLanguage='English']
 * @param {string} [options.assistantBrevity='concise']
 * @param {string} [options.sourceOfTruth='Claude']
 * @param {boolean} [options.enforceNoAutoCommit=false]
 * @param {boolean} [options.tokenEconomyEnabled=true]
 * @returns {object} Init result metrics
 */
function runInit(options) {
    const {
        targetRoot,
        bundleRoot,
        dryRun = false,
        assistantLanguage = 'English',
        assistantBrevity = 'concise',
        sourceOfTruth = 'Claude',
        enforceNoAutoCommit = false,
        tokenEconomyEnabled = true
    } = options;

    const templateRoot = path.join(bundleRoot, 'template');
    const liveRoot = path.join(bundleRoot, 'live');
    const templateRuleRoot = path.join(templateRoot, 'docs/agent-rules');
    const liveRuleRoot = path.join(liveRoot, 'docs/agent-rules');

    if (!pathExists(templateRoot)) {
        throw new Error(`Template directory not found: ${templateRoot}`);
    }

    // Validate target root
    const normalizedTarget = path.resolve(targetRoot);
    const normalizedBundle = path.resolve(bundleRoot);
    if (normalizedTarget.toLowerCase() === normalizedBundle.toLowerCase()) {
        throw new Error(
            `TargetRoot points to orchestrator bundle directory '${bundleRoot}'. Use the project root parent directory instead.`
        );
    }

    const projectName = path.basename(normalizedTarget);
    const timestampIso = new Date().toISOString();

    // Normalize parameters
    const lang = (assistantLanguage || 'English').trim() || 'English';
    let brevity = (assistantBrevity || 'concise').trim().toLowerCase();
    if (!['concise', 'detailed'].includes(brevity)) {
        throw new Error(`Unsupported AssistantBrevity value '${brevity}'. Allowed values: concise, detailed.`);
    }
    const trimmedSoT = (sourceOfTruth || 'Claude').trim();
    const canonicalEntrypoint = getCanonicalEntrypointFile(trimmedSoT);

    // Ensure live directories
    if (!dryRun) {
        ensureDirectory(liveRoot);
        ensureDirectory(liveRuleRoot);
    }

    // Project discovery
    const discovery = getProjectDiscovery(targetRoot);
    const discoveryLines = buildProjectDiscoveryLines(discovery, timestampIso);
    const discoveryOverlay = buildDiscoveryOverlaySection(discovery);

    // Materialize rule files
    const ruleSourceMap = [];
    for (const ruleFile of RULE_FILES) {
        const source = selectRuleSource(ruleFile, { targetRoot, liveRuleRoot, templateRuleRoot });
        if (!source) {
            throw new Error(`No source found for rule file: ${ruleFile}`);
        }

        let content = readTextFile(source.path);
        if (!content || !content.trim()) {
            throw new Error(`Rule source is empty: ${source.path}`);
        }

        // Apply template-specific context overlay
        if (source.origin === 'template') {
            content = applyContextDefaults(content, ruleFile, discoveryOverlay);
        }

        // Apply assistant defaults (language/brevity) to 00-core.md
        content = applyAssistantDefaults(content, ruleFile, lang, brevity);

        const destPath = path.join(liveRuleRoot, ruleFile);
        if (!dryRun) {
            fs.writeFileSync(destPath, content, 'utf8');
        }

        ruleSourceMap.push({
            ruleFile,
            source: path.relative(targetRoot, source.path).replace(/\\/g, '/'),
            origin: source.origin,
            destination: path.relative(targetRoot, destPath).replace(/\\/g, '/')
        });
    }

    // Copy support directories from template to live
    const supportDirectories = [
        'config', 'skills', 'docs/changes', 'docs/reviews', 'docs/tasks'
    ];
    let copiedSupportDirs = 0;

    for (const relDir of supportDirectories) {
        const srcDir = path.join(templateRoot, relDir);
        if (!pathExists(srcDir)) continue;

        const destDir = path.join(liveRoot, relDir);
        if (!dryRun) {
            ensureDirectory(destDir);
            copyDirectoryRecursive(srcDir, destDir);
        }
        copiedSupportDirs++;
    }

    // Handle managed config merge (token-economy enabled flag)
    const managedConfigNames = ['review-capabilities', 'paths', 'token-economy', 'output-filters'];
    const configMergeStatuses = {};

    for (const configName of managedConfigNames) {
        const templateConfigPath = path.join(templateRoot, `config/${configName}.json`);
        const destConfigPath = path.join(liveRoot, `config/${configName}.json`);

        if (!pathExists(templateConfigPath)) {
            configMergeStatuses[configName] = 'template_missing_preservation_skipped';
            continue;
        }

        try {
            const templateConfig = readJsonFile(templateConfigPath);
            let existingConfig = null;

            if (pathExists(destConfigPath)) {
                try {
                    existingConfig = readJsonFile(destConfigPath);
                } catch {
                    existingConfig = null;
                }
            }

            // Merge: use existing values where present, fill from template
            const merged = mergeConfig(templateConfig, existingConfig);

            // Apply token economy enabled flag
            if (configName === 'token-economy') {
                merged.enabled = tokenEconomyEnabled;
            }

            if (!dryRun) {
                const json = JSON.stringify(merged, null, 2);
                ensureDirectory(path.dirname(destConfigPath));
                fs.writeFileSync(destConfigPath, json, 'utf8');
            }

            configMergeStatuses[configName] = existingConfig
                ? 'existing_values_preserved_and_missing_keys_filled'
                : 'no_existing_live_config_template_applied';
        } catch (err) {
            configMergeStatuses[configName] = 'merge_failed_template_applied';
        }
    }

    // Write reporting files
    const sourceInventoryPath = path.join(liveRoot, 'source-inventory.md');
    const initReportPath = path.join(liveRoot, 'init-report.md');
    const projectDiscoveryPath = path.join(liveRoot, 'project-discovery.md');
    const usagePath = path.join(liveRoot, 'USAGE.md');

    if (!dryRun) {
        // Source inventory
        const inventoryLines = buildSourceInventoryLines(targetRoot, timestampIso);
        fs.writeFileSync(sourceInventoryPath, inventoryLines.join('\r\n'), 'utf8');

        // Init report
        const initReportLines = buildInitReportLines({
            timestampIso, projectName, targetRoot, ruleSourceMap,
            ruleFiles: RULE_FILES, copiedSupportDirs,
            configMergeStatuses, lang, brevity, trimmedSoT,
            enforceNoAutoCommit, tokenEconomyEnabled, discovery
        });
        fs.writeFileSync(initReportPath, initReportLines.join('\r\n'), 'utf8');

        // Project discovery
        fs.writeFileSync(projectDiscoveryPath, discoveryLines.join('\r\n'), 'utf8');

        // Usage (seed if not present)
        if (!pathExists(usagePath)) {
            const usageLines = buildUsageLines({
                lang, brevity, canonicalEntrypoint, enforceNoAutoCommit
            });
            fs.writeFileSync(usagePath, usageLines.join('\r\n'), 'utf8');
        }
    }

    return {
        targetRoot: normalizedTarget,
        projectName,
        liveRoot,
        assistantLanguage: lang,
        assistantBrevity: brevity,
        sourceOfTruth: trimmedSoT,
        enforceNoAutoCommit,
        tokenEconomyEnabled,
        ruleFilesMaterialized: RULE_FILES.length,
        supportDirectoriesSynced: copiedSupportDirs,
        reviewCapabilitiesConfigMergeStatus: configMergeStatuses['review-capabilities'] || 'n/a',
        pathsConfigMergeStatus: configMergeStatuses['paths'] || 'n/a',
        tokenEconomyConfigMergeStatus: configMergeStatuses['token-economy'] || 'n/a',
        outputFiltersConfigMergeStatus: configMergeStatuses['output-filters'] || 'n/a',
        ruleSourceMap,
        sourceInventoryPath,
        initReportPath,
        projectDiscoveryPath,
        usagePath
    };
}

/**
 * Simple recursive config merge: template keys are baseline, existing values take precedence.
 */
function mergeConfig(template, existing) {
    if (!existing || typeof existing !== 'object') {
        return JSON.parse(JSON.stringify(template));
    }

    if (Array.isArray(template)) {
        return Array.isArray(existing) ? JSON.parse(JSON.stringify(existing)) : JSON.parse(JSON.stringify(template));
    }

    const result = {};
    // Copy all template keys, using existing values where present
    for (const key of Object.keys(template)) {
        const existingKey = Object.keys(existing).find((k) => k.toLowerCase() === key.toLowerCase());
        if (existingKey !== undefined && existing[existingKey] !== undefined) {
            if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key]) &&
                typeof existing[existingKey] === 'object' && existing[existingKey] !== null && !Array.isArray(existing[existingKey])) {
                result[key] = mergeConfig(template[key], existing[existingKey]);
            } else {
                result[key] = JSON.parse(JSON.stringify(existing[existingKey]));
            }
        } else {
            result[key] = JSON.parse(JSON.stringify(template[key]));
        }
    }

    // Preserve unknown keys from existing
    for (const key of Object.keys(existing)) {
        if (!Object.keys(result).find((k) => k.toLowerCase() === key.toLowerCase())) {
            result[key] = JSON.parse(JSON.stringify(existing[key]));
        }
    }

    return result;
}

function copyDirectoryRecursive(srcDir, destDir) {
    ensureDirectory(destDir);
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function buildSourceInventoryLines(targetRoot, timestampIso) {
    const normalized = targetRoot.replace(/\\/g, '/');
    return [
        '# Source Inventory', '',
        `Generated at: ${timestampIso}`,
        `Project root: ${normalized}`, '',
        '## Legacy Entrypoints',
        '- Check discovery artifacts for legacy entrypoint details.', '',
        '## Legacy Rule Sources',
        '- Check discovery artifacts for legacy rule source details.', '',
        '## Documentation Snapshot',
        '- Check discovery artifacts for documentation snapshot details.'
    ];
}

function buildInitReportLines(opts) {
    const { timestampIso, projectName, targetRoot, ruleSourceMap, ruleFiles,
        copiedSupportDirs, configMergeStatuses, lang, brevity, trimmedSoT,
        enforceNoAutoCommit, tokenEconomyEnabled, discovery } = opts;
    const normalized = targetRoot.replace ? targetRoot.replace(/\\/g, '/') : String(targetRoot);
    const tick = '`';
    const stackSummary = discovery.detectedStacks.length > 0
        ? discovery.detectedStacks.join(', ') : 'none detected';
    const dirSummary = discovery.topLevelDirectories.length > 0
        ? discovery.topLevelDirectories.slice(0, 10).join(', ') : 'none detected';

    const lines = [
        '# Init Report', '',
        `Generated at: ${timestampIso}`,
        `Project: ${projectName}`,
        `Target root: ${normalized}`, '',
        '## Summary',
        `- Rule files materialized in ${tick}Octopus-agent-orchestrator/live/docs/agent-rules${tick}: ${ruleFiles.length}`,
        `- Support directories synced into ${tick}Octopus-agent-orchestrator/live${tick}: ${copiedSupportDirs}`,
        '- Review capabilities config sync policy: preserve existing live values, normalize legacy keys/shapes, and fill missing keys from template.',
        `- Review capabilities config merge status: ${configMergeStatuses['review-capabilities'] || 'n/a'}`,
        '- Paths config sync policy: preserve existing live values, normalize legacy keys/shapes, and fill missing keys from template.',
        `- Paths config merge status: ${configMergeStatuses['paths'] || 'n/a'}`,
        '- Token economy config sync policy: preserve existing live values, normalize legacy keys/shapes, and fill missing keys from template.',
        `- Token economy config merge status: ${configMergeStatuses['token-economy'] || 'n/a'}`,
        '- Output filters config sync policy: preserve existing live values, normalize legacy keys/shapes, and fill missing keys from template.',
        `- Output filters config merge status: ${configMergeStatuses['output-filters'] || 'n/a'}`,
        `- Assistant response language: ${lang}`,
        `- Assistant response brevity: ${brevity}`,
        `- Source of truth entrypoint: ${trimmedSoT}`,
        `- Hard no-auto-commit guard: ${enforceNoAutoCommit ? 'enabled' : 'disabled'}`,
        `- Token economy mode: ${tokenEconomyEnabled ? 'enabled' : 'disabled'}`,
        `- Project discovery source: ${discovery.source}`,
        `- Project discovery stack signals: ${stackSummary}`,
        `- Project discovery top-level directories: ${dirSummary}`,
        '- No files were moved or deleted; discovery sources were read-only.', '',
        '## Rule Source Mapping',
        '| Rule file | Source | Origin | Destination |',
        '|---|---|---|---|'
    ];

    for (const item of ruleSourceMap) {
        lines.push(`| ${item.ruleFile} | ${tick}${item.source}${tick} | ${item.origin} | ${tick}${item.destination}${tick} |`);
    }

    lines.push('', '## Context Fill Policy');
    lines.push('- Project-context rules (`10/20/30/40/50/60`) prefer legacy `docs/agent-rules/*`, then existing `live` content, then template defaults.');
    lines.push('- All other rules prefer existing `live` content, then template defaults, then legacy docs fallback.');
    lines.push(`- Selected source-of-truth entrypoint (${tick}${trimmedSoT}${tick}) is provided by installer and points to ${tick}Octopus-agent-orchestrator/live/docs/agent-rules/*${tick}.`);

    return lines;
}

function buildUsageLines(opts) {
    const { lang, brevity, canonicalEntrypoint, enforceNoAutoCommit } = opts;
    const commitGuardLine = enforceNoAutoCommit
        ? `Hard no-auto-commit guard is enabled. It blocks detected agent-session commits while normal human commits remain available; for intentional manual commits from the same agent shell use: \`${NODE_HUMAN_COMMIT_COMMAND}\`.`
        : 'Hard no-auto-commit guard is disabled.';

    return [
        '# Usage Instructions', '',
        `Language: ${lang}`,
        `Default response brevity: ${brevity}`, '',
        '## Execute Tasks',
        '- Explicit depth: `Execute task <task-id> depth=<1|2|3>`',
        '- Default depth (`2`): `Execute task <task-id>`', '',
        '## Depth Guide',
        '- `depth=1`: simple or low-risk change.',
        '- `depth=2`: default for most tasks.',
        '- `depth=3`: high-risk or cross-cutting work.',
        '- If token economy mode is enabled, use `depth=1` only for small, well-localized tasks; default `depth=3` keeps full reviewer context while shared gate-output compaction still applies.', '',
        '## Update Workspace',
        `- Interactive update: \`${NODE_INTERACTIVE_UPDATE_COMMAND}\``,
        `- Non-interactive apply: \`${NODE_NON_INTERACTIVE_UPDATE_COMMAND}\``, '',
        `Canonical instructions entrypoint for orchestration: \`${canonicalEntrypoint}\`.`,
        `Hard stop: first open \`${canonicalEntrypoint}\` and follow its routing links. Only then execute any task from \`TASK.md\`.`,
        'Orchestrator mode starts when task execution is requested from this file (`TASK.md`).',
        'If needed, the agent can add new tasks from user requests and then execute them in orchestrator mode.',
        commitGuardLine, '',
        'Tasks are managed in root `TASK.md`.',
        'This file can be replaced by the setup agent with project-specific instructions.'
    ];
}

module.exports = {
    mergeConfig,
    runInit
};
