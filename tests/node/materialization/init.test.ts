const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runInit, mergeConfig } = require('../../../src/materialization/init.ts');

function findRepoRoot() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'VERSION')) && fs.existsSync(path.join(dir, 'template'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    throw new Error('Cannot find repo root');
}

function setupTestWorkspace(bundleRoot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-init-'));
    const bundle = path.join(tmpDir, 'Octopus-agent-orchestrator');
    fs.mkdirSync(bundle, { recursive: true });
    fs.copyFileSync(path.join(bundleRoot, 'VERSION'), path.join(bundle, 'VERSION'));
    copyDirRecursive(path.join(bundleRoot, 'template'), path.join(bundle, 'template'));
    fs.mkdirSync(path.join(bundle, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'live'), { recursive: true });
    return { projectRoot: tmpDir, bundleRoot: bundle };
}

function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

describe('runInit', () => {
    const repoRoot = findRepoRoot();

    it('materializes all 11 rule files in live/docs/agent-rules', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const result = runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude'
            });

            assert.equal(result.ruleFilesMaterialized, 11);
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/docs/agent-rules/00-core.md')));
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/docs/agent-rules/80-task-workflow.md')));
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/docs/agent-rules/90-skill-catalog.md')));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('applies language and brevity to 00-core.md', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'Russian',
                assistantBrevity: 'detailed',
                sourceOfTruth: 'Claude'
            });

            const coreContent = fs.readFileSync(
                path.join(bundleRoot, 'live/docs/agent-rules/00-core.md'), 'utf8'
            );
            assert.ok(coreContent.includes('Russian'));
            assert.ok(coreContent.includes('detailed'));
            assert.ok(!coreContent.includes('{{ASSISTANT_RESPONSE_LANGUAGE}}'));
            assert.ok(!coreContent.includes('{{ASSISTANT_RESPONSE_BREVITY}}'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('copies support directories to live/', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            const result = runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude'
            });

            assert.ok(result.supportDirectoriesSynced > 0);
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/config')));
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/skills')));
            assert.ok(fs.existsSync(path.join(bundleRoot, 'live/skills/orchestration/skill.json')));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('creates reporting files', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            fs.mkdirSync(path.join(projectRoot, 'docs', 'agent-rules'), { recursive: true });
            fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Legacy\n', 'utf8');
            fs.writeFileSync(path.join(projectRoot, 'docs', 'agent-rules', '10-context.md'), '# Context\n', 'utf8');
            fs.writeFileSync(path.join(projectRoot, 'docs', 'overview.md'), '# Overview\n', 'utf8');

            const result = runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude'
            });

            assert.ok(fs.existsSync(result.initReportPath));
            assert.ok(fs.existsSync(result.sourceInventoryPath));
            assert.ok(fs.existsSync(result.projectDiscoveryPath));
            assert.ok(fs.existsSync(result.usagePath));

            const report = fs.readFileSync(result.initReportPath, 'utf8');
            const inventory = fs.readFileSync(result.sourceInventoryPath, 'utf8');
            const discovery = fs.readFileSync(result.projectDiscoveryPath, 'utf8');
            assert.ok(report.includes('# Init Report'));
            assert.ok(report.includes('Rule Source Mapping'));
            assert.ok(report.includes('Legacy docs discovered in `docs/agent-rules`: 1 files'));
            assert.ok(inventory.includes('`AGENTS.md` : FOUND'));
            assert.ok(inventory.includes('`docs/agent-rules` : FOUND (files=1)'));
            assert.ok(discovery.includes('## Stack Evidence'));
            assert.ok(discovery.includes('## Runtime Path Hints'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('sets token economy enabled flag in config', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude',
                tokenEconomyEnabled: false
            });

            const configPath = path.join(bundleRoot, 'live/config/token-economy.json');
            assert.ok(fs.existsSync(configPath));
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            assert.equal(config.enabled, false);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('throws for unsupported brevity', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            assert.throws(() => runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantBrevity: 'invalid'
            }), /Unsupported AssistantBrevity/);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('seeds USAGE.md with canonical entrypoint', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Codex'
            });

            const usage = fs.readFileSync(path.join(bundleRoot, 'live/USAGE.md'), 'utf8');
            assert.ok(usage.includes('AGENTS.md'));
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('synchronizes optional review capabilities from live specialist skills', () => {
        const { projectRoot, bundleRoot } = setupTestWorkspace(repoRoot);
        try {
            fs.mkdirSync(path.join(bundleRoot, 'live', 'skills', 'api-contract-review'), { recursive: true });
            fs.mkdirSync(path.join(bundleRoot, 'live', 'skills', 'testing-strategy'), { recursive: true });

            runInit({
                targetRoot: projectRoot,
                bundleRoot,
                assistantLanguage: 'English',
                assistantBrevity: 'concise',
                sourceOfTruth: 'Claude'
            });

            const capabilities = JSON.parse(fs.readFileSync(
                path.join(bundleRoot, 'live', 'config', 'review-capabilities.json'),
                'utf8'
            ));
            assert.equal(capabilities.api, true);
            assert.equal(capabilities.test, true);
            assert.equal(capabilities.dependency, true);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});

describe('mergeConfig', () => {
    it('preserves existing values over template', () => {
        const result = mergeConfig(
            { a: 1, b: 2, c: 3 },
            { a: 10, b: 20 }
        );
        assert.equal(result.a, 10);
        assert.equal(result.b, 20);
        assert.equal(result.c, 3);
    });

    it('fills missing keys from template', () => {
        const result = mergeConfig(
            { a: 1, b: 2 },
            { a: 10 }
        );
        assert.equal(result.b, 2);
    });

    it('preserves unknown keys from existing', () => {
        const result = mergeConfig(
            { a: 1 },
            { a: 10, custom: 'value' }
        );
        assert.equal(result.custom, 'value');
    });

    it('returns template copy when no existing', () => {
        const result = mergeConfig({ a: 1 }, null);
        assert.equal(result.a, 1);
    });

    it('deep merges nested objects', () => {
        const result = mergeConfig(
            { nested: { a: 1, b: 2 } },
            { nested: { a: 10 } }
        );
        assert.equal(result.nested.a, 10);
        assert.equal(result.nested.b, 2);
    });
});
