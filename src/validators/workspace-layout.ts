const fs = require('node:fs');
const path = require('node:path');

const {
    DEFAULT_BUNDLE_NAME,
    SOURCE_TO_ENTRYPOINT_MAP,
    SOURCE_OF_TRUTH_VALUES
} = require('../core/constants.ts');
const { pathExists, readTextFile } = require('../core/fs.ts');

/**
 * Required workspace paths that must exist after a full install.
 * Matches the deployed Node-only bundle surface.
 */
const BASE_REQUIRED_PATHS = Object.freeze([
    'TASK.md',
    'Octopus-agent-orchestrator/.gitattributes',
    'Octopus-agent-orchestrator/VERSION',
    'Octopus-agent-orchestrator/package.json',
    'Octopus-agent-orchestrator/bin/octopus.js',
    'Octopus-agent-orchestrator/src',
    'Octopus-agent-orchestrator/src/cli',
    'Octopus-agent-orchestrator/src/materialization',
    'Octopus-agent-orchestrator/src/validators',
    'Octopus-agent-orchestrator/src/gates',
    'Octopus-agent-orchestrator/src/lifecycle',
    'Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md',
    'Octopus-agent-orchestrator/HOW_TO.md',
    'Octopus-agent-orchestrator/MANIFEST.md',
    'Octopus-agent-orchestrator/live/version.json',
    'Octopus-agent-orchestrator/live/config/review-capabilities.json',
    'Octopus-agent-orchestrator/live/config/paths.json',
    'Octopus-agent-orchestrator/live/config/token-economy.json',
    'Octopus-agent-orchestrator/live/config/output-filters.json',
    'Octopus-agent-orchestrator/live/config/skill-packs.json',
    'Octopus-agent-orchestrator/live/config/skills-index.json',
    'Octopus-agent-orchestrator/live/skills/README.md',
    'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md',
    'Octopus-agent-orchestrator/live/skills/code-review/skill.json',
    'Octopus-agent-orchestrator/live/skills/db-review/skill.json',
    'Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/dependency-review/skill.json',
    'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/orchestration/skill.json',
    'Octopus-agent-orchestrator/live/skills/orchestration-depth1/skill.json',
    'Octopus-agent-orchestrator/live/skills/skill-builder/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/skill-builder/skill.json',
    'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/security-review/skill.json',
    'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md',
    'Octopus-agent-orchestrator/live/skills/refactor-review/skill.json',
    'Octopus-agent-orchestrator/live/init-report.md',
    'Octopus-agent-orchestrator/live/project-discovery.md',
    'Octopus-agent-orchestrator/live/source-inventory.md',
    'Octopus-agent-orchestrator/live/USAGE.md'
]);

/**
 * Standard rule files that must exist in live/docs/agent-rules.
 */
const RULE_FILES = Object.freeze([
    '00-core.md',
    '10-project-context.md',
    '15-project-memory.md',
    '20-architecture.md',
    '30-code-style.md',
    '35-strict-coding-rules.md',
    '40-commands.md',
    '50-structure-and-docs.md',
    '60-operating-rules.md',
    '70-security.md',
    '80-task-workflow.md',
    '90-skill-catalog.md'
]);

/**
 * Project command placeholders that indicate unfilled agent context.
 */
const PROJECT_COMMAND_PLACEHOLDERS = Object.freeze([
    '<install dependencies command>',
    '<local environment bootstrap command>',
    '<start backend command>',
    '<start frontend command>',
    '<start worker or background job command>',
    '<unit test command>',
    '<integration test command>',
    '<e2e test command>',
    '<lint command>',
    '<type-check command>',
    '<format check command>',
    '<compile command>',
    '<build command>',
    '<container or artifact packaging command>'
]);

/**
 * Template placeholder regex: {{SOME_TOKEN}}.
 */
const TEMPLATE_PLACEHOLDER_PATTERN = /{{[A-Z0-9_]+}}/;

/**
 * Managed block markers.
 */
const MANAGED_START = '<!-- Octopus-agent-orchestrator:managed-start -->';
const MANAGED_END = '<!-- Octopus-agent-orchestrator:managed-end -->';

/**
 * Get the canonical entrypoint file for a source-of-truth value.
 */
