const { normalizeLineEndings } = require('../core/line-endings.ts');
const {
    NODE_BUNDLE_CLI_COMMAND,
    NODE_GATE_COMMAND_PREFIX,
    NODE_HUMAN_COMMIT_COMMAND
} = require('./command-constants.ts');

const MANAGED_START = '<!-- Octopus-agent-orchestrator:managed-start -->';
const MANAGED_END = '<!-- Octopus-agent-orchestrator:managed-end -->';
const COMMIT_GUARD_START = '# Octopus-agent-orchestrator:commit-guard-start';
const COMMIT_GUARD_END = '# Octopus-agent-orchestrator:commit-guard-end';
const COMMIT_GUARD_ENV_NAME = 'OCTOPUS_ALLOW_COMMIT';
const COMMIT_GUARD_EXTRA_MARKERS_ENV = 'OCTOPUS_AGENT_ENV_MARKERS';
const COMMIT_GUARD_AGENT_MARKERS = Object.freeze([
    'CODEX_THREAD_ID',
    'CLAUDE_CODE_SSE_PORT',
    'AIDER_SESSION_ID',
    'CURSOR_TRACE_ID',
    'CURSOR_AGENT'
]);

const INSTALL_BACKUP_CANDIDATE_PATHS = Object.freeze([
    'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'TASK.md',
    '.antigravity/rules.md', '.github/copilot-instructions.md',
    '.junie/guidelines.md', '.windsurf/rules/rules.md',
    '.qwen/settings.json', '.claude/settings.local.json',
    '.git/hooks/pre-commit', '.gitignore',
    '.github/agents/orchestrator.md', '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md', '.antigravity/agents/orchestrator.md',
    '.github/agents/reviewer.md', '.github/agents/code-review.md',
    '.github/agents/db-review.md', '.github/agents/security-review.md',
    '.github/agents/refactor-review.md', '.github/agents/api-review.md',
    '.github/agents/test-review.md', '.github/agents/performance-review.md',
    '.github/agents/infra-review.md', '.github/agents/dependency-review.md'
]);

const CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES = Object.freeze([
    `Bash(${NODE_BUNDLE_CLI_COMMAND} *:*)`,
    `Bash(cd * && ${NODE_BUNDLE_CLI_COMMAND} *:*)`,
    'Bash(npx octopus-agent-orchestrator *:*)',
    'Bash(cd * && npx octopus-agent-orchestrator *:*)',
    'Bash(cd * && git diff *:*)',
    'Bash(cd * && git log *:*)',
    'Bash(grep -n * | head * && echo * && grep -n * | head *:*)',
    'Bash(cd * && grep -n * | head * && echo * && grep -n * | head *:*)'
]);

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts managed block (between start/end markers) from text content.
 */
