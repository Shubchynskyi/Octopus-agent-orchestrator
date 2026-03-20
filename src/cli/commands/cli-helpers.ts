const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const {
    ALL_AGENT_ENTRYPOINT_FILES,
    BOOLEAN_FALSE_VALUES,
    BOOLEAN_TRUE_VALUES,
    BREVITY_VALUES,
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    LIFECYCLE_COMMANDS,
    SOURCE_OF_TRUTH_VALUES,
    SOURCE_TO_ENTRYPOINT_MAP
} = require('../../core/constants.ts');

const { pathExists, readTextFile } = require('../../core/fs.ts');
const { isPathInsideRoot } = require('../../core/paths.ts');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';

const SKIPPED_ENTRY_NAMES = new Set([
    '__pycache__',
    '.pytest_cache'
]);

const SKIPPED_FILE_SUFFIXES = Object.freeze([
    '.pyc',
    '.pyo',
    '.pyd'
]);

const DEPLOY_ITEMS = Object.freeze([
    '.gitattributes',
    'bin',
    'scripts',
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

const COMMAND_SUMMARY = Object.freeze([
    ['setup', 'First-run onboarding'],
    ['status', 'Show workspace status'],
    ['doctor', 'Run verify + manifest validation'],
    ['bootstrap', 'Deploy bundle only'],
    ['reinit', 'Change init answers'],
    ['update', 'Check/apply updates'],
    ['uninstall', 'Remove orchestrator']
]);

// ---------------------------------------------------------------------------
// Terminal color helpers
// ---------------------------------------------------------------------------

function supportsColor() {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return true;
    return Boolean(process.stdout && process.stdout.isTTY);
}

function colorize(text, code) {
    return supportsColor() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function bold(text) { return colorize(text, '1'); }
function green(text) { return colorize(text, '32'); }
function cyan(text) { return colorize(text, '36'); }
function yellow(text) { return colorize(text, '33'); }
function red(text) { return colorize(text, '31'); }
function dim(text) { return colorize(text, '2'); }

function padRight(text, width) {
    return String(text).padEnd(width, ' ');
}

function printHighlightedPair(label, value, options) {
    const labelColor = (options && options.labelColor) || yellow;
    const valueColor = (options && options.valueColor) || green;
    const indent = (options && options.indent) || '';
    console.log(`${indent}${labelColor(label)} ${valueColor(value)}`);
}

// ---------------------------------------------------------------------------
// TTY / interactive detection
// ---------------------------------------------------------------------------

function supportsInteractivePrompts() {
    return Boolean(process.stdin && process.stdout && process.stdin.isTTY && process.stdout.isTTY);
}

function readLineInput(promptText) {
    return new Promise(function (resolve) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(promptText, function (value) {
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

async function promptSingleSelect(config) {
    const { title, defaultLabel, options, defaultValue } = config;
    if (!supportsInteractivePrompts()) {
        throw new Error('Interactive setup requires a TTY terminal.');
    }
    const defaultIndex = Math.max(0, options.findIndex(function (o) { return o.value === defaultValue; }));
    console.log(yellow(title));
    console.log(`Default: ${defaultLabel}.`);
    options.forEach(function (option, index) {
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

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

function parseOptions(argv, definitions, config) {
    const allowPositionals = (config && config.allowPositionals) || false;
    const maxPositionals = (config && config.maxPositionals) || 0;
    const options = {};
    const positionals = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '-h' || argument === '--help') { options.help = true; continue; }
        if (argument === '-v' || argument === '--version') { options.version = true; continue; }

        if (!argument.startsWith('-')) {
            if (!allowPositionals) throw new Error(`Unexpected positional argument: ${argument}`);
            positionals.push(argument);
            if (positionals.length > maxPositionals) throw new Error('Too many positional arguments were provided.');
            continue;
        }

        const equalsIndex = argument.indexOf('=');
        const optionName = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
        const inlineValue = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined;
        const definition = definitions[optionName];
        if (!definition) throw new Error(`Unknown option: ${argument}`);

        if (definition.type === 'boolean') {
            options[definition.key] = inlineValue === undefined ? true : parseCliBoolean(inlineValue, optionName);
            continue;
        }

        let resolvedValue = inlineValue;
        if (resolvedValue === undefined) {
            if (index + 1 >= argv.length) throw new Error(`${optionName} requires a value.`);
            resolvedValue = argv[index + 1];
            index += 1;
        }
        options[definition.key] = resolvedValue;
    }

    return { options, positionals };
}

// ---------------------------------------------------------------------------
// Value normalization helpers
// ---------------------------------------------------------------------------

function normalizeLogicalKey(value) {
    return String(value || '').toLowerCase().replace(/[_\-\s]/g, '');
}

function getInitAnswerValue(answers, logicalName) {
    const targetKey = normalizeLogicalKey(logicalName);
    for (const [key, value] of Object.entries(answers)) {
        if (normalizeLogicalKey(key) === targetKey) return value;
    }
    return null;
}

function parseBooleanText(value, label) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
        if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
    }
    throw new Error(`${label} must be one of: true, false, yes, no, 1, 0.`);
}

function parseCliBoolean(value, label) {
    return parseBooleanText(value, label);
}

function tryParseBooleanText(value, fallback) {
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : parseBooleanText(value, 'boolean');
    } catch (_e) { return fallback; }
}

function parseOptionalText(value) {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
        const items = value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
        return items.length > 0 ? items.join(', ') : null;
    }
    const text = String(value).trim();
    return text || null;
}

function parseRequiredText(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} must not be empty.`);
    return text;
}

function normalizeSourceOfTruth(value) {
    const text = parseRequiredText(value, 'SourceOfTruth');
    const match = SOURCE_OF_TRUTH_VALUES.find(function (c) { return c.toLowerCase() === text.toLowerCase(); });
    if (!match) throw new Error(`SourceOfTruth must be one of: ${SOURCE_OF_TRUTH_VALUES.join(', ')}.`);
    return match;
}

function tryNormalizeSourceOfTruth(value, fallback) {
    if (fallback === undefined) fallback = 'Claude';
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeSourceOfTruth(value);
    } catch (_e) { return fallback; }
}

function normalizeAssistantBrevity(value) {
    const text = parseRequiredText(value, 'AssistantBrevity').toLowerCase();
    if (!BREVITY_VALUES.includes(text)) {
        throw new Error(`AssistantBrevity must be one of: ${BREVITY_VALUES.join(', ')}.`);
    }
    return text;
}

function tryNormalizeAssistantBrevity(value, fallback) {
    if (fallback === undefined) fallback = 'concise';
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeAssistantBrevity(value);
    } catch (_e) { return fallback; }
}

function convertSourceOfTruthToEntrypoint(sourceOfTruth) {
    const sourceKey = String(sourceOfTruth || '').trim();
    const match = SOURCE_OF_TRUTH_VALUES.find(function (c) { return c.toLowerCase() === sourceKey.toLowerCase(); });
    return match ? SOURCE_TO_ENTRYPOINT_MAP[match] : null;
}

function normalizeAgentEntrypointToken(value) {
    const trimmed = String(value || '').trim().replace(/^or\s+/i, '');
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase().replace(/\\/g, '/');
    switch (normalized) {
        case 'claude': case 'claude.md': return 'CLAUDE.md';
        case 'codex': case 'agents': case 'agents.md': return 'AGENTS.md';
        case 'gemini': case 'gemini.md': return 'GEMINI.md';
        case 'githubcopilot': case 'copilot': case '.github/copilot-instructions.md': return '.github/copilot-instructions.md';
        case 'windsurf': case '.windsurf/rules/rules.md': return '.windsurf/rules/rules.md';
        case 'junie': case '.junie/guidelines.md': return '.junie/guidelines.md';
        case 'antigravity': case '.antigravity/rules.md': return '.antigravity/rules.md';
        default: {
            const match = ALL_AGENT_ENTRYPOINT_FILES.find(function (c) { return c.toLowerCase() === normalized; });
            return match || null;
        }
    }
}

function normalizeActiveAgentFiles(value, sourceOfTruth) {
    const canonicalEntrypoint = convertSourceOfTruthToEntrypoint(sourceOfTruth);
    const tokens = parseOptionalText(value)
        ? String(value).split(/[;,]+/).map(normalizeAgentEntrypointToken).filter(Boolean)
        : [];
    const unique = new Set(tokens);
    if (canonicalEntrypoint) unique.add(canonicalEntrypoint);
    const ordered = ALL_AGENT_ENTRYPOINT_FILES.filter(function (entry) { return unique.has(entry); });
    return ordered.length > 0 ? ordered.join(', ') : null;
}

function normalizeCollectedVia(value) {
    const text = parseOptionalText(value);
    return text || 'AGENT_INIT_PROMPT.md';
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function normalizePathValue(value) {
    return path.resolve(String(value || '.'));
}

function toPosixPath(value) {
    return value.replace(/\\/g, '/');
}

function ensureDirectoryExists(directoryPath, label) {
    if (!fs.existsSync(directoryPath)) throw new Error(`${label} not found: ${directoryPath}`);
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
}

function resolvePathInsideRoot(rootPath, pathValue, label, options) {
    const requireFile = (options && options.requireFile) || false;
    const allowMissing = (options && options.allowMissing) || false;
    let candidatePath = String(pathValue || '').trim();
    if (!candidatePath) throw new Error(`${label} must not be empty.`);
    if (!path.isAbsolute(candidatePath)) candidatePath = path.join(rootPath, candidatePath);
    const fullPath = path.resolve(candidatePath);
    if (!isPathInsideRoot(rootPath, fullPath)) {
        throw new Error(`${label} must resolve inside target root '${rootPath}'. Resolved path: ${fullPath}`);
    }
    if (!fs.existsSync(fullPath)) {
        if (allowMissing) return fullPath;
        throw new Error(`${label} not found: ${fullPath}`);
    }
    if (requireFile) {
        const stats = fs.lstatSync(fullPath);
        if (!stats.isFile()) throw new Error(`${label} is not a file: ${fullPath}`);
    }
    return fullPath;
}

function getBundlePath(targetRoot) {
    return path.join(targetRoot, DEFAULT_BUNDLE_NAME);
}

function getAgentInitPromptPath(bundlePath) {
    return path.join(bundlePath, 'AGENT_INIT_PROMPT.md');
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function readOptionalJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) return null;
        return JSON.parse(raw);
    } catch (_e) { return null; }
}

function readPackageJson(packageRoot) {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
}

function readBundleVersion(sourceRoot) {
    const versionPath = path.join(sourceRoot, 'VERSION');
    if (fs.existsSync(versionPath)) return fs.readFileSync(versionPath, 'utf8').trim();
    return readPackageJson(sourceRoot).version;
}

// ---------------------------------------------------------------------------
// File copy / bundle deployment
// ---------------------------------------------------------------------------

function shouldSkipPath(sourcePath) {
    const entryName = path.basename(sourcePath);
    if (SKIPPED_ENTRY_NAMES.has(entryName)) return true;
    return SKIPPED_FILE_SUFFIXES.some(function (suffix) { return entryName.endsWith(suffix); });
}

function copyPath(sourcePath, destinationPath) {
    if (shouldSkipPath(sourcePath)) return;
    const stats = fs.lstatSync(sourcePath);
    const destinationParent = path.dirname(destinationPath);
    fs.mkdirSync(destinationParent, { recursive: true });
    if (stats.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        for (const entry of fs.readdirSync(sourcePath)) {
            copyPath(path.join(sourcePath, entry), path.join(destinationPath, entry));
        }
        return;
    }
    if (stats.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(sourcePath);
        fs.symlinkSync(linkTarget, destinationPath);
        return;
    }
    fs.copyFileSync(sourcePath, destinationPath);
    try { fs.chmodSync(destinationPath, stats.mode); } catch (_e) { /* Windows may ignore */ }
}

function removePathIfExists(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureSourceItemExists(sourceRoot, relativePath) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) throw new Error(`Bundle source asset is missing: ${relativePath}`);
    return sourcePath;
}

function deployFreshBundle(sourceRoot, destinationPath) {
    if (fs.existsSync(destinationPath)) {
        const stats = fs.lstatSync(destinationPath);
        if (!stats.isDirectory()) throw new Error(`Destination exists and is not a directory: ${destinationPath}`);
        const entries = fs.readdirSync(destinationPath);
        if (entries.length > 0) throw new Error(`Destination already exists and is not empty: ${destinationPath}`);
    }
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const relativePath of DEPLOY_ITEMS) {
        const sourcePath = ensureSourceItemExists(sourceRoot, relativePath);
        copyPath(sourcePath, path.join(destinationPath, relativePath));
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
        copyPath(sourcePath, targetPath);
    }
}

// ---------------------------------------------------------------------------
// Source acquisition
// ---------------------------------------------------------------------------

function createMissingExecutableError(executableName) {
    return new Error(
        `'${executableName}' is not available on this system. ` +
        `Please install ${executableName} and ensure it is on your PATH.`
    );
}

function runProcess(executableName, args, options) {
    const cwd = (options && options.cwd) || process.cwd();
    const description = (options && options.description) || executableName;
    const interactive = (options && options.interactive) || false;
    return new Promise(function (resolve, reject) {
        let settled = false;
        const child = childProcess.spawn(executableName, args, {
            cwd,
            windowsHide: true,
            stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe']
        });
        function rejectOnce(error) { if (!settled) { settled = true; reject(error); } }
        function resolveOnce() { if (!settled) { settled = true; resolve(); } }
        child.once('error', function (error) {
            if (error && error.code === 'ENOENT') { rejectOnce(createMissingExecutableError(executableName)); return; }
            rejectOnce(error);
        });
        if (!interactive) {
            if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', function (chunk) { process.stdout.write(chunk); }); }
            if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', function (chunk) { process.stderr.write(chunk); }); }
        }
        child.once('close', function (code) {
            if (code !== 0) { rejectOnce(new Error(`${description} failed with exit code ${code}.`)); return; }
            resolveOnce();
        });
    });
}

async function acquireSourceRoot(repoUrl, branch, packageRoot) {
    if (!repoUrl && !branch) {
        return {
            sourceRoot: packageRoot,
            bundleVersion: readBundleVersion(packageRoot),
            cleanup: function () {}
        };
    }
    const effectiveRepoUrl = String(repoUrl || DEFAULT_REPO_URL).trim();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-source-'));
    try {
        const cloneArgs = ['clone', '--quiet', '--depth', '1'];
        if (branch) { cloneArgs.push('--branch', String(branch).trim(), '--single-branch'); }
        cloneArgs.push(effectiveRepoUrl, tempRoot);
        await runProcess('git', cloneArgs, { cwd: process.cwd(), description: `git clone from ${effectiveRepoUrl}` });
        return {
            sourceRoot: tempRoot,
            bundleVersion: readBundleVersion(tempRoot),
            cleanup: function () { fs.rmSync(tempRoot, { recursive: true, force: true }); }
        };
    } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw error;
    }
}

// ---------------------------------------------------------------------------
// PowerShell execution
// ---------------------------------------------------------------------------

function addStringArg(args, name, value) {
    if (value === undefined || value === null || String(value).trim() === '') return;
    args.push(`-${name}`, String(value));
}

function addSwitchArg(args, name, enabled) {
    if (enabled) args.push(`-${name}`);
}

async function runPowerShellScript(scriptPath, configureArgs, options) {
    const interactive = (options && options.interactive) || false;
    if (!fs.existsSync(scriptPath)) throw new Error(`PowerShell script not found: ${scriptPath}`);
    const args = ['-NoLogo', '-NoProfile', '-File', scriptPath];
    configureArgs(args);
    await runProcess('pwsh', args, { cwd: process.cwd(), description: path.basename(scriptPath), interactive });
}

// ---------------------------------------------------------------------------
// Banner / status display
// ---------------------------------------------------------------------------

function printBanner(packageJson, title, subtitle) {
    const width = 62;
    const top = `+${'-'.repeat(width - 2)}+`;
    const versionText = `v${packageJson.version}`;
    const titleText = ` OCTOPUS AGENT ORCHESTRATOR `;
    const titleLine = `|${padRight(titleText, width - versionText.length - 3)} ${versionText}|`;
    console.log(cyan(top));
    console.log(cyan(titleLine));
    console.log(cyan(top));
    if (title) console.log(bold(title));
    if (subtitle) console.log(dim(subtitle));
}

function buildBannerText(packageJson, title, subtitle) {
    const width = 62;
    const top = `+${'-'.repeat(width - 2)}+`;
    const versionText = `v${packageJson.version}`;
    const titleText = ` OCTOPUS AGENT ORCHESTRATOR `;
    const titleLine = `|${padRight(titleText, width - versionText.length - 3)} ${versionText}|`;
    const lines = [top, titleLine, top];
    if (title) lines.push(title);
    if (subtitle) lines.push(subtitle);
    return lines.join('\n');
}

function getStageBadge(completed, options) {
    const warning = (options && options.warning) || false;
    const label = completed ? '[x]' : '[ ]';
    if (completed) return green(label);
    if (warning) return yellow(label);
    return dim(label);
}

function getWorkspaceHeadline(snapshot) {
    if (snapshot.readyForTasks) return green('Workspace ready');
    if (snapshot.primaryInitializationComplete) return yellow('Agent setup required');
    if (snapshot.bundlePresent) return yellow('Primary setup required');
    return red('Not installed');
}

function printStatus(snapshot, options) {
    const heading = (options && options.heading) || 'OCTOPUS_STATUS';
    console.log(heading);
    console.log(bold(getWorkspaceHeadline(snapshot)));
    console.log(`Project: ${snapshot.targetRoot}`);
    console.log(`Bundle: ${snapshot.bundlePath}`);
    console.log(`InitAnswers: ${snapshot.initAnswersResolvedPath}`);
    console.log(`CollectedVia: ${snapshot.collectedVia || 'n/a'}`);
    if (snapshot.activeAgentFiles) console.log(`ActiveAgentFiles: ${snapshot.activeAgentFiles}`);
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
    if (snapshot.initAnswersError) console.log(`InitAnswersStatus: INVALID (${snapshot.initAnswersError})`);
    if (snapshot.liveVersionError) console.log(`LiveVersionStatus: INVALID (${snapshot.liveVersionError})`);
    if (snapshot.missingProjectCommands.length > 0 && snapshot.primaryInitializationComplete) {
        console.log(`CommandsRule: ${snapshot.commandsRulePath}`);
        printHighlightedPair('CommandsStatus:', 'PENDING_AGENT_CONTEXT');
    }
    printHighlightedPair('RecommendedNextCommand:', snapshot.recommendedNextCommand);
    console.log('');
    printCommandSummary();
}

function printCommandSummary() {
    console.log(bold('Available Commands'));
    for (const [name, description] of COMMAND_SUMMARY) {
        console.log(`  ${padRight(name, 10)} ${description}`);
    }
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
            '  install       Deploy or refresh the bundle and run scripts/install.ps1 using prepared init answers.',
            '  init          Run scripts/init.ps1 using prepared init answers from an existing deployed bundle.',
            '  reinit        Run scripts/reinit.ps1 for an existing deployed bundle.',
            '  update        Run scripts/check-update.ps1 for an existing deployed bundle.',
            '  uninstall     Run scripts/uninstall.ps1 for an existing deployed bundle.'
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
            '  - update delegates to check-update.ps1, so --apply controls immediate update and --no-prompt disables prompts.'
        ]
    ];
    console.log(sections.map(function (s) { return s.join('\n'); }).join('\n\n'));
}

function buildHelpText(packageJson) {
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
            '  install       Deploy or refresh the bundle and run scripts/install.ps1 using prepared init answers.',
            '  init          Run scripts/init.ps1 using prepared init answers from an existing deployed bundle.',
            '  reinit        Run scripts/reinit.ps1 for an existing deployed bundle.',
            '  update        Run scripts/check-update.ps1 for an existing deployed bundle.',
            '  uninstall     Run scripts/uninstall.ps1 for an existing deployed bundle.'
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
            '  - update delegates to check-update.ps1, so --apply controls immediate update and --no-prompt disables prompts.'
        ]
    ];
    return sections.map(function (s) { return s.join('\n'); }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Init-answers reading for status-like flows
// ---------------------------------------------------------------------------

function readInitAnswersArtifact(targetRoot, initAnswersPath, bundlePath, commandName) {
    const resolvedPath = resolvePathInsideRoot(targetRoot, initAnswersPath, 'InitAnswersPath', { allowMissing: true });
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(
            `Init answers file is missing for '${commandName}'. ` +
            `Expected at: ${resolvedPath}\n` +
            `Give your agent "${getAgentInitPromptPath(bundlePath)}" to produce the init answers first.`
        );
    }
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    if (!raw.trim()) throw new Error(`Init answers artifact is empty: ${resolvedPath}`);
    let answers;
    try { answers = JSON.parse(raw); } catch (_e) {
        throw new Error(`Init answers artifact is not valid JSON: ${resolvedPath}`);
    }
    const assistantLanguage = parseRequiredText(getInitAnswerValue(answers, 'AssistantLanguage'), 'AssistantLanguage');
    const assistantBrevity = normalizeAssistantBrevity(getInitAnswerValue(answers, 'AssistantBrevity'));
    const sotValue = normalizeSourceOfTruth(getInitAnswerValue(answers, 'SourceOfTruth'));
    const enforceNoAutoCommit = parseBooleanText(getInitAnswerValue(answers, 'EnforceNoAutoCommit') ?? false, 'EnforceNoAutoCommit');
    const claudeOrchestratorFullAccess = parseBooleanText(getInitAnswerValue(answers, 'ClaudeOrchestratorFullAccess'), 'ClaudeOrchestratorFullAccess');
    const tokenEconomyEnabled = parseBooleanText(getInitAnswerValue(answers, 'TokenEconomyEnabled') ?? false, 'TokenEconomyEnabled');
    const collectedVia = normalizeCollectedVia(getInitAnswerValue(answers, 'CollectedVia'));
    const activeAgentFiles = parseOptionalText(getInitAnswerValue(answers, 'ActiveAgentFiles'));

    return {
        resolvedPath,
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth: sotValue,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess,
        tokenEconomyEnabled,
        collectedVia,
        activeAgentFiles
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    acquireSourceRoot,
    addStringArg,
    addSwitchArg,
    bold,
    buildBannerText,
    buildHelpText,
    COMMAND_SUMMARY,
    colorize,
    convertSourceOfTruthToEntrypoint,
    copyPath,
    cyan,
    DEFAULT_REPO_URL,
    DEPLOY_ITEMS,
    deployFreshBundle,
    dim,
    ensureDirectoryExists,
    ensureSourceItemExists,
    getAgentInitPromptPath,
    getBundlePath,
    getInitAnswerValue,
    getStageBadge,
    getWorkspaceHeadline,
    green,
    normalizeActiveAgentFiles,
    normalizeAgentEntrypointToken,
    normalizeAssistantBrevity,
    normalizeCollectedVia,
    normalizeLogicalKey,
    normalizePathValue,
    normalizeSourceOfTruth,
    padRight,
    parseCliBoolean,
    parseBooleanText,
    parseOptionalText,
    parseOptions,
    parseRequiredText,
    printBanner,
    printCommandSummary,
    printHelp,
    printHighlightedPair,
    printStatus,
    promptSingleSelect,
    promptTextInput,
    readBundleVersion,
    readInitAnswersArtifact,
    readLineInput,
    readOptionalJsonFile,
    readPackageJson,
    red,
    removePathIfExists,
    resolvePathInsideRoot,
    runPowerShellScript,
    runProcess,
    shouldSkipPath,
    SKIPPED_ENTRY_NAMES,
    SKIPPED_FILE_SUFFIXES,
    supportsColor,
    supportsInteractivePrompts,
    syncBundleItems,
    toPosixPath,
    tryNormalizeAssistantBrevity,
    tryNormalizeSourceOfTruth,
    tryParseBooleanText,
    yellow
};
