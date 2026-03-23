const path = require('node:path');

const NODE_ENGINE_RANGE = '>=20.0.0';
const NODE_BASELINE_LABEL = 'Node 20 LTS';
const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';
const DEFAULT_INIT_ANSWERS_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json');
const DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'agent-init-state.json');

const LIFECYCLE_COMMANDS = Object.freeze([
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
    'skills'
]);

const SOURCE_OF_TRUTH_VALUES = Object.freeze([
    'Claude',
    'Codex',
    'Gemini',
    'GitHubCopilot',
    'Windsurf',
    'Junie',
    'Antigravity'
]);

const BREVITY_VALUES = Object.freeze([
    'concise',
    'detailed'
]);

const COLLECTED_VIA_VALUES = Object.freeze([
    'AGENT_INIT_PROMPT.md',
    'CLI_INTERACTIVE',
    'CLI_NONINTERACTIVE'
]);

const BOOLEAN_TRUE_VALUES = Object.freeze([
    '1',
    'true',
    'yes',
    'y',
    'on',
    'да'
]);

const BOOLEAN_FALSE_VALUES = Object.freeze([
    '0',
    'false',
    'no',
    'n',
    'off',
    'нет'
]);

const SOURCE_TO_ENTRYPOINT_MAP = Object.freeze({
    Claude: 'CLAUDE.md',
    Codex: 'AGENTS.md',
    Gemini: 'GEMINI.md',
    GitHubCopilot: '.github/copilot-instructions.md',
    Windsurf: '.windsurf/rules/rules.md',
    Junie: '.junie/guidelines.md',
    Antigravity: '.antigravity/rules.md'
});

const ALL_AGENT_ENTRYPOINT_FILES = Object.freeze(Object.values(SOURCE_TO_ENTRYPOINT_MAP));

const MANAGED_CONFIG_NAMES = Object.freeze([
    'review-capabilities',
    'paths',
    'token-economy',
    'output-filters',
    'skill-packs'
]);

module.exports = {
    ALL_AGENT_ENTRYPOINT_FILES,
    BOOLEAN_FALSE_VALUES,
    BOOLEAN_TRUE_VALUES,
    BREVITY_VALUES,
    COLLECTED_VIA_VALUES,
    DEFAULT_AGENT_INIT_STATE_RELATIVE_PATH,
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    LIFECYCLE_COMMANDS,
    MANAGED_CONFIG_NAMES,
    NODE_BASELINE_LABEL,
    NODE_ENGINE_RANGE,
    SOURCE_OF_TRUTH_VALUES,
    SOURCE_TO_ENTRYPOINT_MAP
};
