const {
    ALL_AGENT_ENTRYPOINT_FILES,
    SOURCE_OF_TRUTH_VALUES,
    SOURCE_TO_ENTRYPOINT_MAP
} = require('../core/constants.ts');

/**
 * Resolves a source-of-truth provider name to its canonical entrypoint file.
 */
function getCanonicalEntrypointFile(sourceOfTruth) {
    const key = String(sourceOfTruth).trim();
    const match = SOURCE_OF_TRUTH_VALUES.find(
        (v) => v.toLowerCase() === key.toLowerCase().replace(/\s+/g, '')
    );
    if (!match) {
        throw new Error(`Unsupported SourceOfTruth value '${sourceOfTruth}'.`);
    }
    return SOURCE_TO_ENTRYPOINT_MAP[match];
}

/**
 * Normalizes a single agent entrypoint token (alias, number, or path) to a canonical file.
 */
function normalizeAgentEntrypointToken(token) {
    let trimmed = String(token).trim();
    trimmed = trimmed.replace(/^or\s+/i, '');
    if (!trimmed) {
        return null;
    }

    const selectionNumber = Number.parseInt(trimmed, 10);
    if (/^\d+$/.test(trimmed) && !Number.isNaN(selectionNumber)) {
        if (selectionNumber < 1 || selectionNumber > ALL_AGENT_ENTRYPOINT_FILES.length) {
            throw new Error(
                `Unsupported ActiveAgentFiles selection '${token}'. Choose a number from 1 to ${ALL_AGENT_ENTRYPOINT_FILES.length}, or use one of: ${ALL_AGENT_ENTRYPOINT_FILES.join(', ')}.`
            );
        }
        return ALL_AGENT_ENTRYPOINT_FILES[selectionNumber - 1];
    }

    const normalized = trimmed.toLowerCase().replace(/\\/g, '/');
    const aliasMap = {
        'claude': 'CLAUDE.md',
        'claude.md': 'CLAUDE.md',
        'codex': 'AGENTS.md',
        'agents': 'AGENTS.md',
        'agents.md': 'AGENTS.md',
        'gemini': 'GEMINI.md',
        'gemini.md': 'GEMINI.md',
        'githubcopilot': '.github/copilot-instructions.md',
        'copilot': '.github/copilot-instructions.md',
        '.github/copilot-instructions.md': '.github/copilot-instructions.md',
        'windsurf': '.windsurf/rules/rules.md',
        '.windsurf/rules/rules.md': '.windsurf/rules/rules.md',
        'junie': '.junie/guidelines.md',
        '.junie/guidelines.md': '.junie/guidelines.md',
        'antigravity': '.antigravity/rules.md',
        '.antigravity/rules.md': '.antigravity/rules.md'
    };

    if (aliasMap[normalized]) {
        return aliasMap[normalized];
    }

    const caseMatch = ALL_AGENT_ENTRYPOINT_FILES.find(
        (v) => v.toLowerCase() === trimmed.toLowerCase()
    );
    if (caseMatch) {
        return caseMatch;
    }

    throw new Error(
        `Unsupported ActiveAgentFiles entry '${token}'. Allowed values: ${ALL_AGENT_ENTRYPOINT_FILES.join(', ')}. You may also use provider aliases such as Claude, Codex, Gemini, Copilot, Windsurf, Junie, or Antigravity.`
    );
}

/**
 * Resolves active agent entrypoint files from a comma/semicolon-separated value
 * and/or a source-of-truth provider name. Returns ordered canonical array.
 */
function getActiveAgentEntrypointFiles(value, sourceOfTruthValue) {
    const selected = new Set();

    if (value && String(value).trim()) {
        for (const token of String(value).split(/[,;]/)) {
            const normalized = normalizeAgentEntrypointToken(token);
            if (normalized) {
                selected.add(normalized);
            }
        }
    }

    if (sourceOfTruthValue && String(sourceOfTruthValue).trim()) {
        selected.add(getCanonicalEntrypointFile(sourceOfTruthValue));
    }

    const ordered = [];
    for (const allowed of ALL_AGENT_ENTRYPOINT_FILES) {
        if (selected.has(allowed)) {
            ordered.push(allowed);
        }
    }

    return ordered;
}

/**
 * Converts an array of active entrypoint files to a comma-separated string.
 */
