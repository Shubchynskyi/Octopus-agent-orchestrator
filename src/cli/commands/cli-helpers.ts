import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {
    ALL_AGENT_ENTRYPOINT_FILES,
    BOOLEAN_FALSE_VALUES,
    BOOLEAN_TRUE_VALUES,
    BREVITY_VALUES,
    DEFAULT_BUNDLE_NAME,
    SOURCE_OF_TRUTH_VALUES
} from '../../core/constants';
import { getCanonicalEntrypointFile, normalizeAgentEntrypointToken as normalizeCommonAgentEntrypointToken } from '../../materialization/common';
import { isPathInsideRoot } from '../../core/paths';
import { registerTempRoot } from '../signal-handler';

type ColorFormatter = (text: string) => string;

type ParsedOptionValue = string | boolean | string[] | undefined;

type OptionDefinitions = Record<string, { key: string; type: string }>;

export interface PackageJsonLike {
    name: string;
    version: string;
    [key: string]: unknown;
}

export interface HighlightedPairOptions {
    labelColor?: ColorFormatter;
    valueColor?: ColorFormatter;
    indent?: string;
}

export interface PromptSingleSelectOption {
    label: string;
    value: string;
}

export interface PromptSingleSelectConfig {
    title: string;
    defaultLabel: string;
    options: PromptSingleSelectOption[];
    defaultValue: string;
}

