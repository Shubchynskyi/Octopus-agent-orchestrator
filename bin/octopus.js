#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// Enable .ts extension support — src/ uses CJS-compatible .ts files
if (!require.extensions['.ts']) {
    require.extensions['.ts'] = require.extensions['.js'];
}

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';
const DEFAULT_INIT_ANSWERS_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json');
const DEFAULT_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';
const LIFECYCLE_COMMANDS = new Set([
    'setup',
    'status',
    'doctor',
    'bootstrap',
    'install',
    'init',
    'reinit',
    'uninstall',
    'update',
    'verify',
    'check-update',
    'gate'
]);
const SOURCE_OF_TRUTH_VALUES = new Set([
    'Claude',
    'Codex',
    'Gemini',
    'GitHubCopilot',
    'Windsurf',
    'Junie',
    'Antigravity'
]);
const BREVITY_VALUES = new Set([
    'concise',
    'detailed'
]);
const YES_NO_VALUES = new Set([
    'yes',
    'no'
]);
const COLLECTED_VIA_VALUES = new Set([
    'AGENT_INIT_PROMPT.md',
    'CLI_INTERACTIVE',
    'CLI_NONINTERACTIVE'
]);
const SKIPPED_ENTRY_NAMES = new Set([
    '__pycache__',
    '.pytest_cache'
]);
const SKIPPED_FILE_SUFFIXES = Object.freeze([
    '.pyc',
    '.pyo',
    '.pyd'
]);
const SOURCE_TO_ENTRYPOINT_MAP = new Map([
    ['CLAUDE', 'CLAUDE.md'],
    ['CODEX', 'AGENTS.md'],
    ['GEMINI', 'GEMINI.md'],
    ['GITHUBCOPILOT', '.github/copilot-instructions.md'],
    ['WINDSURF', '.windsurf/rules/rules.md'],
    ['JUNIE', '.junie/guidelines.md'],
    ['ANTIGRAVITY', '.antigravity/rules.md']
]);
const DEPLOY_ITEMS = Object.freeze([
    '.gitattributes',
    'bin',
    'src',
    'template',
    'AGENT_INIT_PROMPT.md',
    'CHANGELOG.md',
    'HOW_TO.md',
    'LICENSE',
    'MANIFEST.md',
    'README.md',
    'VERSION',
    'package.json'
]);
const PROJECT_COMMAND_PLACEHOLDERS = Object.freeze([
    '<install dependencies command>',
    '<local environment bootstrap command>',
    '<start backend command>',
    '<start frontend command>',
    '<start worker or background job command>',
    '<unit test command>',
    '<integration test command>',
    '<e2e test command>',
    '<lint command>',
    '<type-check command>',
    '<format check command>',
    '<compile command>',
    '<build command>',
    '<container or artifact packaging command>'
]);
const COMMAND_SUMMARY = Object.freeze([
    ['setup', 'First-run onboarding'],
    ['status', 'Show workspace status'],
    ['doctor', 'Run verify + manifest validation'],
    ['bootstrap', 'Deploy bundle only'],
    ['reinit', 'Change init answers'],
    ['update', 'Check/apply updates'],
    ['uninstall', 'Remove orchestrator'],
    ['verify', 'Verify workspace layout'],
    ['check-update', 'Check for available updates'],
    ['gate', 'Run an agent gate (gate <name>)']
]);
const ALL_AGENT_ENTRYPOINT_FILES = Object.freeze([...SOURCE_TO_ENTRYPOINT_MAP.values()]);

function supportsColor() {
    return Boolean(process.stdout && process.stdout.isTTY && !process.env.NO_COLOR);
}

function colorize(text, code) {
    return supportsColor() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function bold(text) {
    return colorize(text, '1');
}

function cyan(text) {
    return colorize(text, '36');
}

function green(text) {
    return colorize(text, '32');
}

function yellow(text) {
    return colorize(text, '33');
}

function red(text) {
    return colorize(text, '31');
}

function dim(text) {
    return colorize(text, '2');
}

function printHighlightedPair(label, value, { labelColor = yellow, valueColor = green, indent = '' } = {}) {
    console.log(`${indent}${labelColor(label)} ${valueColor(value)}`);
}

function supportsInteractivePrompts() {
    return Boolean(process.stdin && process.stdout && process.stdin.isTTY && process.stdout.isTTY);
}

function readLineInput(promptText) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(promptText, (value) => {
            rl.close();
            resolve(String(value || '').trim());
        });
    });
}

async function promptTextInput(title, defaultValue) {
    const answer = await readLineInput(`${yellow(`${title} [default: ${defaultValue}]:`)} `);
    const resolvedValue = answer || defaultValue;
    console.log(green(`Selected: ${resolvedValue}`));
    return resolvedValue;
}

async function promptSingleSelect({ title, defaultLabel, options, defaultValue }) {
    if (!supportsInteractivePrompts()) {
        throw new Error('Interactive setup requires a TTY terminal.');
    }

    const defaultIndex = Math.max(0, options.findIndex((option) => option.value === defaultValue));
    console.log(yellow(title));
    console.log(`Default: ${defaultLabel}.`);
    options.forEach((option, index) => {
        console.log(`  ${index + 1}. ${option.label}`);
    });

    while (true) {
        const answer = await readLineInput(`Select option [1-${options.length}] (Enter = ${defaultIndex + 1}): `);
        if (!answer) {
            console.log(green(`Selected: ${options[defaultIndex].label}`));
            return options[defaultIndex].value;
        }

        if (/^\d+$/.test(answer)) {
            const numericIndex = Number.parseInt(answer, 10) - 1;
            if (numericIndex >= 0 && numericIndex < options.length) {
                console.log(green(`Selected: ${options[numericIndex].label}`));
                return options[numericIndex].value;
            }
        }

        console.log(red(`Invalid selection. Enter a number between 1 and ${options.length}.`));
    }
}

function padRight(text, width) {
    return String(text).padEnd(width, ' ');
}

function formatKeyValueOutput(obj, keys) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of keys) {
        if (obj[key] === undefined) continue;
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const val = typeof obj[key] === 'boolean'
            ? (obj[key] ? 'True' : 'False')
            : String(obj[key]);
        console.log(label + ': ' + val);
    }
}

function readPackageJson(packageRoot = PACKAGE_ROOT) {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
}

function readBundleVersion(sourceRoot) {
    const versionPath = path.join(sourceRoot, 'VERSION');
    if (fs.existsSync(versionPath)) {
        return fs.readFileSync(versionPath, 'utf8').trim();
    }

    return readPackageJson(sourceRoot).version;
}

function normalizeLogicalKey(value) {
    return String(value || '').toLowerCase().replace(/[_\-\s]/g, '');
}

function getInitAnswerValue(answers, logicalName) {
    const targetKey = normalizeLogicalKey(logicalName);
    for (const [key, value] of Object.entries(answers)) {
        if (normalizeLogicalKey(key) === targetKey) {
            return value;
        }
    }

    return null;
}

function parseBooleanText(value, label) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value) && (value === 0 || value === 1)) {
        return value === 1;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        switch (normalized) {
            case '1':
            case 'true':
            case 'yes':
            case 'y':
            case 'да':
                return true;
            case '0':
            case 'false':
            case 'no':
            case 'n':
            case 'нет':
                return false;
            default:
                break;
        }
    }

    throw new Error(`${label} must be one of: true, false, yes, no, 1, 0.`);
}

function parseRequiredText(value, label) {
    const text = String(value || '').trim();
    if (!text) {
        throw new Error(`${label} must not be empty.`);
    }

    return text;
}

function parseOptionalText(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (Array.isArray(value)) {
        const items = value.map((item) => String(item || '').trim()).filter(Boolean);
        return items.length > 0 ? items.join(', ') : null;
    }

    const text = String(value).trim();
    return text || null;
}

function normalizeSourceOfTruth(value) {
    const text = parseRequiredText(value, 'SourceOfTruth');
    const match = [...SOURCE_OF_TRUTH_VALUES].find((candidate) => candidate.toLowerCase() === text.toLowerCase());
    if (!match) {
        throw new Error(`SourceOfTruth must be one of: ${[...SOURCE_OF_TRUTH_VALUES].join(', ')}.`);
    }

    return match;
}

function normalizeAssistantBrevity(value) {
    const text = parseRequiredText(value, 'AssistantBrevity').toLowerCase();
    if (!BREVITY_VALUES.has(text)) {
        throw new Error(`AssistantBrevity must be one of: ${[...BREVITY_VALUES].join(', ')}.`);
    }

    return text;
}

function normalizeYesNo(value, label) {
    const text = parseRequiredText(value, label).toLowerCase();
    if (text === 'true') {
        return 'yes';
    }
    if (text === 'false') {
        return 'no';
    }
    if (!YES_NO_VALUES.has(text)) {
        throw new Error(`${label} must be one of: yes, no (legacy true/false also accepted).`);
    }

    return text;
}

function normalizeCollectedVia(value) {
    const text = parseRequiredText(value, 'CollectedVia');
    const match = [...COLLECTED_VIA_VALUES].find((candidate) => candidate.toLowerCase() === text.toLowerCase());
    if (!match) {
        throw new Error(`CollectedVia must be one of: ${[...COLLECTED_VIA_VALUES].join(', ')}.`);
    }

    return match;
}

function convertSourceOfTruthToEntrypoint(sourceOfTruth) {
    const sourceKey = String(sourceOfTruth || '').trim().toUpperCase().replace(/\s+/g, '');
    return SOURCE_TO_ENTRYPOINT_MAP.get(sourceKey) || null;
}

