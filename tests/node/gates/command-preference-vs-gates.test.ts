import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildSharedStartTaskWorkflowContent } from '../../../src/materialization/content-builders';

function findRepoRoot(): string {
    let current = __dirname;
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'template')) && fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        current = path.dirname(current);
    }
    throw new Error('Cannot resolve repo root.');
}

const REPO_ROOT = findRepoRoot();

function readRule(relativePath: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
}

describe('command-preference-vs-mandatory-gates rule clarity', () => {

    describe('40-commands.md (live)', () => {
        const content = readRule('Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md');

        it('uses "ad-hoc" qualifier in manual-command preference', () => {
            assert.ok(
                content.includes('user prefers running ad-hoc commands manually'),
                '40-commands.md must qualify "manual" preference with "ad-hoc" to prevent blanket ban interpretation'
            );
        });

        it('includes mandatory-gate exception immediately after preference', () => {
            assert.ok(
                content.includes('mandatory gates always run'),
                '40-commands.md must state that mandatory gates always run near the preference text'
            );
        });

        it('has Ad-Hoc vs Mandatory Gate Commands section', () => {
            assert.ok(
                content.includes('### Ad-Hoc vs Mandatory Gate Commands'),
                '40-commands.md must include a section distinguishing ad-hoc from gate commands'
            );
        });

        it('includes compile-gate example showing gate-driven build is allowed', () => {
            assert.ok(
                content.includes('compile-gate internally runs') ||
                content.includes('gate-driven, not ad-hoc'),
                '40-commands.md must include an example showing compile-gate build execution is allowed'
            );
        });
    });

    describe('40-commands.md (template)', () => {
        const content = readRule('template/docs/agent-rules/40-commands.md');

        it('uses "ad-hoc" qualifier in manual-command preference', () => {
            assert.ok(
                content.includes('user prefers running ad-hoc commands manually'),
                'template 40-commands.md must qualify "manual" preference with "ad-hoc"'
            );
        });

        it('includes mandatory-gate exception', () => {
            assert.ok(
                content.includes('mandatory gates always run'),
                'template 40-commands.md must state that mandatory gates always run'
            );
        });

        it('has Ad-Hoc vs Mandatory Gate Commands section', () => {
            assert.ok(
                content.includes('### Ad-Hoc vs Mandatory Gate Commands'),
                'template 40-commands.md must include ad-hoc vs gate section'
            );
        });
    });

    describe('00-core.md (live)', () => {
        const content = readRule('Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md');

        it('cross-references 40-commands.md preference in Mandatory Infrastructure Integrity', () => {
            assert.ok(
                content.includes('40-commands.md') && content.includes('ad-hoc manual commands'),
                '00-core.md Mandatory Infrastructure Integrity must cross-reference 40-commands.md ad-hoc preference'
            );
        });

        it('explicitly exempts mandatory gates from ad-hoc preference', () => {
            assert.ok(
                content.includes('compile-gate') && content.includes('does not apply to mandatory gate execution'),
                '00-core.md must state the ad-hoc preference does not apply to mandatory gate execution'
            );
        });
    });

    describe('00-core.md (template)', () => {
        const content = readRule('template/docs/agent-rules/00-core.md');

        it('cross-references 40-commands.md preference in Mandatory Infrastructure Integrity', () => {
            assert.ok(
                content.includes('40-commands.md') && content.includes('ad-hoc manual commands'),
                'template 00-core.md must cross-reference 40-commands.md ad-hoc preference'
            );
        });

        it('explicitly exempts mandatory gates from ad-hoc preference', () => {
            assert.ok(
                content.includes('compile-gate') && content.includes('does not apply to mandatory gate execution'),
                'template 00-core.md must state the ad-hoc preference does not apply to mandatory gate execution'
            );
        });
    });

    describe('start-task router (live)', () => {
        const content = readRule('.agents/workflows/start-task.md');

        it('includes hard-stop clarifying mandatory gates are not exempted by command preference', () => {
            assert.ok(
                content.includes('does NOT exempt mandatory gates'),
                'start-task.md must include hard-stop about mandatory gates not being exempted'
            );
        });
    });

    describe('start-task router (template)', () => {
        const content = readRule('template/.agents/workflows/start-task.md');

        it('includes hard-stop clarifying mandatory gates are not exempted by command preference', () => {
            assert.ok(
                content.includes('does NOT exempt mandatory gates'),
                'template start-task.md must include hard-stop about mandatory gates not being exempted'
            );
        });
    });

    describe('root entrypoint (.github/copilot-instructions.md)', () => {
        const content = readRule('.github/copilot-instructions.md');

        it('includes clarification that ad-hoc preference does not apply to mandatory gates', () => {
            assert.ok(
                content.includes('does NOT apply to mandatory gates'),
                '.github/copilot-instructions.md must clarify that ad-hoc preference does not apply to mandatory gates'
            );
        });
    });

    describe('template root entrypoint (template/CLAUDE.md)', () => {
        const content = readRule('template/CLAUDE.md');

        it('includes clarification that ad-hoc preference does not apply to mandatory gates', () => {
            assert.ok(
                content.includes('does NOT apply to mandatory gates'),
                'template/CLAUDE.md must clarify that ad-hoc preference does not apply to mandatory gates'
            );
        });
    });

    describe('ad-hoc commands are still discouraged (negative parity)', () => {
        const liveCommands = readRule('Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md');
        const templateCommands = readRule('template/docs/agent-rules/40-commands.md');

        it('live 40-commands.md still discourages ad-hoc npm run build', () => {
            assert.ok(
                liveCommands.includes('Do not execute ad-hoc'),
                'live 40-commands.md must still discourage ad-hoc command execution'
            );
        });

        it('template 40-commands.md still discourages ad-hoc npm run build', () => {
            assert.ok(
                templateCommands.includes('Do not execute ad-hoc'),
                'template 40-commands.md must still discourage ad-hoc command execution'
            );
        });

        it('live 40-commands.md marks direct npm run build as ad-hoc to avoid', () => {
            assert.ok(
                liveCommands.includes('Ad-hoc — avoid unless requested'),
                'live 40-commands.md example must mark direct build as ad-hoc to avoid'
            );
        });
    });

    describe('content-builders.ts generated start-task router', () => {
        it('buildSharedStartTaskWorkflowContent includes mandatory-gate exemption hard-stop', () => {
            const generated = buildSharedStartTaskWorkflowContent('.github/copilot-instructions.md');
            assert.ok(
                generated.includes('does NOT exempt mandatory gates'),
                'Generated start-task content must include hard-stop about mandatory gates not being exempted by ad-hoc preference'
            );
        });

        it('buildSharedStartTaskWorkflowContent includes compile-gate reference in hard-stop', () => {
            const generated = buildSharedStartTaskWorkflowContent('CLAUDE.md');
            assert.ok(
                generated.includes('compile-gate'),
                'Generated start-task content must reference compile-gate in the mandatory gate exemption hard-stop'
            );
        });
    });
});
