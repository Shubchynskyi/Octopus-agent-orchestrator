const fs = require('node:fs');
const path = require('node:path');

const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { readJsonFile, writeJsonFile } = require('../core/json.ts');
const { getProjectDiscovery } = require('../materialization/project-discovery.ts');
const { emitSkillSuggestedEvent } = require('./skill-telemetry.ts');

const BASELINE_SKILL_DIRECTORIES = Object.freeze([
    'code-review',
    'db-review',
    'dependency-review',
    'orchestration',
    'orchestration-depth1',
    'refactor-review',
    'security-review',
    'skill-builder'
]);

const DEFAULT_INSTALLED_PACKS_PAYLOAD = Object.freeze({
    version: 1,
    installed_packs: []
});

const REVIEW_CAPABILITIES_DEFAULTS = Object.freeze({
    code: true,
    db: true,
    security: true,
    refactor: true,
    api: false,
    test: false,
    performance: false,
    infra: false,
    dependency: false
});

const OPTIONAL_REVIEW_SKILL_DIRECTORY_MAP = Object.freeze({
    api: ['api-review', 'api-contract-review'],
    test: ['test-review', 'testing-strategy'],
    performance: ['performance-review'],
    infra: ['infra-review', 'devops-k8s'],
    dependency: ['dependency-review']
});

const SKILLS_INDEX_VERSION = 1;
const OPTIONAL_SKILL_PLACEHOLDER_PATTERN = /TODO:\s*fill this optional skill\.?/i;
const SUGGESTED_SKILL_MIN_SCORE = 75;
const SUGGESTED_PACK_MIN_SCORE = 75;

function normalizeStringArray(value) {
    const items = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    const normalized = [];
    for (const item of items) {
        const text = String(item || '').trim();
        if (!text || normalized.includes(text)) {
            continue;
        }
        normalized.push(text);
    }
    return normalized.sort();
}

function normalizeOptionalString(value) {
    const text = String(value || '').trim();
    return text || null;
}

function normalizeRequiredString(value, fieldName) {
    const text = normalizeOptionalString(value);
    if (!text) {
        throw new Error(`${fieldName} is required.`);
    }
    return text;
}

function normalizeNonNegativeInteger(value, fallbackValue) {
    if (value === undefined || value === null || value === '') {
        return fallbackValue;
    }
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
        throw new Error(`Expected a non-negative integer, got '${value}'.`);
    }
    return numeric;
}

function getSkillPacksConfigPath(bundleRoot) {
    return path.join(bundleRoot, 'live', 'config', 'skill-packs.json');
}

function getSkillsIndexConfigPath(bundleRoot) {
    return path.join(bundleRoot, 'live', 'config', 'skills-index.json');
}

function getReviewCapabilitiesConfigPath(bundleRoot) {
    return path.join(bundleRoot, 'live', 'config', 'review-capabilities.json');
}

function getLiveSkillsRoot(bundleRoot) {
    return path.join(bundleRoot, 'live', 'skills');
}

function getTemplateSkillPacksRoot(bundleRoot) {
    return path.join(bundleRoot, 'template', 'skill-packs');
}

function getPackTemplateRoot(bundleRoot, packId) {
    return path.join(getTemplateSkillPacksRoot(bundleRoot), packId);
}

function getPackManifestPath(packRoot) {
    return path.join(packRoot, 'pack.json');
}

function getSkillManifestPath(skillRoot) {
    return path.join(skillRoot, 'skill.json');
}

function getTemplateSkillRelativePath(packId, skillId) {
    return path.join('template', 'skill-packs', packId, 'skills', skillId, 'SKILL.md').replace(/\\/g, '/');
}

function isPlaceholderOptionalSkill(summary, skillRoot) {
    if (OPTIONAL_SKILL_PLACEHOLDER_PATTERN.test(String(summary || ''))) {
        return true;
    }

    const skillPath = path.join(skillRoot, 'SKILL.md');
    if (!pathExists(skillPath)) {
        return false;
    }

    try {
        return OPTIONAL_SKILL_PLACEHOLDER_PATTERN.test(readTextFile(skillPath));
    } catch {
        return false;
    }
}

function readPackManifest(packRoot) {
    const manifestPath = getPackManifestPath(packRoot);
    if (!pathExists(manifestPath)) {
        throw new Error(`Skill pack manifest is missing: ${manifestPath}`);
    }

    const manifest = readJsonFile(manifestPath);
    const fallbackPackId = path.basename(packRoot);

    return {
        id: normalizeRequiredString(manifest.id || fallbackPackId, `pack.json id (${fallbackPackId})`),
        label: normalizeRequiredString(manifest.label || fallbackPackId, `pack.json label (${fallbackPackId})`),
        description: normalizeRequiredString(manifest.description, `pack.json description (${fallbackPackId})`),
        tags: normalizeStringArray(manifest.tags),
        recommendedFor: normalizeStringArray(manifest.recommended_for),
        packRoot
    };
}

