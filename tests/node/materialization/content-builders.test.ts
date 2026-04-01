import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    MANAGED_START,
    MANAGED_END,
    COMMIT_GUARD_START,
    COMMIT_GUARD_END,
    extractManagedBlockFromContent,
    getTaskQueueTableRange,
    getTaskQueueRowsFromManagedBlock,
    setTaskQueueRowsInManagedBlock,
    buildTaskManagedBlockWithExistingQueue,
    buildCanonicalManagedBlock,
    buildRedirectManagedBlock,
    buildCommitGuardManagedBlock,
    buildProviderOrchestratorAgentContent,
    buildGitHubSkillBridgeAgentContent,
    buildQwenSettingsContent,
    buildClaudeLocalSettingsContent,
    buildGitignoreEntries,
    syncManagedBlockInContent
} from '../../../src/materialization/content-builders';

describe('extractManagedBlockFromContent', () => {
    it('extracts block between markers', () => {
        const content = `before\n${MANAGED_START}\ninner\n${MANAGED_END}\nafter`;
        const result = extractManagedBlockFromContent(content, MANAGED_START, MANAGED_END);
        assert.ok(result!.includes('inner'));
        assert.ok(result!.startsWith(MANAGED_START));
        assert.ok(result!.endsWith(MANAGED_END));
    });

    it('returns null for missing markers', () => {
        assert.equal(extractManagedBlockFromContent('no markers here', MANAGED_START, MANAGED_END), null);
    });

    it('returns null for empty content', () => {
        assert.equal(extractManagedBlockFromContent('', MANAGED_START, MANAGED_END), null);
        assert.equal(extractManagedBlockFromContent(null, MANAGED_START, MANAGED_END), null);
    });
});

describe('task queue operations', () => {
    const taskBlock = [
        MANAGED_START,
        '## Active Queue',
        '| ID | Status | Depth |',
        '|---|---|---|',
        '| T-001 | IN_PROGRESS | 2 |',
        '| T-002 | BACKLOG | 1 |',
        '',
        '## Notes',
        MANAGED_END
    ].join('\n');

    it('getTaskQueueTableRange parses correctly', () => {
        const range = getTaskQueueTableRange(taskBlock);
        assert.ok(range);
        assert.equal(range.rowsStartIndex, 4);
        assert.equal(range.rowsEndIndex, 6);
    });

    it('getTaskQueueRowsFromManagedBlock extracts rows', () => {
        const rows = getTaskQueueRowsFromManagedBlock(taskBlock);
        assert.equal(rows.length, 2);
        assert.ok(rows[0].includes('T-001'));
        assert.ok(rows[1].includes('T-002'));
    });

    it('setTaskQueueRowsInManagedBlock replaces rows', () => {
        const newRows = ['| T-003 | DONE | 3 |'];
        const result = setTaskQueueRowsInManagedBlock(taskBlock, newRows);
        assert.ok(result!.includes('T-003'));
        assert.ok(!result.includes('T-001'));
    });

    it('returns empty rows for no table', () => {
        const noTable = `${MANAGED_START}\nNo queue here\n${MANAGED_END}`;
        assert.deepEqual(getTaskQueueRowsFromManagedBlock(noTable), []);
    });
});

describe('buildTaskManagedBlockWithExistingQueue', () => {
    it('preserves existing queue rows in template block', () => {
        const template = `${MANAGED_START}\n## Active Queue\n| ID | Status |\n|---|---|\n| T-NEW | BACKLOG |\n${MANAGED_END}`;
        const existing = `${MANAGED_START}\n## Active Queue\n| ID | Status |\n|---|---|\n| T-OLD | DONE |\n${MANAGED_END}`;
        const result = buildTaskManagedBlockWithExistingQueue(template, existing);
        assert.ok(result!.includes('T-OLD'));
    });

    it('returns template block when no existing', () => {
        const template = `${MANAGED_START}\nTemplate content\n${MANAGED_END}`;
        const result = buildTaskManagedBlockWithExistingQueue(template, '');
        assert.ok(result!.includes('Template content'));
    });
});