function extractManagedBlockFromContent(content, startMarker, endMarker) {
    if (!content || !content.trim()) return null;
    const pattern = new RegExp(
        `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'm'
    );
    const match = content.match(pattern);
    return match ? match[0] : null;
}

/**
 * Parses the Active Queue table range from a managed block in TASK.md.
 */
function getTaskQueueTableRange(managedBlock) {
    if (!managedBlock || !managedBlock.trim()) return null;
    const normalized = normalizeLineEndings(managedBlock, '\n');
    const lines = normalized.split('\n');

    let activeQueueIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '## Active Queue') {
            activeQueueIndex = i;
            break;
        }
    }
    if (activeQueueIndex < 0) return null;

    let headerIndex = -1;
    for (let i = activeQueueIndex + 1; i < lines.length; i++) {
        if (lines[i].trim().startsWith('|')) {
            headerIndex = i;
            break;
        }
    }
    if (headerIndex < 0) return null;

    let separatorIndex = -1;
    if (headerIndex + 1 < lines.length && lines[headerIndex + 1].trim().startsWith('|')) {
        separatorIndex = headerIndex + 1;
    }
    if (separatorIndex < 0) return null;

    const rowsStartIndex = separatorIndex + 1;
    let rowsEndIndex = rowsStartIndex;
    while (rowsEndIndex < lines.length && lines[rowsEndIndex].trim().startsWith('|')) {
        rowsEndIndex++;
    }

    return { lines, rowsStartIndex, rowsEndIndex };
}

/**
 * Extracts task queue rows from a managed block.
 */
function getTaskQueueRowsFromManagedBlock(managedBlock) {
    const range = getTaskQueueTableRange(managedBlock);
    if (!range) return [];
    const rows = [];
    for (let i = range.rowsStartIndex; i < range.rowsEndIndex; i++) {
        if (range.lines[i] && range.lines[i].trim()) {
            rows.push(range.lines[i]);
        }
    }
    return rows;
}

/**
 * Replaces task queue rows in a managed block.
 */
function setTaskQueueRowsInManagedBlock(managedBlock, rows) {
    const range = getTaskQueueTableRange(managedBlock);
    if (!range) return managedBlock;

    const prefix = range.rowsStartIndex > 0 ? range.lines.slice(0, range.rowsStartIndex) : [];
    const suffix = range.rowsEndIndex < range.lines.length ? range.lines.slice(range.rowsEndIndex) : [];
    return [...prefix, ...rows, ...suffix].join('\n');
}

/**
 * Builds a TASK.md managed block preserving existing queue rows.
 */
function buildTaskManagedBlockWithExistingQueue(templateContent, existingContent) {
    const templateBlock = extractManagedBlockFromContent(templateContent, MANAGED_START, MANAGED_END);
    if (!templateBlock) return null;

    const existingBlock = extractManagedBlockFromContent(existingContent, MANAGED_START, MANAGED_END);
    if (!existingBlock) return templateBlock;

    const existingRows = getTaskQueueRowsFromManagedBlock(existingBlock);
    if (existingRows.length === 0) return templateBlock;

    return setTaskQueueRowsInManagedBlock(templateBlock, existingRows);
}

/**
 * Builds the canonical entrypoint managed block (for the source-of-truth file).
 */
function buildCanonicalManagedBlock(canonicalFile, templateClaudeContent) {
    const baseBlock = extractManagedBlockFromContent(templateClaudeContent, MANAGED_START, MANAGED_END);
    if (!baseBlock) {
        throw new Error('Template CLAUDE.md managed block is missing; cannot build canonical entrypoint.');
    }
    return baseBlock.replace(/^# CLAUDE\.md$/m, `# ${canonicalFile}`);
}

/**
 * Builds a redirect managed block for non-canonical entrypoints.
 */
function buildRedirectManagedBlock(targetFile, canonicalFile, providerBridgePaths) {
    const providerLines = [];
    for (const bridgePath of (providerBridgePaths || [])) {
        const normalized = bridgePath.replace(/\\/g, '/');
        switch (normalized) {
            case '.github/agents/orchestrator.md':
                providerLines.push('For GitHub Copilot Agents, run task execution through `.github/agents/orchestrator.md`.');
                break;
            case '.windsurf/agents/orchestrator.md':
                providerLines.push('For Windsurf Agents, run task execution through `.windsurf/agents/orchestrator.md`.');
                break;
            case '.junie/agents/orchestrator.md':
                providerLines.push('For Junie Agents, run task execution through `.junie/agents/orchestrator.md`.');
                break;
            case '.antigravity/agents/orchestrator.md':
                providerLines.push('For Antigravity Agents, run task execution through `.antigravity/agents/orchestrator.md`.');
                break;
        }
    }
    const uniqueProviderLines = [...new Set(providerLines)].sort();
    const providerBridgeSection = uniqueProviderLines.length > 0
        ? uniqueProviderLines.join('\r\n')
        : 'No provider-specific bridge files are enabled for this workspace.';

    return [
        MANAGED_START,
        `# ${targetFile}`,
        '',
        'This file is a redirect.',
        `Canonical source of truth for agent workflow rules: \`${canonicalFile}\`.`,
        '',
        `Hard stop: read \`${canonicalFile}\` first and follow its routing links before responding to anything.`,
        `Hard stop: before any task execution, open \`TASK.md\` and \`${canonicalFile}\`.`,
        'Do not implement tasks directly without orchestration preflight and required review gates.',
        'Ignored orchestration control-plane files (for example `TASK.md`, `Octopus-agent-orchestrator/runtime/**`, and `Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md`) are expected local artifacts; never `git add -f` them unless the user explicitly asks to version orchestrator internals.',
        providerBridgeSection,
        MANAGED_END
    ].join('\r\n');
}

/**
 * Builds the commit guard hook script content.
 */
function buildCommitGuardManagedBlock() {
    const agentEnvLines = COMMIT_GUARD_AGENT_MARKERS.map((m) => `  "${m}"`).join('\n');
    return `${COMMIT_GUARD_START}
# Commit blocked by Octopus auto-commit guard only for detected agent sessions.
if [ "\${${COMMIT_GUARD_ENV_NAME}:-}" = "1" ]; then
  exit 0
fi

octopus_agent_env_markers=(
${agentEnvLines}
)

if [ -n "\${${COMMIT_GUARD_EXTRA_MARKERS_ENV}:-}" ]; then
  IFS=', ' read -r -a octopus_extra_agent_markers <<< "\${${COMMIT_GUARD_EXTRA_MARKERS_ENV}}"
  for octopus_marker in "\${octopus_extra_agent_markers[@]}"; do
    if [[ "$octopus_marker" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      octopus_agent_env_markers+=("$octopus_marker")
    fi
  done
fi

octopus_detected_agent_var=""
for octopus_marker in "\${octopus_agent_env_markers[@]}"; do
  if [ -n "\${!octopus_marker:-}" ]; then
    octopus_detected_agent_var="$octopus_marker"
    break
  fi
done

if [ -n "$octopus_detected_agent_var" ]; then
  echo "Commit blocked: agent commit guard is enabled (detected env: $octopus_detected_agent_var)."
  echo "If this is a manual human commit from the same shell, use helper:"
  echo "  ${NODE_HUMAN_COMMIT_COMMAND.replace(/"/g, '\\"')}"
  exit 1
fi
${COMMIT_GUARD_END}`;
}

/**
 * Builds provider orchestrator agent markdown content.
 */
function buildProviderOrchestratorAgentContent(providerLabel, canonicalFile, bridgePath) {
    return `${MANAGED_START}
# ${providerLabel} Agent: Orchestrator

Canonical source of truth for agent workflow rules: \`${canonicalFile}\`.

Hard stop: first open \`${canonicalFile}\` and \`TASK.md\`.
Do not implement tasks directly without orchestration preflight and required review gates.
Ignored orchestration control-plane files (for example \`TASK.md\`, \`Octopus-agent-orchestrator/runtime/**\`, and \`Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md\`) are expected local artifacts; never \`git add -f\` them unless the user explicitly asks to version orchestrator internals.
This provider profile is a strict bridge to Octopus skills and the Node gate router.
Do not execute task or review workflow with provider-default reviewer agents that bypass this bridge.

## Required Execution Contract
1. Read \`${canonicalFile}\` and its routing links before making changes.
2. Read \`TASK.md\` and select/create a task row before implementation.
3. Execute task workflow only in orchestrator mode: \`Execute task <task-id> depth=<1|2|3>\`.
4. Run preflight classification before implementation via \`${NODE_GATE_COMMAND_PREFIX} classify-change ...\`.
5. Run compile gate before review via \`${NODE_GATE_COMMAND_PREFIX} compile-gate --commands-path "Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md"\`.
6. Run required independent reviews and gates via \`${NODE_GATE_COMMAND_PREFIX} required-reviews-check ...\`, then \`doc-impact-gate\`, then \`completion-gate\` before marking \`DONE\`.
7. Update task status and artifacts in \`TASK.md\`.
8. Log lifecycle events by task id via \`${NODE_GATE_COMMAND_PREFIX} log-task-event ...\` into \`Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl\`.

## Reviewer Launch Mapping (Required)
- Claude Code: launch clean-context reviewers via Agent tool (\`fork_context=false\`).
- GitHub Copilot CLI: launch clean-context reviewers via \`task\` tool with \`agent_type="general-purpose"\` (one reviewer per isolated task run).
- Platforms without task/sub-agent support: run sequential isolated reviewer passes in one thread; never use provider-default reviewer agents.

## Skill Routing
- Orchestration: \`Octopus-agent-orchestrator/live/skills/orchestration/SKILL.md\`
- Code review: \`Octopus-agent-orchestrator/live/skills/code-review/SKILL.md\`
- DB review: \`Octopus-agent-orchestrator/live/skills/db-review/SKILL.md\`
- Security review: \`Octopus-agent-orchestrator/live/skills/security-review/SKILL.md\`
- Refactor review: \`Octopus-agent-orchestrator/live/skills/refactor-review/SKILL.md\`

## Dynamic Skill Discovery (Required)
- Canonical skill list: \`Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md\`
- Optional-skill capability flags: \`Octopus-agent-orchestrator/live/config/review-capabilities.json\`
- Token-economy controls: \`Octopus-agent-orchestrator/live/config/token-economy.json\`
- Output-filter profiles: \`Octopus-agent-orchestrator/live/config/output-filters.json\`
- Include specialist skills added after initialization from \`Octopus-agent-orchestrator/live/skills/**\` when required by preflight and capability flags.

## Task Timeline Logging (Required)
- Event logger: \`${NODE_GATE_COMMAND_PREFIX} log-task-event ...\`
- Log file (per task): \`Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl\`
- Aggregate log: \`Octopus-agent-orchestrator/runtime/task-events/all-tasks.jsonl\`

Bridge path for this provider: \`${bridgePath}\`.
${MANAGED_END}`.trim();
}

/**
 * Builds GitHub skill bridge agent markdown content.
 */
function buildGitHubSkillBridgeAgentContent(profileTitle, canonicalFile, skillPath, reviewRequirement, capabilityFlag) {
    return `${MANAGED_START}
# GitHub Agent: ${profileTitle}

Canonical source of truth for agent workflow rules: \`${canonicalFile}\`.

Hard stop: first open \`.github/agents/orchestrator.md\`, \`${canonicalFile}\`, and \`TASK.md\`.
Do not implement tasks directly without orchestration preflight and required review gates.
Ignored orchestration control-plane files (for example \`TASK.md\`, \`Octopus-agent-orchestrator/runtime/**\`, and \`Octopus-agent-orchestrator/live/docs/changes/CHANGELOG.md\`) are expected local artifacts; never \`git add -f\` them unless the user explicitly asks to version orchestrator internals.

## Skill Bridge Contract
- Use this profile only as a bridge to skill: \`${skillPath}\`
- Required review selector: \`${reviewRequirement}\`
- Capability flag gate: \`${capabilityFlag}\`
- Re-read \`Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md\` before execution.
- Re-read \`Octopus-agent-orchestrator/live/config/review-capabilities.json\` before execution.
- Re-read \`Octopus-agent-orchestrator/live/config/token-economy.json\` before execution.
- Re-read \`Octopus-agent-orchestrator/live/config/output-filters.json\` before execution.
- On GitHub Copilot CLI, spawn reviewer helper tasks via \`task\` tool with \`agent_type="general-purpose"\` and isolated context.
- Honor specialist skills added after initialization under \`Octopus-agent-orchestrator/live/skills/**\`.
- Log review invocation and outcomes via \`${NODE_GATE_COMMAND_PREFIX} log-task-event ...\` into task timeline.
- Task timeline path (per task): \`Octopus-agent-orchestrator/runtime/task-events/<task-id>.jsonl\`.
- Review verdicts and completion status are recorded only through orchestrator workflow.
- Never mark task \`DONE\` from this profile; hand off to \`.github/agents/orchestrator.md\`.
${MANAGED_END}`.trim();
}

/**
 * Merges required entries into Qwen settings JSON, preserving existing structure.
 */
function buildQwenSettingsContent(existingContent, requiredEntries) {
    const entries = (requiredEntries || ['TASK.md', 'AGENTS.md']).filter((e) => e && e.trim());
    const unique = [...new Set(entries)];
    let settingsMap = {};
    let needsUpdate = false;
    let parseMode = 'default';

    if (existingContent && existingContent.trim()) {
        try {
            const parsed = JSON.parse(existingContent);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                settingsMap = parsed;
                parseMode = 'merge-existing';
            } else {
                needsUpdate = true;
                parseMode = 'invalid-root';
            }
        } catch {
            needsUpdate = true;
            parseMode = 'invalid-json';
        }
    } else {
        needsUpdate = true;
    }

    if (!settingsMap.context || typeof settingsMap.context !== 'object' || Array.isArray(settingsMap.context)) {
        settingsMap.context = {};
        needsUpdate = true;
    }

    const currentEntries = [];
    if (Array.isArray(settingsMap.context.fileName)) {
        for (const item of settingsMap.context.fileName) {
            if (item != null && String(item).trim()) {
                currentEntries.push(String(item).trim());
            }
        }
    }

    const existingSet = new Set(currentEntries.map((e) => e.toLowerCase()));
    for (const entry of unique) {
        if (!existingSet.has(entry.toLowerCase())) {
            currentEntries.push(entry);
            existingSet.add(entry.toLowerCase());
            needsUpdate = true;
        }
    }

    settingsMap.context.fileName = currentEntries;
    return {
        content: JSON.stringify(settingsMap, null, 2),
        needsUpdate,
        parseMode
    };
}

