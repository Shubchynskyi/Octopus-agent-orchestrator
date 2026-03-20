const { pathExists, readTextFile } = require('../core/fs.ts');

const RULE_FILES = Object.freeze([
    '00-core.md', '10-project-context.md', '20-architecture.md',
    '30-code-style.md', '35-strict-coding-rules.md', '40-commands.md',
    '50-structure-and-docs.md', '60-operating-rules.md',
    '70-security.md', '80-task-workflow.md', '90-skill-catalog.md'
]);

const CONTEXT_RULE_FILES = Object.freeze([
    '10-project-context.md', '20-architecture.md', '30-code-style.md',
    '40-commands.md', '50-structure-and-docs.md', '60-operating-rules.md'
]);

const DISCOVERY_AUGMENTED_RULE_FILES = CONTEXT_RULE_FILES;

const LANGUAGE_PLACEHOLDER = '{{ASSISTANT_RESPONSE_LANGUAGE}}';
const BREVITY_PLACEHOLDER = '{{ASSISTANT_RESPONSE_BREVITY}}';

/**
 * Selects the best source for a rule file following priority rules:
 * - 00-core.md: template > live > legacy
 * - Context rules (10-60): legacy > live > template
 * - Other rules: live > template > legacy
 */
function selectRuleSource(ruleFile, options) {
    const { targetRoot, liveRuleRoot, templateRuleRoot } = options;
    const path = require('node:path');

    const legacyCandidate = path.join(targetRoot, 'docs/agent-rules', ruleFile);
    const liveCandidate = path.join(liveRuleRoot, ruleFile);
    const templateCandidate = path.join(templateRuleRoot, ruleFile);
    const isContextRule = CONTEXT_RULE_FILES.includes(ruleFile);

    if (ruleFile === '00-core.md') {
        if (pathExists(templateCandidate)) return { path: templateCandidate, origin: 'template' };
        if (pathExists(liveCandidate)) return { path: liveCandidate, origin: 'live-existing' };
        if (pathExists(legacyCandidate)) return { path: legacyCandidate, origin: 'legacy-docs' };
    } else if (isContextRule) {
        if (pathExists(legacyCandidate)) return { path: legacyCandidate, origin: 'legacy-docs' };
        if (pathExists(liveCandidate)) return { path: liveCandidate, origin: 'live-existing' };
        if (pathExists(templateCandidate)) return { path: templateCandidate, origin: 'template' };
    } else {
        if (pathExists(liveCandidate)) return { path: liveCandidate, origin: 'live-existing' };
        if (pathExists(templateCandidate)) return { path: templateCandidate, origin: 'template' };
        if (pathExists(legacyCandidate)) return { path: legacyCandidate, origin: 'legacy-docs' };
    }

    return null;
}

/**
 * Applies project discovery overlay to context rules (10-60).
 */
function applyContextDefaults(content, ruleFile, discoveryOverlay) {
    if (!DISCOVERY_AUGMENTED_RULE_FILES.includes(ruleFile) || !discoveryOverlay) {
        return content;
    }

    let updated = content.trimEnd();
    const overlayPattern = /^## Project Discovery Snapshot[\s\S]*?(?=^## |\z)/m;
    if (overlayPattern.test(updated)) {
        updated = updated.replace(overlayPattern, discoveryOverlay);
        return updated + '\r\n';
    }

    return updated + '\r\n\r\n' + discoveryOverlay + '\r\n';
}

/**
 * Applies assistant language/brevity defaults to 00-core.md.
 */
function applyAssistantDefaults(content, ruleFile, assistantLanguage, assistantBrevity) {
    if (ruleFile !== '00-core.md') return content;

    let updated = content
        .replace(new RegExp(escapeRegex(LANGUAGE_PLACEHOLDER), 'g'), assistantLanguage)
        .replace(new RegExp(escapeRegex(BREVITY_PLACEHOLDER), 'g'), assistantBrevity);

    updated = updated.replace(
        /^Respond in .+ for explanations and assistance\.$/m,
        `Respond in ${assistantLanguage} for explanations and assistance.`
    );
    updated = updated.replace(
        /^1\. Respond in .+\.$/m,
        `1. Respond in ${assistantLanguage}.`
    );
    updated = updated.replace(
        /^Default response brevity: .+\.$/m,
        `Default response brevity: ${assistantBrevity}.`
    );
    updated = updated.replace(
        /^2\. Keep responses .+ unless the user explicitly asks for more or less detail\.$/m,
        `2. Keep responses ${assistantBrevity} unless the user explicitly asks for more or less detail.`
    );

    return updated;
}

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    applyAssistantDefaults,
    applyContextDefaults,
    BREVITY_PLACEHOLDER,
    CONTEXT_RULE_FILES,
    DISCOVERY_AUGMENTED_RULE_FILES,
    LANGUAGE_PLACEHOLDER,
    RULE_FILES,
    selectRuleSource
};
