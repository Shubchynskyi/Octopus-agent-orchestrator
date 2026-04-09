import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileReviewPolicy {
    code: boolean | 'auto';
    db: boolean | 'auto';
    security: boolean | 'auto';
    refactor: boolean | 'auto';
    [key: string]: boolean | 'auto';
}

export interface ProfileTokenEconomy {
    enabled: boolean;
    strip_examples: boolean;
    strip_code_blocks: boolean;
    scoped_diffs: boolean;
    compact_reviewer_output: boolean;
}

export interface ProfileSkills {
    auto_suggest: boolean;
    [key: string]: boolean;
}

export interface ProfileEntry {
    description: string;
    depth: number;
    review_policy: ProfileReviewPolicy;
    token_economy: ProfileTokenEconomy;
    skills: ProfileSkills;
}

export interface ProfilesData {
    version: number;
    active_profile: string;
    built_in_profiles: Record<string, ProfileEntry>;
    user_profiles: Record<string, ProfileEntry>;
}

export interface ReviewCapabilities {
    code: boolean;
    db: boolean;
    security: boolean;
    refactor: boolean;
    api: boolean;
    test: boolean;
    performance: boolean;
    infra: boolean;
    dependency: boolean;
    [key: string]: boolean;
}

export interface TokenEconomyConfig {
    enabled: boolean;
    enabled_depths: number[];
    strip_examples: boolean;
    strip_code_blocks: boolean;
    scoped_diffs: boolean;
    compact_reviewer_output: boolean;
    fail_tail_lines: number;
}

export interface SkillPacksConfig {
    version: number;
    installed_packs: string[];
}

export interface EffectiveReviewPolicy {
    code: boolean;
    db: boolean | 'auto';
    security: boolean | 'auto';
    refactor: boolean | 'auto';
    api: boolean | 'auto';
    test: boolean | 'auto';
    performance: boolean | 'auto';
    infra: boolean | 'auto';
    dependency: boolean | 'auto';
    [key: string]: boolean | 'auto';
}

export interface PathsConfig {
    metrics_path: string;
    runtime_roots: string[];
    fast_path_roots: string[];
    fast_path_allowed_regexes: string[];
    fast_path_sensitive_regexes: string[];
    sql_or_migration_regexes: string[];
    triggers: Record<string, string[]>;
    code_like_regexes: string[];
}

export interface EffectivePolicy {
    profile_name: string;
    profile_source: 'built_in' | 'user';
    depth: number;
    review_policy: EffectiveReviewPolicy;
    token_economy: TokenEconomyConfig;
    skills: ProfileSkills;
    installed_packs: string[];
    paths: PathsConfig;
    safety_floors_applied: string[];
    resolution_sources: {
        profiles: string;
        review_capabilities: string;
        token_economy: string;
        skill_packs: string;
        paths: string;
    };
}

export interface ResolveOptions {
    /** Override the profile name instead of using active_profile. */
    profileOverride?: string;
    /** Whether the task scope involves code changes (triggers safety floors). */
    isCodeChangingTask?: boolean;
}

// ---------------------------------------------------------------------------
// Mandatory review safety floors for code-changing work
// ---------------------------------------------------------------------------

const CODE_CHANGING_SAFETY_FLOORS: ReadonlyMap<string, boolean> = new Map([
    ['code', true]
]);

// ---------------------------------------------------------------------------
// Config file loaders (read-only, never write)
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
}

export function loadProfilesData(profilesPath: string): ProfilesData {
    const data = readJsonFile<ProfilesData>(profilesPath);
    if (!data) throw new Error(`Profiles config not found: ${profilesPath}`);
    if (!data.active_profile || !data.built_in_profiles) {
        throw new Error(`Invalid profiles config at: ${profilesPath}`);
    }
    return data;
}

export function loadReviewCapabilities(configPath: string): ReviewCapabilities {
    const defaults: ReviewCapabilities = {
        code: true, db: true, security: true, refactor: true,
        api: false, test: false, performance: false, infra: false, dependency: false
    };
    const data = readJsonFile<Record<string, unknown>>(configPath);
    if (!data) return defaults;
    for (const key of Object.keys(defaults)) {
        if (key in data && typeof data[key] === 'boolean') {
            defaults[key] = data[key] as boolean;
        }
    }
    return defaults;
}