/**
 * Merges required permission entries into Claude local settings JSON.
 */
function buildClaudeLocalSettingsContent(existingContent, enableOrchestratorAccess) {
    const requiredAllowEntries = enableOrchestratorAccess ? [...CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES] : [];
    let settingsMap = {};
    let needsUpdate = false;
    let parseMode = 'default';

    if (existingContent && existingContent.trim()) {
        try {
            const parsed = JSON.parse(existingContent);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                settingsMap = parsed;
                parseMode = 'merge-existing';
            } else {
                needsUpdate = true;
                parseMode = 'invalid-root';
            }
        } catch {
            needsUpdate = true;
            parseMode = 'invalid-json';
        }
    } else {
        needsUpdate = true;
    }

    if (!settingsMap.permissions || typeof settingsMap.permissions !== 'object' || Array.isArray(settingsMap.permissions)) {
        settingsMap.permissions = {};
        needsUpdate = true;
    }

    const allowEntries = [];
    if (Array.isArray(settingsMap.permissions.allow)) {
        for (const item of settingsMap.permissions.allow) {
            if (item != null && String(item).trim()) {
                allowEntries.push(String(item).trim());
            }
        }
    }

    const existingSet = new Set(allowEntries.map((e) => e.toLowerCase()));
    for (const entry of requiredAllowEntries) {
        if (!existingSet.has(entry.toLowerCase())) {
            allowEntries.push(entry);
            existingSet.add(entry.toLowerCase());
            needsUpdate = true;
        }
    }

    settingsMap.permissions.allow = allowEntries;
    return {
        content: JSON.stringify(settingsMap, null, 2),
        needsUpdate,
        parseMode
    };
}

