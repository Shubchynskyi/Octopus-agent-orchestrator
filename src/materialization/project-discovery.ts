const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const { ensureDirectory, pathExists, readTextFile } = require('../core/fs.ts');
const { normalizeRelativePath } = require('../core/paths.ts');

const EXCLUDED_PATH_FRAGMENTS = Object.freeze([
    '/.git/', '/node_modules/', '/.next/', '/dist/', '/build/',
    '/target/', '/bin/', '/obj/', '/Octopus-agent-orchestrator/'
]);

const STACK_SIGNALS = Object.freeze([
    { name: 'Node.js or JavaScript', pattern: /(^|\/)package\.json$/ },
    { name: 'TypeScript', pattern: /(^|\/)tsconfig(\.[^/]+)?\.json$/ },
    { name: 'Java or JVM', pattern: /(^\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/ },
    { name: 'Python', pattern: /(^|\/)(?:pyproject\.toml|requirements(?:\.txt|-dev\.txt)?)$/ },
    { name: 'Go', pattern: /(^|\/)go\.mod$/ },
    { name: 'Rust', pattern: /(^|\/)Cargo\.toml$/ },
    { name: '.NET', pattern: /\.(sln|csproj|fsproj)$/ },
    { name: 'PHP', pattern: /(^|\/)composer\.json$/ },
    { name: 'Ruby', pattern: /(^|\/)Gemfile$/ },
    { name: 'Containerization', pattern: /(^|\/)Dockerfile(\..+)?$|(^|\/)docker-compose(\.[^/]+)?\.ya?ml$/ }
]);

const EXCLUDED_TOP_LEVEL_DIRS = new Set([
    'Octopus-agent-orchestrator', '.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj'
]);

/**
 * Scans the project for stack signals, file listings, and directory structure.
 */
function getProjectDiscovery(targetRoot) {
    let relativeFiles = [];
    let discoverySource = 'filesystem_scan';

    // Try git-based discovery first
    try {
        const gitDir = path.join(targetRoot, '.git');
        if (pathExists(gitDir)) {
            const tracked = childProcess.spawnSync('git', ['ls-files'], {
                cwd: targetRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            const untracked = childProcess.spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
                cwd: targetRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });

            if (tracked.status === 0 && untracked.status === 0) {
                const trackedFiles = (tracked.stdout || '').split('\n').filter((l) => l.trim());
                const untrackedFiles = (untracked.stdout || '').split('\n').filter((l) => l.trim());
                relativeFiles = [...new Set([...trackedFiles, ...untrackedFiles])].sort();
                discoverySource = 'git_index_and_worktree';
            }
        }
    } catch {
        // Fall through to filesystem scan
    }

    // Filesystem fallback
    if (relativeFiles.length === 0) {
        relativeFiles = collectFilesRecursive(targetRoot, targetRoot);
    }

    // Filter excluded paths
    const filteredFiles = relativeFiles
        .map((f) => normalizeRelativePath(f))
        .filter((f) => {
            if (!f) return false;
            const wrapped = `/${f}/`;
            return !EXCLUDED_PATH_FRAGMENTS.some((frag) => wrapped.includes(frag));
        });
    const uniqueFiles = [...new Set(filteredFiles)].sort();

    // Detect stacks
    const detectedStacks = [];
    const stackEvidence = [];
    for (const signal of STACK_SIGNALS) {
        const matches = uniqueFiles.filter((f) => signal.pattern.test(f)).slice(0, 8);
        if (matches.length > 0) {
            detectedStacks.push(signal.name);
            stackEvidence.push({
                name: signal.name,
                matches
            });
        }
    }

    // Get top-level directories
    let topLevelDirectories = [];
    try {
        const entries = fs.readdirSync(targetRoot, { withFileTypes: true });
        topLevelDirectories = entries
            .filter((e) => e.isDirectory() && !EXCLUDED_TOP_LEVEL_DIRS.has(e.name))
            .map((e) => e.name)
            .sort();
    } catch {
        // Ignore
    }

    // Suggest commands
    const suggestedCommands = [];
    if (detectedStacks.includes('Node.js or JavaScript')) {
        suggestedCommands.push('npm run test', 'npm run lint', 'npm run build');
    }
    if (detectedStacks.includes('Python')) {
        suggestedCommands.push('pytest', 'ruff check .');
    }
    if (detectedStacks.includes('Java or JVM')) {
        suggestedCommands.push('./mvnw test', './gradlew test');
    }
    if (detectedStacks.includes('Go')) {
        suggestedCommands.push('go test ./...');
    }
    if (detectedStacks.includes('Rust')) {
        suggestedCommands.push('cargo test');
    }
    if (detectedStacks.includes('.NET')) {
        suggestedCommands.push('dotnet test');
    }

    const rootFiles = uniqueFiles.filter((filePath) => !filePath.includes('/')).slice(0, 20);
    const runtimePathHints = collectRuntimePathHints(uniqueFiles);

    return {
        source: discoverySource,
        fileCount: uniqueFiles.length,
        detectedStacks: [...new Set(detectedStacks)].sort(),
        stackEvidence,
        topLevelDirectories: [...new Set(topLevelDirectories)].sort(),
        rootFiles,
        runtimePathHints,
        suggestedCommands: [...new Set(suggestedCommands)].sort(),
        relativeFiles: uniqueFiles,
        sampleFiles: uniqueFiles.slice(0, 40)
    };
}

function collectRuntimePathHints(relativeFiles) {
    const runtimeRootTokens = new Set(['src', 'app', 'apps', 'backend', 'frontend', 'web', 'api', 'services', 'packages']);
    const hints = [];
    const seen = new Set();

    for (const filePath of relativeFiles) {
        const segments = String(filePath || '').split('/').filter(Boolean);
        if (segments.length < 2) {
            continue;
        }

        let hint = null;
        const first = segments[0].toLowerCase();
        const second = segments[1].toLowerCase();

        if (runtimeRootTokens.has(first)) {
            hint = `${segments[0]}/`;
        } else if (runtimeRootTokens.has(second)) {
            hint = `${segments[0]}/${segments[1]}/`;
        }

        if (hint && !seen.has(hint)) {
            seen.add(hint);
            hints.push(hint);
        }

        if (hints.length >= 20) {
            break;
        }
    }

    return hints;
}

function collectFilesRecursive(rootPath, basePath) {
    const results = [];
    try {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(rootPath, entry.name);
            if (entry.isDirectory()) {
                results.push(...collectFilesRecursive(fullPath, basePath));
            } else if (entry.isFile()) {
                results.push(path.relative(basePath, fullPath).replace(/\\/g, '/'));
            }
        }
    } catch {
        // Ignore unreadable dirs
    }
    return results;
}

