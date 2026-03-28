import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    getStatusSnapshot,
    formatStatusSnapshot,
    resolveInitAnswersPath
} from '../../../src/validators/status';

function writeStatusFixtureFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function seedInitializedWorkspace(tmpDir: string, collectedVia: string, options: Record<string, unknown> = {}) {
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const runtimePath = path.join(bundlePath, 'runtime');
    const liveRulesPath = path.join(bundlePath, 'live', 'docs', 'agent-rules');
    const activeAgentFiles = options.activeAgentFiles || 'AGENTS.md';
    writeStatusFixtureFile(path.join(runtimePath, 'init-answers.json'), JSON.stringify({
        AssistantLanguage: 'English',
        AssistantBrevity: 'concise',
        SourceOfTruth: 'Codex',
        EnforceNoAutoCommit: 'false',
        ClaudeOrchestratorFullAccess: 'false',
        TokenEconomyEnabled: 'true',
        CollectedVia: collectedVia,
        ActiveAgentFiles: activeAgentFiles
    }));
    writeStatusFixtureFile(path.join(bundlePath, 'live', 'USAGE.md'), '# Usage\n');
    writeStatusFixtureFile(path.join(tmpDir, 'TASK.md'), '# Tasks\n');
    writeStatusFixtureFile(path.join(liveRulesPath, '40-commands.md'), 'npm install\nnpm test\nnpm run lint\n');

    if (options.agentInitState) {
        writeStatusFixtureFile(
            path.join(runtimePath, 'agent-init-state.json'),
            JSON.stringify(options.agentInitState)
        );
    }
}