function normalizeAgentEntrypointToken(value) {
    const trimmed = String(value || '').trim().replace(/^or\s+/i, '');
    if (!trimmed) {
        return null;
    }

    // Handle numeric selection (1-based index into ALL_AGENT_ENTRYPOINT_FILES)
    const numericMatch = trimmed.match(/^\d+$/);
    if (numericMatch) {
        const idx = parseInt(numericMatch[0], 10) - 1;
        if (idx >= 0 && idx < ALL_AGENT_ENTRYPOINT_FILES.length) {
            return ALL_AGENT_ENTRYPOINT_FILES[idx];
        }
        return null;
    }

    const normalized = trimmed.toLowerCase().replace(/\\/g, '/');
    switch (normalized) {
        case 'claude':
        case 'claude.md':
            return 'CLAUDE.md';
        case 'codex':
        case 'agents':
        case 'agents.md':
            return 'AGENTS.md';
        case 'gemini':
        case 'gemini.md':
            return 'GEMINI.md';
        case 'githubcopilot':
        case 'copilot':
        case '.github/copilot-instructions.md':
            return '.github/copilot-instructions.md';
        case 'windsurf':
        case '.windsurf/rules/rules.md':
            return '.windsurf/rules/rules.md';
        case 'junie':
        case '.junie/guidelines.md':
            return '.junie/guidelines.md';
        case 'antigravity':
        case '.antigravity/rules.md':
            return '.antigravity/rules.md';
        default: {
            const match = ALL_AGENT_ENTRYPOINT_FILES.find((candidate) => candidate.toLowerCase() === normalized);
            return match || null;
        }
    }
}

function normalizeActiveAgentFiles(value, sourceOfTruth) {
    const canonicalEntrypoint = convertSourceOfTruthToEntrypoint(sourceOfTruth);
    const tokens = parseOptionalText(value)
        ? String(value).split(/[;,]+/).map((token) => normalizeAgentEntrypointToken(token)).filter(Boolean)
        : [];
    const unique = new Set(tokens);
    if (canonicalEntrypoint) {
        unique.add(canonicalEntrypoint);
    }

    const ordered = ALL_AGENT_ENTRYPOINT_FILES.filter((entry) => unique.has(entry));
    return ordered.length > 0 ? ordered.join(', ') : null;
}

function tryNormalizeAssistantBrevity(value, fallback = 'concise') {
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeAssistantBrevity(value);
    } catch {
        return fallback;
    }
}

function tryNormalizeSourceOfTruth(value, fallback = 'Claude') {
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeSourceOfTruth(value);
    } catch {
        return fallback;
    }
}

function tryParseBooleanText(value, fallback) {
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : parseBooleanText(value, 'boolean');
    } catch {
        return fallback;
    }
}

function readOptionalJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) {
            return null;
        }
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function getSetupAnswerDefaults(targetRoot, initAnswersPath, options) {
    const resolvedInitAnswersPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    const existingAnswers = readOptionalJsonFile(resolvedInitAnswersPath) || {};
    const sourceOfTruth = tryNormalizeSourceOfTruth(options.sourceOfTruth ?? getInitAnswerValue(existingAnswers, 'SourceOfTruth'), 'Claude');
    const activeAgentFiles = normalizeActiveAgentFiles(
        options.activeAgentFiles ?? getInitAnswerValue(existingAnswers, 'ActiveAgentFiles'),
        sourceOfTruth
    );

    return {
        assistantLanguage: parseOptionalText(options.assistantLanguage) || parseOptionalText(getInitAnswerValue(existingAnswers, 'AssistantLanguage')) || 'English',
        assistantBrevity: tryNormalizeAssistantBrevity(options.assistantBrevity ?? getInitAnswerValue(existingAnswers, 'AssistantBrevity'), 'concise'),
        sourceOfTruth,
        enforceNoAutoCommit: tryParseBooleanText(options.enforceNoAutoCommit ?? getInitAnswerValue(existingAnswers, 'EnforceNoAutoCommit'), true),
        claudeOrchestratorFullAccess: tryParseBooleanText(options.claudeOrchestratorFullAccess ?? getInitAnswerValue(existingAnswers, 'ClaudeOrchestratorFullAccess'), false),
        tokenEconomyEnabled: tryParseBooleanText(options.tokenEconomyEnabled ?? getInitAnswerValue(existingAnswers, 'TokenEconomyEnabled'), true),
        activeAgentFiles
    };
}

async function collectSetupAnswersInteractively(targetRoot, initAnswersPath, options) {
    const defaults = getSetupAnswerDefaults(targetRoot, initAnswersPath, options);
    const assistantLanguage = await promptTextInput('Set communication language', defaults.assistantLanguage);
    const assistantBrevity = await promptSingleSelect({
        title: 'Set default response brevity',
        defaultLabel: defaults.assistantBrevity,
        defaultValue: defaults.assistantBrevity,
        options: [
            { label: 'concise', value: 'concise' },
            { label: 'detailed', value: 'detailed' }
        ]
    });
    const sourceOfTruth = await promptSingleSelect({
        title: 'Set primary source-of-truth entrypoint',
        defaultLabel: defaults.sourceOfTruth,
        defaultValue: defaults.sourceOfTruth,
        options: [...SOURCE_OF_TRUTH_VALUES].map((value) => ({ label: value, value }))
    });
    const enforceNoAutoCommit = await promptSingleSelect({
        title: 'Set no-auto-commit guard mode',
        defaultLabel: defaults.enforceNoAutoCommit ? 'Yes' : 'No',
        defaultValue: defaults.enforceNoAutoCommit ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });
    const claudeOrchestratorFullAccess = await promptSingleSelect({
        title: 'Set Claude access level for orchestrator files',
        defaultLabel: defaults.claudeOrchestratorFullAccess ? 'Yes' : 'No',
        defaultValue: defaults.claudeOrchestratorFullAccess ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });
    const tokenEconomyEnabled = await promptSingleSelect({
        title: 'Set default token economy mode',
        defaultLabel: defaults.tokenEconomyEnabled ? 'Yes' : 'No',
        defaultValue: defaults.tokenEconomyEnabled ? 'true' : 'false',
        options: [
            { label: 'No', value: 'false' },
            { label: 'Yes', value: 'true' }
        ]
    });

    const activeAgentFiles = normalizeActiveAgentFiles(defaults.activeAgentFiles, sourceOfTruth);

    return {
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess,
        tokenEconomyEnabled,
        activeAgentFiles
    };
}

function getCommandName(argv) {
    if (argv.length === 0) {
        return 'bootstrap';
    }

    const candidate = String(argv[0] || '').trim();
    if (candidate === 'help') {
        return 'help';
    }

    if (LIFECYCLE_COMMANDS.has(candidate)) {
        return candidate;
    }

    return 'bootstrap';
}

function parseOptions(argv, definitions, { allowPositionals = false, maxPositionals = 0 } = {}) {
    const options = {};
    const positionals = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '-h' || argument === '--help') {
            options.help = true;
            continue;
        }

        if (argument === '-v' || argument === '--version') {
            options.version = true;
            continue;
        }

        if (!argument.startsWith('-')) {
            if (!allowPositionals) {
                throw new Error(`Unexpected positional argument: ${argument}`);
            }

            positionals.push(argument);
            if (positionals.length > maxPositionals) {
                throw new Error('Too many positional arguments were provided.');
            }
            continue;
        }

        const equalsIndex = argument.indexOf('=');
        const optionName = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
        const inlineValue = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined;
        const definition = definitions[optionName];
        if (!definition) {
            throw new Error(`Unknown option: ${argument}`);
        }

        if (definition.type === 'boolean') {
            options[definition.key] = inlineValue === undefined ? true : parseBooleanText(inlineValue, optionName);
            continue;
        }

        let resolvedValue = inlineValue;
        if (resolvedValue === undefined) {
            if (index + 1 >= argv.length) {
                throw new Error(`${optionName} requires a value.`);
            }

            resolvedValue = argv[index + 1];
            index += 1;
        }

        if (definition.type === 'string[]') {
            if (!Array.isArray(options[definition.key])) {
                options[definition.key] = [];
            }
            options[definition.key].push(resolvedValue);
            continue;
        }

        options[definition.key] = resolvedValue;
    }

    return { options, positionals };
}

function normalizePathValue(value) {
    return path.resolve(String(value || '.'));
}

function getNormalizedPath(pathValue) {
    const fullPath = path.resolve(pathValue);
    const rootPath = path.parse(fullPath).root;
    if (fullPath.toLowerCase() === rootPath.toLowerCase()) {
        return fullPath;
    }

    return fullPath.replace(/[\\/]+$/, '');
}

function isPathInsideRoot(rootPath, candidatePath) {
    const rootFull = getNormalizedPath(rootPath);
    const candidateFull = getNormalizedPath(candidatePath);
    if (rootFull.toLowerCase() === candidateFull.toLowerCase()) {
        return true;
    }

    return candidateFull.toLowerCase().startsWith(`${rootFull.toLowerCase()}${path.sep.toLowerCase()}`);
}

function ensureDirectoryExists(directoryPath, label) {
    if (!fs.existsSync(directoryPath)) {
        throw new Error(`${label} not found: ${directoryPath}`);
    }

    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory()) {
        throw new Error(`${label} is not a directory: ${directoryPath}`);
    }
}