function readSkillManifest(skillRoot, fallbackPackId) {
    const manifestPath = getSkillManifestPath(skillRoot);
    if (!pathExists(manifestPath)) {
        throw new Error(`Skill manifest is missing: ${manifestPath}`);
    }

    const manifest = readJsonFile(manifestPath);
    const fallbackSkillId = path.basename(skillRoot);
    const skillId = normalizeRequiredString(manifest.id || fallbackSkillId, `skill.json id (${fallbackSkillId})`);
    const packId = normalizeRequiredString(manifest.pack || fallbackPackId, `skill.json pack (${skillId})`);

    return {
        id: skillId,
        name: normalizeRequiredString(manifest.name || skillId, `skill.json name (${skillId})`),
        pack: packId,
        summary: normalizeRequiredString(manifest.summary, `skill.json summary (${skillId})`),
        tags: normalizeStringArray(manifest.tags),
        aliases: normalizeStringArray(manifest.aliases),
        stackSignals: normalizeStringArray(manifest.stack_signals),
        taskSignals: normalizeStringArray(manifest.task_signals),
        changedPathSignals: normalizeStringArray(manifest.changed_path_signals),
        references: normalizeStringArray(manifest.references),
        costHint: normalizeRequiredString(manifest.cost_hint || 'low', `skill.json cost_hint (${skillId})`),
        priority: normalizeNonNegativeInteger(manifest.priority, 50),
        autoload: normalizeRequiredString(manifest.autoload || 'never', `skill.json autoload (${skillId})`),
        deprecated: manifest.deprecated === true,
        replacedBy: normalizeOptionalString(manifest.replaced_by),
        implemented: !isPlaceholderOptionalSkill(manifest.summary, skillRoot),
        skillRoot
    };
}

function readBaselineSkillManifest(skillRoot) {
    const manifestPath = getSkillManifestPath(skillRoot);
    if (!pathExists(manifestPath)) {
        throw new Error(`Skill manifest is missing: ${manifestPath}`);
    }

    const manifest = readJsonFile(manifestPath);
    const fallbackSkillId = path.basename(skillRoot);

    return {
        id: normalizeRequiredString(manifest.id || fallbackSkillId, `skill.json id (${fallbackSkillId})`),
        name: normalizeRequiredString(manifest.name || fallbackSkillId, `skill.json name (${fallbackSkillId})`),
        summary: normalizeRequiredString(manifest.summary, `skill.json summary (${fallbackSkillId})`),
        tags: normalizeStringArray(manifest.tags),
        aliases: normalizeStringArray(manifest.aliases),
        references: normalizeStringArray(manifest.references),
        costHint: normalizeRequiredString(manifest.cost_hint || 'low', `skill.json cost_hint (${fallbackSkillId})`),
        priority: normalizeNonNegativeInteger(manifest.priority, 50),
        autoload: normalizeRequiredString(manifest.autoload || 'never', `skill.json autoload (${fallbackSkillId})`),
        skillRoot
    };
}

function collectMissingReferenceIssues(skillRoot, manifest, skillLabel) {
    const issues = [];
    for (const reference of Array.isArray(manifest.references) ? manifest.references : []) {
        const referencePath = path.join(skillRoot, 'references', reference);
        if (!pathExists(referencePath)) {
            issues.push(`${skillLabel} declares missing reference '${reference}'.`);
        }
    }
    return issues;
}

function listPackSkillDefinitions(packRoot, packId) {
    const skillsRoot = path.join(packRoot, 'skills');
    if (!pathExists(skillsRoot)) {
        return [];
    }

    return fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => readSkillManifest(path.join(skillsRoot, entry.name), packId))
        .sort((left, right) => left.id.localeCompare(right.id));
}

