import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { runGitDiff } from '../../../src/gates/build-scoped-diff';

test('runGitDiff handles repo roots and pathspecs with spaces', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-diff-'));
    const repoRoot = path.join(tempDir, 'repo with spaces');
    const srcDir = path.join(repoRoot, 'src');
    const changedFilePath = path.join(srcDir, 'app with spaces.ts');

    try {
        fs.mkdirSync(srcDir, { recursive: true });
        execFileSync('git', ['init', repoRoot], { stdio: 'ignore' });
        execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Octopus Test'], { stdio: 'ignore' });
        execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'octopus@example.com'], { stdio: 'ignore' });

        fs.writeFileSync(changedFilePath, 'export const value = 1;\n', 'utf8');
        execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'ignore' });
        execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'initial'], { stdio: 'ignore' });

        fs.writeFileSync(changedFilePath, 'export const value = 2;\n', 'utf8');

        const diff = runGitDiff(repoRoot, false, ['src/app with spaces.ts']);
        assert.match(diff, /diff --git a\/src\/app with spaces\.ts b\/src\/app with spaces\.ts/);
        assert.match(diff, /\+export const value = 2;/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