function resolvePathInsideRoot(rootPath, pathValue, label, { requireFile = false, allowMissing = false } = {}) {
    let candidatePath = String(pathValue || '').trim();
    if (!candidatePath) {
        throw new Error(`${label} must not be empty.`);
    }

    if (!path.isAbsolute(candidatePath)) {
        candidatePath = path.join(rootPath, candidatePath);
    }

    const fullPath = path.resolve(candidatePath);
    if (!isPathInsideRoot(rootPath, fullPath)) {
        throw new Error(`${label} must resolve inside target root '${rootPath}'. Resolved path: ${fullPath}`);
    }

    if (!fs.existsSync(fullPath)) {
        if (allowMissing) {
            return fullPath;
        }

        throw new Error(`${label} not found: ${fullPath}`);
    }

    if (requireFile) {
        const stats = fs.lstatSync(fullPath);
        if (!stats.isFile()) {
            throw new Error(`${label} is not a file: ${fullPath}`);
        }
    }

    return fullPath;
}

function shouldSkipPath(sourcePath) {
    const entryName = path.basename(sourcePath);
    if (SKIPPED_ENTRY_NAMES.has(entryName)) {
        return true;
    }

    return SKIPPED_FILE_SUFFIXES.some((suffix) => entryName.endsWith(suffix));
}

function removePathIfExists(targetPath) {
    if (!fs.existsSync(targetPath)) {
        return;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
}

function getCopyBoundaryRoot(sourcePath, stats, bundleRoot) {
    if (bundleRoot) {
        return path.resolve(bundleRoot);
    }

    return path.resolve(stats.isDirectory() ? sourcePath : path.dirname(sourcePath));
}

function readSafeSymlinkTarget(sourcePath, boundaryRoot) {
    const linkTarget = fs.readlinkSync(sourcePath);
    const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
    if (!isPathInsideRoot(boundaryRoot, resolvedTarget)) {
        throw new Error(`Refusing to copy symlink outside bundle root: ${sourcePath}`);
    }

    return linkTarget;
}

function copyPath(sourcePath, destinationPath, bundleRoot) {
    if (shouldSkipPath(sourcePath)) {
        return;
    }

    const stats = fs.lstatSync(sourcePath);
    const boundaryRoot = getCopyBoundaryRoot(sourcePath, stats, bundleRoot);
    const destinationParent = path.dirname(destinationPath);
    fs.mkdirSync(destinationParent, { recursive: true });

    if (stats.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        for (const entry of fs.readdirSync(sourcePath)) {
            copyPath(path.join(sourcePath, entry), path.join(destinationPath, entry), boundaryRoot);
        }

        return;
    }

    if (stats.isSymbolicLink()) {
        const linkTarget = readSafeSymlinkTarget(sourcePath, boundaryRoot);
        fs.symlinkSync(linkTarget, destinationPath);
        return;
    }

    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, stats.mode);
}

function ensureSourceItemExists(sourceRoot, relativePath) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Bundle source asset is missing: ${relativePath}`);
    }

    return sourcePath;
}

function deployFreshBundle(sourceRoot, destinationPath) {
    if (fs.existsSync(destinationPath)) {
        const stats = fs.lstatSync(destinationPath);
        if (!stats.isDirectory()) {
            throw new Error(`Destination exists and is not a directory: ${destinationPath}`);
        }

        const entries = fs.readdirSync(destinationPath);
        if (entries.length > 0) {
            throw new Error(`Destination already exists and is not empty: ${destinationPath}`);
        }
    }

    fs.mkdirSync(destinationPath, { recursive: true });
    for (const relativePath of DEPLOY_ITEMS) {
        const sourcePath = ensureSourceItemExists(sourceRoot, relativePath);
        copyPath(sourcePath, path.join(destinationPath, relativePath), sourceRoot);
    }
}

function syncBundleItems(sourceRoot, destinationPath) {
    if (fs.existsSync(destinationPath) && !fs.lstatSync(destinationPath).isDirectory()) {
        throw new Error(`Bundle path exists and is not a directory: ${destinationPath}`);
    }

    fs.mkdirSync(destinationPath, { recursive: true });
    for (const relativePath of DEPLOY_ITEMS) {
        const sourcePath = ensureSourceItemExists(sourceRoot, relativePath);
        const targetPath = path.join(destinationPath, relativePath);
        removePathIfExists(targetPath);
        copyPath(sourcePath, targetPath, sourceRoot);
    }
}

function createMissingExecutableError(executableName) {
    return new Error(`${executableName} is required but was not found in PATH.`);
}

function runProcess(executableName, args, { cwd, description, interactive = false } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = childProcess.spawn(executableName, args, {
            cwd,
            windowsHide: true,
            stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe']
        });

        const rejectOnce = (error) => {
            if (settled) {
                return;
            }

            settled = true;
            reject(error);
        };
        const resolveOnce = () => {
            if (settled) {
                return;
            }

            settled = true;
            resolve();
        };

        child.once('error', (error) => {
            if (error && error.code === 'ENOENT') {
                rejectOnce(createMissingExecutableError(executableName));
                return;
            }

            rejectOnce(error);
        });

        if (!interactive) {
            if (child.stdout) {
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => {
                    process.stdout.write(chunk);
                });
            }

            if (child.stderr) {
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', (chunk) => {
                    process.stderr.write(chunk);
                });
            }
        }

        child.once('close', (code) => {
            if (code !== 0) {
                rejectOnce(new Error(`${description || executableName} failed with exit code ${code}.`));
                return;
            }

            resolveOnce();
        });
    });
}

async function acquireSourceRoot(repoUrl, branch) {
    if (!repoUrl && !branch) {
        return {
            sourceRoot: PACKAGE_ROOT,
            bundleVersion: readBundleVersion(PACKAGE_ROOT),
            cleanup() {}
        };
    }

    const effectiveRepoUrl = String(repoUrl || DEFAULT_REPO_URL).trim();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-source-'));

    try {
        const cloneArgs = ['clone', '--quiet', '--depth', '1'];
        if (branch) {
            cloneArgs.push('--branch', String(branch).trim(), '--single-branch');
        }
        cloneArgs.push(effectiveRepoUrl, tempRoot);
        await runProcess('git', cloneArgs, {
            cwd: process.cwd(),
            description: `git clone from ${effectiveRepoUrl}`
        });

        return {
            sourceRoot: tempRoot,
            bundleVersion: readBundleVersion(tempRoot),
            cleanup() {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            }
        };
    } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw error;
    }
}

function buildMissingInitAnswersMessage(commandName, bundlePath, initAnswersPath) {
    const initPromptPath = path.join(bundlePath, 'AGENT_INIT_PROMPT.md');
    return [
        `Init answers artifact not found: ${initAnswersPath}`,
        `The '${commandName}' command requires init answers prepared either by 'npx octopus-agent-orchestrator setup' or by the setup agent.`,
        `Run 'npx octopus-agent-orchestrator setup --target-root "${path.dirname(bundlePath)}"' or give the agent "${initPromptPath}", then rerun this command.`
    ].join('\n');
}

function readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, commandName) {
    const resolvedPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(buildMissingInitAnswersMessage(commandName, bundlePath, resolvedPath));
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8');
    if (!raw.trim()) {
        throw new Error(`Init answers artifact is empty: ${resolvedPath}`);
    }

    let answers;
    try {
        answers = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Init answers artifact is not valid JSON: ${resolvedPath}`);
    }

    const assistantLanguage = parseRequiredText(getInitAnswerValue(answers, 'AssistantLanguage'), 'AssistantLanguage');
    const assistantBrevity = normalizeAssistantBrevity(getInitAnswerValue(answers, 'AssistantBrevity'));
    const sourceOfTruth = normalizeSourceOfTruth(getInitAnswerValue(answers, 'SourceOfTruth'));
    const enforceNoAutoCommit = parseBooleanText(
        getInitAnswerValue(answers, 'EnforceNoAutoCommit') ?? false,
        'EnforceNoAutoCommit'
    );
    const claudeOrchestratorFullAccess = parseBooleanText(
        getInitAnswerValue(answers, 'ClaudeOrchestratorFullAccess'),
        'ClaudeOrchestratorFullAccess'
    );
    const tokenEconomyEnabled = parseBooleanText(
        getInitAnswerValue(answers, 'TokenEconomyEnabled') ?? false,
        'TokenEconomyEnabled'
    );
    const collectedVia = normalizeCollectedVia(getInitAnswerValue(answers, 'CollectedVia'));
    const activeAgentFiles = parseOptionalText(getInitAnswerValue(answers, 'ActiveAgentFiles'));

    return {
        resolvedPath,
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess,
        tokenEconomyEnabled,
        collectedVia,
        activeAgentFiles
    };
}

function getBundlePath(targetRoot) {
    return path.join(targetRoot, DEFAULT_BUNDLE_NAME);
}

function ensureBundleExists(targetRoot, commandName) {
    const bundlePath = getBundlePath(targetRoot);
    if (!fs.existsSync(bundlePath) || !fs.lstatSync(bundlePath).isDirectory()) {
        throw new Error([
            `Deployed bundle not found: ${bundlePath}`,
            `Run 'npx octopus-agent-orchestrator' first, then rerun '${commandName}'.`
        ].join('\n'));
    }

    return bundlePath;
}

function getCommandsRulePath(bundlePath) {
    return path.join(bundlePath, 'live', 'docs', 'agent-rules', '40-commands.md');
}

function getAgentInitPromptPath(bundlePath) {
    return path.join(bundlePath, 'AGENT_INIT_PROMPT.md');
}

function readUtf8IfExists(filePath) {
    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
        return null;
    }

    return fs.readFileSync(filePath, 'utf8');
}