function listBuiltinSkillPacks(bundleRoot) {
    const templateSkillPacksRoot = getTemplateSkillPacksRoot(bundleRoot);
    if (!pathExists(templateSkillPacksRoot)) {
        return [];
    }

    return fs.readdirSync(templateSkillPacksRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const packRoot = path.join(templateSkillPacksRoot, entry.name);
            const manifest = readPackManifest(packRoot);
            const skills = listPackSkillDefinitions(packRoot, manifest.id);
            const readySkills = skills.filter((skill) => skill.implemented !== false);
            const placeholderSkills = skills.filter((skill) => skill.implemented === false);
            return {
                ...manifest,
                skills,
                skillCount: skills.length,
                skillDirectories: skills.map((skill) => skill.id),
                readySkillCount: readySkills.length,
                readySkillDirectories: readySkills.map((skill) => skill.id),
                placeholderSkillCount: placeholderSkills.length,
                placeholderSkillDirectories: placeholderSkills.map((skill) => skill.id),
                implemented: readySkills.length > 0,
                collidesWithBaseline: BASELINE_SKILL_DIRECTORIES.includes(manifest.id)
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
}

function getBuiltinSkillPackDefinition(bundleRoot, packId) {
    return listBuiltinSkillPacks(bundleRoot).find((pack) => pack.id === packId) || null;
}

function buildSkillsIndex(bundleRoot) {
    const builtinPacks = listBuiltinSkillPacks(bundleRoot);
    return {
        version: SKILLS_INDEX_VERSION,
        packs: builtinPacks.map((pack) => ({
            id: pack.id,
            label: pack.label,
            description: pack.description,
            tags: pack.tags,
            recommended_for: pack.recommendedFor,
            skill_count: pack.skillCount,
            ready_skill_count: pack.readySkillCount,
            placeholder_skill_count: pack.placeholderSkillCount,
            implemented: pack.implemented,
            collides_with_baseline: pack.collidesWithBaseline
        })),
        skills: builtinPacks
            .flatMap((pack) => pack.skills.map((skill) => ({
                id: skill.id,
                name: skill.name,
                pack: skill.pack,
                summary: skill.summary,
                tags: skill.tags,
                aliases: skill.aliases,
                stack_signals: skill.stackSignals,
                task_signals: skill.taskSignals,
                changed_path_signals: skill.changedPathSignals,
                references: skill.references,
                cost_hint: skill.costHint,
                priority: skill.priority,
                autoload: skill.autoload,
                deprecated: skill.deprecated,
                replaced_by: skill.replacedBy,
                implemented: skill.implemented !== false,
                template_skill_path: getTemplateSkillRelativePath(pack.id, skill.id)
            })))
            .sort((left, right) => left.id.localeCompare(right.id))
    };
}

function writeSkillsIndex(bundleRoot) {
    const indexPath = getSkillsIndexConfigPath(bundleRoot);
    ensureDirectory(path.dirname(indexPath));
    writeJsonFile(indexPath, buildSkillsIndex(bundleRoot));
    return indexPath;
}

function readSkillsIndex(bundleRoot) {
    const indexPath = getSkillsIndexConfigPath(bundleRoot);
    if (!pathExists(indexPath)) {
        throw new Error(`Skills index is missing: ${indexPath}`);
    }

    const payload = readJsonFile(indexPath);
    if (!payload || !Array.isArray(payload.packs) || !Array.isArray(payload.skills)) {
        throw new Error(`Skills index has an invalid shape: ${indexPath}`);
    }

    return {
        indexPath,
        payload
    };
}

function normalizeReviewCapabilitiesConfig(raw) {
    const normalized = {};
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    for (const [key, fallbackValue] of Object.entries(REVIEW_CAPABILITIES_DEFAULTS)) {
        normalized[key] = key in source ? !!source[key] : fallbackValue;
    }

    return normalized;
}

function readTemplateReviewCapabilities(bundleRoot) {
    const templatePath = path.join(bundleRoot, 'template', 'config', 'review-capabilities.json');
    if (!pathExists(templatePath)) {
        return { ...REVIEW_CAPABILITIES_DEFAULTS };
    }

    try {
        return normalizeReviewCapabilitiesConfig(readJsonFile(templatePath));
    } catch {
        return { ...REVIEW_CAPABILITIES_DEFAULTS };
    }
}

// ---------------------------------------------------------------------------
// Fuzzy alias expansion – deterministic, reviewable synonym groups for
// abbreviation ↔ full-name matching (T-078).
// Each inner array is a group of equivalent terms.  Matching is symmetric:
// if signal says "kubernetes" and text says "k8s" (or vice-versa), the
// alias layer bridges the gap.  All terms are compared lowercased.
// ---------------------------------------------------------------------------
const FUZZY_ALIAS_GROUPS = Object.freeze([
    ['k8s', 'kubernetes', 'kube'],
    ['pg', 'postgres', 'postgresql', 'pgsql'],
    ['js', 'javascript'],
    ['ts', 'typescript'],
    ['dotnet', '.net', 'csharp', 'c#'],
    ['py', 'python'],
    ['rb', 'ruby'],
    ['rs', 'rust'],
    ['tf', 'terraform'],
    ['mongo', 'mongodb'],
    ['gql', 'graphql'],
    ['nodejs', 'node.js'],
    ['reactjs', 'react.js'],
    ['vuejs', 'vue.js'],
    ['nextjs', 'next.js'],
    ['sveltekit', 'svelte-kit'],
    ['expressjs', 'express.js'],
    ['fastapi', 'fast-api'],
]);

let _fuzzyAliasMap = null;

function getFuzzyAliasMap() {
    if (_fuzzyAliasMap) {
        return _fuzzyAliasMap;
    }
    _fuzzyAliasMap = new Map();
    for (const group of FUZZY_ALIAS_GROUPS) {
        for (const term of group) {
            const key = term.toLowerCase();
            const aliases = _fuzzyAliasMap.get(key) || [];
            for (const other of group) {
                const otherKey = other.toLowerCase();
                if (otherKey !== key && !aliases.includes(otherKey)) {
                    aliases.push(otherKey);
                }
            }
            _fuzzyAliasMap.set(key, aliases);
        }
    }
    return _fuzzyAliasMap;
}

function containsAtWordBoundary(text, term) {
    let startIndex = 0;
    while (startIndex <= text.length - term.length) {
        const idx = text.indexOf(term, startIndex);
        if (idx === -1) {
            return false;
        }
        const before = idx > 0 ? text[idx - 1] : '';
        const after = idx + term.length < text.length ? text[idx + term.length] : '';
        const boundaryBefore = !before || /[^a-z0-9]/.test(before);
        const boundaryAfter = !after || /[^a-z0-9]/.test(after);
        if (boundaryBefore && boundaryAfter) {
            return true;
        }
        startIndex = idx + 1;
    }
    return false;
}

function getSignalFuzzyVariants(normalizedSignal) {
    const aliasMap = getFuzzyAliasMap();
    const variants = [];
    for (const [term, aliases] of aliasMap) {
        if (!containsAtWordBoundary(normalizedSignal, term)) {
            continue;
        }
        for (const alias of aliases) {
            const variant = normalizedSignal.replace(term, alias);
            if (variant !== normalizedSignal && !variants.includes(variant)) {
                variants.push(variant);
            }
        }
    }
    return variants;
}

function textMatchesFuzzyVariant(text, normalizedSignal) {
    const variants = getSignalFuzzyVariants(normalizedSignal);
    for (const variant of variants) {
        if (containsAtWordBoundary(text, variant)) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------

function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeSearchTokens(value) {
    return normalizeSearchText(value)
        .split(/[^a-z0-9.+#/_-]+/i)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeSignalText(value) {
    return normalizeSearchText(value).replace(/\*/g, '').replace(/\\/g, '/');
}

function normalizeChangedPath(targetRoot, value) {
    const text = String(value || '').trim();
    if (!text) {
        return null;
    }

    if (!path.isAbsolute(text)) {
        return text.replace(/\\/g, '/');
    }

    const resolvedRoot = path.resolve(targetRoot);
    const resolvedPath = path.resolve(text);
    const relativePath = path.relative(resolvedRoot, resolvedPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return resolvedPath.replace(/\\/g, '/');
}

function textContainsSignal(text, signal) {
    const normalizedSignal = normalizeSignalText(signal);
    if (!normalizedSignal) {
        return false;
    }
    const normalizedText = normalizeSearchText(text);
    if (normalizedText.includes(normalizedSignal)) {
        return true;
    }
    return textMatchesFuzzyVariant(normalizedText, normalizedSignal);
}

function anyPathMatchesSignal(paths, signal) {
    const normalizedSignal = normalizeSignalText(signal);
    if (!normalizedSignal) {
        return false;
    }

    return paths.some((candidate) => {
        const normalizedCandidate = String(candidate || '').replace(/\\/g, '/').toLowerCase();
        if (normalizedCandidate.includes(normalizedSignal)) {
            return true;
        }
        return textMatchesFuzzyVariant(normalizedCandidate, normalizedSignal);
    });
}

function getSignalMatches(signals, matcher) {
    const matches = [];
    for (const signal of Array.isArray(signals) ? signals : []) {
        const text = String(signal || '').trim();
        if (!text || matches.includes(text)) {
            continue;
        }
        if (matcher(text)) {
            matches.push(text);
        }
    }
    return matches.sort();
}

function buildSuggestionContext(targetRoot, taskText, changedPaths) {
    const discovery = getProjectDiscovery(targetRoot);
    const normalizedChangedPaths = normalizeStringArray(changedPaths)
        .map((item) => normalizeChangedPath(targetRoot, item))
        .filter(Boolean);
    const projectPaths = Array.isArray(discovery.relativeFiles) ? discovery.relativeFiles : [];
    const taskTextValue = String(taskText || '').trim();
    const textCorpus = [
        taskTextValue,
        ...discovery.detectedStacks,
        ...discovery.topLevelDirectories,
        ...projectPaths,
        ...normalizedChangedPaths
    ].join('\n');

    return {
        discovery,
        taskText: taskTextValue,
        taskTextLower: normalizeSearchText(taskTextValue),
        projectPaths,
        changedPaths: normalizedChangedPaths,
        textCorpus,
        textCorpusLower: normalizeSearchText(textCorpus)
    };
}

function scoreSkillSuggestion(skill, context, installedPackIds) {
    const aliasSignals = [
        skill.id,
        skill.name,
        ...(Array.isArray(skill.aliases) ? skill.aliases : [])
    ];

    const stackMatches = getSignalMatches(skill.stack_signals, (signal) => (
        textContainsSignal(context.textCorpusLower, signal) || anyPathMatchesSignal(context.projectPaths, signal)
    ));
    const taskMatches = getSignalMatches(skill.task_signals, (signal) => (
        textContainsSignal(context.taskTextLower, signal)
    ));
    const changedPathMatches = getSignalMatches(skill.changed_path_signals, (signal) => (
        anyPathMatchesSignal(context.changedPaths, signal)
    ));
    const projectPathMatches = getSignalMatches(skill.changed_path_signals, (signal) => (
        anyPathMatchesSignal(context.projectPaths, signal)
    )).filter((signal) => !changedPathMatches.includes(signal));
    const aliasMatches = getSignalMatches(aliasSignals, (signal) => (
        textContainsSignal(context.taskTextLower, signal) || anyPathMatchesSignal(context.changedPaths, signal)
    ));

    const evidenceCount =
        stackMatches.length +
        taskMatches.length +
        changedPathMatches.length +
        projectPathMatches.length +
        aliasMatches.length;

    if (evidenceCount === 0) {
        return null;
    }

    if (Array.isArray(skill.stack_signals) && skill.stack_signals.length > 0 && stackMatches.length === 0 && aliasMatches.length === 0) {
        return null;
    }

    let score = 0;
    score += stackMatches.length * 40;
    score += taskMatches.length * 24;
    score += changedPathMatches.length * 30;
    score += projectPathMatches.length * 10;
    score += aliasMatches.length * 12;
    score += Math.min(Number(skill.priority || 0), 100) / 100;
    if (skill.deprecated) {
        score -= 25;
    }

    return {
        id: skill.id,
        name: skill.name,
        pack: skill.pack,
        summary: skill.summary,
        score,
        installed: installedPackIds.includes(skill.pack),
        matches: {
            stack_signals: stackMatches,
            task_signals: taskMatches,
            changed_path_signals: changedPathMatches,
            project_path_signals: projectPathMatches,
            aliases_or_tags: aliasMatches
        }
    };
}

// ---------------------------------------------------------------------------
// Same-pack dedupe – keeps the top-N suggestion list diverse across packs
// (T-080).  The strongest skill per pack is always preserved.  Additional
// same-pack skills survive only when they contribute evidence in a signal
// category the primary skill does not cover.
// ---------------------------------------------------------------------------
const MATCH_CATEGORIES = Object.freeze([
    'stack_signals', 'task_signals', 'changed_path_signals',
    'project_path_signals', 'aliases_or_tags'
]);

function hasDistinctSignalCoverage(primarySkill, candidateSkill) {
    for (const category of MATCH_CATEGORIES) {
        const primaryMatches = (primarySkill.matches && primarySkill.matches[category]) || [];
        const candidateMatches = (candidateSkill.matches && candidateSkill.matches[category]) || [];
        if (primaryMatches.length === 0 && candidateMatches.length > 0) {
            return true;
        }
    }
    return false;
}

function dedupeSkillsByPack(sortedSkills) {
    const topByPack = new Map();
    const primary = [];
    const collapsed = [];

    for (const skill of sortedSkills) {
        const existing = topByPack.get(skill.pack);
        if (!existing) {
            topByPack.set(skill.pack, skill);
            primary.push(skill);
            continue;
        }
        if (hasDistinctSignalCoverage(existing, skill)) {
            primary.push(skill);
            continue;
        }
        collapsed.push(skill);
    }

    return { primary, collapsed };
}

// ---------------------------------------------------------------------------

function aggregatePackSuggestions(skillSuggestions, packIndex, installedPackIds) {
    const byPackId = new Map();

    for (const suggestion of skillSuggestions) {
        const existing = byPackId.get(suggestion.pack) || {
            id: suggestion.pack,
            score: 0,
            skillIds: [],
            matches: {
                stack_signals: [],
                task_signals: [],
                changed_path_signals: [],
                project_path_signals: [],
                aliases_or_tags: []
            }
        };

        existing.score = Math.max(existing.score, suggestion.score);
        existing.skillIds.push(suggestion.id);

        for (const key of Object.keys(existing.matches)) {
            for (const item of suggestion.matches[key]) {
                if (!existing.matches[key].includes(item)) {
                    existing.matches[key].push(item);
                }
            }
        }

        byPackId.set(suggestion.pack, existing);
    }

    return Array.from(byPackId.values())
        .map((entry) => {
            const pack = packIndex.get(entry.id) || { id: entry.id, label: entry.id, description: '' };
            return {
                id: entry.id,
                label: pack.label,
                description: pack.description,
                implemented: pack.implemented !== false,
                collidesWithBaseline: pack.collides_with_baseline === true,
                score: entry.score,
                installed: installedPackIds.includes(entry.id),
                skillIds: entry.skillIds.sort(),
                matches: entry.matches
            };
        })
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.id.localeCompare(right.id);
        });
}

function suggestSkills(bundleRoot, targetRoot, options = {}) {
    const { indexPath, payload } = readSkillsIndex(bundleRoot);
    const { installedPackIds } = readInstalledSkillPacks(bundleRoot);
    const listing = listSkillPacks(bundleRoot);
    const liveSkillDirectorySet = new Set(listing.liveSkillDirectories);
    const context = buildSuggestionContext(targetRoot, options.taskText || '', options.changedPaths || []);
    const packIndex = new Map((payload.packs || []).map((pack) => [pack.id, pack]));
    const limit = normalizeNonNegativeInteger(options.limit, 7) || 7;
    const packLimit = normalizeNonNegativeInteger(options.packLimit, 5) || 5;

    const allSkillSuggestions = (payload.skills || [])
        .filter((skill) => skill && skill.implemented !== false)
        .map((skill) => scoreSkillSuggestion(skill, context, installedPackIds))
        .filter(Boolean)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.id.localeCompare(right.id);
        });

    const availableRelevantSkillsFull = allSkillSuggestions.filter((skill) => liveSkillDirectorySet.has(skill.id));
    const suggestedSkillsFull = allSkillSuggestions.filter((skill) => (
        !liveSkillDirectorySet.has(skill.id) &&
        skill.score >= SUGGESTED_SKILL_MIN_SCORE
    ));

    // Pack aggregation uses the full (non-deduped) skill lists so pack
    // scores and match summaries remain comprehensive.
    const availableRelevantPacks = aggregatePackSuggestions(availableRelevantSkillsFull, packIndex, installedPackIds);
    const suggestedPacks = aggregatePackSuggestions(suggestedSkillsFull, packIndex, installedPackIds)
        .filter((pack) => !pack.installed && pack.score >= SUGGESTED_PACK_MIN_SCORE);

    // Dedupe same-pack skills to keep top-N diverse across packs (T-080).
    const suggestedDedupe = dedupeSkillsByPack(suggestedSkillsFull);
    const availableDedupe = dedupeSkillsByPack(availableRelevantSkillsFull);

    const cappedSuggestedSkills = suggestedDedupe.primary.slice(0, limit);

    // Emit skill_suggested telemetry when a taskId is provided.
    const taskId = options.taskId || null;
    if (taskId) {
        for (const suggestion of cappedSuggestedSkills) {
            emitSkillSuggestedEvent(bundleRoot, taskId, suggestion, 'context_match');
        }
    }

    return {
        bundleRoot,
        targetRoot: path.resolve(targetRoot),
        indexPath,
        configPath: getSkillPacksConfigPath(bundleRoot),
        installedPackIds,
        baselineSkillDirectories: [...listing.baselineSkillDirectories],
        liveSkillDirectories: [...listing.liveSkillDirectories],
        installedOptionalSkillDirectories: [...listing.installedOptionalSkillDirectories],
        customSkillDirectories: [...listing.customSkillDirectories],
        taskText: context.taskText,
        changedPaths: context.changedPaths,
        discovery: {
            source: context.discovery.source,
            detectedStacks: context.discovery.detectedStacks,
            topLevelDirectories: context.discovery.topLevelDirectories
        },
        availableRelevantPacks: availableRelevantPacks.slice(0, packLimit),
        availableRelevantSkills: availableDedupe.primary.slice(0, limit),
        suggestedPacks: suggestedPacks.slice(0, packLimit),
        suggestedSkills: cappedSuggestedSkills,
        collapsedSamePackSkills: suggestedDedupe.collapsed,
        collapsedAvailableRelevantSkills: availableDedupe.collapsed
    };
}

function validateInstalledPackIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || normalized.includes(text)) {
            continue;
        }
        normalized.push(text);
    }

    return normalized.sort();
}