export interface StatusSnapshot {
    targetRoot: string;
    bundlePath: string;
    initAnswersResolvedPath: string;
    collectedVia: string | null;
    activeAgentFiles: string | null;
    sourceOfTruth: string | null;
    canonicalEntrypoint: string | null;
    bundlePresent: boolean;
    primaryInitializationComplete: boolean;
    agentInitializationComplete: boolean;
    readyForTasks: boolean;
    agentInitializationPendingReason:
        | 'AGENT_HANDOFF_REQUIRED'
        | 'LANGUAGE_CONFIRMATION_PENDING'
        | 'ACTIVE_AGENT_FILES_PENDING'
        | 'AGENT_STATE_STALE'
        | 'PROJECT_RULES_PENDING'
        | 'SKILLS_PROMPT_PENDING'
        | 'VALIDATION_PENDING'
        | 'AGENT_STATE_INVALID'
        | 'PROJECT_COMMANDS_PENDING'
        | null;
    missingProjectCommands: string[];
    initAnswersError: string | null;
    liveVersionError: string | null;
    agentInitStateError: string | null;
    commandsRulePath: string;
    recommendedNextCommand: string;
    parityResult: {
        isSourceCheckout: boolean;
        isStale: boolean;
        violations: string[];
        remediation: string | null;
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_REPO_URL = 'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git';

export const SKIPPED_ENTRY_NAMES = new Set([
    '__pycache__',
    '.pytest_cache'
]);

export const SKIPPED_FILE_SUFFIXES = Object.freeze([
    '.pyc',
    '.pyo',
    '.pyd'
]);

export const DEPLOY_ITEMS = Object.freeze([
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

export const COMPILED_RUNTIME_DEPLOY_CANDIDATES = Object.freeze([
    'dist',
    '.node-build'
]);

export const COMMAND_SUMMARY = Object.freeze([
    ['setup', 'First-run onboarding'],
    ['agent-init', 'Finalize mandatory agent onboarding'],
    ['status', 'Show workspace status'],
    ['doctor', 'Run verify + manifest validation'],
    ['bootstrap', 'Deploy bundle only'],
    ['reinit', 'Change init answers'],
    ['update', 'Check/apply updates'],
    ['update git', 'Apply update from git source'],
    ['rollback', 'Rollback to a specific or previous version'],
    ['uninstall', 'Remove orchestrator'],
    ['verify', 'Verify workspace layout'],
    ['check-update', 'Check for available updates'],
    ['skills', 'List, suggest, and manage optional skill packs'],
    ['gate', 'Run an agent gate (gate <name>)']
]);

// ---------------------------------------------------------------------------
// Terminal color helpers
// ---------------------------------------------------------------------------

export function supportsColor(): boolean {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return true;
    return Boolean(process.stdout && process.stdout.isTTY);
}

export function colorize(text: string, code: string): string {
    return supportsColor() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export function bold(text: string): string { return colorize(text, '1'); }
export function green(text: string): string { return colorize(text, '32'); }
export function cyan(text: string): string { return colorize(text, '36'); }
export function yellow(text: string): string { return colorize(text, '33'); }
export function red(text: string): string { return colorize(text, '31'); }
export function dim(text: string): string { return colorize(text, '2'); }

export function padRight(text: string, width: number): string {
    return String(text).padEnd(width, ' ');
}

export function printHighlightedPair(label: string, value: string, options?: HighlightedPairOptions): void {
    const labelColor = (options && options.labelColor) || yellow;
    const valueColor = (options && options.valueColor) || green;
    const indent = (options && options.indent) || '';
    console.log(`${indent}${labelColor(label)} ${valueColor(value)}`);
}

// ---------------------------------------------------------------------------
// TTY / interactive detection
// ---------------------------------------------------------------------------

export function supportsInteractivePrompts(): boolean {
    return Boolean(process.stdin && process.stdout && process.stdin.isTTY && process.stdout.isTTY);
}

export function readLineInput(promptText: string): Promise<string> {
    return new Promise<string>(function (resolve: (value: string) => void): void {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(promptText, function (value: string): void {
            rl.close();
            resolve(String(value || '').trim());
        });
    });
}

export async function promptTextInput(title: string, defaultValue: string): Promise<string> {
    const answer = await readLineInput(`${yellow(`${title} [default: ${defaultValue}]:`)} `);
    const resolvedValue = answer || defaultValue;
    console.log(green(`Selected: ${resolvedValue}`));
    return resolvedValue;
}

export async function promptSingleSelect(config: PromptSingleSelectConfig): Promise<string> {
    const { title, defaultLabel, options, defaultValue } = config;
    if (!supportsInteractivePrompts()) {
        throw new Error('Interactive setup requires a TTY terminal.');
    }
    const defaultIndex = Math.max(0, options.findIndex(function (option: PromptSingleSelectOption): boolean { return option.value === defaultValue; }));
    console.log(yellow(title));
    console.log(`Default: ${defaultLabel}.`);
    options.forEach(function (option: PromptSingleSelectOption, index: number): void {
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

export function parseOptions(
    argv: string[],
    definitions: OptionDefinitions,
    config?: { allowPositionals?: boolean; maxPositionals?: number }
): { options: Record<string, ParsedOptionValue>; positionals: string[] } {
    const allowPositionals = (config && config.allowPositionals) || false;
    const maxPositionals = (config && config.maxPositionals) || 0;
    const options: Record<string, ParsedOptionValue> = {};
    const positionals: string[] = [];

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
            options[definition.key] = inlineValue === undefined ? true : parseBooleanText(inlineValue, optionName);
            continue;
        }

        let resolvedValue = inlineValue;
        if (resolvedValue === undefined) {
            if (index + 1 >= argv.length) throw new Error(`${optionName} requires a value.`);
            resolvedValue = argv[index + 1];
            index += 1;
        }
        if (definition.type === 'string[]') {
            const existingValue = options[definition.key];
            const values = Array.isArray(existingValue) ? existingValue : [];
            values.push(resolvedValue);
            options[definition.key] = values;
        } else {
            options[definition.key] = resolvedValue;
        }
    }

    return { options, positionals };
}

// ---------------------------------------------------------------------------
// Value normalization helpers
// ---------------------------------------------------------------------------

export function normalizeLogicalKey(value: unknown): string {
    return String(value || '').toLowerCase().replace(/[_\-\s]/g, '');
}

export function getInitAnswerValue(answers: Record<string, unknown>, logicalName: string): unknown {
    const targetKey = normalizeLogicalKey(logicalName);
    for (const [key, value] of Object.entries(answers)) {
        if (normalizeLogicalKey(key) === targetKey) return value;
    }
    return null;
}

export function parseBooleanText(value: unknown, label: string): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
        if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
    }
    throw new Error(`${label} must be one of: true, false, yes, no, 1, 0.`);
}

export function tryParseBooleanText(value: unknown, fallback: boolean): boolean {
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : parseBooleanText(value, 'boolean');
    } catch (_e) { return fallback; }
}

export function parseOptionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
        const items = value.map(function (item: unknown): string { return String(item || '').trim(); }).filter(Boolean);
        return items.length > 0 ? items.join(', ') : null;
    }
    const text = String(value).trim();
    return text || null;
}

export function parseRequiredText(value: unknown, label: string): string {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} must not be empty.`);
    return text;
}

export function normalizeSourceOfTruth(value: unknown): string {
    const text = parseRequiredText(value, 'SourceOfTruth');
    const match = SOURCE_OF_TRUTH_VALUES.find(function (c) { return c.toLowerCase() === text.toLowerCase(); });
    if (!match) throw new Error(`SourceOfTruth must be one of: ${SOURCE_OF_TRUTH_VALUES.join(', ')}.`);
    return match;
}

export function tryNormalizeSourceOfTruth(value: unknown, fallback?: string): string {
    if (fallback === undefined) fallback = 'Claude';
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeSourceOfTruth(value);
    } catch (_e) { return fallback; }
}

export function normalizeAssistantBrevity(value: unknown): string {
    const text = parseRequiredText(value, 'AssistantBrevity').toLowerCase();
    if (!BREVITY_VALUES.includes(text)) {
        throw new Error(`AssistantBrevity must be one of: ${BREVITY_VALUES.join(', ')}.`);
    }
    return text;
}

export function tryNormalizeAssistantBrevity(value: unknown, fallback?: string): string {
    if (fallback === undefined) fallback = 'concise';
    try {
        return value === undefined || value === null || String(value).trim() === ''
            ? fallback
            : normalizeAssistantBrevity(value);
    } catch (_e) { return fallback; }
}

export function convertSourceOfTruthToEntrypoint(sourceOfTruth: string): string | null {
    try {
        return getCanonicalEntrypointFile(sourceOfTruth);
    } catch (_error) {
        return null;
    }
}

export function normalizeAgentEntrypointToken(value: unknown): string | null {
    try {
        return normalizeCommonAgentEntrypointToken(String(value || ''));
    } catch (_error) {
        return null;
    }
}

export function normalizeActiveAgentFiles(value: unknown, sourceOfTruth: string): string | null {
    const canonicalEntrypoint = convertSourceOfTruthToEntrypoint(sourceOfTruth);
    const tokens = parseOptionalText(value)
        ? String(value).split(/[;,]+/).map(normalizeAgentEntrypointToken).filter(function (token): token is string { return token !== null; })
        : [];
    const unique = new Set(tokens);
    if (canonicalEntrypoint) unique.add(canonicalEntrypoint);
    const ordered = ALL_AGENT_ENTRYPOINT_FILES.filter(function (entry) { return unique.has(entry); });
    return ordered.length > 0 ? ordered.join(', ') : null;
}

export function normalizeCollectedVia(value: unknown): string {
    const text = parseOptionalText(value);
    return text || 'AGENT_INIT_PROMPT.md';
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function normalizePathValue(value: unknown): string {
    return path.resolve(String(value || '.'));
}

export function toPosixPath(value: string): string {
    return value.replace(/\\/g, '/');
}

export function ensureDirectoryExists(directoryPath: string, label: string): void {
    if (!fs.existsSync(directoryPath)) throw new Error(`${label} not found: ${directoryPath}`);
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
}

export function resolvePathInsideRoot(
    rootPath: string,
    pathValue: string,
    label: string,
    options?: { requireFile?: boolean; allowMissing?: boolean }
): string {
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

export function getBundlePath(targetRoot: string): string {
    return path.join(targetRoot, DEFAULT_BUNDLE_NAME);
}

export function getAgentInitPromptPath(bundlePath: string): string {
    return path.join(bundlePath, 'AGENT_INIT_PROMPT.md');
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function readOptionalJsonFile(filePath: string) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) return null;
        return JSON.parse(raw);
    } catch (_e) { return null; }
}

export function readPackageJson(packageRoot: string): PackageJsonLike {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as PackageJsonLike;
}

export function readBundleVersion(sourceRoot: string): string {
    const versionPath = path.join(sourceRoot, 'VERSION');
    if (fs.existsSync(versionPath)) return fs.readFileSync(versionPath, 'utf8').trim();
    return readPackageJson(sourceRoot).version;
}

function readVersionFileIfPresent(versionPath: string): string | null {
    if (!fs.existsSync(versionPath)) return null;
    const stats = fs.statSync(versionPath);
    if (!stats.isFile()) return null;
    const value = fs.readFileSync(versionPath, 'utf8').trim();
    return value || null;
}

export function resolveWorkspaceDisplayVersion(targetRoot: string, fallbackVersion?: string): string | null {
    const normalizedRoot = normalizePathValue(targetRoot);
    const bundleVersion = readVersionFileIfPresent(path.join(normalizedRoot, DEFAULT_BUNDLE_NAME, 'VERSION'));
    if (bundleVersion) return bundleVersion;
    const rootVersion = readVersionFileIfPresent(path.join(normalizedRoot, 'VERSION'));
    if (rootVersion) return rootVersion;
    return fallbackVersion || null;
}

// ---------------------------------------------------------------------------
// File copy / bundle deployment
// ---------------------------------------------------------------------------

export function shouldSkipPath(sourcePath: string): boolean {
    const entryName = path.basename(sourcePath);
    if (SKIPPED_ENTRY_NAMES.has(entryName)) return true;
    return SKIPPED_FILE_SUFFIXES.some(function (suffix) { return entryName.endsWith(suffix); });
}

function getCopyBoundaryRoot(sourcePath: string, stats: fs.Stats, bundleRoot: string | undefined): string {
    if (bundleRoot) {
        return path.resolve(bundleRoot);
    }
    return path.resolve(stats.isDirectory() ? sourcePath : path.dirname(sourcePath));
}

function readSafeSymlinkTarget(sourcePath: string, boundaryRoot: string): string {
    const linkTarget = fs.readlinkSync(sourcePath);
    const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
    if (!isPathInsideRoot(boundaryRoot, resolvedTarget)) {
        throw new Error(`Refusing to copy symlink outside bundle root: ${sourcePath}`);
    }
    return linkTarget;
}

export function copyPath(sourcePath: string, destinationPath: string, bundleRoot?: string): void {
    if (shouldSkipPath(sourcePath)) return;
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
    try { fs.chmodSync(destinationPath, stats.mode); } catch (_e) { /* Windows may ignore */ }
}

export function removePathIfExists(targetPath: string): void {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

export function ensureSourceItemExists(sourceRoot: string, relativePath: string): string {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) throw new Error(`Bundle source asset is missing: ${relativePath}`);
    return sourcePath;
}

export function deployFreshBundle(sourceRoot: string, destinationPath: string): void {
    if (fs.existsSync(destinationPath)) {
        const stats = fs.lstatSync(destinationPath);
        if (!stats.isDirectory()) throw new Error(`Destination exists and is not a directory: ${destinationPath}`);
        const entries = fs.readdirSync(destinationPath);
        if (entries.length > 0) throw new Error(`Destination already exists and is not empty: ${destinationPath}`);
    }
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const relativePath of DEPLOY_ITEMS) {
        const sourcePath = ensureSourceItemExists(sourceRoot, relativePath);
        copyPath(sourcePath, path.join(destinationPath, relativePath), sourceRoot);
    }
    copyCompiledRuntimeArtifacts(sourceRoot, destinationPath, { replaceExisting: false });
}

export function syncBundleItems(sourceRoot: string, destinationPath: string): void {
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
    copyCompiledRuntimeArtifacts(sourceRoot, destinationPath, { replaceExisting: true });
}

function hasCompiledRuntimeRoot(sourceRoot: string, relativePath: string): boolean {
    return fs.existsSync(path.join(sourceRoot, relativePath, 'src', 'index.js'));
}

function isRecoverableRuntimeCopyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'MODULE_NOT_FOUND';
}

function copyCompiledRuntimeArtifacts(
    sourceRoot: string,
    destinationPath: string,
    options: { replaceExisting: boolean }
): void {
    const availableCandidates = COMPILED_RUNTIME_DEPLOY_CANDIDATES.filter(function (relativePath: string): boolean {
        return hasCompiledRuntimeRoot(sourceRoot, relativePath);
    });

    if (availableCandidates.length === 0) {
        throw new Error(
            'Octopus runtime build output not found.\n' +
            'Run "npm run build" to compile TypeScript sources before bootstrap or install.'
        );
    }

    let lastError: unknown = null;

    for (let index = 0; index < availableCandidates.length; index += 1) {
        const relativePath = availableCandidates[index];
        const sourcePath = path.join(sourceRoot, relativePath);
        const targetPath = path.join(destinationPath, relativePath);

        try {
            if (options.replaceExisting) {
                removePathIfExists(targetPath);
            }
            copyPath(sourcePath, targetPath, sourceRoot);
            return;
        } catch (error: unknown) {
            lastError = error;
            removePathIfExists(targetPath);
            const hasFallback = index < availableCandidates.length - 1;
            if (!hasFallback || !isRecoverableRuntimeCopyError(error)) {
                throw error;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to copy compiled runtime artifacts.');
}

// ---------------------------------------------------------------------------
// Source acquisition
// ---------------------------------------------------------------------------

function createMissingExecutableError(executableName: string): Error {
    return new Error(
        `'${executableName}' is not available on this system. ` +
        `Please install ${executableName} and ensure it is on your PATH.`
    );
}

export function runProcess(
    executableName: string,
    args: string[],
    options?: { cwd?: string; description?: string; interactive?: boolean }
): Promise<void> {
    const cwd = (options && options.cwd) || process.cwd();
    const description = (options && options.description) || executableName;
    const interactive = (options && options.interactive) || false;
    return new Promise<void>(function (resolve: () => void, reject: (reason?: unknown) => void): void {
        let settled = false;
        const child = childProcess.spawn(executableName, args, {
            cwd,
            windowsHide: true,
            stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe']
        });
        function rejectOnce(error: Error): void { if (!settled) { settled = true; reject(error); } }
        function resolveOnce(): void { if (!settled) { settled = true; resolve(); } }
        child.once('error', function (error: Error): void {
            const errno = error as NodeJS.ErrnoException;
            if (errno.code === 'ENOENT') { rejectOnce(createMissingExecutableError(executableName)); return; }
            rejectOnce(error);
        });
        if (!interactive) {
            if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', function (chunk: string): void { process.stdout.write(chunk); }); }
            if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', function (chunk: string): void { process.stderr.write(chunk); }); }
        }
        child.once('close', function (code: number | null): void {
            if (code !== 0) { rejectOnce(new Error(`${description} failed with exit code ${code}.`)); return; }
            resolveOnce();
        });
    });
}

export async function acquireSourceRoot(
    repoUrl: string | undefined,
    branch: string | undefined,
    packageRoot: string
): Promise<{ sourceRoot: string; bundleVersion: string; cleanup: () => void }> {
    if (!repoUrl && !branch) {
        return {
            sourceRoot: packageRoot,
            bundleVersion: readBundleVersion(packageRoot),
            cleanup: function () {}
        };
    }
    const effectiveRepoUrl = String(repoUrl || DEFAULT_REPO_URL).trim();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-source-'));
    const disposeSignalCleanup = registerTempRoot(tempRoot);
    try {
        const cloneArgs = ['clone', '--quiet', '--depth', '1'];
        if (branch) { cloneArgs.push('--branch', String(branch).trim(), '--single-branch'); }
        cloneArgs.push(effectiveRepoUrl, tempRoot);
        await runProcess('git', cloneArgs, { cwd: process.cwd(), description: `git clone from ${effectiveRepoUrl}` });
        return {
            sourceRoot: tempRoot,
            bundleVersion: readBundleVersion(tempRoot),
            cleanup: function () { disposeSignalCleanup(); fs.rmSync(tempRoot, { recursive: true, force: true }); }
        };
    } catch (error) {
        disposeSignalCleanup();
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Banner / status display
// ---------------------------------------------------------------------------

export function printBanner(
    packageJson: PackageJsonLike,
    title: string,
    subtitle: string,
    options?: { versionOverride?: string | null }
): void {
    const width = 62;
    const top = `+${'-'.repeat(width - 2)}+`;
    const titleText = ` OCTOPUS AGENT ORCHESTRATOR `;
    const effectiveVersion = options && options.versionOverride !== undefined
        ? options.versionOverride
        : packageJson.version;
    const versionText = effectiveVersion ? `v${effectiveVersion}` : '';
    const titleLine = versionText
        ? `|${padRight(titleText, width - versionText.length - 3)} ${versionText}|`
        : `|${padRight(titleText, width - 2)}|`;
    console.log(cyan(top));
    console.log(cyan(titleLine));
    console.log(cyan(top));
    if (title) console.log(bold(title));
    if (subtitle) console.log(dim(subtitle));
}

export function buildBannerText(
    packageJson: PackageJsonLike,
    title: string,
    subtitle: string,
    options?: { versionOverride?: string | null }
): string {
    const width = 62;
    const top = `+${'-'.repeat(width - 2)}+`;
    const titleText = ` OCTOPUS AGENT ORCHESTRATOR `;
    const effectiveVersion = options && options.versionOverride !== undefined
        ? options.versionOverride
        : packageJson.version;
    const versionText = effectiveVersion ? `v${effectiveVersion}` : '';
    const titleLine = versionText
        ? `|${padRight(titleText, width - versionText.length - 3)} ${versionText}|`
        : `|${padRight(titleText, width - 2)}|`;
    const lines = [top, titleLine, top];
    if (title) lines.push(title);
    if (subtitle) lines.push(subtitle);
    return lines.join('\n');
}

export function getStageBadge(completed: boolean, options?: { warning?: boolean }): string {
    const warning = (options && options.warning) || false;
    const label = completed ? '[x]' : '[ ]';
    if (completed) return green(label);
    if (warning) return yellow(label);
    return dim(label);
}

export function getWorkspaceHeadline(snapshot: StatusSnapshot): string {
    if (snapshot.readyForTasks) return green('Workspace ready');
    if (snapshot.primaryInitializationComplete) return yellow('Agent setup required');
    if (snapshot.bundlePresent) return yellow('Primary setup required');
    return red('Not installed');
}

export function printStatus(snapshot: StatusSnapshot, options?: { heading?: string }): void {
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

    // T-034: source-vs-bundle parity in status output
    if (snapshot.parityResult.isSourceCheckout) {
        console.log(`  ${getStageBadge(!snapshot.parityResult.isStale, { warning: snapshot.parityResult.isStale })} Source parity (Self-hosted)`);
        if (snapshot.parityResult.isStale) {
            for (const violation of snapshot.parityResult.violations) {
                console.log(`    Violation: ${violation}`);
            }
        }
    }

    console.log(`  ${getStageBadge(snapshot.readyForTasks, { warning: snapshot.agentInitializationComplete && !snapshot.readyForTasks })} Ready for task execution`);
    if (snapshot.agentInitializationPendingReason === 'AGENT_HANDOFF_REQUIRED') {
        printHighlightedPair('NextStage:', 'Launch your agent with AGENT_INIT_PROMPT.md');
    } else if (snapshot.agentInitializationPendingReason === 'LANGUAGE_CONFIRMATION_PENDING') {
        console.log('  Pending checkpoint: Confirm assistant language during AGENT_INIT_PROMPT flow');
    } else if (snapshot.agentInitializationPendingReason === 'ACTIVE_AGENT_FILES_PENDING') {
        console.log('  Pending checkpoint: Confirm active agent files during AGENT_INIT_PROMPT flow');
    } else if (snapshot.agentInitializationPendingReason === 'AGENT_STATE_STALE') {
        console.log('  Pending checkpoint: Agent-init state no longer matches current init answers');
    } else if (snapshot.agentInitializationPendingReason === 'PROJECT_RULES_PENDING') {
        console.log('  Pending checkpoint: Update project-specific live rules before finalizing agent init');
    } else if (snapshot.agentInitializationPendingReason === 'SKILLS_PROMPT_PENDING') {
        console.log('  Pending checkpoint: Ask the built-in specialist skills question before finalizing agent init');
    } else if (snapshot.agentInitializationPendingReason === 'VALIDATION_PENDING') {
        console.log('  Pending checkpoint: Final agent-init validation has not passed yet');
    } else if (snapshot.agentInitializationPendingReason === 'AGENT_STATE_INVALID') {
        console.log('  Pending checkpoint: Repair invalid agent-init state file');
    } else if (snapshot.agentInitializationPendingReason === 'PROJECT_COMMANDS_PENDING') {
        console.log(`  Missing project commands: ${snapshot.missingProjectCommands.length}`);
    }
    if (snapshot.initAnswersError) console.log(`InitAnswersStatus: INVALID (${snapshot.initAnswersError})`);
    if (snapshot.liveVersionError) console.log(`LiveVersionStatus: INVALID (${snapshot.liveVersionError})`);
    if (snapshot.agentInitStateError) console.log(`AgentInitStateStatus: INVALID (${snapshot.agentInitStateError})`);
    if (snapshot.agentInitializationPendingReason === 'PROJECT_COMMANDS_PENDING') {
        console.log(`CommandsRule: ${snapshot.commandsRulePath}`);
        printHighlightedPair('CommandsStatus:', 'PENDING_AGENT_CONTEXT');
    }
    printHighlightedPair('RecommendedNextCommand:', snapshot.recommendedNextCommand);
    console.log('');
    printCommandSummary();
}

export function printCommandSummary(): void {
    console.log(bold('Available Commands'));
    for (const [name, description] of COMMAND_SUMMARY) {
        console.log(`  ${padRight(name, 10)} ${description}`);
    }
}

export function printHelp(packageJson: PackageJsonLike): void {
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
            '  agent-init    Finalize mandatory agent onboarding after AGENT_INIT_PROMPT work is complete.',
            '  status        Show current project status without changing files.',
            '  doctor        Run verify + manifest validation using existing init answers.',
            '  bootstrap     Deploy the bundle only.',
            '  install       Deploy or refresh the bundle and run the Node install pipeline.',
            '  init          Re-materialize live/ from an existing deployed bundle.',
            '  reinit        Re-ask or override init answers for an existing deployed bundle.',
            '  update        Check for updates and optionally apply them (npm by default).',
            '  update git    Apply update from a git repo or local git clone.',
            '  rollback      Rollback to a specific version or restore from the latest rollback snapshot.',
            '  uninstall     Remove the deployed orchestrator bundle and managed files.',
            '  cleanup       Remove stale runtime artifacts using a configurable retention policy.',
            '  verify        Validate deployment consistency and rule contracts.',
            '  check-update  Compare current deployment with a newer npm package or local source.',
            '  skills        List, suggest, add, remove, and validate optional built-in skill packs.',
            '  gate          Run an agent gate or helper command.'
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
            'Update source override options:',
            '      --package-spec SPEC          npm package spec, version tag, or local .tgz for check-update/update.',
            '      --source-path PATH           Local unpacked bundle root for check-update/update testing.',
            '      --repo-url URL               Git source override for `octopus update git`.',
            '      --branch NAME                Git branch override for `octopus update git`.',
            '      --check-only                 Compare a git source without applying the update.',
            '      --snapshot-path PATH         Explicit rollback snapshot path for `octopus rollback`.',
            '      --to-version VERSION         Rollback to a specific orchestrator version (acquires source, syncs bundle, re-materializes).'
        ],
        [
            'Notes:',
            `  - The default deployed bundle path is ${DEFAULT_BUNDLE_NAME}.`,
            '  - Running octopus with no arguments is safe: it prints status and help instead of bootstrapping.',
            '  - setup collects the 6 mandatory init answers, writes init-answers.json, and leaves final agent onboarding to AGENT_INIT_PROMPT.md.',
            '  - agent-init is the hard code-level gate that records active agent files, project-rule completion, skills prompt completion, and final verify/manifest PASS.',
            '  - skills manages optional built-in packs (installable bundles) and skill recommendations (concrete live/skills directories) from Octopus-agent-orchestrator/live/config/skills-index.json.',
            '  - update/check-update use the deployed package name from package.json with the npm latest tag by default.',
            '  - use `octopus update git` when you explicitly want git-based source acquisition.',
            '  - update/check-update run the full update lifecycle after bundle sync when an update is applied.',
            '  - rollback without --to-version restores the latest saved pre-update snapshot; with --to-version it acquires that version, syncs the bundle, and re-materializes the workspace.',
            '  - older snapshots created before rollback metadata persistence cannot be restored automatically.',
            '  - cleanup uses retention defaults (30 days, 20 backups, 50 task events, 100 review sets, 10 update reports, 5 rollbacks, 5 bundle backups); override with --max-age-days and --max-backups.'
        ]
    ];
    console.log(sections.map(function (s) { return s.join('\n'); }).join('\n\n'));
}

export function buildHelpText(packageJson: PackageJsonLike): string {
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
            '  agent-init    Finalize mandatory agent onboarding after AGENT_INIT_PROMPT work is complete.',
            '  status        Show current project status without changing files.',
            '  doctor        Run verify + manifest validation using existing init answers.',
            '  bootstrap     Deploy the bundle only.',
            '  install       Deploy or refresh the bundle and run the Node install pipeline.',
            '  init          Re-materialize live/ from an existing deployed bundle.',
            '  reinit        Re-ask or override init answers for an existing deployed bundle.',
            '  update        Check for updates and optionally apply them (npm by default).',
            '  update git    Apply update from a git repo or local git clone.',
            '  rollback      Rollback to a specific version or restore from the latest rollback snapshot.',
            '  uninstall     Remove the deployed orchestrator bundle and managed files.',
            '  cleanup       Remove stale runtime artifacts using a configurable retention policy.',
            '  verify        Validate deployment consistency and rule contracts.',
            '  check-update  Compare current deployment with a newer npm package or local source.',
            '  skills        List, suggest, add, remove, and validate optional built-in skill packs.',
            '  gate          Run an agent gate or helper command.'
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
            'Update source override options:',
            '      --package-spec SPEC          npm package spec, version tag, or local .tgz for check-update/update.',
            '      --source-path PATH           Local unpacked bundle root for check-update/update testing.',
            '      --repo-url URL               Git source override for `octopus update git`.',
            '      --branch NAME                Git branch override for `octopus update git`.',
            '      --check-only                 Compare a git source without applying the update.',
            '      --snapshot-path PATH         Explicit rollback snapshot path for `octopus rollback`.',
            '      --to-version VERSION         Rollback to a specific orchestrator version (acquires source, syncs bundle, re-materializes).'
        ],
        [
            'Notes:',
            `  - The default deployed bundle path is ${DEFAULT_BUNDLE_NAME}.`,
            '  - Running octopus with no arguments is safe: it prints status and help instead of bootstrapping.',
            '  - setup collects the 6 mandatory init answers, writes init-answers.json, and leaves final agent onboarding to AGENT_INIT_PROMPT.md.',
            '  - agent-init is the hard code-level gate that records active agent files, project-rule completion, skills prompt completion, and final verify/manifest PASS.',
            '  - skills manages optional built-in packs (installable bundles) and skill recommendations (concrete live/skills directories) from Octopus-agent-orchestrator/live/config/skills-index.json.',
            '  - update/check-update use the deployed package name from package.json with the npm latest tag by default.',
            '  - use `octopus update git` when you explicitly want git-based source acquisition.',
            '  - update/check-update run the full update lifecycle after bundle sync when an update is applied.',
            '  - rollback without --to-version restores the latest saved pre-update snapshot; with --to-version it acquires that version, syncs the bundle, and re-materializes the workspace.',
            '  - older snapshots created before rollback metadata persistence cannot be restored automatically.',
            '  - cleanup uses retention defaults (30 days, 20 backups, 50 task events, 100 review sets, 10 update reports, 5 rollbacks, 5 bundle backups); override with --max-age-days and --max-backups.'
        ]
    ];
    return sections.map(function (s) { return s.join('\n'); }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Init-answers reading for status-like flows
// ---------------------------------------------------------------------------

export function readInitAnswersArtifact(targetRoot: string, initAnswersPath: string, bundlePath: string, commandName: string) {
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
    let answers: Record<string, unknown>;
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