function getMissingProjectCommands(commandsContent) {
    if (!commandsContent) {
        return [...PROJECT_COMMAND_PLACEHOLDERS];
    }

    return PROJECT_COMMAND_PLACEHOLDERS.filter((placeholder) => commandsContent.includes(placeholder));
}

function getStageBadge(completed, { warning = false } = {}) {
    const label = completed ? '[x]' : '[ ]';
    if (completed) {
        return green(label);
    }
    if (warning) {
        return yellow(label);
    }
    return dim(label);
}

function getWorkspaceHeadline(snapshot) {
    if (snapshot.readyForTasks) {
        return green('Workspace ready');
    }
    if (snapshot.primaryInitializationComplete) {
        return yellow('Agent setup required');
    }
    if (snapshot.bundlePresent) {
        return yellow('Primary setup required');
    }

    return red('Not installed');
}

function printBanner(packageJson, title, subtitle) {
    const width = 62;
    const top = `+${'-'.repeat(width - 2)}+`;
    const titleText = ` OCTOPUS AGENT ORCHESTRATOR `;
    const versionText = `v${packageJson.version}`;
    const titleLine = `|${padRight(titleText, width - versionText.length - 3)} ${versionText}|`;

    console.log(cyan(top));
    console.log(cyan(titleLine));
    console.log(cyan(top));
    if (title) {
        console.log(bold(title));
    }
    if (subtitle) {
        console.log(dim(subtitle));
    }
}

function printCommandSummary() {
    console.log(bold('Available Commands'));
    for (const [name, description] of COMMAND_SUMMARY) {
        console.log(`  ${padRight(name, 10)} ${description}`);
    }
}

function printSetupHandoff(snapshot) {
    const initPromptPath = getAgentInitPromptPath(snapshot.bundlePath);

    console.log('');
    console.log(bold('Agent Initialization'));
    if (snapshot.activeAgentFiles) {
        console.log(`  Active agent files: ${snapshot.activeAgentFiles}`);
    }
    printHighlightedPair('1. Give your agent:', `"${initPromptPath}"`, { indent: '  ' });
    console.log('  2. The prompt already tells the agent to reuse existing init answers,');
    console.log('     validate/normalize language, fill project context, replace placeholders,');
    console.log('     and run the final doctor check.');
    console.log('  3. After that you can execute tasks, for example:');
    console.log(`     ${green('Execute task T-001 depth=2')}`);
}

function getStatusSnapshot(targetRoot, initAnswersPath = DEFAULT_INIT_ANSWERS_RELATIVE_PATH) {
    const bundlePath = getBundlePath(targetRoot);
    const bundlePresent = fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory();
    const taskPath = path.join(targetRoot, 'TASK.md');
    const livePath = path.join(bundlePath, 'live');
    const usagePath = path.join(livePath, 'USAGE.md');
    const commandsRulePath = getCommandsRulePath(bundlePath);
    const commandsContent = readUtf8IfExists(commandsRulePath);
    const missingProjectCommands = getMissingProjectCommands(commandsContent);
    const initAnswersResolvedPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    const initAnswersPresent = fs.existsSync(initAnswersResolvedPath) && fs.lstatSync(initAnswersResolvedPath).isFile();

    let answers = null;
    let initAnswersError = null;
    if (initAnswersPresent) {
        try {
            answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePresent ? bundlePath : getBundlePath(targetRoot), 'status');
        } catch (error) {
            initAnswersError = error instanceof Error ? error.message : String(error);
        }
    }

    const liveVersionPath = path.join(livePath, 'version.json');
    let liveVersion = null;
    let liveVersionError = null;
    if (fs.existsSync(liveVersionPath)) {
        try {
            liveVersion = JSON.parse(fs.readFileSync(liveVersionPath, 'utf8'));
        } catch (error) {
            liveVersionError = error instanceof Error ? error.message : String(error);
        }
    }

    const sourceOfTruth = answers ? answers.sourceOfTruth : (liveVersion && String(liveVersion.SourceOfTruth || '').trim()) || null;
    const sourceKey = sourceOfTruth ? sourceOfTruth.trim().toUpperCase().replace(/\s+/g, '') : null;
    const canonicalEntrypoint = sourceKey && SOURCE_TO_ENTRYPOINT_MAP.has(sourceKey)
        ? SOURCE_TO_ENTRYPOINT_MAP.get(sourceKey)
        : null;
    const livePresent = fs.existsSync(livePath) && fs.lstatSync(livePath).isDirectory();
    const taskPresent = fs.existsSync(taskPath) && fs.lstatSync(taskPath).isFile();
    const usagePresent = fs.existsSync(usagePath) && fs.lstatSync(usagePath).isFile();
    const primaryInitializationComplete = bundlePresent && initAnswersPresent && !initAnswersError && livePresent && taskPresent && usagePresent;
    const agentInitializationComplete = primaryInitializationComplete && missingProjectCommands.length === 0;
    const readyForTasks = agentInitializationComplete;

    let recommendedNextCommand = 'npx octopus-agent-orchestrator setup';
    if (readyForTasks) {
        recommendedNextCommand = 'Execute task T-001 depth=2';
    } else if (primaryInitializationComplete) {
        recommendedNextCommand = `Give your agent "${getAgentInitPromptPath(bundlePath)}" and then run npx octopus-agent-orchestrator doctor`;
    } else if (bundlePresent && (!initAnswersPresent || initAnswersError)) {
        recommendedNextCommand = `npx octopus-agent-orchestrator setup --target-root "${targetRoot}"`;
    } else if (bundlePresent) {
        recommendedNextCommand = `npx octopus-agent-orchestrator install --target-root "${targetRoot}" --init-answers-path "${initAnswersPath}"`;
    }

    return {
        targetRoot,
        bundlePath,
        initAnswersResolvedPath,
        initAnswersPathForDisplay: initAnswersPath,
        bundlePresent,
        initAnswersPresent,
        initAnswersError,
        taskPresent,
        livePresent,
        usagePresent,
        commandsRulePath,
        missingProjectCommands,
        sourceOfTruth,
        canonicalEntrypoint,
        collectedVia: answers ? answers.collectedVia : null,
        activeAgentFiles: answers ? answers.activeAgentFiles : null,
        liveVersionError,
        primaryInitializationComplete,
        agentInitializationComplete,
        readyForTasks,
        recommendedNextCommand
    };
}

function printStatus(snapshot, { heading = 'OCTOPUS_STATUS' } = {}) {
    console.log(heading);
    console.log(bold(getWorkspaceHeadline(snapshot)));
    console.log(`Project: ${snapshot.targetRoot}`);
    console.log(`Bundle: ${snapshot.bundlePath}`);
    console.log(`InitAnswers: ${snapshot.initAnswersResolvedPath}`);
    console.log(`CollectedVia: ${snapshot.collectedVia || 'n/a'}`);
    if (snapshot.activeAgentFiles) {
        console.log(`ActiveAgentFiles: ${snapshot.activeAgentFiles}`);
    }
    console.log(`SourceOfTruth: ${snapshot.sourceOfTruth || 'n/a'}${snapshot.canonicalEntrypoint ? ` -> ${snapshot.canonicalEntrypoint}` : ''}`);
    console.log('');
    console.log(bold('Workspace Stages'));
    console.log(`  ${getStageBadge(snapshot.bundlePresent)} Installed`);
    console.log(`  ${getStageBadge(snapshot.primaryInitializationComplete, { warning: snapshot.bundlePresent && !snapshot.primaryInitializationComplete })} Primary initialization`);
    console.log(`  ${getStageBadge(snapshot.agentInitializationComplete, { warning: snapshot.primaryInitializationComplete && !snapshot.agentInitializationComplete })} Agent initialization`);
    console.log(`  ${getStageBadge(snapshot.readyForTasks, { warning: snapshot.agentInitializationComplete && !snapshot.readyForTasks })} Ready for task execution`);
    if (snapshot.primaryInitializationComplete && !snapshot.agentInitializationComplete) {
        console.log(`  Missing project commands: ${snapshot.missingProjectCommands.length}`);
    }
    if (snapshot.initAnswersError) {
        console.log(`InitAnswersStatus: INVALID (${snapshot.initAnswersError})`);
    }
    if (snapshot.liveVersionError) {
        console.log(`LiveVersionStatus: INVALID (${snapshot.liveVersionError})`);
    }
    if (snapshot.missingProjectCommands.length > 0 && snapshot.primaryInitializationComplete) {
        console.log(`CommandsRule: ${snapshot.commandsRulePath}`);
        printHighlightedPair('CommandsStatus:', 'PENDING_AGENT_CONTEXT');
    }
    printHighlightedPair('RecommendedNextCommand:', snapshot.recommendedNextCommand);
    console.log('');
    printCommandSummary();
}