export function loadTokenEconomyConfig(configPath: string): TokenEconomyConfig {
    const defaults: TokenEconomyConfig = {
        enabled: true,
        enabled_depths: [1, 2],
        strip_examples: true,
        strip_code_blocks: true,
        scoped_diffs: true,
        compact_reviewer_output: true,
        fail_tail_lines: 50
    };
    const data = readJsonFile<Record<string, unknown>>(configPath);
    if (!data) return defaults;
    if (typeof data.enabled === 'boolean') defaults.enabled = data.enabled;
    if (Array.isArray(data.enabled_depths)) {
        defaults.enabled_depths = data.enabled_depths.filter((v): v is number => typeof v === 'number');
    }
    if (typeof data.strip_examples === 'boolean') defaults.strip_examples = data.strip_examples;
    if (typeof data.strip_code_blocks === 'boolean') defaults.strip_code_blocks = data.strip_code_blocks;
    if (typeof data.scoped_diffs === 'boolean') defaults.scoped_diffs = data.scoped_diffs;
    if (typeof data.compact_reviewer_output === 'boolean') defaults.compact_reviewer_output = data.compact_reviewer_output;
    if (typeof data.fail_tail_lines === 'number' && data.fail_tail_lines >= 1) defaults.fail_tail_lines = data.fail_tail_lines;
    return defaults;
}

export function loadSkillPacksConfig(configPath: string): SkillPacksConfig {
    const defaults: SkillPacksConfig = { version: 1, installed_packs: [] };
    const data = readJsonFile<Record<string, unknown>>(configPath);
    if (!data) return defaults;
    if (typeof data.version === 'number') defaults.version = data.version;
    if (Array.isArray(data.installed_packs)) {
        defaults.installed_packs = data.installed_packs.filter((v): v is string => typeof v === 'string');
    }
    return defaults;
}

const DEFAULT_PATHS_CONFIG: PathsConfig = {
    metrics_path: '',
    runtime_roots: ['src/', 'app/', 'apps/', 'backend/', 'frontend/', 'web/', 'api/', 'services/', 'packages/'],
    fast_path_roots: ['frontend/', 'web/', 'ui/', 'mobile/', 'apps/'],
    fast_path_allowed_regexes: [],
    fast_path_sensitive_regexes: [],
    sql_or_migration_regexes: [],
    triggers: {},
    code_like_regexes: []
};

export function loadPathsConfig(configPath: string): PathsConfig {
    const defaults: PathsConfig = { ...DEFAULT_PATHS_CONFIG, triggers: { ...DEFAULT_PATHS_CONFIG.triggers } };
    const data = readJsonFile<Record<string, unknown>>(configPath);
    if (!data) return defaults;
    if (typeof data.metrics_path === 'string') defaults.metrics_path = data.metrics_path;
    for (const arrayKey of [
        'runtime_roots', 'fast_path_roots', 'fast_path_allowed_regexes',
        'fast_path_sensitive_regexes', 'sql_or_migration_regexes', 'code_like_regexes'
    ] as const) {
        if (Array.isArray(data[arrayKey])) {
            defaults[arrayKey] = (data[arrayKey] as unknown[]).filter((v): v is string => typeof v === 'string');
        }
    }
    if (data.triggers && typeof data.triggers === 'object' && !Array.isArray(data.triggers)) {
        const rawTriggers = data.triggers as Record<string, unknown>;
        const triggers: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(rawTriggers)) {
            if (Array.isArray(value)) {
                triggers[key] = value.filter((v): v is string => typeof v === 'string');
            }
        }
        defaults.triggers = triggers;
    }
    return defaults;
}

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

export function getProfileEntry(data: ProfilesData, name: string): ProfileEntry | null {
    if (Object.hasOwn(data.built_in_profiles, name)) return data.built_in_profiles[name];
    if (Object.hasOwn(data.user_profiles, name)) return data.user_profiles[name];
    return null;
}