/**
 * Computes the set of .gitignore entries needed for a given configuration.
 */
function buildGitignoreEntries(activeEntryFiles, providerOrchestratorProfiles, enableClaudeOrchestratorFullAccess, includeQwenDirectory = false) {
    const entries = ['Octopus-agent-orchestrator/', 'TASK.md'];

    if (includeQwenDirectory) {
        entries.push('.qwen/');
    }

    for (const entryFile of activeEntryFiles) {
        const normalized = entryFile.replace(/\\/g, '/');
        if (normalized === 'AGENTS.md') entries.push('AGENTS.md');
        if (normalized === '.github/copilot-instructions.md') entries.push('.github/copilot-instructions.md');
    }

    for (const profile of providerOrchestratorProfiles) {
        for (const entry of profile.gitignoreEntries) {
            entries.push(entry);
        }
    }

    const unique = [...new Set(entries)].sort();
    if (enableClaudeOrchestratorFullAccess) {
        unique.push('.claude/');
    }

    return unique;
}

/**
 * Synchronizes a managed block into a file's content.
 * If the file already contains a managed block, replace it in place.
 * If the file has unrelated legacy content and no managed block, replace the file
 * entirely so the previous content lives only in install backups instead of being
 * merged with the new orchestrator contract.
 */
function syncManagedBlockInContent(content, managedBlock) {
    const pattern = new RegExp(
        `${escapeRegex(MANAGED_START)}[\\s\\S]*?${escapeRegex(MANAGED_END)}`, 'm'
    );

    let newContent;
    if (pattern.test(content || '')) {
        newContent = (content || '').replace(pattern, managedBlock);
    } else if (!content || !content.trim()) {
        newContent = managedBlock + '\r\n';
    } else {
        newContent = managedBlock + '\r\n';
    }

    return { content: newContent, changed: newContent !== (content || '') };
}

module.exports = {
    buildCanonicalManagedBlock,
    buildClaudeLocalSettingsContent,
    buildCommitGuardManagedBlock,
    buildGitHubSkillBridgeAgentContent,
    buildGitignoreEntries,
    buildProviderOrchestratorAgentContent,
    buildQwenSettingsContent,
    buildRedirectManagedBlock,
    buildTaskManagedBlockWithExistingQueue,
    CLAUDE_ORCHESTRATOR_ALLOW_ENTRIES,
    COMMIT_GUARD_AGENT_MARKERS,
    COMMIT_GUARD_END,
    COMMIT_GUARD_ENV_NAME,
    COMMIT_GUARD_EXTRA_MARKERS_ENV,
    COMMIT_GUARD_START,
    extractManagedBlockFromContent,
    getTaskQueueRowsFromManagedBlock,
    getTaskQueueTableRange,
    INSTALL_BACKUP_CANDIDATE_PATHS,
    MANAGED_END,
    MANAGED_START,
    setTaskQueueRowsInManagedBlock,
    syncManagedBlockInContent
};