describe('buildCanonicalManagedBlock', () => {
    it('replaces CLAUDE.md title with canonical file', () => {
        const templateClaudeContent = `${MANAGED_START}\n# CLAUDE.md\nSome content\n${MANAGED_END}`;
        const result = buildCanonicalManagedBlock('AGENTS.md', templateClaudeContent);
        assert.ok(result!.includes('# AGENTS.md'));
        assert.ok(!result.includes('# CLAUDE.md'));
    });

    it('restores clickable rule links in deployed canonical entrypoints', () => {
        const templateClaudeContent = `${MANAGED_START}
# CLAUDE.md
## Rule Files
- \`Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md\`
- \`Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md\`
${MANAGED_END}`;
        const result = buildCanonicalManagedBlock('CLAUDE.md', templateClaudeContent);
        assert.ok(result!.includes('- [Core Rules](./Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md)'));
        assert.ok(result!.includes('- [Commands](./Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md)'));
        assert.ok(!result.includes('- `Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md`'));
    });

    it('throws for missing managed block', () => {
        assert.throws(
            () => buildCanonicalManagedBlock('AGENTS.md', 'no managed block'),
            /managed block is missing/
        );
    });
});

describe('buildRedirectManagedBlock', () => {
    it('generates redirect with provider bridge lines', () => {
        const result = buildRedirectManagedBlock(
            'AGENTS.md', 'CLAUDE.md',
            ['.github/agents/orchestrator.md']
        );
        assert.ok(result!.includes(MANAGED_START));
        assert.ok(result!.includes(MANAGED_END));
        assert.ok(result!.includes('# AGENTS.md'));
        assert.ok(result!.includes('redirect'));
        assert.ok(result!.includes('CLAUDE.md'));
        assert.ok(result!.includes('GitHub Copilot Agents'));
    });

    it('shows no-bridge message when no providers', () => {
        const result = buildRedirectManagedBlock('GEMINI.md', 'CLAUDE.md', []);
        assert.ok(result!.includes('No provider-specific bridge files'));
    });
});

describe('buildCommitGuardManagedBlock', () => {
    it('produces valid bash hook script', () => {
        const result = buildCommitGuardManagedBlock();
        assert.ok(result!.includes(COMMIT_GUARD_START));
        assert.ok(result!.includes(COMMIT_GUARD_END));
        assert.ok(result!.includes('OCTOPUS_ALLOW_COMMIT'));
        assert.ok(result!.includes('CODEX_THREAD_ID'));
        assert.ok(result!.includes('exit 1'));
    });
});

describe('buildProviderOrchestratorAgentContent', () => {
    it('includes required execution contract sections', () => {
        const result = buildProviderOrchestratorAgentContent('GitHub Copilot', 'CLAUDE.md', '.github/agents/orchestrator.md');
        assert.ok(result!.includes(MANAGED_START));
        assert.ok(result!.includes('GitHub Copilot Agent: Orchestrator'));
        assert.ok(result!.includes('Required Execution Contract'));
        assert.ok(result!.includes('Skill Routing'));
        assert.ok(result!.includes('Task Timeline Logging'));
        assert.ok(result!.includes('.github/agents/orchestrator.md'));
    });
});

describe('buildGitHubSkillBridgeAgentContent', () => {
    it('includes skill bridge contract', () => {
        const result = buildGitHubSkillBridgeAgentContent(
            'Code Review Bridge', 'CLAUDE.md',
            'Octopus-agent-orchestrator/live/skills/code-review/SKILL.md',
            'required_reviews.code=true', 'always-on'
        );
        assert.ok(result!.includes(MANAGED_START));
        assert.ok(result!.includes('Code Review Bridge'));
        assert.ok(result!.includes('Skill Bridge Contract'));
        assert.ok(result!.includes('required_reviews.code=true'));
    });
});

describe('buildQwenSettingsContent', () => {
    it('creates new settings with required entries', () => {
        const result = buildQwenSettingsContent(null, ['TASK.md', 'CLAUDE.md']);
        assert.equal(result!.needsUpdate, true);
        const parsed = JSON.parse(result.content);
        assert.ok(parsed.context.fileName.includes('TASK.md'));
        assert.ok(parsed.context.fileName.includes('CLAUDE.md'));
    });

    it('merges into existing settings', () => {
        const existing = JSON.stringify({ context: { fileName: ['TASK.md'] }, other: 'value' });
        const result = buildQwenSettingsContent(existing, ['TASK.md', 'CLAUDE.md']);
        assert.equal(result!.needsUpdate, true);
        assert.equal(result!.parseMode, 'merge-existing');
        const parsed = JSON.parse(result.content);
        assert.ok(parsed.context.fileName.includes('CLAUDE.md'));
        assert.equal(parsed.other, 'value');
    });

    it('reports no update needed when all entries present', () => {
        const existing = JSON.stringify({ context: { fileName: ['TASK.md', 'CLAUDE.md'] } });
        const result = buildQwenSettingsContent(existing, ['TASK.md', 'CLAUDE.md']);
        assert.equal(result!.needsUpdate, false);
    });

    it('handles invalid JSON gracefully', () => {
        const result = buildQwenSettingsContent('not json', ['TASK.md']);
        assert.equal(result!.parseMode, 'invalid-json');
        assert.equal(result!.needsUpdate, true);
    });
});

