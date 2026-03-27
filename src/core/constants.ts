import * as path from 'node:path';

export const NODE_ENGINE_RANGE = '>=20.0.0';
export const NODE_BASELINE_LABEL = 'Node 20 LTS';
export const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';
export const DEFAULT_INIT_ANSWERS_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json');
export const DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'agent-init-state.json');

export const LIFECYCLE_COMMANDS: readonly string[] = Object.freeze([
    'setup',
    'agent-init',
    'status',
    'doctor',
    'bootstrap',
    'install',
    'init',
    'reinit',
    'verify',
    'check-update',
    'uninstall',
    'update',
    'rollback',
    'skills'
]);

export const SOURCE_OF_TRUTH_VALUES: readonly string[] = Object.freeze([
    'Claude',
    'Codex',
    'Gemini',
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
    'skill-packs'
]);