test('resolveInitAnswersPath resolves relative path inside root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        const resolved = resolveInitAnswersPath(tmpDir, 'runtime/init-answers.json');
        assert.ok(resolved.includes('runtime'));
        assert.ok(resolved.includes('init-answers.json'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('resolveInitAnswersPath throws for path escaping root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        assert.throws(
            () => resolveInitAnswersPath(tmpDir, '../../etc/passwd'),
            /must resolve inside TargetRoot/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot returns not-installed state for empty directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.bundlePresent, false);
        assert.equal(snapshot.initAnswersPresent, false);
        assert.equal(snapshot.taskPresent, false);
        assert.equal(snapshot.livePresent, false);
        assert.equal(snapshot.usagePresent, false);
        assert.equal(snapshot.primaryInitializationComplete, false);
        assert.equal(snapshot.agentInitializationComplete, false);
        assert.equal(snapshot.readyForTasks, false);
        assert.ok(snapshot.recommendedNextCommand.includes('setup'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot detects bundle-present state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundlePath, { recursive: true });

    try {
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.bundlePresent, true);
        assert.equal(snapshot.initAnswersPresent, false);
        assert.ok(snapshot.recommendedNextCommand.includes('setup'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot reads init answers when present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const runtimePath = path.join(bundlePath, 'runtime');
    const livePath = path.join(bundlePath, 'live');
    fs.mkdirSync(runtimePath, { recursive: true });
    fs.mkdirSync(livePath, { recursive: true });
    fs.writeFileSync(
        path.join(runtimePath, 'init-answers.json'),
        JSON.stringify({
            AssistantLanguage: 'English',
            AssistantBrevity: 'concise',
            SourceOfTruth: 'Claude',
            EnforceNoAutoCommit: 'false',
            ClaudeOrchestratorFullAccess: 'false',
            TokenEconomyEnabled: 'true',
            CollectedVia: 'CLI_INTERACTIVE'
        }),
        'utf8'
    );

    try {
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.bundlePresent, true);
        assert.equal(snapshot.initAnswersPresent, true);
        assert.equal(snapshot.initAnswersError, null);
        assert.equal(snapshot.sourceOfTruth, 'Claude');
        assert.equal(snapshot.canonicalEntrypoint, 'CLAUDE.md');
        assert.equal(snapshot.collectedVia, 'CLI_INTERACTIVE');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot captures init answers error for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
    const runtimePath = path.join(bundlePath, 'runtime');
    fs.mkdirSync(runtimePath, { recursive: true });
    fs.writeFileSync(
        path.join(runtimePath, 'init-answers.json'),
        'not valid json',
        'utf8'
    );

    try {
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.initAnswersPresent, true);
        assert.ok(snapshot.initAnswersError !== null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot keeps CLI-collected setup in agent handoff state even when commands are filled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        seedInitializedWorkspace(tmpDir, 'CLI_INTERACTIVE');
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.primaryInitializationComplete, true);
        assert.equal(snapshot.agentInitializationComplete, false);
        assert.equal(snapshot.readyForTasks, false);
        assert.equal(snapshot.agentInitializationPendingReason, 'AGENT_HANDOFF_REQUIRED');
        assert.ok(snapshot.recommendedNextCommand.includes('AGENT_INIT_PROMPT.md'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot marks workspace ready only after AGENT_INIT_PROMPT initialization with commands filled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        seedInitializedWorkspace(tmpDir, 'AGENT_INIT_PROMPT.md', {
            agentInitState: {
                Version: 1,
                AssistantLanguage: 'English',
                SourceOfTruth: 'Codex',
                AssistantLanguageConfirmed: true,
                ActiveAgentFilesConfirmed: true,
                ProjectRulesUpdated: true,
                SkillsPromptCompleted: true,
                VerificationPassed: true,
                ManifestValidationPassed: true,
                ActiveAgentFiles: ['AGENTS.md']
            }
        });
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.primaryInitializationComplete, true);
        assert.equal(snapshot.agentInitializationComplete, true);
        assert.equal(snapshot.readyForTasks, true);
        assert.equal(snapshot.agentInitializationPendingReason, null);
        assert.equal(snapshot.recommendedNextCommand, 'Execute task T-001 depth=2');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot flags stale agent-init state when active agent files no longer match answers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        seedInitializedWorkspace(tmpDir, 'AGENT_INIT_PROMPT.md', {
            activeAgentFiles: 'AGENTS.md, CLAUDE.md',
            agentInitState: {
                Version: 1,
                AssistantLanguage: 'English',
                SourceOfTruth: 'Codex',
                AssistantLanguageConfirmed: true,
                ActiveAgentFilesConfirmed: true,
                ProjectRulesUpdated: true,
                SkillsPromptCompleted: true,
                VerificationPassed: true,
                ManifestValidationPassed: true,
                ActiveAgentFiles: ['AGENTS.md']
            }
        });
        const snapshot = getStatusSnapshot(tmpDir);
        assert.equal(snapshot.readyForTasks, false);
        assert.equal(snapshot.agentInitializationPendingReason, 'AGENT_STATE_STALE');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatStatusSnapshot produces expected text markers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        const snapshot = getStatusSnapshot(tmpDir);
        const output = formatStatusSnapshot(snapshot);
        assert.ok(output.includes('OCTOPUS_STATUS'));
        assert.ok(output.includes('Not installed'));
        assert.ok(output.includes('Workspace Stages'));
        assert.ok(output.includes('Installed'));
        assert.ok(output.includes('RecommendedNextCommand'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatStatusSnapshot includes explicit next stage for CLI-collected setup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        seedInitializedWorkspace(tmpDir, 'CLI_NONINTERACTIVE');
        const snapshot = getStatusSnapshot(tmpDir);
        const output = formatStatusSnapshot(snapshot);
        assert.ok(output.includes('Agent setup required'));
        assert.ok(output.includes('Next stage: Launch your agent with AGENT_INIT_PROMPT.md'));
        assert.ok(output.includes('RecommendedNextCommand: Give your agent'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('formatStatusSnapshot accepts custom heading', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        const snapshot = getStatusSnapshot(tmpDir);
        const output = formatStatusSnapshot(snapshot, { heading: 'CUSTOM_HEADING' });
        assert.ok(output.includes('CUSTOM_HEADING'));
        assert.ok(!output.includes('OCTOPUS_STATUS'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getStatusSnapshot warns about incomplete task timelines', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
    try {
        seedInitializedWorkspace(tmpDir, 'AGENT_INIT_PROMPT.md', {
            agentInitState: {
                Version: 1,
                AssistantLanguage: 'English',
                SourceOfTruth: 'Codex',
                AssistantLanguageConfirmed: true,
                ActiveAgentFilesConfirmed: true,
                ProjectRulesUpdated: true,
                SkillsPromptCompleted: true,
                VerificationPassed: true,
                ManifestValidationPassed: true,
                ActiveAgentFiles: ['AGENTS.md']
            }
        });

        const bundlePath = path.join(tmpDir, 'Octopus-agent-orchestrator');
        const timelinePath = path.join(bundlePath, 'runtime', 'task-events', 'T-001.jsonl');
        writeStatusFixtureFile(timelinePath, JSON.stringify({
            timestamp_utc: '2026-03-28T10:00:00.000Z',
            task_id: 'T-001',
            event_type: 'TASK_MODE_ENTERED',
            outcome: 'PASS',
            actor: 'gate',
            message: 'Task mode entered.',
            details: {}
        }) + '\n');

        const snapshot = getStatusSnapshot(tmpDir);
        const output = formatStatusSnapshot(snapshot);
        assert.equal(snapshot.timelineTaskCount, 1);
        assert.equal(snapshot.timelineHealthy, 0);
        assert.ok(snapshot.timelineWarnings.some((warning) => warning.includes('Incomplete timeline: T-001.jsonl')));
        assert.ok(output.includes('TaskTimelines: 0/1 complete'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
