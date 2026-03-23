const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleSkills } = require('../../../../src/cli/commands/skills.ts');
const { getSkillPacksConfigPath, writeSkillsIndex } = require('../../../../src/runtime/skills.ts');

function findRepoRoot() {
    let current = __dirname;
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'template')) && fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        current = path.dirname(current);
    }
    throw new Error('Cannot resolve repo root.');
}

test('handleSkills suggest prints deterministic recommendation output', () => {
    const repoRoot = findRepoRoot();
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oao-cli-skills-'));
    const workspaceRoot = path.join(bundleRoot, 'workspace');
    const packageJson = { version: '1.0.8' };
    const originalLog = console.log;
    const lines = [];

    try {
        fs.mkdirSync(path.join(bundleRoot, 'template'), { recursive: true });
        fs.mkdirSync(path.join(bundleRoot, 'live', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(bundleRoot, 'live', 'config'), { recursive: true });
        fs.cpSync(path.join(repoRoot, 'template', 'skill-packs'), path.join(bundleRoot, 'template', 'skill-packs'), { recursive: true });
        fs.copyFileSync(path.join(repoRoot, 'template', 'config', 'skill-packs.json'), getSkillPacksConfigPath(bundleRoot));
        writeSkillsIndex(bundleRoot);

        fs.mkdirSync(path.join(workspaceRoot, 'src', 'components'), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"web-app","dependencies":{"react":"18.0.0"}}', 'utf8');
        fs.writeFileSync(path.join(workspaceRoot, 'src', 'components', 'App.tsx'), 'export function App() { return null; }\n', 'utf8');

        console.log = function (...items) {
            lines.push(items.join(' '));
        };

        const result = handleSkills([
            'suggest',
            '--bundle-root', bundleRoot,
            '--target-root', workspaceRoot,
            '--task-text', 'Improve component accessibility and rendering performance',
            '--changed-path', 'src/components/App.tsx'
        ], packageJson);

        assert.ok(result.suggestedPacks.some((pack) => pack.id === 'frontend-react'));
        assert.ok(result.suggestedSkills.some((skill) => skill.id === 'frontend-react'));
        const output = lines.join('\n');
        assert.match(output, /OCTOPUS_SKILLS/);
        assert.match(output, /Action: suggest/);
        assert.match(output, /Suggested Packs/);
        assert.match(output, /Suggested Skills/);
    } finally {
        console.log = originalLog;
        fs.rmSync(bundleRoot, { recursive: true, force: true });
    }
});
