const fs = require('node:fs');
const path = require('node:path');
const { pathExists, readTextFile } = require('../core/fs.ts');
const {
    extractNonEmptySections,
    selectRuleSource,
    stripHtmlComments
} = require('./rule-materialization.ts');

/**
 * Marker file written after a successful migration so the process runs exactly once.
 */
const MIGRATION_MARKER = '.migrated-from-rules';

/**
 * Minimum number of meaningful lines that must differ between a live/legacy
 * context rule and its template source before we treat the rule as user-authored.
 */
const MEANINGFUL_DIFF_THRESHOLD = 5;

/**
 * Maps context rule files to their project-memory counterparts.
 */
const MIGRATION_RULE_MAP = Object.freeze([
    { ruleFile: '10-project-context.md', memoryFile: 'context.md', heading: 'Project Context' },
    { ruleFile: '20-architecture.md', memoryFile: 'architecture.md', heading: 'Architecture' },
    { ruleFile: '30-code-style.md', memoryFile: 'conventions.md', heading: 'Conventions' },
    { ruleFile: '40-commands.md', memoryFile: 'stack.md', heading: 'Technology Stack' }
]);

/**
 * Sections in context rule files that are template boilerplate and should not
 * be migrated (they are auto-generated or purely instructional).
 */
const BOILERPLATE_SECTIONS = new Set(['Purpose', 'Project Discovery Snapshot']);

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * One-time migration: copies user-authored content from context rule files
 * into the corresponding project-memory/ seed files.
 *
 * Guards:
 * 1. Marker file already exists → skip (already migrated).
 * 2. project-memory/ dir absent → skip.
 * 3. project-memory/ already has substantive content → skip.
 *
 * For each mapping the function:
 *   a. Finds the current rule source (legacy > live > template).
 *   b. Skips if the source is the template itself (no user edits).
 *   c. Diffs against the template; skips if ≤ threshold meaningful lines differ.
 *   d. Extracts user-authored sections and writes to the memory file.
 *
 * Finally writes the marker file and returns a result object suitable for
 * inclusion in the init report.
 *
 * IMPORTANT: call this BEFORE rule materialization so the current live/legacy
 * content has not yet been overwritten.
 *
 * @param {object} options
 * @param {string} options.bundleRoot
 * @param {string} options.targetRoot
 * @param {string} options.templateRoot
 * @param {boolean} [options.dryRun=false]
 * @returns {{ status: string, migratedFiles: Array }}
 */
function migrateContextRulesToProjectMemory(options) {
    const { bundleRoot, targetRoot, templateRoot, dryRun = false } = options;
    const projectMemoryDir = path.join(bundleRoot, 'live', 'docs', 'project-memory');
    const markerPath = path.join(projectMemoryDir, MIGRATION_MARKER);
    const templateRuleRoot = path.join(templateRoot, 'docs', 'agent-rules');
    const liveRuleRoot = path.join(bundleRoot, 'live', 'docs', 'agent-rules');

    // Guard 1: already migrated
    if (pathExists(markerPath)) {
        return { status: 'already_migrated', migratedFiles: [] };
    }

    // Guard 2: project-memory dir must exist
    if (!pathExists(projectMemoryDir)) {
        return { status: 'no_project_memory_dir', migratedFiles: [] };
    }

    // Guard 3: project-memory must contain only template seeds
    if (!isProjectMemoryOnlySeeds(projectMemoryDir)) {
        return { status: 'project_memory_has_content', migratedFiles: [] };
    }

    const migratedFiles = [];

    for (const mapping of MIGRATION_RULE_MAP) {
        const { ruleFile, memoryFile, heading } = mapping;

        // Need the template version for comparison
        const templatePath = path.join(templateRuleRoot, ruleFile);
        if (!pathExists(templatePath)) continue;
        const templateContent = readTextFile(templatePath);

        // Find where the current rule lives (before materialization)
        const source = selectRuleSource(ruleFile, { targetRoot, liveRuleRoot, templateRuleRoot });
        if (!source) continue;
        if (source.origin === 'template') continue; // no user edits

        const liveContent = readTextFile(source.path);
        const addedLines = countMeaningfulAddedLines(liveContent, templateContent);
        if (addedLines <= MEANINGFUL_DIFF_THRESHOLD) continue;

        const extracted = extractMigrationContent(liveContent, heading);
        if (!extracted || !extracted.trim()) continue;

        const destPath = path.join(projectMemoryDir, memoryFile);
        if (!dryRun) {
            fs.writeFileSync(destPath, extracted, 'utf8');
        }

        migratedFiles.push({
            ruleFile,
            memoryFile,
            origin: source.origin,
            meaningfulLinesDetected: addedLines
        });
    }

    // Write marker (even when migratedFiles is empty we still mark so we don't re-scan)
    if (!dryRun) {
        const markerLines = [
            `migrated_at: ${new Date().toISOString()}`,
            `threshold: ${MEANINGFUL_DIFF_THRESHOLD}`,
            `files_migrated: ${migratedFiles.length}`,
            ''
        ];
        if (migratedFiles.length > 0) {
            for (const f of migratedFiles) {
                markerLines.push(
                    `${f.ruleFile} -> ${f.memoryFile} (origin=${f.origin}, lines=${f.meaningfulLinesDetected})`
                );
            }
            markerLines.push('');
        }
        fs.writeFileSync(markerPath, markerLines.join('\n'), 'utf8');
    }

    return {
        status: migratedFiles.length > 0 ? 'migrated' : 'no_significant_content',
        migratedFiles
    };
}

