import { MANAGED_CONFIG_NAMES } from '../core/constants';
import {
    cloneUnknownProperties,
    ensurePlainObject,
    normalizeBooleanLike,
    normalizeInteger,
    normalizeNonEmptyString,
    normalizeOptionalString,
    normalizeStringArray
} from './shared';

interface IntegerArrayOptions {
    allowScalar?: boolean;
    minimum?: number;
    maximum?: number;
}

function normalizeIntegerArray(value: unknown, fieldName: string, options: IntegerArrayOptions = {}): number[] {
    const allowScalar = options.allowScalar === true;
    const items = Array.isArray(value) ? value : (allowScalar ? [value] : null);

    if (!items) {
        throw new Error(`${fieldName} must be an array.`);
    }

    const normalized: number[] = [];
    for (const item of items) {
        const integerValue = normalizeInteger(item, fieldName, options);
        if (!normalized.includes(integerValue)) {
            normalized.push(integerValue);
        }
    }

    return normalized.sort((left, right) => left - right);
}

export function validateReviewCapabilitiesConfig(input: unknown): Record<string, boolean> {
    const raw = ensurePlainObject(input, 'review-capabilities');
    const normalized: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(raw)) {
        normalized[key] = normalizeBooleanLike(value, `review-capabilities.${key}`);
    }

    for (const requiredKey of ['code', 'db', 'security', 'refactor', 'api', 'test', 'performance', 'infra', 'dependency']) {
        if (!(requiredKey in normalized)) {
            throw new Error(`review-capabilities.${requiredKey} is required.`);
        }
    }

    return normalized;
}

export function validatePathsConfig(input: unknown): Record<string, unknown> {
    const raw = ensurePlainObject(input, 'paths');
    const knownKeys = new Set([
        'metrics_path',
        'runtime_roots',
        'fast_path_roots',
        'fast_path_allowed_regexes',
        'fast_path_sensitive_regexes',
        'sql_or_migration_regexes',
        'triggers',
        'code_like_regexes'
    ]);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.metrics_path = normalizeNonEmptyString(raw.metrics_path, 'paths.metrics_path');
    normalized.runtime_roots = normalizeStringArray(raw.runtime_roots, 'paths.runtime_roots', { allowScalar: true });
    normalized.fast_path_roots = normalizeStringArray(raw.fast_path_roots, 'paths.fast_path_roots', { allowScalar: true });

    if (raw.fast_path_allowed_regexes !== undefined) {
        normalized.fast_path_allowed_regexes = normalizeStringArray(raw.fast_path_allowed_regexes, 'paths.fast_path_allowed_regexes', { allowScalar: true });
    }

    if (raw.fast_path_sensitive_regexes !== undefined) {
        normalized.fast_path_sensitive_regexes = normalizeStringArray(raw.fast_path_sensitive_regexes, 'paths.fast_path_sensitive_regexes', { allowScalar: true });
    }

    if (raw.sql_or_migration_regexes !== undefined) {
        normalized.sql_or_migration_regexes = normalizeStringArray(raw.sql_or_migration_regexes, 'paths.sql_or_migration_regexes', { allowScalar: true });
    }

    if (raw.code_like_regexes !== undefined) {
        normalized.code_like_regexes = normalizeStringArray(raw.code_like_regexes, 'paths.code_like_regexes', { allowScalar: true });
    }

    const triggers = ensurePlainObject(raw.triggers, 'paths.triggers');
    const triggersMap: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(triggers)) {
        triggersMap[key] = normalizeStringArray(value, `paths.triggers.${key}`, { allowScalar: true });
    }

    if (Object.keys(triggersMap).length === 0) {
        throw new Error('paths.triggers must not be empty.');
    }

    normalized.triggers = triggersMap;

    return normalized;
}

export function validateTokenEconomyConfig(input: unknown): Record<string, unknown> {
    const raw = ensurePlainObject(input, 'token-economy');
    const knownKeys = new Set([
        'enabled',
        'enabled_depths',
        'strip_examples',
        'strip_code_blocks',
        'scoped_diffs',
        'compact_reviewer_output',
        'fail_tail_lines'
    ]);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.enabled = normalizeBooleanLike(raw.enabled, 'token-economy.enabled');
    normalized.enabled_depths = normalizeIntegerArray(raw.enabled_depths, 'token-economy.enabled_depths', { allowScalar: true, minimum: 0 });
    normalized.strip_examples = normalizeBooleanLike(raw.strip_examples, 'token-economy.strip_examples');
    normalized.strip_code_blocks = normalizeBooleanLike(raw.strip_code_blocks, 'token-economy.strip_code_blocks');
    normalized.scoped_diffs = normalizeBooleanLike(raw.scoped_diffs, 'token-economy.scoped_diffs');
    normalized.compact_reviewer_output = normalizeBooleanLike(raw.compact_reviewer_output, 'token-economy.compact_reviewer_output');
    normalized.fail_tail_lines = normalizeInteger(raw.fail_tail_lines, 'token-economy.fail_tail_lines', { minimum: 1 });

    return normalized;
}

function validateContextLookupObject(input: unknown, fieldName: string): Record<string, unknown> {
    const raw = ensurePlainObject(input, fieldName);
    return {
        ...raw,
        context_key: normalizeNonEmptyString(raw.context_key, `${fieldName}.context_key`)
    };
}