/**
 * Builds project discovery markdown lines.
 */
function buildProjectDiscoveryLines(discovery, timestampIso) {
    const tick = '`';
    const lines = [
        '# Project Discovery', '',
        `Generated at: ${timestampIso}`,
        `Source: ${discovery.source}`,
        `Files considered: ${discovery.fileCount}`,
        '', '## Detected Stack Signals'
    ];

    if (discovery.detectedStacks.length === 0) {
        lines.push('- No strong stack markers detected. Fill context rules manually.');
    } else {
        for (const stack of discovery.detectedStacks) {
            lines.push(`- ${stack}`);
        }
    }

    lines.push('', '## Top-Level Directories');
    if (discovery.topLevelDirectories.length === 0) {
        lines.push('- No top-level runtime directories detected.');
    } else {
        for (const dir of discovery.topLevelDirectories) {
            lines.push(`- ${tick}${dir}/${tick}`);
        }
    }

    lines.push('', '## Stack Evidence');
    if (!Array.isArray(discovery.stackEvidence) || discovery.stackEvidence.length === 0) {
        lines.push('- No stack evidence captured.');
    } else {
        for (const evidence of discovery.stackEvidence) {
            const matches = Array.isArray(evidence.matches) && evidence.matches.length > 0
                ? evidence.matches.map((item) => `${tick}${item}${tick}`).join(', ')
                : 'none';
            lines.push(`- ${evidence.name}: ${matches}`);
        }
    }

    lines.push('', '## Root Files');
    if (!Array.isArray(discovery.rootFiles) || discovery.rootFiles.length === 0) {
        lines.push('- No root files captured.');
    } else {
        for (const filePath of discovery.rootFiles) {
            lines.push(`- ${tick}${filePath}${tick}`);
        }
    }

    lines.push('', '## Runtime Path Hints');
    if (!Array.isArray(discovery.runtimePathHints) || discovery.runtimePathHints.length === 0) {
        lines.push('- No runtime path hints detected.');
    } else {
        for (const hint of discovery.runtimePathHints) {
            lines.push(`- ${tick}${hint}${tick}`);
        }
    }

    lines.push('', '## Suggested Local Commands (Heuristic)');
    if (discovery.suggestedCommands.length === 0) {
        lines.push('- No command suggestions from discovery. Populate `40-commands.md` manually.');
    } else {
        for (const cmd of discovery.suggestedCommands) {
            lines.push(`- ${tick}${cmd}${tick}`);
        }
    }

    lines.push('', '## Sample Files Used For Detection');
    if (discovery.sampleFiles.length === 0) {
        lines.push('- No sample files captured.');
    } else {
        for (const sample of discovery.sampleFiles) {
            lines.push(`- ${tick}${sample}${tick}`);
        }
    }

    return lines;
}

/**
 * Builds a brief discovery overlay section for context rules.
 */
function buildDiscoveryOverlaySection(discovery) {
    const stacksText = discovery.detectedStacks.length > 0
        ? discovery.detectedStacks.join(', ')
        : 'none detected';
    const dirsText = discovery.topLevelDirectories.length > 0
        ? discovery.topLevelDirectories.slice(0, 10).join(', ')
        : 'none detected';

    return [
        '## Project Discovery Snapshot',
        `- Discovery source: ${discovery.source}`,
        `- Files considered: ${discovery.fileCount}`,
        `- Detected stacks: ${stacksText}`,
        `- Top-level directories: ${dirsText}`,
        '- Full report: `Octopus-agent-orchestrator/live/project-discovery.md`'
    ].join('\r\n');
}

module.exports = {
    buildDiscoveryOverlaySection,
    buildProjectDiscoveryLines,
    collectRuntimePathHints,
    EXCLUDED_PATH_FRAGMENTS,
    EXCLUDED_TOP_LEVEL_DIRS,
    getProjectDiscovery,
    STACK_SIGNALS
};
