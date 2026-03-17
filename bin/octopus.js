#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE_NAME = 'Octopus-agent-orchestrator';
const DEFAULT_INIT_ANSWERS_RELATIVE_PATH = path.join(DEFAULT_BUNDLE_NAME, 'runtime', 'init-answers.json');
const DEFAULT_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';
const LIFECYCLE_COMMANDS = new Set([
    'bootstrap',
    'install',
    'init',
    'reinit',
    'uninstall',
    'update'
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

function toPosixPath(value) {
    return value.replace(/\\/g, '/');
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

function parseCliBoolean(value, label) {
    return parseBooleanText(value, label);
}

function parseRequiredText(value, label) {
    const text = String(value || '').trim();
    if (!text) {
        throw new Error(`${label} must not be empty.`);
    }

    return text;
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
    if (!YES_NO_VALUES.has(text)) {
        throw new Error(`${label} must be one of: yes, no.`);
    }

    return text;
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
            options[definition.key] = inlineValue === undefined ? true : parseCliBoolean(inlineValue, optionName);
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

function copyPath(sourcePath, destinationPath) {
    if (shouldSkipPath(sourcePath)) {
        return;
    }

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

function emitChildResult(result, executableName) {
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    if (result.error) {
        if (result.error.code === 'ENOENT') {
            throw new Error(`${executableName} is required but was not found in PATH.`);
        }

        throw result.error;
    }
}

function runProcess(executableName, args, { cwd, description } = {}) {
    const result = childProcess.spawnSync(executableName, args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true
    });
    emitChildResult(result, executableName);

    if (result.status !== 0) {
        throw new Error(`${description || executableName} failed with exit code ${result.status}.`);
    }
}

function acquireSourceRoot(repoUrl, branch) {
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
        runProcess('git', cloneArgs, {
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
        `The '${commandName}' command only works after an agent has prepared init answers.`,
        `Give the agent "${initPromptPath}" and let it write "${initAnswersPath}", then rerun this command.`
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
    const collectedVia = parseRequiredText(getInitAnswerValue(answers, 'CollectedVia'), 'CollectedVia');
    if (collectedVia.toLowerCase() !== 'agent_init_prompt.md') {
        throw new Error(`CollectedVia must be 'AGENT_INIT_PROMPT.md'. Current value: '${collectedVia}'.`);
    }

    return {
        resolvedPath,
        assistantLanguage,
        assistantBrevity,
        sourceOfTruth,
        enforceNoAutoCommit,
        claudeOrchestratorFullAccess,
        tokenEconomyEnabled
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

function addStringArg(args, name, value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return;
    }

    args.push(`-${name}`, String(value));
}

function addSwitchArg(args, name, enabled) {
    if (enabled) {
        args.push(`-${name}`);
    }
}

function addBooleanArg(args, name, value) {
    if (typeof value === 'boolean') {
        args.push(`-${name}:${value ? '$true' : '$false'}`);
    }
}

function runPowerShellScript(scriptPath, configureArgs) {
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`PowerShell script not found: ${scriptPath}`);
    }

    const args = ['-NoLogo', '-NoProfile', '-File', scriptPath];
    configureArgs(args);
    runProcess('pwsh', args, {
        cwd: process.cwd(),
        description: path.basename(scriptPath)
    });
}

function printHelp(packageJson) {
    const sections = [
        [
            `Octopus Agent Orchestrator CLI v${packageJson.version}`,
            'Usage:',
            '  octopus-agent-orchestrator [destination]',
            '  octopus-agent-orchestrator <command> [options]'
        ],
        [
            'Commands:',
            '  bootstrap     Deploy the bundle only (default when no command is provided).',
            '  install       Deploy or refresh the bundle and run scripts/install.ps1 using agent-produced init answers.',
            '  init          Run scripts/init.ps1 using agent-produced init answers from an existing deployed bundle.',
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
            '      --target-root <path>         Workspace root. Defaults to the current working directory.',
            '      --init-answers-path <path>   Path inside the workspace to agent-produced init answers.'
        ],
        [
            'Bootstrap/install source override options:',
            '      --repo-url <url>             Clone bundle source from a repo instead of the packaged bundle.',
            '      --branch <name>              Clone a specific branch for branch testing.'
        ],
        [
            'Notes:',
            `  - The default deployed bundle path is ${DEFAULT_BUNDLE_NAME}.`,
            '  - install/init do not ask the human user init questions; the agent must prepare init-answers.json first.',
            '  - update delegates to check-update.ps1, so --apply controls immediate update and --no-prompt disables prompts.'
        ]
    ];

    console.log(sections.map((section) => section.join('\n')).join('\n\n'));
}

function printBootstrapSuccess(packageJson, bundleVersion, destinationPath) {
    const targetRoot = path.dirname(destinationPath);
    const bundleRelativePath = path.relative(targetRoot, destinationPath) || path.basename(destinationPath);
    const initPromptPath = path.join(destinationPath, 'AGENT_INIT_PROMPT.md');
    const installScriptPath = path.join(destinationPath, 'scripts', 'install.ps1');
    const installShellPath = path.join(destinationPath, 'scripts', 'install.sh');
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
        console.log('3. Custom bundle paths should use the raw installer entrypoint:');
        console.log(`   pwsh -File "${installScriptPath}" -TargetRoot "${targetRoot}" -AssistantLanguage "<language>" -AssistantBrevity "<concise|detailed>" -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "${initAnswersRelativePath}"`);
        console.log(`   bash "${toPosixPath(installShellPath)}" -TargetRoot "${toPosixPath(targetRoot)}" -AssistantLanguage "<language>" -AssistantBrevity "<concise|detailed>" -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "${toPosixPath(initAnswersRelativePath)}"`);
    }
}

function handleBootstrap(commandArgv, packageJson) {
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
    const source = acquireSourceRoot(options.repoUrl, options.branch);
    try {
        deployFreshBundle(source.sourceRoot, destinationPath);
        printBootstrapSuccess(packageJson, source.bundleVersion, destinationPath);
    } finally {
        source.cleanup();
    }
}

function handleInstall(commandArgv, packageJson) {
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

    const source = acquireSourceRoot(options.repoUrl, options.branch);
    try {
        const bundlePath = getBundlePath(targetRoot);
        if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isDirectory()) {
            syncBundleItems(source.sourceRoot, bundlePath);
        } else if (!options.dryRun) {
            syncBundleItems(source.sourceRoot, bundlePath);
        }

        const effectiveBundlePath = fs.existsSync(bundlePath) ? bundlePath : source.sourceRoot;
        const initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
        const answers = readInitAnswersArtifact(targetRoot, initAnswersPath, getBundlePath(targetRoot), 'install');
        const installScriptPath = path.join(effectiveBundlePath, 'scripts', 'install.ps1');

        runPowerShellScript(installScriptPath, (args) => {
            addStringArg(args, 'TargetRoot', targetRoot);
            addStringArg(args, 'AssistantLanguage', answers.assistantLanguage);
            addStringArg(args, 'AssistantBrevity', answers.assistantBrevity);
            addStringArg(args, 'SourceOfTruth', answers.sourceOfTruth);
            addStringArg(args, 'InitAnswersPath', answers.resolvedPath);
            addSwitchArg(args, 'DryRun', options.dryRun);
        });
    } finally {
        source.cleanup();
    }
}

function handleInit(commandArgv, packageJson) {
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
    const initScriptPath = path.join(bundlePath, 'scripts', 'init.ps1');

    runPowerShellScript(initScriptPath, (args) => {
        addStringArg(args, 'TargetRoot', targetRoot);
        addStringArg(args, 'AssistantLanguage', answers.assistantLanguage);
        addStringArg(args, 'AssistantBrevity', answers.assistantBrevity);
        addStringArg(args, 'SourceOfTruth', answers.sourceOfTruth);
        addBooleanArg(args, 'EnforceNoAutoCommit', answers.enforceNoAutoCommit);
        addBooleanArg(args, 'TokenEconomyEnabled', answers.tokenEconomyEnabled);
        addSwitchArg(args, 'DryRun', options.dryRun);
    });
}

function handleReinit(commandArgv, packageJson) {
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
    const reinitScriptPath = path.join(bundlePath, 'scripts', 'reinit.ps1');

    runPowerShellScript(reinitScriptPath, (args) => {
        addStringArg(args, 'TargetRoot', targetRoot);
        addStringArg(args, 'InitAnswersPath', options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH);
        addSwitchArg(args, 'NoPrompt', options.noPrompt);
        addSwitchArg(args, 'SkipVerify', options.skipVerify);
        addSwitchArg(args, 'SkipManifestValidation', options.skipManifestValidation);
        addStringArg(args, 'AssistantLanguage', options.assistantLanguage);
        if (options.assistantBrevity !== undefined) {
            addStringArg(args, 'AssistantBrevity', normalizeAssistantBrevity(options.assistantBrevity));
        }
        if (options.sourceOfTruth !== undefined) {
            addStringArg(args, 'SourceOfTruth', normalizeSourceOfTruth(options.sourceOfTruth));
        }
        if (options.enforceNoAutoCommit !== undefined) {
            addStringArg(args, 'EnforceNoAutoCommit', parseCliBoolean(options.enforceNoAutoCommit, 'EnforceNoAutoCommit') ? 'true' : 'false');
        }
        if (options.claudeOrchestratorFullAccess !== undefined) {
            addStringArg(args, 'ClaudeOrchestratorFullAccess', parseCliBoolean(options.claudeOrchestratorFullAccess, 'ClaudeOrchestratorFullAccess') ? 'true' : 'false');
        }
        if (options.tokenEconomyEnabled !== undefined) {
            addStringArg(args, 'TokenEconomyEnabled', parseCliBoolean(options.tokenEconomyEnabled, 'TokenEconomyEnabled') ? 'true' : 'false');
        }
    });
}

function handleUpdate(commandArgv, packageJson) {
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
    const updateScriptPath = path.join(bundlePath, 'scripts', 'check-update.ps1');

    runPowerShellScript(updateScriptPath, (args) => {
        addStringArg(args, 'TargetRoot', targetRoot);
        addStringArg(args, 'InitAnswersPath', options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH);
        addStringArg(args, 'RepoUrl', options.repoUrl);
        addStringArg(args, 'Branch', options.branch);
        addSwitchArg(args, 'Apply', options.apply);
        addSwitchArg(args, 'NoPrompt', options.noPrompt);
        addSwitchArg(args, 'DryRun', options.dryRun);
        addSwitchArg(args, 'SkipVerify', options.skipVerify);
        addSwitchArg(args, 'SkipManifestValidation', options.skipManifestValidation);
    });
}

function handleUninstall(commandArgv, packageJson) {
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
    const uninstallScriptPath = path.join(bundlePath, 'scripts', 'uninstall.ps1');

    runPowerShellScript(uninstallScriptPath, (args) => {
        addStringArg(args, 'TargetRoot', targetRoot);
        addStringArg(args, 'InitAnswersPath', options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH);
        addSwitchArg(args, 'NoPrompt', options.noPrompt);
        addSwitchArg(args, 'DryRun', options.dryRun);
        addSwitchArg(args, 'SkipBackups', options.skipBackups);
        if (options.keepPrimaryEntrypoint !== undefined) {
            addStringArg(args, 'KeepPrimaryEntrypoint', normalizeYesNo(options.keepPrimaryEntrypoint, 'KeepPrimaryEntrypoint'));
        }
        if (options.keepTaskFile !== undefined) {
            addStringArg(args, 'KeepTaskFile', normalizeYesNo(options.keepTaskFile, 'KeepTaskFile'));
        }
        if (options.keepRuntimeArtifacts !== undefined) {
            addStringArg(args, 'KeepRuntimeArtifacts', normalizeYesNo(options.keepRuntimeArtifacts, 'KeepRuntimeArtifacts'));
        }
    });
}

function main() {
    const packageJson = readPackageJson();
    const argv = process.argv.slice(2);
    const commandName = getCommandName(argv);

    if (commandName === 'help') {
        printHelp(packageJson);
        return;
    }

    const commandArgv = commandName === 'bootstrap' ? argv : argv.slice(1);
    switch (commandName) {
        case 'bootstrap':
            handleBootstrap(commandArgv, packageJson);
            return;
        case 'install':
            handleInstall(commandArgv, packageJson);
            return;
        case 'init':
            handleInit(commandArgv, packageJson);
            return;
        case 'reinit':
            handleReinit(commandArgv, packageJson);
            return;
        case 'update':
            handleUpdate(commandArgv, packageJson);
            return;
        case 'uninstall':
            handleUninstall(commandArgv, packageJson);
            return;
        default:
            throw new Error(`Unsupported command: ${commandName}`);
    }
}

try {
    main();
} catch (error) {
    console.error('OCTOPUS_BOOTSTRAP_FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
