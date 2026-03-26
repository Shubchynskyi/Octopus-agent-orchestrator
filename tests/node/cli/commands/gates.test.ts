const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    runClassifyChangeCommand,
    runCompileGateCommand,
    runDocImpactGateCommand,
    runHumanCommitCommand,
    runLogTaskEventCommand,
    runRequiredReviewsCheckCommand,
    splitCommandLine,
    executeCommand
} = require('../../../../src/cli/commands/gates.ts');

function createTempRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-gates-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n', 'utf8');
    return root;
}

function writePreflight(repoRoot, taskId, overrides = {}) {
    const preflightPath = path.join(repoRoot, `${taskId}-preflight.json`);
    const payload = {
        task_id: taskId,
        detection_source: 'explicit_changed_files',
        mode: 'FULL_PATH',
        metrics: { changed_lines_total: 3 },
        required_reviews: {
            code: true,
            db: false,
            security: false,
            refactor: false,
            api: false,
            test: false,
            performance: false,
            infra: false,
            dependency: false
        },
        triggers: {},
        changed_files: ['src/app.ts'],
        ...overrides
    };
    fs.writeFileSync(preflightPath, JSON.stringify(payload, null, 2), 'utf8');
    return preflightPath;
}

describe('cli/commands/gates', () => {
    it('splits quoted command lines', () => {
        assert.deepEqual(
            splitCommandLine('node -e "console.log(\'ok\')"'),
            ['node', '-e', "console.log('ok')"]
        );
    });

    it('classifies explicit changed files and writes preflight artifact', () => {
        const repoRoot = createTempRepo();
        const outputPath = path.join(repoRoot, 'preflight.json');
        const result = runClassifyChangeCommand({
            repoRoot,
            changedFiles: ['src/app.ts'],
            taskId: 'T-900',
            taskIntent: 'Update app flow',
            outputPath,
            emitMetrics: false
        });

        const payload = JSON.parse(result.outputText);
        assert.equal(payload.task_id, 'T-900');
        assert.equal(payload.changed_files[0], 'src/app.ts');
        assert.equal(payload.required_reviews.code, true);
        assert.equal(fs.existsSync(outputPath), true);

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('runs compile gate and writes evidence', async () => {
        const repoRoot = createTempRepo();
        const taskId = 'T-901';
        const preflightPath = writePreflight(repoRoot, taskId);
        const commandsPath = path.join(repoRoot, 'commands.md');
        const outputFiltersPath = path.resolve('live/config/output-filters.json');
        fs.writeFileSync(commandsPath, [
            '### Compile Gate (Mandatory)',
            '```bash',
            'node -e "console.log(\'build ok\')"',
            '```'
        ].join('\n'), 'utf8');

        const result = await runCompileGateCommand({
            repoRoot,
            taskId,
            preflightPath,
            commandsPath,
            outputFiltersPath,
            emitMetrics: false
        });

        const evidencePath = path.join(repoRoot, 'runtime', 'reviews', `${taskId}-compile-gate.json`);
        const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        assert.equal(result.exitCode, 0);
        assert.equal(result.outputLines[0], 'COMPILE_GATE_PASSED');
        assert.equal(evidence.status, 'PASSED');
        assert.equal(evidence.event_source, 'compile-gate');

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('passes doc-impact gate and writes artifact', () => {
        const repoRoot = createTempRepo();
        const taskId = 'T-902';
        const preflightPath = writePreflight(repoRoot, taskId);

        const result = runDocImpactGateCommand({
            repoRoot,
            taskId,
            preflightPath,
            decision: 'NO_DOC_UPDATES',
            behaviorChanged: false,
            changelogUpdated: false,
            rationale: 'Internal cleanup only, no public behavior change.',
            emitMetrics: false
        });

        const artifactPath = path.join(repoRoot, 'runtime', 'reviews', `${taskId}-doc-impact.json`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        assert.equal(result.exitCode, 0);
        assert.equal(result.outputLines[0], 'DOC_IMPACT_GATE_PASSED');
        assert.equal(artifact.status, 'PASSED');

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('passes required reviews gate with compile evidence and review artifact', async () => {
        const repoRoot = createTempRepo();
        const taskId = 'T-903';
        const preflightPath = writePreflight(repoRoot, taskId);
        const commandsPath = path.join(repoRoot, 'commands.md');
        const outputFiltersPath = path.resolve('live/config/output-filters.json');
        fs.writeFileSync(commandsPath, [
            '### Compile Gate (Mandatory)',
            '```bash',
            'node -e "console.log(\'build ok\')"',
            '```'
        ].join('\n'), 'utf8');

        await runCompileGateCommand({
            repoRoot,
            taskId,
            preflightPath,
            commandsPath,
            outputFiltersPath,
            emitMetrics: false
        });

        const reviewsRoot = path.join(repoRoot, 'runtime', 'reviews');
        fs.mkdirSync(reviewsRoot, { recursive: true });
        fs.writeFileSync(path.join(reviewsRoot, `${taskId}-code.md`), [
            '# Review',
            '',
            'REVIEW PASSED',
            '',
            '## Findings by Severity',
            'Critical: None',
            'High: None',
            'Medium: None',
            'Low: None',
            '',
            '## Residual Risks',
            'None',
            '',
            '## Deferred Findings',
            'None'
        ].join('\n'), 'utf8');

        const result = runRequiredReviewsCheckCommand({
            repoRoot,
            taskId,
            preflightPath,
            codeReviewVerdict: 'REVIEW PASSED',
            outputFiltersPath,
            emitMetrics: false
        });

        const evidencePath = path.join(reviewsRoot, `${taskId}-review-gate.json`);
        const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        assert.equal(result.exitCode, 0);
        assert.equal(result.outputLines[0], 'REVIEW_GATE_PASSED');
        assert.equal(evidence.status, 'PASSED');
        assert.equal(evidence.event_source, 'required-reviews-check');

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('logs task events with terminal cleanup and command audit', () => {
        const repoRoot = createTempRepo();
        const taskId = 'T-904';
        const reviewsRoot = path.join(repoRoot, 'runtime', 'reviews');
        fs.mkdirSync(reviewsRoot, { recursive: true });
        const compileOutputPath = path.join(reviewsRoot, `${taskId}-compile-output.log`);
        fs.writeFileSync(compileOutputPath, 'temporary compile output\n', 'utf8');
        fs.writeFileSync(path.join(reviewsRoot, `${taskId}-compile-gate.json`), JSON.stringify({
            task_id: taskId,
            compile_output_path: `runtime/reviews/${taskId}-compile-output.log`
        }, null, 2), 'utf8');

        const result = runLogTaskEventCommand({
            repoRoot,
            taskId,
            eventType: 'TASK_DONE',
            outcome: 'PASS',
            detailsJson: JSON.stringify({
                command: 'docker logs api',
                command_mode: 'scan'
            })
        });

        const payload = JSON.parse(result.outputText);
        assert.equal(result.exitCode, 0);
        assert.equal(payload.status, 'TASK_EVENT_LOGGED');
        assert.equal(payload.command_policy_audit.warning_count > 0, true);
        assert.equal(payload.terminal_log_cleanup.deleted_paths.length, 1);
        assert.equal(fs.existsSync(compileOutputPath), false);

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('runs human commit through git with commit guard override', async () => {
        const repoRoot = createTempRepo();
        const childProcess = require('node:child_process');

        childProcess.spawnSync('git', ['init'], { cwd: repoRoot, windowsHide: true, stdio: 'ignore' });
        childProcess.spawnSync('git', ['config', 'user.name', 'Octopus Tests'], { cwd: repoRoot, windowsHide: true, stdio: 'ignore' });
        childProcess.spawnSync('git', ['config', 'user.email', 'octopus-tests@example.com'], { cwd: repoRoot, windowsHide: true, stdio: 'ignore' });
        childProcess.spawnSync('git', ['add', '.'], { cwd: repoRoot, windowsHide: true, stdio: 'ignore' });

        const exitCode = await runHumanCommitCommand(['-m', 'test: initial commit'], { cwd: repoRoot });
        const logResult = childProcess.spawnSync('git', ['log', '--oneline', '-1'], {
            cwd: repoRoot,
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });

        assert.equal(exitCode, 0);
        assert.match(logResult.stdout, /test: initial commit/);

        fs.rmSync(repoRoot, { recursive: true, force: true });
    });
});

describe('executeCommand timeout protection (T-061)', () => {
    it('runs a simple command successfully with default timeout', () => {
        const result = executeCommand(`node -e "console.log('hello')"`, {
            cwd: process.cwd()
        });
        assert.equal(result.exitCode, 0);
        assert.ok(result.outputLines.some(line => line.includes('hello')));
        assert.equal(result.timedOut, false);
    });

    it('reports timedOut when command exceeds specified timeout', () => {
        const result = executeCommand(
            `node -e "const s=Date.now();while(Date.now()-s<10000){}"`,
            { cwd: process.cwd(), timeoutMs: 500 }
        );
        assert.equal(result.timedOut, true);
        assert.equal(result.exitCode, 1);
        assert.ok(result.outputLines.some(line => /timed out/i.test(line)));
    });

    it('throws ENOENT for missing executable', () => {
        assert.throws(
            () => executeCommand('__nonexistent_executable_12345__', { cwd: process.cwd() }),
            /not found in PATH/
        );
    });
});
