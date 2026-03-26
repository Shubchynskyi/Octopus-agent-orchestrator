const path = require('node:path');

const { DEFAULT_INIT_ANSWERS_RELATIVE_PATH } = require('../core/constants.ts');
const { pathExists } = require('../core/fs.ts');

const { validateManifest, formatManifestResult } = require('./validate-manifest.ts');
const { formatVerifyResult } = require('./verify.ts');
const { runVerify } = require('./verify.ts');
const { getBundlePath } = require('./workspace-layout.ts');

function runDoctor(options) {
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
    catch(err) { manifestError = err.message || String(err); }

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

function formatDoctorResult(result) {
    var lines = [];
    lines.push(formatVerifyResult(result.verifyResult));
    lines.push('');
    if (result.manifestResult) lines.push(formatManifestResult(result.manifestResult));
    else if (result.manifestError) { lines.push('MANIFEST_VALIDATION_FAILED'); lines.push('Error: '+result.manifestError); }
    lines.push('');
    if (result.passed) { lines.push('Doctor: PASS'); lines.push('Next: Execute task T-001 depth=2'); }
    else { lines.push('Doctor: FAIL'); lines.push('Resolve listed issues and rerun doctor.'); }
    return lines.join('\n');
}

module.exports = {
    formatDoctorResult,
    runDoctor
};
