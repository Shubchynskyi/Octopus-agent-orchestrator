import * as path from 'node:path';

export const NODE_ENGINE_RANGE = '>=24.0.0';
export const NODE_BASELINE_LABEL = 'Node 24 LTS';
export const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';

/**
 * Return the effective bundle name.
 * Resolution order: explicit override > OCTOPUS_BUNDLE_NAME env var > DEFAULT_BUNDLE_NAME.
 */
export function resolveBundleName(override?: string): string {
    if (override && override.trim()) return override.trim();
    const envValue = process.env.OCTOPUS_BUNDLE_NAME;
    if (envValue && envValue.trim()) return envValue.trim();
    return DEFAULT_BUNDLE_NAME;
}

/** @deprecated Use {@link resolveInitAnswersRelativePath} which respects configured bundle name. */
export const DEFAULT_INIT_ANSWERS_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json');
/** @deprecated Use {@link resolveAgentInitStateRelativePath} which respects configured bundle name. */
export const DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'agent-init-state.json');

export function resolveInitAnswersRelativePath(override?: string): string {
    if (override && override.trim()) return override.trim();
    return path.join(resolveBundleName(), 'runtime', 'init-answers.json');
}

export function resolveAgentInitStateRelativePath(override?: string): string {
    if (override && override.trim()) return override.trim();
    return path.join(resolveBundleName(), 'runtime', 'agent-init-state.json');
}

export const LIFECYCLE_COMMANDS: readonly string[] = Object.freeze([
    'setup',
    'agent-init',
    'status',
    'doctor',
    'debug',
    'stats',
    'bootstrap',
    'install',
    'init',
    'reinit',
    'verify',
    'check-update',
    'uninstall',
    'update',
    'rollback',
    'cleanup',
    'gc',
    'clean',
    'skills',
    'profile'
]);

export const SOURCE_OF_TRUTH_VALUES: readonly string[] = Object.freeze([
    'Claude',
    'Codex',
    'Gemini',
    'Qwen',
    'GitHubCopilot',
    'Windsurf',
    'Junie',
    'Antigravity'
]);

export const BREVITY_VALUES: readonly string[] = Object.freeze([
    'concise',
    'detailed'
]);

export const COLLECTED_VIA_VALUES: readonly string[] = Object.freeze([
    'AGENT_INIT_PROMPT.md',
    'CLI_INTERACTIVE',
    'CLI_NONINTERACTIVE'
]);

export const BOOLEAN_TRUE_VALUES: readonly string[] = Object.freeze([
    '1',
    'true',
    'yes',
    'y',
    'on',
    'да'
]);

export const BOOLEAN_FALSE_VALUES: readonly string[] = Object.freeze([
    '0',
    'false',
    'no',
    'n',
    'off',
    'нет'
]);

export const SOURCE_TO_ENTRYPOINT_MAP = Object.freeze({
    Claude: 'CLAUDE.md',
    Codex: 'AGENTS.md',
    Gemini: 'GEMINI.md',
    Qwen: 'QWEN.md',
    GitHubCopilot: '.github/copilot-instructions.md',
    Windsurf: '.windsurf/rules/rules.md',
    Junie: '.junie/guidelines.md',
    Antigravity: '.antigravity/rules.md'
});

export const ALL_AGENT_ENTRYPOINT_FILES = Object.freeze(Object.values(SOURCE_TO_ENTRYPOINT_MAP));

export const MANAGED_CONFIG_NAMES: readonly string[] = Object.freeze([
    'review-capabilities',
    'paths',
    'token-economy',
    'output-filters',
    'skill-packs',
    'isolation-mode',
    'profiles',
    'review-artifact-storage'
]);