function readInstalledSkillPacks(bundleRoot) {
    const configPath = getSkillPacksConfigPath(bundleRoot);
    if (!pathExists(configPath)) {
        return {
            configPath,
            installedPackIds: []
        };
    }

    const payload = readJsonFile(configPath);
    return {
        configPath,
        installedPackIds: validateInstalledPackIds(payload.installed_packs)
    };
}

function writeInstalledSkillPacks(bundleRoot, installedPackIds) {
    const configPath = getSkillPacksConfigPath(bundleRoot);
    writeJsonFile(configPath, {
        ...DEFAULT_INSTALLED_PACKS_PAYLOAD,
        installed_packs: validateInstalledPackIds(installedPackIds)
    });
    return configPath;
}

function listLiveSkillDirectories(bundleRoot) {
    const liveSkillsRoot = getLiveSkillsRoot(bundleRoot);
    if (!pathExists(liveSkillsRoot)) {
        return [];
    }

    return fs.readdirSync(liveSkillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function syncReviewCapabilities(bundleRoot) {
    const configPath = getReviewCapabilitiesConfigPath(bundleRoot);
    const capabilities = readTemplateReviewCapabilities(bundleRoot);
    const liveSkillDirectorySet = new Set(listLiveSkillDirectories(bundleRoot));

    for (const [capabilityKey, candidateDirectories] of Object.entries(OPTIONAL_REVIEW_SKILL_DIRECTORY_MAP)) {
        capabilities[capabilityKey] = candidateDirectories.some((candidate) => liveSkillDirectorySet.has(candidate));
    }

    ensureDirectory(path.dirname(configPath));
    writeJsonFile(configPath, capabilities);

    return {
        configPath,
        capabilities
    };
}

function listSkillPacks(bundleRoot) {
    const installed = readInstalledSkillPacks(bundleRoot);
    const liveSkillDirectories = listLiveSkillDirectories(bundleRoot);
    const builtinPacks = listBuiltinSkillPacks(bundleRoot);
    const managedPackSkillDirs = new Set();

    for (const packId of installed.installedPackIds) {
        const pack = builtinPacks.find((candidate) => candidate.id === packId);
        if (!pack) {
            continue;
        }
        for (const skillDir of pack.skillDirectories) {
            managedPackSkillDirs.add(skillDir);
        }
    }

    const customSkillDirectories = liveSkillDirectories.filter((skillDir) => {
        return !BASELINE_SKILL_DIRECTORIES.includes(skillDir) && !managedPackSkillDirs.has(skillDir);
    });
    const installedOptionalSkillDirectories = liveSkillDirectories.filter((skillDir) => managedPackSkillDirs.has(skillDir));

    return {
        configPath: installed.configPath,
        indexPath: getSkillsIndexConfigPath(bundleRoot),
        baselineSkillDirectories: [...BASELINE_SKILL_DIRECTORIES],
        liveSkillDirectories,
        installedPackIds: installed.installedPackIds,
        installedOptionalSkillDirectories,
        builtinPacks: builtinPacks.map((pack) => ({
            id: pack.id,
            label: pack.label,
            description: pack.description,
            tags: pack.tags,
            recommendedFor: pack.recommendedFor,
            skillCount: pack.skillCount,
            readySkillCount: pack.readySkillCount,
            readySkillDirectories: [...pack.readySkillDirectories],
            placeholderSkillCount: pack.placeholderSkillCount,
            placeholderSkillDirectories: [...pack.placeholderSkillDirectories],
            implemented: pack.implemented,
            collidesWithBaseline: pack.collidesWithBaseline,
            skillDirectories: [...pack.skillDirectories],
            installed: installed.installedPackIds.includes(pack.id)
        })),
        customSkillDirectories
    };
}

function copyDirectoryRecursive(sourcePath, destinationPath) {
    ensureDirectory(destinationPath);
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
        const sourceEntryPath = path.join(sourcePath, entry.name);
        const destinationEntryPath = path.join(destinationPath, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourceEntryPath, destinationEntryPath);
        } else {
            ensureDirectory(path.dirname(destinationEntryPath));
            fs.copyFileSync(sourceEntryPath, destinationEntryPath);
        }
    }
}

