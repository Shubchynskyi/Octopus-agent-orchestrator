import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getRepoRoot } from '../../../scripts/node-foundation/build';

function readRepoFile(relativePath: string): string {
    const repoRoot = getRepoRoot();
    const filePath = path.join(repoRoot, relativePath);
    assert.ok(fs.existsSync(filePath), `${relativePath} must exist`);
    return fs.readFileSync(filePath, 'utf8');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('repo governance files use the current owner handle and root-relative paths', () => {
    const codeowners = readRepoFile('.github/CODEOWNERS');
    const branchProtection = readRepoFile('docs/branch-protection.md');
    const gitleaks = readRepoFile('.gitleaks.toml');

    assert.ok(!codeowners.includes('@anthropic-team/orchestrator-maintainers'));
    assert.match(codeowners, /@Shubchynskyi/);
    for (const pattern of [
        'runtime/',
        'Octopus-agent-orchestrator/runtime/',
        'live/docs/agent-rules/',
        'Octopus-agent-orchestrator/live/docs/agent-rules/',
        'live/config/',
        'Octopus-agent-orchestrator/live/config/',
        'live/skills/',
        'Octopus-agent-orchestrator/live/skills/',
        'src/',
        'Octopus-agent-orchestrator/src/',
        'bin/',
        'Octopus-agent-orchestrator/bin/',
        'dist/',
        'Octopus-agent-orchestrator/dist/',
        'template/',
        'Octopus-agent-orchestrator/template/'
    ]) {
        assert.match(
            codeowners,
            new RegExp(`^${escapeRegExp(pattern)}\\s+@Shubchynskyi$`, 'm'),
            `CODEOWNERS must cover ${pattern}`
        );
    }

    assert.ok(!branchProtection.includes('@anthropic-team/orchestrator-maintainers'));
    assert.match(branchProtection, /@Shubchynskyi/);
    assert.match(branchProtection, /runtime\/.*Octopus-agent-orchestrator\/runtime\//s);
    assert.match(branchProtection, /src\/.*Octopus-agent-orchestrator\/src\//s);

    assert.ok(!gitleaks.includes("'''tests/.*'''"));
    assert.ok(!gitleaks.includes("'''dist/.*'''"));
    assert.match(gitleaks, /'''runtime\/\.\*'''/);
    assert.match(gitleaks, /'''Octopus-agent-orchestrator\/runtime\/\.\*'''/);
    assert.ok(gitleaks.includes("'''tests/node/core/redaction\\.test\\.ts'''"));
});
