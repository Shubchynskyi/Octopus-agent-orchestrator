import * as path from 'node:path';
import { DEFAULT_INIT_ANSWERS_RELATIVE_PATH } from '../core/constants';
import { pathExists } from '../core/fs';
import { validateManifest, formatManifestResult } from './validate-manifest';
import { formatVerifyResult } from './verify';
import { runVerify } from './verify';
import { getBundlePath } from './workspace-layout';

interface DoctorOptions {
    targetRoot: string;
    sourceOfTruth: string;
    initAnswersPath?: string;
}

interface DoctorResult {
    passed: boolean;
    targetRoot: string;
    verifyResult: ReturnType<typeof runVerify>;
    manifestResult: ReturnType<typeof validateManifest> | null;
    manifestError: string | null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function runDoctor(options: DoctorOptions): DoctorResult {
    var targetRoot = path.resolve(options.targetRoot);
    var initAnswersPath = options.initAnswersPath || DEFAULT_INIT_ANSWERS_RELATIVE_PATH;
    var bundlePath = getBundlePath(targetRoot);

    if (!pathExists(bundlePath)) {
        throw new Error(
            'Deployed bundle not found: '+bundlePath+'\n'+
            "Run 'npx octopus-agent-orchestrator' first, then rerun 'doctor'."
        );
    }

    var verifyResult = runVerify({
        targetRoot: targetRoot,
        sourceOfTruth: options.sourceOfTruth,
        initAnswersPath: initAnswersPath
    });

    var manifestPath = path.join(bundlePath, 'MANIFEST.md');
    var manifestResult = null;
    var manifestError = null;

    try { manifestResult = validateManifest(manifestPath, targetRoot); }
    catch (err: unknown) { manifestError = getErrorMessage(err); }

    var manifestPassed = manifestResult ? manifestResult.passed : false;
    var passed = verifyResult.passed && manifestPassed && !manifestError;

    return {
        passed: passed,
        targetRoot: targetRoot,
        verifyResult: verifyResult,
        manifestResult: manifestResult,
        manifestError: manifestError
    };
}

export function formatDoctorResult(result: DoctorResult): string {
    var lines: string[] = [];
    lines.push(formatVerifyResult(result.verifyResult));
    lines.push('');
    if (result.manifestResult) lines.push(formatManifestResult(result.manifestResult));
    else if (result.manifestError) { lines.push('MANIFEST_VALIDATION_FAILED'); lines.push('Error: '+result.manifestError); }
    lines.push('');
    if (result.passed) { lines.push('Doctor: PASS'); lines.push('Next: Execute task T-001 depth=2'); }
    else { lines.push('Doctor: FAIL'); lines.push('Resolve listed issues and rerun doctor.'); }
    return lines.join('\n');
}