function addSkillPack(bundleRoot, packId) {
    const pack = getBuiltinSkillPackDefinition(bundleRoot, packId);
    if (!pack) {
        throw new Error(`Unknown skill pack '${packId}'.`);
    }

    const templateRoot = getPackTemplateRoot(bundleRoot, packId);
    if (!pathExists(templateRoot)) {
        throw new Error(`Skill pack template is missing: ${templateRoot}`);
    }

    const current = readInstalledSkillPacks(bundleRoot);
    if (current.installedPackIds.includes(packId)) {
        return {
            packId,
            changed: false,
            installedPackIds: current.installedPackIds,
            installedSkillDirectories: [...pack.skillDirectories],
            configPath: current.configPath
        };
    }

    const liveSkillsRoot = getLiveSkillsRoot(bundleRoot);
    ensureDirectory(liveSkillsRoot);

    for (const skillDir of pack.skillDirectories) {
        const sourceSkillDir = path.join(templateRoot, 'skills', skillDir);
        const destinationSkillDir = path.join(liveSkillsRoot, skillDir);
        if (!pathExists(sourceSkillDir)) {
            throw new Error(`Skill pack asset is missing: ${sourceSkillDir}`);
        }
        if (pathExists(destinationSkillDir)) {
            throw new Error(`Cannot install skill pack '${packId}' because '${destinationSkillDir}' already exists.`);
        }
        copyDirectoryRecursive(sourceSkillDir, destinationSkillDir);
    }

    const updatedPackIds = [...current.installedPackIds, packId].sort();
    const configPath = writeInstalledSkillPacks(bundleRoot, updatedPackIds);
    const reviewCapabilities = syncReviewCapabilities(bundleRoot);

    return {
        packId,
        changed: true,
        installedPackIds: updatedPackIds,
        installedSkillDirectories: [...pack.skillDirectories],
        configPath,
        reviewCapabilitiesPath: reviewCapabilities.configPath,
        reviewCapabilities: reviewCapabilities.capabilities
    };
}