function validateOutputFilterOperation(input: unknown, fieldName: string): Record<string, unknown> {
    const raw = ensurePlainObject(input, fieldName);
    const knownKeys = new Set(['type', 'pattern', 'replacement', 'suffix', 'max_chars']);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.type = normalizeNonEmptyString(raw.type, `${fieldName}.type`);
    if (raw.pattern !== undefined) {
        normalized.pattern = normalizeNonEmptyString(raw.pattern, `${fieldName}.pattern`);
    }

    if (raw.replacement !== undefined) {
        normalized.replacement = normalizeOptionalString(raw.replacement) ?? '';
    }

    if (raw.suffix !== undefined) {
        normalized.suffix = normalizeOptionalString(raw.suffix) ?? '';
    }

    if (raw.max_chars !== undefined) {
        normalized.max_chars = normalizeInteger(raw.max_chars, `${fieldName}.max_chars`, { minimum: 1 });
    }

    return normalized;
}

function validateOutputFilterParser(input: unknown, fieldName: string): Record<string, unknown> {
    const raw = ensurePlainObject(input, fieldName);
    const knownKeys = new Set(['type', 'strategy', 'max_matches', 'tail_count', 'max_lines']);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.type = normalizeNonEmptyString(raw.type, `${fieldName}.type`);

    if (raw.strategy !== undefined) {
        normalized.strategy = typeof raw.strategy === 'string'
            ? normalizeNonEmptyString(raw.strategy, `${fieldName}.strategy`)
            : validateContextLookupObject(raw.strategy, `${fieldName}.strategy`);
    }

    if (raw.max_matches !== undefined) {
        normalized.max_matches = normalizeInteger(raw.max_matches, `${fieldName}.max_matches`, { minimum: 1 });
    }

    if (raw.max_lines !== undefined) {
        normalized.max_lines = normalizeInteger(raw.max_lines, `${fieldName}.max_lines`, { minimum: 1 });
    }

    if (raw.tail_count !== undefined) {
        normalized.tail_count = (typeof raw.tail_count === 'object' && raw.tail_count !== null)
            ? validateContextLookupObject(raw.tail_count, `${fieldName}.tail_count`)
            : normalizeInteger(raw.tail_count, `${fieldName}.tail_count`, { minimum: 1 });
    }

    return normalized;
}

function validateOutputFilterProfile(input: unknown, fieldName: string): Record<string, unknown> {
    const raw = ensurePlainObject(input, fieldName);
    const knownKeys = new Set(['description', 'emit_when_empty', 'operations', 'parser']);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.description = normalizeNonEmptyString(raw.description, `${fieldName}.description`);
    if (raw.emit_when_empty !== undefined) {
        normalized.emit_when_empty = normalizeOptionalString(raw.emit_when_empty) ?? '';
    }

    if (raw.operations !== undefined) {
        if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
            throw new Error(`${fieldName}.operations must be a non-empty array.`);
        }

        normalized.operations = raw.operations.map((operation, index) => (
            validateOutputFilterOperation(operation, `${fieldName}.operations[${index}]`)
        ));
    }

    if (raw.parser !== undefined) {
        normalized.parser = validateOutputFilterParser(raw.parser, `${fieldName}.parser`);
    }

    if (normalized.operations === undefined && normalized.parser === undefined) {
        throw new Error(`${fieldName} must define operations, parser, or both.`);
    }

    return normalized;
}

export function validateOutputFiltersConfig(input: unknown): Record<string, unknown> {
    const raw = ensurePlainObject(input, 'output-filters');
    const knownKeys = new Set(['version', 'passthrough_ceiling', 'profiles']);
    const normalized = cloneUnknownProperties(raw, knownKeys);

    normalized.version = normalizeInteger(raw.version, 'output-filters.version', { minimum: 1 });
    if (raw.passthrough_ceiling !== undefined) {
        const passthrough = ensurePlainObject(raw.passthrough_ceiling, 'output-filters.passthrough_ceiling');
        normalized.passthrough_ceiling = {
            ...passthrough,
            max_lines: normalizeInteger(passthrough.max_lines, 'output-filters.passthrough_ceiling.max_lines', { minimum: 1 }),
            strategy: normalizeNonEmptyString(passthrough.strategy, 'output-filters.passthrough_ceiling.strategy')
        };
    }

    const profiles = ensurePlainObject(raw.profiles, 'output-filters.profiles');
    const profilesMap: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(profiles)) {
        profilesMap[key] = validateOutputFilterProfile(value, `output-filters.profiles.${key}`);
    }

    if (Object.keys(profilesMap).length === 0) {
        throw new Error('output-filters.profiles must not be empty.');
    }

    normalized.profiles = profilesMap;

    return normalized;
}

const MANAGED_CONFIG_VALIDATORS = Object.freeze({
    'review-capabilities': validateReviewCapabilitiesConfig,
    paths: validatePathsConfig,
    'token-economy': validateTokenEconomyConfig,
    'output-filters': validateOutputFiltersConfig
});

function normalizeManagedConfigName(configName: unknown): string {
    const normalized = normalizeNonEmptyString(configName, 'configName').toLowerCase();
    const match = MANAGED_CONFIG_NAMES.find((candidate) => candidate.toLowerCase() === normalized);

    if (!match) {
        throw new Error(`Unsupported managed config '${configName}'.`);
    }

    return match;
}

export function validateManagedConfigByName(configName: unknown, input: unknown): Record<string, unknown> {
    const normalizedName = normalizeManagedConfigName(configName);
    const validators = MANAGED_CONFIG_VALIDATORS as Record<string, (input: unknown) => Record<string, unknown>>;
    return validators[normalizedName](input);
}

export function getManagedConfigValidators() {
    return MANAGED_CONFIG_VALIDATORS;
}

