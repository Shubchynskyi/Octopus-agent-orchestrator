const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    getProjectDiscovery,
    buildProjectDiscoveryLines,
    buildDiscoveryOverlaySection,
    STACK_SIGNALS
} = require('../../../src/materialization/project-discovery.ts');

describe('STACK_SIGNALS', () => {
    it('covers expected tech stacks', () => {
        const names = STACK_SIGNALS.map((s) => s.name);
        assert.ok(names.includes('Node.js or JavaScript'));
        assert.ok(names.includes('Python'));
        assert.ok(names.includes('Go'));
        assert.ok(names.includes('Rust'));
        assert.ok(names.includes('.NET'));
        assert.ok(names.includes('TypeScript'));
    });
});

describe('getProjectDiscovery', () => {
    it('discovers stack signals from filesystem', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-discovery-'));
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
            fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module test');
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.writeFileSync(path.join(tmpDir, 'src', 'main.go'), '');

            const result = getProjectDiscovery(tmpDir);
            assert.ok(result.source === 'filesystem_scan' || result.source === 'git_index_and_worktree');
            assert.ok(result.fileCount >= 2);
            assert.ok(result.detectedStacks.includes('Node.js or JavaScript'));
            assert.ok(result.detectedStacks.includes('Go'));
            assert.ok(result.suggestedCommands.length > 0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('excludes Octopus-agent-orchestrator paths', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-discovery-excl-'));
        try {
            const oaoDir = path.join(tmpDir, 'Octopus-agent-orchestrator');
            fs.mkdirSync(oaoDir, { recursive: true });
            fs.writeFileSync(path.join(oaoDir, 'package.json'), '{}');
            fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello');

            const result = getProjectDiscovery(tmpDir);
            assert.ok(!result.detectedStacks.includes('Node.js or JavaScript'));
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns top-level directories excluding excluded ones', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-discovery-dirs-'));
        try {
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.mkdirSync(path.join(tmpDir, '.git'));
            fs.mkdirSync(path.join(tmpDir, 'node_modules'));
            fs.mkdirSync(path.join(tmpDir, 'docs'));

            const result = getProjectDiscovery(tmpDir);
            assert.ok(result.topLevelDirectories.includes('src'));
            assert.ok(result.topLevelDirectories.includes('docs'));
            assert.ok(!result.topLevelDirectories.includes('.git'));
            assert.ok(!result.topLevelDirectories.includes('node_modules'));
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('buildProjectDiscoveryLines', () => {
    it('produces markdown with expected sections', () => {
        const discovery = {
            source: 'filesystem_scan',
            fileCount: 5,
            detectedStacks: ['Node.js or JavaScript'],
            stackEvidence: [{ name: 'Node.js or JavaScript', matches: ['package.json'] }],
            topLevelDirectories: ['src', 'docs'],
            rootFiles: ['package.json', 'README.md'],
            runtimePathHints: ['src/'],
            suggestedCommands: ['npm run test'],
            sampleFiles: ['package.json', 'src/index.js']
        };
        const lines = buildProjectDiscoveryLines(discovery, '2025-01-01T00:00:00Z');
        const text = lines.join('\n');
        assert.ok(text.includes('# Project Discovery'));
        assert.ok(text.includes('## Detected Stack Signals'));
        assert.ok(text.includes('Node.js or JavaScript'));
        assert.ok(text.includes('## Top-Level Directories'));
        assert.ok(text.includes('## Stack Evidence'));
        assert.ok(text.includes('## Root Files'));
        assert.ok(text.includes('## Runtime Path Hints'));
        assert.ok(text.includes('## Suggested Local Commands'));
        assert.ok(text.includes('## Sample Files Used'));
    });
});

describe('buildDiscoveryOverlaySection', () => {
    it('produces compact snapshot', () => {
        const discovery = {
            source: 'git_index_and_worktree',
            fileCount: 100,
            detectedStacks: ['Python', 'Go'],
            topLevelDirectories: ['src', 'cmd']
        };
        const result = buildDiscoveryOverlaySection(discovery);
        assert.ok(result.includes('## Project Discovery Snapshot'));
        assert.ok(result.includes('Python, Go'));
        assert.ok(result.includes('src, cmd'));
    });

    it('shows none detected for empty stacks', () => {
        const discovery = {
            source: 'filesystem_scan',
            fileCount: 0,
            detectedStacks: [],
            topLevelDirectories: []
        };
        const result = buildDiscoveryOverlaySection(discovery);
        assert.ok(result.includes('none detected'));
    });
});