function printHelp(packageJson) {
    const sections = [
        [
            `Octopus Agent Orchestrator CLI v${packageJson.version}`,
            'Usage:',
            '  octopus-agent-orchestrator',
            '  octopus-agent-orchestrator setup [options]',
            '  octopus-agent-orchestrator status [options]',
            '  octopus-agent-orchestrator COMMAND [options]'
        ],
        [
            'Commands:',
            '  setup         First-run onboarding: deploy/refresh bundle, collect init answers, run install, and validate manifest.',
            '  status        Show current project status without changing files.',
            '  doctor        Run verify + manifest validation using existing init answers.',
            '  bootstrap     Deploy the bundle only.',
            '  install       Deploy or refresh the bundle and run the Node install pipeline.',
            '  init          Re-materialize live/ from an existing deployed bundle.',
            '  reinit        Re-ask or override init answers for an existing deployed bundle.',
            '  update        Check for updates and optionally apply them.',
            '  uninstall     Remove the deployed orchestrator bundle and managed files.'
        ],
        [
            'Global options:',
            '  -h, --help                 Show this help message.',
            '  -v, --version              Show the package version.'
        ],
        [
            'Shared lifecycle options:',
            '      --target-root PATH           Workspace root. Defaults to the current working directory.',
            '      --init-answers-path PATH     Path inside the workspace to agent-produced init answers.'
        ],
        [
            'Bootstrap/install source override options:',
            '      --repo-url URL               Clone bundle source from a repo instead of the packaged bundle.',
            '      --branch NAME                Clone a specific branch for branch testing.'
        ],
        [
            'Notes:',
            `  - The default deployed bundle path is ${DEFAULT_BUNDLE_NAME}.`,
            '  - Running octopus with no arguments is safe: it prints status and help instead of bootstrapping.',
            '  - setup can collect init answers itself; install/init/doctor use an existing init-answers.json.',
            '  - setup skips full verify by default because project-specific command placeholders are usually filled later by the setup agent.',
            '  - update delegates to the built-in check-update flow, so --apply controls immediate update and --no-prompt disables prompts.'
        ]
    ];

    console.log(sections.map((section) => section.join('\n')).join('\n\n'));
}

function printOverview(packageJson, targetRoot = normalizePathValue('.')) {
    const snapshot = getStatusSnapshot(targetRoot);
    console.log('OCTOPUS_OVERVIEW');
    printBanner(packageJson, 'Workspace overview', targetRoot);
    printStatus(snapshot, { heading: 'OCTOPUS_STATUS' });
}

function printBootstrapSuccess(packageJson, bundleVersion, destinationPath) {
    const targetRoot = path.dirname(destinationPath);
    const bundleRelativePath = path.relative(targetRoot, destinationPath) || path.basename(destinationPath);
    const initPromptPath = path.join(destinationPath, 'AGENT_INIT_PROMPT.md');
    const bundleCliPath = path.join(destinationPath, 'bin', 'octopus.js');
    const initAnswersRelativePath = path.join(bundleRelativePath, 'runtime', 'init-answers.json');

    console.log('OCTOPUS_BOOTSTRAP_OK');
    console.log(`PackageVersion: ${packageJson.version}`);
    console.log(`BundleVersion: ${bundleVersion}`);
    console.log(`BundlePath: ${destinationPath}`);
    console.log(`TargetRoot: ${targetRoot}`);
    console.log(`InitPromptPath: ${initPromptPath}`);
    console.log(`InitAnswersPath: ${initAnswersRelativePath}`);
    console.log('NextSteps:');
    console.log(`1. Give your agent "${initPromptPath}".`);
    console.log(`2. Let the agent write "${path.join(targetRoot, initAnswersRelativePath)}".`);
    if (bundleRelativePath === DEFAULT_BUNDLE_NAME) {
        console.log('3. After init answers exist, run the lifecycle CLI:');
        console.log(`   npx ${packageJson.name} install --target-root "${targetRoot}" --init-answers-path "${initAnswersRelativePath}"`);
    } else {
        console.log('3. Custom bundle paths should still use the Node CLI:');
        console.log(`   node "${bundleCliPath}" install --target-root "${targetRoot}" --assistant-language "<language>" --assistant-brevity "<concise|detailed>" --source-of-truth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" --init-answers-path "${initAnswersRelativePath}"`);
    }
}

async function handleBootstrap(commandArgv, packageJson) {
    const bootstrapDefinitions = {
        '--destination': { key: 'destination', type: 'string' },
        '--target': { key: 'destination', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' }
    };
    const { options, positionals } = parseOptions(commandArgv, bootstrapDefinitions, {
        allowPositionals: true,
        maxPositionals: 1
    });

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const destinationPath = normalizePathValue(options.destination || positionals[0] || DEFAULT_BUNDLE_NAME);
    const source = await acquireSourceRoot(options.repoUrl, options.branch);
    try {
        deployFreshBundle(source.sourceRoot, destinationPath);
        printBootstrapSuccess(packageJson, source.bundleVersion, destinationPath);
    } finally {
        source.cleanup();
    }
}

async function handleSetup(commandArgv, packageJson) {
    const setupDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--verify': { key: 'runVerify', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--assistant-language': { key: 'assistantLanguage', type: 'string' },
        '--assistant-brevity': { key: 'assistantBrevity', type: 'string' },
        '--active-agent-files': { key: 'activeAgentFiles', type: 'string' },
        '--source-of-truth': { key: 'sourceOfTruth', type: 'string' },
        '--enforce-no-auto-commit': { key: 'enforceNoAutoCommit', type: 'string' },
        '--claude-orchestrator-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--claude-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--token-economy-enabled': { key: 'tokenEconomyEnabled', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, setupDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const interactiveSetup = !options.noPrompt;
    const canUseInteractivePrompts = interactiveSetup && supportsInteractivePrompts();

    console.log('OCTOPUS_SETUP');
    printBanner(
        packageJson,
        'Primary setup',
        canUseInteractivePrompts
            ? 'You will be asked 6 control questions.'
            : interactiveSetup
                ? 'Interactive prompts are unavailable in this terminal. Falling back to script-managed setup.'
                : 'Running in non-interactive mode with provided/default answers.'
    );
    console.log(`Project: ${targetRoot}`);
    console.log(`BundlePath: ${getBundlePath(targetRoot)}`);
    console.log('');
    console.log(bold('Setup Steps'));
    console.log(`  ${green('[1/3]')} Deploy bundle`);
    console.log(`  ${green('[2/3]')} Collect or reuse init answers`);
    console.log(`  ${green('[3/3]')} Run install and prepare agent handoff`);
    console.log('');

    const source = await acquireSourceRoot(options.repoUrl, options.branch);
    try {
        const promptedAnswers = canUseInteractivePrompts
            ? await collectSetupAnswersInteractively(targetRoot, options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH, options)
            : null;
        const bundlePath = getBundlePath(targetRoot);
        const sourceResolvedSetup = path.resolve(source.sourceRoot);
        const bundleResolvedSetup = path.resolve(bundlePath);
        if (sourceResolvedSetup.toLowerCase() !== bundleResolvedSetup.toLowerCase()) {
            if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory()) {
                syncBundleItems(source.sourceRoot, bundlePath);
            } else if (!options.dryRun) {
                syncBundleItems(source.sourceRoot, bundlePath);
            }
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;

        // T-074: build and save init answers, then call TS install+init directly
        const resolvedAnswers = promptedAnswers || {};
        const assistantLanguage = resolvedAnswers.assistantLanguage || options.assistantLanguage || 'English';
        const assistantBrevity = resolvedAnswers.assistantBrevity
            || (options.assistantBrevity !== undefined ? normalizeAssistantBrevity(options.assistantBrevity) : 'concise');
        const sourceOfTruth = resolvedAnswers.sourceOfTruth
            || (options.sourceOfTruth !== undefined ? normalizeSourceOfTruth(options.sourceOfTruth) : 'Claude');
        const enforceNoAutoCommit = resolvedAnswers.enforceNoAutoCommit !== undefined
            ? (String(resolvedAnswers.enforceNoAutoCommit) === 'true')
            : (options.enforceNoAutoCommit !== undefined ? parseBooleanText(options.enforceNoAutoCommit, 'EnforceNoAutoCommit') : true);
        const claudeOrchestratorFullAccess = resolvedAnswers.claudeOrchestratorFullAccess !== undefined
            ? (String(resolvedAnswers.claudeOrchestratorFullAccess) === 'true')
            : (options.claudeOrchestratorFullAccess !== undefined ? parseBooleanText(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess') : false);
        const tokenEconomyEnabled = resolvedAnswers.tokenEconomyEnabled !== undefined
            ? (String(resolvedAnswers.tokenEconomyEnabled) === 'true')
            : (options.tokenEconomyEnabled !== undefined ? parseBooleanText(options.tokenEconomyEnabled, 'TokenEconomyEnabled') : true);
        const rawActiveAgentFiles = resolvedAnswers.activeAgentFiles || options.activeAgentFiles || null;
        const activeAgentFiles = normalizeActiveAgentFiles(rawActiveAgentFiles, sourceOfTruth) || '';

        const collectedVia = canUseInteractivePrompts ? 'CLI_INTERACTIVE' : 'CLI_NONINTERACTIVE';

        // Save init answers
        const resolvedInitAnswersPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
        const initAnswersDir = path.dirname(resolvedInitAnswersPath);
        if (!options.dryRun) {
            if (!fs.existsSync(initAnswersDir)) { fs.mkdirSync(initAnswersDir, { recursive: true }); }
            const { serializeInitAnswers } = require(path.join(PACKAGE_ROOT, 'src', 'schemas', 'init-answers.ts'));
            const serialized = serializeInitAnswers({
                AssistantLanguage: assistantLanguage,
                AssistantBrevity: assistantBrevity,
                SourceOfTruth: sourceOfTruth,
                EnforceNoAutoCommit: enforceNoAutoCommit,
                ClaudeOrchestratorFullAccess: claudeOrchestratorFullAccess,
                TokenEconomyEnabled: tokenEconomyEnabled,
                CollectedVia: collectedVia,
                ActiveAgentFiles: activeAgentFiles
                    ? activeAgentFiles.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
                    : []
            });
            fs.writeFileSync(resolvedInitAnswersPath, JSON.stringify(serialized, null, 2), 'utf8');
        }

        // Run install
        const { runInstall } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'install.ts'));
        runInstall({
            targetRoot,
            bundleRoot: effectiveBundlePath,
            assistantLanguage,
            assistantBrevity,
            sourceOfTruth,
            initAnswersPath: resolvedInitAnswersPath,
            dryRun: options.dryRun
        });

        // Run init
        const { runInit } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'init.ts'));
        runInit({
            targetRoot,
            bundleRoot: effectiveBundlePath,
            assistantLanguage,
            assistantBrevity,
            sourceOfTruth,
            enforceNoAutoCommit,
            tokenEconomyEnabled,
            dryRun: options.dryRun
        });

        const snapshot = getStatusSnapshot(targetRoot, initAnswersPath);

        // Run manifest validation
        let manifestStatus = 'SKIPPED';
        try {
            const manifestPath = path.join(effectiveBundlePath, 'MANIFEST.md');
            if (fs.existsSync(manifestPath)) {
                const { validateManifest } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'validate-manifest.ts'));
                const manifestResult = validateManifest(manifestPath);
                manifestStatus = manifestResult.passed ? 'PASS' : 'FAIL';
            }
        } catch { manifestStatus = 'ERROR'; }

        // Run verify if possible
        let verifyStatus = 'PENDING_AGENT_CONTEXT';
        try {
            if (snapshot.readyForTasks) {
                const { runVerify } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'verify.ts'));
                const verifyResult = runVerify({
                    targetRoot,
                    sourceOfTruth,
                    initAnswersPath: resolvedInitAnswersPath
                });
                verifyStatus = (verifyResult.totalViolationCount > 0) ? 'FAIL' : 'PASS';
            }
        } catch { verifyStatus = 'PENDING_AGENT_CONTEXT'; }

        console.log('Setup: PASS');
        console.log('Verify: ' + verifyStatus);
        console.log('ManifestValidation: ' + manifestStatus);
        console.log('');
        printBanner(packageJson, 'Setup complete', snapshot.readyForTasks ? 'Workspace is ready.' : 'Primary setup finished. Agent handoff is still required.');
        printStatus(snapshot, { heading: 'OCTOPUS_SETUP_STATUS' });
        if (!snapshot.agentInitializationComplete) {
            printSetupHandoff(snapshot);
        }
    } finally {
        source.cleanup();
    }
}