function convertActiveAgentEntrypointFilesToString(activeEntrypointFiles) {
    if (!activeEntrypointFiles || !Array.isArray(activeEntrypointFiles)) {
        return null;
    }

    const normalized = [];
    const selectedSet = new Set();
    for (const entry of activeEntrypointFiles) {
        if (!entry || !String(entry).trim()) continue;
        const token = normalizeAgentEntrypointToken(entry);
        if (token && !selectedSet.has(token)) {
            selectedSet.add(token);
        }
    }

    for (const allowed of ALL_AGENT_ENTRYPOINT_FILES) {
        if (selectedSet.has(allowed)) {
            normalized.push(allowed);
        }
    }

    return normalized.length === 0 ? null : normalized.join(', ');
}

/**
 * Returns provider orchestrator profile definitions.
 */
function getProviderOrchestratorProfileDefinitions() {
    return [
        {
            entrypointFile: '.github/copilot-instructions.md',
            providerLabel: 'GitHub Copilot',
            orchestratorRelativePath: '.github/agents/orchestrator.md',
            gitignoreEntries: ['.github/agents/', '.github/copilot-instructions.md']
        },
        {
            entrypointFile: '.windsurf/rules/rules.md',
            providerLabel: 'Windsurf',
            orchestratorRelativePath: '.windsurf/agents/orchestrator.md',
            gitignoreEntries: ['.windsurf/', '.windsurf/rules/rules.md']
        },
        {
            entrypointFile: '.junie/guidelines.md',
            providerLabel: 'Junie',
            orchestratorRelativePath: '.junie/agents/orchestrator.md',
            gitignoreEntries: ['.junie/', '.junie/guidelines.md']
        },
        {
            entrypointFile: '.antigravity/rules.md',
            providerLabel: 'Antigravity',
            orchestratorRelativePath: '.antigravity/agents/orchestrator.md',
            gitignoreEntries: ['.antigravity/', '.antigravity/rules.md']
        }
    ];
}

/**
 * Returns GitHub skill bridge profile definitions.
 */
function getGitHubSkillBridgeProfileDefinitions() {
    return [
        {
            relativePath: '.github/agents/reviewer.md',
            profileTitle: 'Reviewer Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md',
            reviewRequirement: 'Use preflight `required_reviews.*` flags from orchestrator.',
            capabilityFlag: 'always-on'
        },
        {
            relativePath: '.github/agents/code-review.md',
            profileTitle: 'Code Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md',
            reviewRequirement: 'required_reviews.code=true',
            capabilityFlag: 'always-on'
        },
        {
            relativePath: '.github/agents/db-review.md',
            profileTitle: 'DB Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/db-review/SKILL.md',
            reviewRequirement: 'required_reviews.db=true',
            capabilityFlag: 'always-on'
        },
        {
            relativePath: '.github/agents/security-review.md',
            profileTitle: 'Security Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/security-review/SKILL.md',
            reviewRequirement: 'required_reviews.security=true',
            capabilityFlag: 'always-on'
        },
        {
            relativePath: '.github/agents/refactor-review.md',
            profileTitle: 'Refactor Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md',
            reviewRequirement: 'required_reviews.refactor=true',
            capabilityFlag: 'always-on'
        },
        {
            relativePath: '.github/agents/api-review.md',
            profileTitle: 'API Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/api-review/SKILL.md',
            reviewRequirement: 'required_reviews.api=true',
            capabilityFlag: 'review-capabilities.api=true'
        },
        {
            relativePath: '.github/agents/test-review.md',
            profileTitle: 'Test Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/test-review/SKILL.md',
            reviewRequirement: 'required_reviews.test=true',
            capabilityFlag: 'review-capabilities.test=true'
        },
        {
            relativePath: '.github/agents/performance-review.md',
            profileTitle: 'Performance Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/performance-review/SKILL.md',
            reviewRequirement: 'required_reviews.performance=true',
            capabilityFlag: 'review-capabilities.performance=true'
        },
        {
            relativePath: '.github/agents/infra-review.md',
            profileTitle: 'Infra Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/infra-review/SKILL.md',
            reviewRequirement: 'required_reviews.infra=true',
            capabilityFlag: 'review-capabilities.infra=true'
        },
        {
            relativePath: '.github/agents/dependency-review.md',
            profileTitle: 'Dependency Review Bridge',
            skillPath: 'Octopus-agent-orchestrator/live/skills/dependency-review/SKILL.md',
            reviewRequirement: 'required_reviews.dependency=true',
            capabilityFlag: 'review-capabilities.dependency=true'
        }
    ];
}

module.exports = {
    convertActiveAgentEntrypointFilesToString,
    getActiveAgentEntrypointFiles,
    getCanonicalEntrypointFile,
    getGitHubSkillBridgeProfileDefinitions,
    getProviderOrchestratorProfileDefinitions,
    normalizeAgentEntrypointToken
};