function removeSkillPack(bundleRoot, packId) {
    const pack = getBuiltinSkillPackDefinition(bundleRoot, packId);
    if (!pack) {
        throw new Error(`Unknown skill pack '${packId}'.`);
    }

    const current = readInstalledSkillPacks(bundleRoot);
    if (!current.installedPackIds.includes(packId)) {
        return {
            packId,
            changed: false,
            removedSkillDirectories: [],
            installedPackIds: current.installedPackIds,
            configPath: current.configPath
        };
    }

    const liveSkillsRoot = getLiveSkillsRoot(bundleRoot);
    const removedSkillDirectories = [];
    for (const skillDir of pack.skillDirectories) {
        const destinationSkillDir = path.join(liveSkillsRoot, skillDir);
        if (pathExists(destinationSkillDir)) {
            fs.rmSync(destinationSkillDir, { recursive: true, force: true });
            removedSkillDirectories.push(skillDir);
        }
    }

    const updatedPackIds = current.installedPackIds.filter((candidate) => candidate !== packId);
    const configPath = writeInstalledSkillPacks(bundleRoot, updatedPackIds);
    const reviewCapabilities = syncReviewCapabilities(bundleRoot);

    return {
        packId,
        changed: true,
        removedSkillDirectories,
        installedPackIds: updatedPackIds,
        configPath,
        reviewCapabilitiesPath: reviewCapabilities.configPath,
        reviewCapabilities: reviewCapabilities.capabilities
    };
}