async function handleInstall(commandArgv, packageJson) {
    const installDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options } = parseOptions(commandArgv, installDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');

    const source = await acquireSourceRoot(options.repoUrl, options.branch);
    try {
        const bundlePath = getBundlePath(targetRoot);
        const sourceResolved = path.resolve(source.sourceRoot);
        const bundleResolved = path.resolve(bundlePath);
        if (sourceResolved.toLowerCase() !== bundleResolved.toLowerCase()) {
            if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory()) {
                syncBundleItems(source.sourceRoot, bundlePath);
            } else if (!options.dryRun) {
                syncBundleItems(source.sourceRoot, bundlePath);
            }
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
        const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, getBundlePath(targetRoot), 'install');

        const { runInstall } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'install.ts'));
        const { runInit: initRunner } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'init.ts'));
        const installResult = runInstall({
            targetRoot,
            bundleRoot: effectiveBundlePath,
            assistantLanguage: answers.assistantLanguage,
            assistantBrevity: answers.assistantBrevity,
            sourceOfTruth: answers.sourceOfTruth,
            initAnswersPath: answers.resolvedPath,
            dryRun: options.dryRun,
            initRunner: function (initOpts) {
                initRunner(Object.assign({ bundleRoot: effectiveBundlePath }, initOpts));
            }
        });
        formatKeyValueOutput(installResult, [
            'targetRoot', 'sourceOfTruth', 'canonicalEntrypoint',
            'assistantLanguage', 'assistantBrevity',
            'filesDeployed', 'initInvoked', 'liveVersionWritten',
            'dryRun'
        ]);
    } finally {
        source.cleanup();
    }
}

async function handleInit(commandArgv, packageJson) {
    const initDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--dry-run': { key: 'dryRun', type: 'boolean' }
    };
    const { options } = parseOptions(commandArgv, initDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'init');
    const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'init');

    const { runInit } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'init.ts'));
    const initResult = runInit({
        targetRoot,
        bundleRoot: bundlePath,
        assistantLanguage: answers.assistantLanguage,
        assistantBrevity: answers.assistantBrevity,
        sourceOfTruth: answers.sourceOfTruth,
        enforceNoAutoCommit: answers.enforceNoAutoCommit,
        tokenEconomyEnabled: answers.tokenEconomyEnabled,
        dryRun: options.dryRun
    });
    console.log('Init: PASS');
    formatKeyValueOutput(initResult, [
        'targetRoot', 'sourceOfTruth', 'assistantLanguage',
        'ruleFilesMaterialized', 'projectDiscoveryPath', 'usagePath'
    ]);
}

function handleStatus(commandArgv, packageJson) {
    const statusDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, statusDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    printBanner(packageJson, 'Workspace status', targetRoot);
    printStatus(getStatusSnapshot(targetRoot, options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH));
}

async function handleDoctor(commandArgv, packageJson) {
    const doctorDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, doctorDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    printBanner(packageJson, 'Workspace doctor', targetRoot);
    const bundlePath = ensureBundleExists(targetRoot, 'doctor');
    const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'doctor');
    const manifestPath = path.join(bundlePath, 'MANIFEST.md');

    // T-074: call TS implementations directly instead of PowerShell
    const { runVerify, formatVerifyResult } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'verify.ts'));
    const verifyResult = runVerify({
        targetRoot,
        sourceOfTruth: answers.sourceOfTruth,
        initAnswersPath: answers.resolvedPath
    });
    if (verifyResult.totalViolationCount > 0) {
        console.error(formatVerifyResult(verifyResult));
        throw new Error('Workspace verification failed with ' + verifyResult.totalViolationCount + ' violation(s).');
    }

    const { validateManifest } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'validate-manifest.ts'));
    const manifestResult = validateManifest(manifestPath);
    if (!manifestResult.passed) {
        throw new Error('Manifest validation failed: ' + manifestResult.duplicates.length + ' duplicate(s) found.');
    }

    console.log('Doctor: PASS');
    console.log(`Next: Execute task T-001 depth=2`);
}

async function handleReinit(commandArgv, packageJson) {
    const reinitDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' },
        '--assistant-language': { key: 'assistantLanguage', type: 'string' },
        '--assistant-brevity': { key: 'assistantBrevity', type: 'string' },
        '--source-of-truth': { key: 'sourceOfTruth', type: 'string' },
        '--enforce-no-auto-commit': { key: 'enforceNoAutoCommit', type: 'string' },
        '--claude-orchestrator-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--claude-full-access': { key: 'claudeOrchestratorFullAccess', type: 'string' },
        '--token-economy-enabled': { key: 'tokenEconomyEnabled', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, reinitDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'reinit');

    // T-074: call TS implementation directly instead of PowerShell
    const overrides = {};
    if (options.assistantLanguage !== undefined) overrides.AssistantLanguage = options.assistantLanguage;
    if (options.assistantBrevity !== undefined) overrides.AssistantBrevity = normalizeAssistantBrevity(options.assistantBrevity);
    if (options.sourceOfTruth !== undefined) overrides.SourceOfTruth = normalizeSourceOfTruth(options.sourceOfTruth);
    if (options.enforceNoAutoCommit !== undefined) overrides.EnforceNoAutoCommit = String(parseBooleanText(options.enforceNoAutoCommit, 'EnforceNoAutoCommit'));
    if (options.claudeOrchestratorFullAccess !== undefined) overrides.ClaudeOrchestratorFullAccess = String(parseBooleanText(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess'));
    if (options.tokenEconomyEnabled !== undefined) overrides.TokenEconomyEnabled = String(parseBooleanText(options.tokenEconomyEnabled, 'TokenEconomyEnabled'));

    const { runReinit } = require(path.join(PACKAGE_ROOT, 'src', 'materialization', 'reinit.ts'));
    const reinitResult = runReinit({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        overrides,
        skipVerify: options.skipVerify,
        skipManifestValidation: options.skipManifestValidation
    });
    console.log('Reinit: PASS');
    formatKeyValueOutput(reinitResult, [
        'targetRoot', 'sourceOfTruth', 'canonicalEntrypoint',
        'assistantLanguage', 'assistantBrevity',
        'coreRuleUpdated', 'tokenEconomyConfigUpdated'
    ]);
}

async function handleUpdate(commandArgv, packageJson) {
    const updateDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--apply': { key: 'apply', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' }
    };
    const { options } = parseOptions(commandArgv, updateDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'update');

    // T-075: call TS implementation directly — Node-only runtime
    const { runCheckUpdate } = require(path.join(PACKAGE_ROOT, 'src', 'lifecycle', 'check-update.ts'));
    const updateResult = runCheckUpdate({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        repoUrl: options.repoUrl,
        branch: options.branch,
        apply: true,
        noPrompt: options.noPrompt,
        dryRun: options.dryRun,
        skipVerify: options.skipVerify,
        skipManifestValidation: options.skipManifestValidation
    });
    formatKeyValueOutput(updateResult, [
        'targetRoot', 'repoUrl', 'branch',
        'currentVersion', 'latestVersion', 'updateAvailable',
        'updateApplied', 'checkUpdateResult'
    ]);
}