function getCanonicalEntrypoint(sourceOfTruth) {
    const key = sourceOfTruth.trim().toUpperCase().replace(/\s+/g, '');
    const match = SOURCE_OF_TRUTH_VALUES.find(
        function (v) { return v.toUpperCase().replace(/\s+/g, '') === key; }
    );
    return match ? SOURCE_TO_ENTRYPOINT_MAP[match] : null;
}

/**
 * Get the bundle path within a target root.
 */
function getBundlePath(targetRoot) {
    return path.join(targetRoot, DEFAULT_BUNDLE_NAME);
}

/**
 * Build the full list of required paths for a workspace.
 */
function buildRequiredPaths(options) {
    var activeAgentFiles = options.activeAgentFiles || [];
    var claudeOrchestratorFullAccess = options.claudeOrchestratorFullAccess || false;

    var paths = [].concat(BASE_REQUIRED_PATHS);

    for (var i = 0; i < RULE_FILES.length; i++) {
        paths.push('Octopus-agent-orchestrator/live/docs/agent-rules/' + RULE_FILES[i]);
    }

    for (var j = 0; j < activeAgentFiles.length; j++) {
        if (paths.indexOf(activeAgentFiles[j]) === -1) {
            paths.push(activeAgentFiles[j]);
        }
    }

    if (claudeOrchestratorFullAccess) {
        paths.push('.claude/settings.local.json');
    }

    var unique = [];
    var seen = {};
    for (var k = 0; k < paths.length; k++) {
        if (!(paths[k] in seen)) {
            seen[paths[k]] = true;
            unique.push(paths[k]);
        }
    }

    return unique.sort();
}

/**
 * Check which required paths are missing.
 */
function detectMissingPaths(targetRoot, requiredPaths) {
    var missing = [];
    for (var i = 0; i < requiredPaths.length; i++) {
        var fullPath = path.join(targetRoot, requiredPaths[i]);
        if (!pathExists(fullPath)) {
            missing.push(requiredPaths[i]);
        }
    }
    return missing;
}

/**
 * Get the commands rule file path.
 */
function getCommandsRulePath(bundlePath) {
    return path.join(bundlePath, 'live', 'docs', 'agent-rules', '40-commands.md');
}

/**
 * Read a text file, returning null if it doesn't exist.
 */
function readUtf8IfExists(filePath) {
    try {
        if (!pathExists(filePath)) return null;
        var stats = fs.lstatSync(filePath);
        if (!stats.isFile()) return null;
        return readTextFile(filePath);
    } catch (e) {
        return null;
    }
}

/**
 * Return any project-command placeholders still present in commands content.
 */
function getMissingProjectCommands(commandsContent) {
    if (!commandsContent) {
        return [].concat(PROJECT_COMMAND_PLACEHOLDERS);
    }
    return PROJECT_COMMAND_PLACEHOLDERS.filter(
        function (placeholder) { return commandsContent.includes(placeholder); }
    );
}

/**
 * Extract a managed block from file content.
 */
function extractManagedBlock(content) {
    if (!content) return null;
    var startEscaped = MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var endEscaped = MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = new RegExp(startEscaped + '[\\s\\S]*?' + endEscaped);
    var match = content.match(pattern);
    return match ? match[0] : null;
}

/**
 * Detect rule file violations: empty files and unresolved template placeholders.
 */
function detectRuleFileViolations(targetRoot) {
    var ruleFileViolations = [];
    var templatePlaceholderViolations = [];

    for (var i = 0; i < RULE_FILES.length; i++) {
        var ruleFile = RULE_FILES[i];
        var relativePath = 'Octopus-agent-orchestrator/live/docs/agent-rules/' + ruleFile;
        var fullPath = path.join(targetRoot, relativePath);
        if (!pathExists(fullPath)) continue;

        var content = readTextFile(fullPath);
        if (!content || !content.trim()) {
            ruleFileViolations.push('Rule file is empty: ' + relativePath);
        }
        if (TEMPLATE_PLACEHOLDER_PATTERN.test(content)) {
            templatePlaceholderViolations.push('Unresolved template placeholder in: ' + relativePath);
        }
    }

    return { ruleFileViolations: ruleFileViolations, templatePlaceholderViolations: templatePlaceholderViolations };
}

/**
 * Detect version contract violations between VERSION file and live/version.json.
 */