// ────────────────────────────────────────────────────────
// Detection helpers
// ────────────────────────────────────────────────────────

/**
 * Returns true when every .md file in the project-memory directory (excluding
 * README.md and the marker) contains only template seed content (headings and
 * HTML-comment placeholders with no real prose).
 */
function isProjectMemoryOnlySeeds(projectMemoryDir) {
    let entries;
    try {
        entries = fs.readdirSync(projectMemoryDir, { withFileTypes: true });
    } catch {
        return true; // unreadable → treat as empty
    }

    const mdFiles = entries
        .filter(e =>
            e.isFile() &&
            e.name.toLowerCase().endsWith('.md') &&
            e.name.toLowerCase() !== 'readme.md'
        )
        .map(e => e.name);

    for (const fileName of mdFiles) {
        const content = readTextFile(path.join(projectMemoryDir, fileName));
        const sections = extractNonEmptySections(content);
        if (sections.length > 0) return false;
    }

    return true;
}

/**
 * Counts meaningful lines present in `liveContent` but absent from
 * `templateContent`.  Both texts are normalised (HTML comments removed,
 * Project Discovery Snapshot section stripped, lines trimmed) before
 * comparison.
 */
function countMeaningfulAddedLines(liveContent, templateContent) {
    const templateSet = new Set(getMeaningfulLines(templateContent));
    const liveLines = getMeaningfulLines(liveContent);
    return liveLines.filter(l => !templateSet.has(l)).length;
}

/**
 * Extracts meaningful (non-blank, non-heading-only, non-boilerplate) lines
 * from markdown text after stripping comments and the discovery overlay.
 */
function getMeaningfulLines(text) {
    let cleaned = stripHtmlComments(text);
    cleaned = removeSectionByHeading(cleaned, 'Project Discovery Snapshot');

    return cleaned
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l =>
            l.length > 0 &&
            !l.match(/^#+\s/) &&         // headings
            l !== '```' &&
            l !== '```text' &&
            l !== '```bash' &&
            !l.match(/^\|[-:\s|]+\|$/) && // table separator rows
            l !== '---' &&
            l !== '`TODO`' &&
            l !== 'TODO'
        );
}

/**
 * Removes an entire H2 section (heading + body) from markdown text.
 */