describe('buildClaudeLocalSettingsContent', () => {
    it('adds orchestrator allow entries when enabled', () => {
        const result = buildClaudeLocalSettingsContent(null, true);
        assert.equal(result!.needsUpdate, true);
        const parsed = JSON.parse(result.content);
        assert.ok(parsed.permissions.allow.length > 0);
        assert.ok(parsed.permissions.allow.some((e: string) => e.includes('bin/octopus.js')));
    });

    it('does not add entries when disabled', () => {
        const result = buildClaudeLocalSettingsContent(null, false);
        const parsed = JSON.parse(result.content);
        assert.equal(parsed.permissions.allow.length, 0);
    });
});

describe('buildGitignoreEntries', () => {
    it('includes core entries', () => {
        const entries = buildGitignoreEntries(['CLAUDE.md'], [], false);
        assert.ok(entries.includes('Octopus-agent-orchestrator/'));
        assert.ok(entries.includes('TASK.md'));
        assert.ok(entries.includes('.qwen/'));
    });

    it('includes .qwen/ in the managed baseline so later Qwen activation stays ignored', () => {
        const entries = buildGitignoreEntries(['CLAUDE.md'], [], false, true);
        assert.ok(entries.includes('.qwen/'));
    });

    it('adds AGENTS.md when active', () => {
        const entries = buildGitignoreEntries(['AGENTS.md'], [], false);
        assert.ok(entries.includes('AGENTS.md'));
    });

    it('adds QWEN.md when active', () => {
        const entries = buildGitignoreEntries(['QWEN.md'], [], false);
        assert.ok(entries.includes('QWEN.md'));
    });

    it('includes all supported entrypoint and provider ignore variants from the managed baseline', () => {
        const entries = buildGitignoreEntries(['CLAUDE.md'], [], false);
        assert.ok(entries.includes('CLAUDE.md'));
        assert.ok(entries.includes('AGENTS.md'));
        assert.ok(entries.includes('GEMINI.md'));
        assert.ok(entries.includes('QWEN.md'));
        assert.ok(entries.includes('.github/copilot-instructions.md'));
        assert.ok(entries.includes('.antigravity/'));
        assert.ok(entries.includes('.junie/'));
        assert.ok(entries.includes('.windsurf/'));
        assert.ok(entries.includes('.qwen/'));
    });

    it('adds .claude/ when claude access enabled', () => {
        const entries = buildGitignoreEntries(['CLAUDE.md'], [], true);
        assert.ok(entries.includes('.claude/'));
    });

    it('includes provider gitignore entries', () => {
        const profiles = [{ gitignoreEntries: ['.github/agents/', '.github/copilot-instructions.md'] }];
        const entries = buildGitignoreEntries(['.github/copilot-instructions.md'], profiles, false);
        assert.ok(entries.includes('.github/agents/'));
    });
});

describe('syncManagedBlockInContent', () => {
    it('replaces existing managed block', () => {
        const content = `before\r\n${MANAGED_START}\r\nold\r\n${MANAGED_END}\r\nafter`;
        const result = syncManagedBlockInContent(content, `${MANAGED_START}\r\nnew\r\n${MANAGED_END}`);
        assert.ok(result!.changed);
        assert.ok(result!.content.includes('new'));
        assert.ok(!result.content.includes('old'));
    });

    it('appends to empty content', () => {
        const result = syncManagedBlockInContent('', `${MANAGED_START}\ncontent\n${MANAGED_END}`);
        assert.ok(result!.changed);
        assert.ok(result!.content.includes(MANAGED_START));
    });

    it('replaces non-empty legacy content without block', () => {
        const result = syncManagedBlockInContent('existing content', `${MANAGED_START}\ncontent\n${MANAGED_END}`);
        assert.ok(result!.changed);
        assert.ok(result!.content.includes(MANAGED_START));
        assert.ok(!result.content.includes('existing content'));
    });
});
