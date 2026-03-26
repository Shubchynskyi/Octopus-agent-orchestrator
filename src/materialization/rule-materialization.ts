const fs = require('node:fs');
const path = require('node:path');
const { pathExists, readTextFile } = require('../core/fs.ts');

const RULE_FILES = Object.freeze([
    '00-core.md', '10-project-context.md', '15-project-memory.md',
    '20-architecture.md', '30-code-style.md', '35-strict-coding-rules.md',
    '40-commands.md', '50-structure-and-docs.md', '60-operating-rules.md',
    '70-security.md', '80-task-workflow.md', '90-skill-catalog.md'
]);

const GENERATED_RULE_FILES = Object.freeze(['15-project-memory.md']);

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

/**
 * Generates a read-only summary of project-memory sources for agent-rules.
 * If the directory is absent or has no substantive content, returns a stub.
 */
function generateProjectMemorySummary(projectMemoryDir, timestampIso) {
    const HEADER = '<!-- DO NOT EDIT — regenerated from project-memory/ -->';
    const TITLE = '# 15 · Project Memory Summary';

    const preamble = [
        HEADER, '',
        TITLE, '',
        `Generated at: ${timestampIso}`, '',
        '> Auto-generated from `docs/project-memory/`. Edit source files there;',
        '> this summary regenerates on every init, reinit, and update.', ''
    ];

    if (!pathExists(projectMemoryDir)) {
        return [...preamble,
            '## Status', '',
            'No `docs/project-memory/` directory found.',
            'Populate it with project knowledge files to enable this summary.', '',
            'Run init or reinit to seed the default category templates.'
        ].join('\r\n');
    }

    let entries;
    try {
        entries = fs.readdirSync(projectMemoryDir, { withFileTypes: true });
    } catch {
        return [...preamble,
            '## Status', '',
            'Could not read `docs/project-memory/` directory.'
        ].join('\r\n');
    }

    const mdFiles = entries
        .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name.toLowerCase() !== 'readme.md')
        .map(e => e.name)
        .sort();

    if (mdFiles.length === 0) {
        return [...preamble,
            '## Status', '',
            '`docs/project-memory/` contains no content files yet.',
            'Populate it with project knowledge to enable this summary.', '',
            'Available category templates: `context.md`, `architecture.md`, `conventions.md`, `stack.md`, `decisions.md`.'
        ].join('\r\n');
    }

    const lines = [...preamble];
    const provenanceRows = [];
    let hasContent = false;

    for (const fileName of mdFiles) {
        const filePath = path.join(projectMemoryDir, fileName);
        const raw = readTextFile(filePath);
        const sections = extractNonEmptySections(raw);

        if (sections.length === 0) continue;
        hasContent = true;

        lines.push(`## From \`${fileName}\``, '');

        for (const section of sections) {
            lines.push(`### ${section.heading}`, '');
            lines.push(section.content, '');
            provenanceRows.push({ heading: section.heading, source: fileName });
        }
    }

    if (!hasContent) {
        lines.push(
            '## Status', '',
            'All `docs/project-memory/` files exist but contain only placeholder templates.',
            'Fill in the sections with real project knowledge to enable this summary.', ''
        );
    }

    if (provenanceRows.length > 0) {
        lines.push('---', '', '## Provenance', '',
            '| Section | Source |',
            '|---|---|');
        for (const row of provenanceRows) {
            lines.push(`| ${row.heading} | \`docs/project-memory/${row.source}\` |`);
        }
        lines.push('');
    }

    return lines.join('\r\n');
}

/**
 * Extracts level-2 heading sections that have non-empty content after stripping HTML comments.
 * Comments are stripped from the full text first so headings inside comments are ignored.
 */
function extractNonEmptySections(markdown) {
    const cleaned = stripHtmlComments(markdown);
    const lines = cleaned.split(/\r?\n/);
    const sections = [];
    let currentHeading = null;
    let currentLines = [];

    for (const line of lines) {
        const h2Match = line.match(/^##\s+(.+)$/);
        if (h2Match) {
            if (currentHeading !== null) {
                const content = currentLines.join('\n').trim();
                if (content) {
                    sections.push({ heading: currentHeading, content });
                }
            }
            currentHeading = h2Match[1].trim();
            currentLines = [];
        } else if (currentHeading !== null) {
            currentLines.push(line);
        }
    }

    if (currentHeading !== null) {
        const content = currentLines.join('\n').trim();
        if (content) {
            sections.push({ heading: currentHeading, content });
        }
    }

    return sections;
}

function stripHtmlComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, '');
}

module.exports = {
    applyAssistantDefaults,
    applyContextDefaults,
    BREVITY_PLACEHOLDER,
    CONTEXT_RULE_FILES,
    DISCOVERY_AUGMENTED_RULE_FILES,
    extractNonEmptySections,
    GENERATED_RULE_FILES,
    generateProjectMemorySummary,
    LANGUAGE_PLACEHOLDER,
    RULE_FILES,
    selectRuleSource,
    stripHtmlComments
};