function removeSectionByHeading(markdown, sectionHeading) {
    const lines = markdown.split(/\r?\n/);
    const result = [];
    let skipping = false;

    for (const line of lines) {
        const h2 = line.match(/^## (.+)$/);
        if (h2) {
            skipping = h2[1].trim() === sectionHeading;
        }
        if (!skipping) {
            result.push(line);
        }
    }

    return result.join('\n');
}

// ────────────────────────────────────────────────────────
// Content extraction
// ────────────────────────────────────────────────────────

/**
 * Extracts migrateable content from a context rule file.
 *
 * - Parses the file into H2 sections.
 * - Drops known boilerplate sections (Purpose, Project Discovery Snapshot).
 * - Replaces the H1 heading with the project-memory target heading.
 * - Adds a migration provenance comment.
 */
function extractMigrationContent(ruleContent, targetHeading) {
    const lines = ruleContent.split(/\r?\n/);
    const sections = [];
    let current = null;
    let preambleLines = [];

    for (const line of lines) {
        const h2 = line.match(/^## (.+)$/);
        if (h2) {
            if (current) sections.push(current);
            current = { heading: h2[1].trim(), lines: [] };
        } else if (current) {
            current.lines.push(line);
        } else {
            preambleLines.push(line);
        }
    }
    if (current) sections.push(current);

    // Keep only non-boilerplate sections that have real content after stripping comments
    const kept = sections.filter(s => {
        if (BOILERPLATE_SECTIONS.has(s.heading)) return false;
        const body = stripHtmlComments(s.lines.join('\n')).trim();
        return body.length > 0;
    });

    if (kept.length === 0) return '';

    const output = [
        `# ${targetHeading}`,
        '',
        '<!-- Migrated from agent-rules context file. Review and restructure as needed. -->'
    ];

    for (const section of kept) {
        output.push('');
        output.push(`## ${section.heading}`);
        output.push('');
        const body = section.lines.join('\n').trimEnd();
        if (body.trim()) {
            output.push(body.trim());
        }
    }

    output.push('');
    return output.join('\n');
}

// ────────────────────────────────────────────────────────
// Report helpers
// ────────────────────────────────────────────────────────

/**
 * Builds init-report lines describing the migration outcome.
 */
function buildMigrationReportLines(migrationResult) {
    const lines = ['', '## Project-Memory Migration (T-075)'];

    if (migrationResult.status === 'already_migrated') {
        lines.push('- Status: skipped (marker file present; migration already completed).');
        return lines;
    }
    if (migrationResult.status === 'no_project_memory_dir') {
        lines.push('- Status: skipped (project-memory directory does not exist).');
        return lines;
    }
    if (migrationResult.status === 'project_memory_has_content') {
        lines.push('- Status: skipped (project-memory already contains user content).');
        return lines;
    }
    if (migrationResult.status === 'no_significant_content') {
        lines.push('- Status: no migration needed (context rules match template or have minimal edits).');
        lines.push(`- Detection threshold: >${MEANINGFUL_DIFF_THRESHOLD} meaningful lines.`);
        lines.push('- Marker file written to prevent future re-scanning.');
        return lines;
    }

    // status === 'migrated'
    lines.push('- Status: **migrated** user-authored content from context rules into `docs/project-memory/`.');
    lines.push(`- Detection threshold: >${MEANINGFUL_DIFF_THRESHOLD} meaningful lines.`);
    lines.push(`- Files migrated: ${migrationResult.migratedFiles.length}`);
    lines.push('');
    lines.push('| Rule File | Memory File | Origin | Lines Detected |');
    lines.push('|---|---|---|---|');
    for (const f of migrationResult.migratedFiles) {
        lines.push(`| ${f.ruleFile} | ${f.memoryFile} | ${f.origin} | ${f.meaningfulLinesDetected} |`);
    }
    lines.push('');
    lines.push('- Marker file written: `docs/project-memory/.migrated-from-rules`.');
    lines.push('- Context rules will revert to template-driven on next materialization.');

    return lines;
}

module.exports = {
    BOILERPLATE_SECTIONS,
    buildMigrationReportLines,
    countMeaningfulAddedLines,
    extractMigrationContent,
    getMeaningfulLines,
    isProjectMemoryOnlySeeds,
    MEANINGFUL_DIFF_THRESHOLD,
    migrateContextRulesToProjectMemory,
    MIGRATION_MARKER,
    MIGRATION_RULE_MAP
};