function validateSkillsIndex(bundleRoot) {
    const indexPath = getSkillsIndexConfigPath(bundleRoot);
    const issues = [];
    const expected = buildSkillsIndex(bundleRoot);

    if (!pathExists(indexPath)) {
        issues.push(`Skills index is missing: ${indexPath}`);
        return { indexPath, expected, issues, passed: false };
    }

    let parsed = null;
    try {
        parsed = readJsonFile(indexPath);
    } catch (error) {
        issues.push(`Skills index is not valid JSON: ${indexPath}`);
        return { indexPath, expected, issues, passed: false };
    }

    const actualSerialized = JSON.stringify(parsed);
    const expectedSerialized = JSON.stringify(expected);
    if (actualSerialized !== expectedSerialized) {
        issues.push(`Skills index is stale: ${indexPath}. Re-run init/materialization to refresh it.`);
    }

    return {
        indexPath,
        expected,
        issues,
        passed: issues.length === 0
    };
}

function validateSkillPacks(bundleRoot) {
    const listing = listSkillPacks(bundleRoot);
    const issues = [];
    const liveSkillsRoot = getLiveSkillsRoot(bundleRoot);
    const liveSkillsReadmePath = path.join(liveSkillsRoot, 'README.md');

    if (!pathExists(liveSkillsReadmePath)) {
        issues.push(`Live skills README is missing: ${liveSkillsReadmePath}`);
    }

    for (const skillDir of BASELINE_SKILL_DIRECTORIES) {
        const skillRoot = path.join(liveSkillsRoot, skillDir);
        const skillPath = path.join(skillRoot, 'SKILL.md');
        const skillManifestPath = path.join(skillRoot, 'skill.json');

        if (!pathExists(skillRoot)) {
            issues.push(`Baseline skill directory is missing: ${skillRoot}`);
            continue;
        }

        if (!pathExists(skillManifestPath)) {
            issues.push(`Baseline skill '${skillDir}' is missing '${skillDir}/skill.json'.`);
        } else {
            try {
                const manifest = readBaselineSkillManifest(skillRoot);
                if (manifest.id !== skillDir) {
                    issues.push(`Baseline skill '${skillDir}' declares id '${manifest.id}' instead of '${skillDir}'.`);
                }
                issues.push(...collectMissingReferenceIssues(skillRoot, manifest, `Baseline skill '${skillDir}'`));
            } catch (error) {
                issues.push(`Baseline skill '${skillDir}' has an invalid manifest: ${String((error && error.message) || error)}`);
            }
        }

        if (!pathExists(skillPath)) {
            issues.push(`Baseline skill '${skillDir}' is missing '${skillDir}/SKILL.md'.`);
        }
    }

    for (const pack of listing.builtinPacks) {
        if (pack.collidesWithBaseline) {
            issues.push(`Optional skill pack '${pack.id}' collides with baseline skill id '${pack.id}'. Optional packs must not duplicate baseline skills.`);
        }
        for (const skillDir of pack.skillDirectories) {
            if (BASELINE_SKILL_DIRECTORIES.includes(skillDir)) {
                issues.push(`Optional skill pack '${pack.id}' includes skill directory '${skillDir}' that duplicates a baseline skill.`);
            }
        }
    }

    for (const packId of listing.installedPackIds) {
        const pack = getBuiltinSkillPackDefinition(bundleRoot, packId);
        if (!pack) {
            issues.push(`Installed skill pack '${packId}' is not a known built-in pack.`);
            continue;
        }

        for (const skillDir of pack.skillDirectories) {
            const skillRoot = path.join(getLiveSkillsRoot(bundleRoot), skillDir);
            const skillPath = path.join(skillRoot, 'SKILL.md');
            const skillManifestPath = path.join(skillRoot, 'skill.json');

            if (!pathExists(skillRoot)) {
                issues.push(`Installed skill pack '${packId}' is missing live skill directory '${skillDir}'.`);
                continue;
            }

            if (!pathExists(skillManifestPath)) {
                issues.push(`Installed skill pack '${packId}' is missing '${skillDir}/skill.json'.`);
            } else {
                try {
                    const manifest = readSkillManifest(skillRoot, packId);
                    if (manifest.id !== skillDir) {
                        issues.push(`Installed skill '${skillDir}' declares id '${manifest.id}' instead of '${skillDir}'.`);
                    }
                    if (manifest.pack !== packId) {
                        issues.push(`Installed skill '${skillDir}' declares pack '${manifest.pack}' instead of '${packId}'.`);
                    }
                    issues.push(...collectMissingReferenceIssues(skillRoot, manifest, `Installed skill '${skillDir}'`));
                } catch (error) {
                    issues.push(`Installed skill '${skillDir}' has an invalid manifest: ${String((error && error.message) || error)}`);
                }
            }

            if (!pathExists(skillPath)) {
                issues.push(`Installed skill pack '${packId}' is missing '${skillDir}/SKILL.md'.`);
            }
        }
    }

    const skillsIndexValidation = validateSkillsIndex(bundleRoot);
    issues.push(...skillsIndexValidation.issues);

    return {
        ...listing,
        issues,
        passed: issues.length === 0
    };
}

module.exports = {
    BASELINE_SKILL_DIRECTORIES,
    FUZZY_ALIAS_GROUPS,
    MATCH_CATEGORIES,
    SKILLS_INDEX_VERSION,
    addSkillPack,
    buildSkillsIndex,
    containsAtWordBoundary,
    dedupeSkillsByPack,
    getBuiltinSkillPackDefinition,
    getFuzzyAliasMap,
    getReviewCapabilitiesConfigPath,
    getSignalFuzzyVariants,
    getSkillPacksConfigPath,
    getSkillsIndexConfigPath,
    hasDistinctSignalCoverage,
    listBuiltinSkillPacks,
    listSkillPacks,
    readSkillsIndex,
    readInstalledSkillPacks,
    removeSkillPack,
    suggestSkills,
    syncReviewCapabilities,
    textMatchesFuzzyVariant,
    validateSkillPacks,
    validateSkillsIndex,
    writeInstalledSkillPacks,
    writeSkillsIndex
};
