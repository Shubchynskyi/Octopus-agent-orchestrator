const path = require('node:path');

const {
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH
} = require('../../core/constants.ts');

const {
    acquireSourceRoot,
    deployFreshBundle,
    getAgentInitPromptPath,
    normalizePathValue,
    parseOptions,
    printBanner,
    printHelp,
    readBundleVersion,
    toPosixPath
} = require('./cli-helpers.ts');

// ---------------------------------------------------------------------------
// Flag definitions
// ---------------------------------------------------------------------------

const BOOTSTRAP_DEFINITIONS = {
    '--destination': { key: 'destination', type: 'string' },
    '--target': { key: 'destination', type: 'string' },
    '--repo-url': { key: 'repoUrl', type: 'string' },
    '--branch': { key: 'branch', type: 'string' }
};

// ---------------------------------------------------------------------------
// Output builders (testable without stdout capture)
// ---------------------------------------------------------------------------

/**
 * Build the success output text for a completed bootstrap.
 * Returns a string matching the OCTOPUS_BOOTSTRAP_OK contract.
 */
function buildBootstrapSuccessOutput(packageJson, bundleVersion, destinationPath) {
    const targetRoot = path.dirname(destinationPath);
    const bundleRelativePath = path.relative(targetRoot, destinationPath) || path.basename(destinationPath);
    const initPromptPath = path.join(destinationPath, 'AGENT_INIT_PROMPT.md');
    const installScriptPath = path.join(destinationPath, 'scripts', 'install.ps1');
    const installShellPath = path.join(destinationPath, 'scripts', 'install.sh');
    const initAnswersRelativePath = path.join(bundleRelativePath, 'runtime', 'init-answers.json');

    const lines = [];
    lines.push('OCTOPUS_BOOTSTRAP_OK');
    lines.push(`PackageVersion: ${packageJson.version}`);
    lines.push(`BundleVersion: ${bundleVersion}`);
    lines.push(`BundlePath: ${destinationPath}`);
    lines.push(`TargetRoot: ${targetRoot}`);
    lines.push(`InitPromptPath: ${initPromptPath}`);
    lines.push(`InitAnswersPath: ${initAnswersRelativePath}`);
    lines.push('NextSteps:');
    lines.push(`1. Give your agent "${initPromptPath}".`);
    lines.push(`2. Let the agent write "${path.join(targetRoot, initAnswersRelativePath)}".`);

    if (bundleRelativePath === DEFAULT_BUNDLE_NAME) {
        lines.push('3. After init answers exist, run the lifecycle CLI:');
        lines.push(`   npx ${packageJson.name} install --target-root "${targetRoot}" --init-answers-path "${initAnswersRelativePath}"`);
    } else {
        lines.push('3. Custom bundle paths should use the raw installer entrypoint:');
        lines.push(`   pwsh -File "${installScriptPath}" -TargetRoot "${targetRoot}" -AssistantLanguage "<language>" -AssistantBrevity "<concise|detailed>" -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "${initAnswersRelativePath}"`);
        lines.push(`   bash "${toPosixPath(installShellPath)}" -TargetRoot "${toPosixPath(targetRoot)}" -AssistantLanguage "<language>" -AssistantBrevity "<concise|detailed>" -SourceOfTruth "<Claude|Codex|Gemini|GitHubCopilot|Windsurf|Junie|Antigravity>" -InitAnswersPath "${toPosixPath(initAnswersRelativePath)}"`);
    }

    return lines.join('\n');
}

/**
 * Print bootstrap success to stdout.
 */
function printBootstrapSuccess(packageJson, bundleVersion, destinationPath) {
    console.log(buildBootstrapSuccessOutput(packageJson, bundleVersion, destinationPath));
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

/**
 * Handle the `bootstrap` command.
 * Deploys a fresh bundle to the destination path.
 *
 * Contract markers:
 *   - OCTOPUS_BOOTSTRAP_OK on success
 *   - Exit code 0 on success
 */
async function handleBootstrap(commandArgv, packageJson, packageRoot) {
    const { options, positionals } = parseOptions(commandArgv, BOOTSTRAP_DEFINITIONS, {
        allowPositionals: true,
        maxPositionals: 1
    });

    if (options.help) { printHelp(packageJson); return; }
    if (options.version) { console.log(packageJson.version); return; }

    const destinationPath = normalizePathValue(options.destination || positionals[0] || DEFAULT_BUNDLE_NAME);
    const source = await acquireSourceRoot(options.repoUrl, options.branch, packageRoot);
    try {
        deployFreshBundle(source.sourceRoot, destinationPath);
        printBootstrapSuccess(packageJson, source.bundleVersion, destinationPath);
    } finally {
        source.cleanup();
    }
}

module.exports = {
    BOOTSTRAP_DEFINITIONS,
    buildBootstrapSuccessOutput,
    handleBootstrap,
    printBootstrapSuccess
};