async function handleUninstall(commandArgv, packageJson) {
    const uninstallDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-backups': { key: 'skipBackups', type: 'boolean' },
        '--keep-primary-entrypoint': { key: 'keepPrimaryEntrypoint', type: 'string' },
        '--keep-task-file': { key: 'keepTaskFile', type: 'string' },
        '--keep-runtime-artifacts': { key: 'keepRuntimeArtifacts', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, uninstallDefinitions);

    if (options.help) {
        printHelp(packageJson);
        return;
    }
    if (options.version) {
        console.log(packageJson.version);
        return;
    }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'uninstall');

    // T-075: Node-only runtime
    const { runUninstall } = require(path.join(PACKAGE_ROOT, 'src', 'lifecycle', 'uninstall.ts'));
    const uninstallResult = runUninstall({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        noPrompt: options.noPrompt,
        dryRun: options.dryRun,
        skipBackups: options.skipBackups,
        keepPrimaryEntrypoint: options.keepPrimaryEntrypoint !== undefined
            ? normalizeYesNo(options.keepPrimaryEntrypoint, 'KeepPrimaryEntrypoint') : undefined,
        keepTaskFile: options.keepTaskFile !== undefined
            ? normalizeYesNo(options.keepTaskFile, 'KeepTaskFile') : undefined,
        keepRuntimeArtifacts: options.keepRuntimeArtifacts !== undefined
            ? normalizeYesNo(options.keepRuntimeArtifacts, 'KeepRuntimeArtifacts') : undefined
    });
    formatKeyValueOutput(uninstallResult, [
        'targetRoot', 'keepPrimaryEntrypoint', 'keepTaskFile',
        'keepRuntimeArtifacts', 'dryRun', 'backupRoot',
        'preservedRuntimePath', 'filesDeleted', 'directoriesDeleted',
        'warningsCount'
    ]);
    console.log('Result: ' + (uninstallResult.result || 'SUCCESS'));
}

// ---------------------------------------------------------------------------
// T-074: verify command (new CLI entrypoint)
// ---------------------------------------------------------------------------

function handleVerify(commandArgv, packageJson) {
    const verifyDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--source-of-truth': { key: 'sourceOfTruth', type: 'string' }
    };
    const { options } = parseOptions(commandArgv, verifyDefinitions);

    if (options.help) { printHelp(packageJson); return; }
    if (options.version) { console.log(packageJson.version); return; }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'verify');
    const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, 'verify');
    const sot = options.sourceOfTruth ? normalizeSourceOfTruth(options.sourceOfTruth) : answers.sourceOfTruth;

    const { runVerify, formatVerifyResult } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'verify.ts'));
    const result = runVerify({
        targetRoot,
        sourceOfTruth: sot,
        initAnswersPath: answers.resolvedPath
    });
    console.log(formatVerifyResult(result));
    if (result.totalViolationCount > 0) {
        throw new Error('Workspace verification failed with ' + result.totalViolationCount + ' violation(s).');
    }
}

// ---------------------------------------------------------------------------
// check-update command
// ---------------------------------------------------------------------------

function handleCheckUpdate(commandArgv, packageJson) {
    const checkUpdateDefinitions = {
        '--target-root': { key: 'targetRoot', type: 'string' },
        '--init-answers-path': { key: 'initAnswersPath', type: 'string' },
        '--repo-url': { key: 'repoUrl', type: 'string' },
        '--branch': { key: 'branch', type: 'string' },
        '--apply': { key: 'apply', type: 'boolean' },
        '--no-prompt': { key: 'noPrompt', type: 'boolean' },
        '--dry-run': { key: 'dryRun', type: 'boolean' },
        '--skip-verify': { key: 'skipVerify', type: 'boolean' },
        '--skip-manifest-validation': { key: 'skipManifestValidation', type: 'boolean' }
    };
    const { options } = parseOptions(commandArgv, checkUpdateDefinitions);

    if (options.help) { printHelp(packageJson); return; }
    if (options.version) { console.log(packageJson.version); return; }

    const targetRoot = normalizePathValue(options.targetRoot || '.');
    ensureDirectoryExists(targetRoot, 'Target root');
    const bundlePath = ensureBundleExists(targetRoot, 'check-update');

    const { runCheckUpdate } = require(path.join(PACKAGE_ROOT, 'src', 'lifecycle', 'check-update.ts'));
    const checkResult = runCheckUpdate({
        targetRoot,
        bundleRoot: bundlePath,
        initAnswersPath: options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        repoUrl: options.repoUrl,
        branch: options.branch,
        apply: options.apply,
        noPrompt: options.noPrompt,
        dryRun: options.dryRun,
        skipVerify: options.skipVerify,
        skipManifestValidation: options.skipManifestValidation
    });
    formatKeyValueOutput(checkResult, [
        'targetRoot', 'repoUrl', 'branch',
        'currentVersion', 'latestVersion', 'updateAvailable',
        'checkUpdateResult'
    ]);
}

// ---------------------------------------------------------------------------
// T-074: gate command family (new CLI entrypoint)
// ---------------------------------------------------------------------------