function detectVersionViolations(targetRoot, sourceOfTruth, canonicalEntrypoint) {
    var violations = [];
    var bundleVersionPath = path.join(targetRoot, 'Octopus-agent-orchestrator/VERSION');
    var liveVersionPath = path.join(targetRoot, 'Octopus-agent-orchestrator/live/version.json');

    var bundleVersion = null;

    if (pathExists(bundleVersionPath)) {
        bundleVersion = readTextFile(bundleVersionPath).trim();
        if (!bundleVersion) {
            violations.push('Octopus-agent-orchestrator/VERSION must not be empty.');
        }
    }

    if (pathExists(liveVersionPath)) {
        var liveVersionObject;
        try {
            liveVersionObject = JSON.parse(readTextFile(liveVersionPath));
        } catch (e) {
            violations.push('Octopus-agent-orchestrator/live/version.json must contain valid JSON.');
            return { violations: violations, bundleVersion: bundleVersion };
        }

        var liveVersion = liveVersionObject && liveVersionObject.Version
            ? String(liveVersionObject.Version).trim()
            : '';
        if (!liveVersion) {
            violations.push('Octopus-agent-orchestrator/live/version.json must include non-empty Version.');
        } else if (bundleVersion && liveVersion !== bundleVersion) {
            violations.push(
                "Octopus-agent-orchestrator/live/version.json Version '" + liveVersion + "' must match Octopus-agent-orchestrator/VERSION '" + bundleVersion + "'."
            );
        }

        var liveSoT = liveVersionObject && liveVersionObject.SourceOfTruth
            ? String(liveVersionObject.SourceOfTruth).trim()
            : '';
        if (!liveSoT) {
            violations.push('Octopus-agent-orchestrator/live/version.json must include non-empty SourceOfTruth.');
        } else if (liveSoT.toLowerCase() !== sourceOfTruth.toLowerCase()) {
            violations.push(
                "Octopus-agent-orchestrator/live/version.json SourceOfTruth '" + liveSoT + "' must match verification SourceOfTruth '" + sourceOfTruth + "'."
            );
        }

        var liveCE = liveVersionObject && liveVersionObject.CanonicalEntrypoint
            ? String(liveVersionObject.CanonicalEntrypoint).trim()
            : '';
        if (!liveCE) {
            violations.push('Octopus-agent-orchestrator/live/version.json must include non-empty CanonicalEntrypoint.');
        } else if (canonicalEntrypoint && liveCE !== canonicalEntrypoint) {
            violations.push(
                "Octopus-agent-orchestrator/live/version.json CanonicalEntrypoint '" + liveCE + "' must match expected '" + canonicalEntrypoint + "'."
            );
        }
    }

    return { violations: violations, bundleVersion: bundleVersion };
}

/**
 * Validate managed config JSON files exist and parse without error.
 */
function detectManagedConfigViolations(targetRoot, configRelativePath) {
    var violations = [];
    var configPath = path.join(targetRoot, configRelativePath);

    if (!pathExists(configPath)) {
        violations.push(configRelativePath + ' is missing.');
        return violations;
    }

    try {
        var raw = readTextFile(configPath);
        JSON.parse(raw);
    } catch (e) {
        violations.push(configRelativePath + ' must contain valid JSON.');
    }

    return violations;
}

/**
 * Detect .gitignore violations.
 */
function detectGitignoreViolations(targetRoot, requiredEntries) {
    var gitignorePath = path.join(targetRoot, '.gitignore');
    if (!pathExists(gitignorePath)) {
        return [].concat(requiredEntries);
    }

    var existingLines = readTextFile(gitignorePath).split(/\r?\n/);
    var missing = [];

    for (var i = 0; i < requiredEntries.length; i++) {
        if (existingLines.indexOf(requiredEntries[i]) === -1) {
            missing.push(requiredEntries[i]);
        }
    }

    return missing;
}

module.exports = {
    BASE_REQUIRED_PATHS,
    MANAGED_END,
    MANAGED_START,
    PROJECT_COMMAND_PLACEHOLDERS,
    RULE_FILES,
    TEMPLATE_PLACEHOLDER_PATTERN,
    buildRequiredPaths,
    detectGitignoreViolations,
    detectManagedConfigViolations,
    detectMissingPaths,
    detectRuleFileViolations,
    detectVersionViolations,
    extractManagedBlock,
    getBundlePath,
    getCanonicalEntrypoint,
    getCommandsRulePath,
    getMissingProjectCommands,
    readUtf8IfExists
};