export function getProfileSource(data: ProfilesData, name: string): 'built_in' | 'user' | null {
    if (Object.hasOwn(data.built_in_profiles, name)) return 'built_in';
    if (Object.hasOwn(data.user_profiles, name)) return 'user';
    return null;
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/**
 * Merge profile review_policy overlay onto review-capabilities config.
 *
 * Resolution rules:
 * - Profile `true` / `false` overrides the capability-level default.
 * - Profile `"auto"` defers to the review-capabilities config value.
 * - Capabilities not mentioned in the profile are passed through unchanged.
 * - After merge, safety floors are applied for code-changing tasks.
 */
export function mergeReviewPolicy(
    profilePolicy: ProfileReviewPolicy,
    capabilities: ReviewCapabilities,
    isCodeChangingTask: boolean
): { merged: EffectiveReviewPolicy; floorsApplied: string[] } {
    const merged: EffectiveReviewPolicy = {} as EffectiveReviewPolicy;
    const floorsApplied: string[] = [];

    for (const key of Object.keys(capabilities)) {
        const profileValue = key in profilePolicy ? profilePolicy[key] : undefined;
        if (profileValue === 'auto' || profileValue === undefined) {
            merged[key] = capabilities[key] ? capabilities[key] : false;
        } else {
            merged[key] = profileValue;
        }
    }

    // Include any extra profile keys not in capabilities
    for (const key of Object.keys(profilePolicy)) {
        if (!(key in merged)) {
            merged[key] = profilePolicy[key];
        }
    }

    if (isCodeChangingTask) {
        for (const [floorKey, floorValue] of CODE_CHANGING_SAFETY_FLOORS) {
            const currentValue = merged[floorKey];
            if (currentValue !== floorValue) {
                merged[floorKey] = floorValue;
                floorsApplied.push(`${floorKey}: profile wanted ${String(currentValue)}, safety floor enforced ${String(floorValue)}`);
            }
        }
    }

    return { merged, floorsApplied };
}

/**
 * Merge profile token_economy overlay onto token-economy.json config.
 *
 * Profile can override boolean flags. Numeric settings (enabled_depths, fail_tail_lines)
 * always come from the config file; profiles do not control them.
 */
export function mergeTokenEconomy(
    profileTokenEconomy: ProfileTokenEconomy,
    configTokenEconomy: TokenEconomyConfig
): TokenEconomyConfig {
    return {
        enabled: profileTokenEconomy.enabled,
        enabled_depths: configTokenEconomy.enabled_depths,
        strip_examples: profileTokenEconomy.strip_examples,
        strip_code_blocks: profileTokenEconomy.strip_code_blocks,
        scoped_diffs: profileTokenEconomy.scoped_diffs,
        compact_reviewer_output: profileTokenEconomy.compact_reviewer_output,
        fail_tail_lines: configTokenEconomy.fail_tail_lines
    };
}

/**
 * Merge profile skills overlay onto installed skill packs.
 * The installed_packs list is always authoritative from skill-packs.json;
 * profiles only control behavioral flags like auto_suggest.
 */
export function mergeSkills(
    profileSkills: ProfileSkills,
    _skillPacks: SkillPacksConfig
): { skills: ProfileSkills; installed_packs: string[] } {
    return {
        skills: { ...profileSkills },
        installed_packs: [..._skillPacks.installed_packs]
    };
}

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

export function resolveConfigPaths(bundleRoot: string): {
    profiles: string;
    reviewCapabilities: string;
    tokenEconomy: string;
    skillPacks: string;
    paths: string;
} {
    const configDir = path.join(bundleRoot, 'live', 'config');
    return {
        profiles: path.join(configDir, 'profiles.json'),
        reviewCapabilities: path.join(configDir, 'review-capabilities.json'),
        tokenEconomy: path.join(configDir, 'token-economy.json'),
        skillPacks: path.join(configDir, 'skill-packs.json'),
        paths: path.join(configDir, 'paths.json')
    };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the effective task policy by merging the active profile overlays
 * with the existing config files. Config files are never modified.
 *
 * Safety floors:
 * - For code-changing tasks, `code` review is always `true` regardless of profile.
 */
export function resolveEffectivePolicy(
    bundleRoot: string,
    options: ResolveOptions = {}
): EffectivePolicy {
    const configPaths = resolveConfigPaths(bundleRoot);

    const profilesData = loadProfilesData(configPaths.profiles);
    const profileName = options.profileOverride || profilesData.active_profile;

    const entry = getProfileEntry(profilesData, profileName);
    if (!entry) {
        const allNames = [
            ...Object.keys(profilesData.built_in_profiles),
            ...Object.keys(profilesData.user_profiles)
        ];
        throw new Error(
            `Profile '${profileName}' not found. Available: ${allNames.join(', ')}`
        );
    }

    const profileSource = getProfileSource(profilesData, profileName)!;
    const isCodeChangingTask = options.isCodeChangingTask !== false;

    const capabilities = loadReviewCapabilities(configPaths.reviewCapabilities);
    const tokenEconomyConfig = loadTokenEconomyConfig(configPaths.tokenEconomy);
    const skillPacksConfig = loadSkillPacksConfig(configPaths.skillPacks);

    const { merged: reviewPolicy, floorsApplied } = mergeReviewPolicy(
        entry.review_policy,
        capabilities,
        isCodeChangingTask
    );

    const tokenEconomy = mergeTokenEconomy(entry.token_economy, tokenEconomyConfig);

    const { skills, installed_packs } = mergeSkills(entry.skills, skillPacksConfig);

    const pathsConfig = loadPathsConfig(configPaths.paths);

    return {
        profile_name: profileName,
        profile_source: profileSource,
        depth: entry.depth,
        review_policy: reviewPolicy,
        token_economy: tokenEconomy,
        skills,
        installed_packs,
        paths: pathsConfig,
        safety_floors_applied: floorsApplied,
        resolution_sources: {
            profiles: configPaths.profiles,
            review_capabilities: configPaths.reviewCapabilities,
            token_economy: configPaths.tokenEconomy,
            skill_packs: configPaths.skillPacks,
            paths: configPaths.paths
        }
    };
}

/**
 * Format effective policy as compact human-readable text.
 */
export function formatEffectivePolicy(policy: EffectivePolicy): string {
    const lines: string[] = [];
    lines.push('EFFECTIVE_POLICY');
    lines.push(`Profile: ${policy.profile_name} (${policy.profile_source})`);
    lines.push(`Depth: ${policy.depth}`);
    lines.push('');

    lines.push('ReviewPolicy:');
    for (const [key, value] of Object.entries(policy.review_policy)) {
        lines.push(`  ${key}: ${String(value)}`);
    }
    lines.push('');

    lines.push('TokenEconomy:');
    lines.push(`  enabled: ${policy.token_economy.enabled}`);
    lines.push(`  enabled_depths: [${policy.token_economy.enabled_depths.join(', ')}]`);
    lines.push(`  strip_examples: ${policy.token_economy.strip_examples}`);
    lines.push(`  strip_code_blocks: ${policy.token_economy.strip_code_blocks}`);
    lines.push(`  scoped_diffs: ${policy.token_economy.scoped_diffs}`);
    lines.push(`  compact_reviewer_output: ${policy.token_economy.compact_reviewer_output}`);
    lines.push(`  fail_tail_lines: ${policy.token_economy.fail_tail_lines}`);
    lines.push('');

    lines.push('Skills:');
    for (const [key, value] of Object.entries(policy.skills)) {
        lines.push(`  ${key}: ${String(value)}`);
    }
    if (policy.installed_packs.length > 0) {
        lines.push(`  installed_packs: [${policy.installed_packs.join(', ')}]`);
    }
    lines.push('');

    lines.push('Paths:');
    lines.push(`  runtime_roots: [${policy.paths.runtime_roots.join(', ')}]`);
    lines.push(`  fast_path_roots: [${policy.paths.fast_path_roots.join(', ')}]`);
    lines.push(`  trigger_categories: [${Object.keys(policy.paths.triggers).join(', ')}]`);

    if (policy.safety_floors_applied.length > 0) {
        lines.push('');
        lines.push('SafetyFloors:');
        for (const floor of policy.safety_floors_applied) {
            lines.push(`  - ${floor}`);
        }
    }

    return lines.join('\n');
}

/**
 * Format effective policy as JSON.
 */
export function formatEffectivePolicyJson(policy: EffectivePolicy): string {
    return JSON.stringify(policy, null, 2);
}