function handleGate(commandArgv) {
    if (commandArgv.length === 0 || commandArgv[0] === '-h' || commandArgv[0] === '--help') {
        const { getAllShimmedGateNames } = require(path.join(PACKAGE_ROOT, 'src', 'compat', 'shim-registry.ts'));
        console.log(bold('Available gates:'));
        getAllShimmedGateNames().forEach(function (name) { console.log('  ' + name); });
        return;
    }

    const gateName = commandArgv[0];
    const gateArgv = commandArgv.slice(1);

    // Adapt PS-style args if present
    const { adaptPsArgs } = require(path.join(PACKAGE_ROOT, 'src', 'compat', 'ps-arg-adapter.ts'));
    const gateHelpers = require(path.join(PACKAGE_ROOT, 'src', 'gates', 'helpers.ts'));
    const adaptedArgv = adaptPsArgs(gateArgv);

    switch (gateName) {
        case 'validate-manifest': {
            const defs = { '--manifest-path': { key: 'manifestPath', type: 'string' } };
            const { options } = parseOptions(adaptedArgv, defs);
            const manifestPath = options.manifestPath || path.join('Octopus-agent-orchestrator', 'MANIFEST.md');
            const { validateManifest, formatManifestResult } = require(path.join(PACKAGE_ROOT, 'src', 'validators', 'validate-manifest.ts'));
            const result = validateManifest(manifestPath);
            if (typeof formatManifestResult === 'function') console.log(formatManifestResult(result));
            if (!result.passed) throw new Error('Manifest validation failed.');
            return;
        }
        case 'classify-change': {
            const defs = {
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--changed-file': { key: 'changedFiles', type: 'string[]' },
                '--changed-files': { key: 'changedFiles', type: 'string[]' },
                '--use-staged': { key: 'useStaged', type: 'boolean' },
                '--include-untracked': { key: 'includeUntracked', type: 'boolean' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--task-intent': { key: 'taskIntent', type: 'string' },
                '--fast-path-max-files': { key: 'fastPathMaxFiles', type: 'string' },
                '--fast-path-max-changed-lines': { key: 'fastPathMaxChangedLines', type: 'string' },
                '--performance-heuristic-min-lines': { key: 'performanceHeuristicMinLines', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const { runClassifyChangeCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const result = runClassifyChangeCommand(options);
            process.stdout.write(result.outputText);
            return;
        }
        case 'compile-gate': {
            const defs = {
                '--commands-path': { key: 'commandsPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--compile-output-path': { key: 'compileOutputPath', type: 'string' },
                '--fail-tail-lines': { key: 'failTailLines', type: 'string' },
                '--output-filters-path': { key: 'outputFiltersPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const { runCompileGateCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const result = runCompileGateCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'build-scoped-diff': {
            const defs = {
                '--review-type': { key: 'reviewType', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--paths-config-path': { key: 'pathsConfigPath', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--metadata-path': { key: 'metadataPath', type: 'string' },
                '--full-diff-path': { key: 'fullDiffPath', type: 'string' },
                '--use-staged': { key: 'useStaged', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const reviewType = parseRequiredText(options.reviewType, 'ReviewType');
            const preflightPath = gateHelpers.resolvePathInsideRepo(parseRequiredText(options.preflightPath, 'PreflightPath'), repoRoot);
            const { buildScopedDiff, resolveMetadataPath, resolveOutputPath } = require(path.join(PACKAGE_ROOT, 'src', 'gates', 'build-scoped-diff.ts'));
            const pathsConfigPath = options.pathsConfigPath
                ? gateHelpers.resolvePathInsideRepo(options.pathsConfigPath, repoRoot)
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'config', 'paths.json'));
            const outputPath = resolveOutputPath(options.outputPath || '', preflightPath, reviewType, repoRoot);
            const metadataPath = resolveMetadataPath(options.metadataPath || '', preflightPath, reviewType, repoRoot);
            const fullDiffPath = options.fullDiffPath
                ? gateHelpers.resolvePathInsideRepo(options.fullDiffPath, repoRoot)
                : null;
            const result = buildScopedDiff({
                reviewType,
                preflightPath,
                pathsConfigPath,
                outputPath,
                metadataPath,
                fullDiffPath,
                repoRoot,
                useStaged: options.useStaged
            });
            formatKeyValueOutput({
                outputPath: result.output_path,
                metadataPath: result.metadata_path,
                matchedFilesCount: result.matched_files_count,
                fallbackToFullDiff: result.fallback_to_full_diff
            }, ['outputPath', 'metadataPath', 'matchedFilesCount', 'fallbackToFullDiff']);
            return;
        }
        case 'build-review-context': {
            const defs = {
                '--review-type': { key: 'reviewType', type: 'string' },
                '--depth': { key: 'depth', type: 'string' },
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--token-economy-config-path': { key: 'tokenEconomyConfigPath', type: 'string' },
                '--scoped-diff-metadata-path': { key: 'scopedDiffMetadataPath', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const reviewType = parseRequiredText(options.reviewType, 'ReviewType');
            const depth = Number.parseInt(parseRequiredText(options.depth, 'Depth'), 10);
            if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
                throw new Error('Depth must be an integer between 1 and 3.');
            }
            const preflightPath = gateHelpers.resolvePathInsideRepo(parseRequiredText(options.preflightPath, 'PreflightPath'), repoRoot);
            const { buildReviewContext, resolveContextOutputPath, resolveScopedDiffMetadataPath } = require(path.join(PACKAGE_ROOT, 'src', 'gates', 'build-review-context.ts'));
            const tokenEconomyConfigPath = options.tokenEconomyConfigPath
                ? gateHelpers.resolvePathInsideRepo(options.tokenEconomyConfigPath, repoRoot, { allowMissing: true })
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('live', 'config', 'token-economy.json'));
            const outputPath = resolveContextOutputPath(options.outputPath || '', preflightPath, reviewType, repoRoot);
            const scopedDiffMetadataPath = resolveScopedDiffMetadataPath(options.scopedDiffMetadataPath || '', preflightPath, reviewType, repoRoot);
            const result = buildReviewContext({
                reviewType,
                depth,
                preflightPath,
                tokenEconomyConfigPath,
                scopedDiffMetadataPath,
                outputPath,
                repoRoot
            });
            formatKeyValueOutput({
                outputPath: result.output_path,
                ruleContextArtifactPath: result.rule_context.artifact_path,
                tokenEconomyActive: result.token_economy_active
            }, ['outputPath', 'ruleContextArtifactPath', 'tokenEconomyActive']);
            return;
        }
        case 'task-events-summary': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--events-root': { key: 'eventsRoot', type: 'string' },
                '--output-path': { key: 'outputPath', type: 'string' },
                '--as-json': { key: 'asJson', type: 'boolean' },
                '--include-details': { key: 'includeDetails', type: 'boolean' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const { buildTaskEventsSummary, formatTaskEventsSummaryText } = require(path.join(PACKAGE_ROOT, 'src', 'gates', 'task-events-summary.ts'));
            const eventsRoot = options.eventsRoot
                ? gateHelpers.resolvePathInsideRepo(options.eventsRoot, repoRoot, { allowMissing: true })
                : gateHelpers.joinOrchestratorPath(repoRoot, path.join('runtime', 'task-events'));
            const summary = buildTaskEventsSummary({
                taskId: parseRequiredText(options.taskId, 'TaskId'),
                eventsRoot,
                repoRoot,
                includeDetails: options.includeDetails,
                asJson: options.asJson
            });
            const rendered = options.asJson
                ? `${JSON.stringify(summary, null, 2)}\n`
                : `${formatTaskEventsSummaryText(summary, options.includeDetails)}\n`;
            if (options.outputPath) {
                const outputPath = gateHelpers.resolvePathInsideRepo(options.outputPath, repoRoot, { allowMissing: true });
                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, rendered, 'utf8');
            }
            process.stdout.write(rendered);
            return;
        }
        case 'log-task-event': {
            const defs = {
                '--task-id': { key: 'taskId', type: 'string' },
                '--event-type': { key: 'eventType', type: 'string' },
                '--outcome': { key: 'outcome', type: 'string' },
                '--message': { key: 'message', type: 'string' },
                '--actor': { key: 'actor', type: 'string' },
                '--details-json': { key: 'detailsJson', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' },
                '--events-root': { key: 'eventsRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const { runLogTaskEventCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const result = runLogTaskEventCommand(options);
            process.stdout.write(result.outputText);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'required-reviews-check': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--code-review-verdict': { key: 'codeReviewVerdict', type: 'string' },
                '--db-review-verdict': { key: 'dbReviewVerdict', type: 'string' },
                '--security-review-verdict': { key: 'securityReviewVerdict', type: 'string' },
                '--refactor-review-verdict': { key: 'refactorReviewVerdict', type: 'string' },
                '--api-review-verdict': { key: 'apiReviewVerdict', type: 'string' },
                '--test-review-verdict': { key: 'testReviewVerdict', type: 'string' },
                '--performance-review-verdict': { key: 'performanceReviewVerdict', type: 'string' },
                '--infra-review-verdict': { key: 'infraReviewVerdict', type: 'string' },
                '--dependency-review-verdict': { key: 'dependencyReviewVerdict', type: 'string' },
                '--skip-reviews': { key: 'skipReviews', type: 'string' },
                '--skip-reason': { key: 'skipReason', type: 'string' },
                '--override-artifact-path': { key: 'overrideArtifactPath', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--reviews-root': { key: 'reviewsRoot', type: 'string' },
                '--review-evidence-path': { key: 'reviewEvidencePath', type: 'string' },
                '--output-filters-path': { key: 'outputFiltersPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const { runRequiredReviewsCheckCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const result = runRequiredReviewsCheckCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'doc-impact-gate': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--decision': { key: 'decision', type: 'string' },
                '--behavior-changed': { key: 'behaviorChanged', type: 'boolean' },
                '--docs-updated': { key: 'docsUpdated', type: 'string[]' },
                '--changelog-updated': { key: 'changelogUpdated', type: 'boolean' },
                '--sensitive-scope-reviewed': { key: 'sensitiveScopeReviewed', type: 'boolean' },
                '--sensitive-reviewed': { key: 'sensitiveReviewed', type: 'boolean' },
                '--rationale': { key: 'rationale', type: 'string' },
                '--artifact-path': { key: 'artifactPath', type: 'string' },
                '--metrics-path': { key: 'metricsPath', type: 'string' },
                '--emit-metrics': { key: 'emitMetrics', type: 'boolean' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const { runDocImpactGateCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const result = runDocImpactGateCommand(options);
            process.stdout.write(`${result.outputLines.join('\n')}\n`);
            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
            return;
        }
        case 'completion-gate': {
            const defs = {
                '--preflight-path': { key: 'preflightPath', type: 'string' },
                '--task-id': { key: 'taskId', type: 'string' },
                '--timeline-path': { key: 'timelinePath', type: 'string' },
                '--reviews-root': { key: 'reviewsRoot', type: 'string' },
                '--compile-evidence-path': { key: 'compileEvidencePath', type: 'string' },
                '--review-evidence-path': { key: 'reviewEvidencePath', type: 'string' },
                '--doc-impact-path': { key: 'docImpactPath', type: 'string' },
                '--repo-root': { key: 'repoRoot', type: 'string' }
            };
            const { options } = parseOptions(adaptedArgv, defs);
            const repoRoot = normalizePathValue(options.repoRoot || '.');
            ensureDirectoryExists(repoRoot, 'Repo root');
            const { formatCompletionGateResult, runCompletionGate } = require(path.join(PACKAGE_ROOT, 'src', 'gates', 'completion.ts'));
            const result = runCompletionGate({
                repoRoot,
                preflightPath: parseRequiredText(options.preflightPath, 'PreflightPath'),
                taskId: options.taskId || '',
                timelinePath: options.timelinePath || '',
                reviewsRoot: options.reviewsRoot || '',
                compileEvidencePath: options.compileEvidencePath || '',
                reviewEvidencePath: options.reviewEvidencePath || '',
                docImpactPath: options.docImpactPath || ''
            });
            process.stdout.write(`${formatCompletionGateResult(result)}\n`);
            if (result.outcome !== 'PASS') {
                process.exitCode = 1;
            }
            return;
        }
        case 'human-commit': {
            const { runHumanCommitCommand } = require(path.join(PACKAGE_ROOT, 'src', 'cli', 'commands', 'gates.ts'));
            const exitCode = runHumanCommitCommand(adaptedArgv, { cwd: process.cwd() });
            if (exitCode !== 0) {
                process.exitCode = exitCode;
            }
            return;
        }
        default:
            throw new Error('Unknown gate: ' + gateName + '. Run "octopus gate --help" for available gates.');
    }
}

async function main() {
    const packageJson = readPackageJson();
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        printOverview(packageJson);
        return;
    }
    const commandName = getCommandName(argv);

    if (commandName === 'help') {
        printHelp(packageJson);
        return;
    }

    const commandArgv = commandName === 'bootstrap' && argv[0] !== 'bootstrap' ? argv : argv.slice(1);
    switch (commandName) {
        case 'setup':
            await handleSetup(commandArgv, packageJson);
            return;
        case 'status':
            handleStatus(commandArgv, packageJson);
            return;
        case 'doctor':
            await handleDoctor(commandArgv, packageJson);
            return;
        case 'bootstrap':
            await handleBootstrap(commandArgv, packageJson);
            return;
        case 'install':
            await handleInstall(commandArgv, packageJson);
            return;
        case 'init':
            await handleInit(commandArgv, packageJson);
            return;
        case 'reinit':
            await handleReinit(commandArgv, packageJson);
            return;
        case 'update':
            await handleUpdate(commandArgv, packageJson);
            return;
        case 'uninstall':
            await handleUninstall(commandArgv, packageJson);
            return;
        case 'verify':
            handleVerify(commandArgv, packageJson);
            return;
        case 'check-update':
            handleCheckUpdate(commandArgv, packageJson);
            return;
        case 'gate':
            handleGate(commandArgv);
            return;
        default:
            throw new Error(`Unsupported command: ${commandName}`);
    }
}

try {
    Promise.resolve(main()).catch((error) => {
        console.error('OCTOPUS_BOOTSTRAP_FAILED');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
} catch (error) {
    console.error('OCTOPUS_BOOTSTRAP_FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
