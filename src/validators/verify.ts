const path = require('node:path');

const {
    BOOLEAN_TRUE_VALUES,
    BOOLEAN_FALSE_VALUES
} = require('../core/constants.ts');
const { pathExists, readTextFile } = require('../core/fs.ts');
const { isPathInsideRoot } = require('../core/paths.ts');
const { validateSkillPacks, validateSkillsIndex } = require('../runtime/skills.ts');

const {
    PROJECT_COMMAND_PLACEHOLDERS,
    RULE_FILES,
    buildRequiredPaths,
    detectGitignoreViolations,
    detectManagedConfigViolations,
    detectMissingPaths,
    detectRuleFileViolations,
    detectVersionViolations,
    extractManagedBlock,
    getCanonicalEntrypoint
} = require('./workspace-layout.ts');

function parseBooleanLike(value, defaultValue) {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    var normalized = String(value).trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
    if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
    return defaultValue;
}

function readVerifyInitAnswers(targetRoot, initAnswersPath, sourceOfTruth) {
    var violations = [];
    var defaults = {
        violations: violations,
        assistantLanguage: null,
        assistantBrevity: null,
        enforceNoAutoCommit: false,
        claudeOrchestratorFullAccess: false,
        tokenEconomyEnabled: true,
        activeAgentFiles: []
    };

    var resolvedPath;
    try {
        var candidate = String(initAnswersPath || '').trim();
        if (!path.isAbsolute(candidate)) {
            candidate = path.join(targetRoot, candidate);
        }
        resolvedPath = path.resolve(candidate);
        if (!isPathInsideRoot(targetRoot, resolvedPath)) {
            violations.push("InitAnswersPath must resolve inside TargetRoot '" + targetRoot + "'. Resolved path: " + resolvedPath);
            return defaults;
        }
    } catch (err) {
        violations.push(err.message || String(err));
        return defaults;
    }

    if (!pathExists(resolvedPath)) {
        violations.push('Init answers artifact missing: ' + resolvedPath);
        return defaults;
    }

    var raw;
    try { raw = readTextFile(resolvedPath); } catch (e) {
        violations.push('Cannot read init answers artifact: ' + resolvedPath);
        return defaults;
    }

    if (!raw.trim()) {
        violations.push('Init answers artifact is empty: ' + resolvedPath);
        return defaults;
    }

    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
        violations.push('Init answers artifact is not valid JSON: ' + resolvedPath);
        return defaults;
    }

    function getField(obj, key) {
        if (!obj || typeof obj !== 'object') return undefined;
        return obj[key] !== undefined ? String(obj[key]) : undefined;
    }

    var assistantLanguage = getField(parsed, 'AssistantLanguage');
    if (!assistantLanguage || !assistantLanguage.trim()) {
        violations.push('Init answers artifact missing AssistantLanguage: ' + resolvedPath);
    }

    var assistantBrevity = getField(parsed, 'AssistantBrevity');
    if (!assistantBrevity || !assistantBrevity.trim()) {
        violations.push('Init answers artifact missing AssistantBrevity: ' + resolvedPath);
    } else {
        var nb = assistantBrevity.trim().toLowerCase();
        if (nb !== 'concise' && nb !== 'detailed') {
            violations.push("Init answers artifact has unsupported AssistantBrevity '" + nb + "'. Allowed values: concise, detailed.");
        }
    }

    var artifactSoT = getField(parsed, 'SourceOfTruth');
    if (!artifactSoT || !artifactSoT.trim()) {
        violations.push('Init answers artifact missing SourceOfTruth: ' + resolvedPath);
    } else {
        var aKey = artifactSoT.trim().toUpperCase().replace(/\s+/g, '');
        var eKey = sourceOfTruth.trim().toUpperCase().replace(/\s+/g, '');
        if (aKey !== eKey) {
            violations.push("Init answers SourceOfTruth '" + artifactSoT.trim() + "' does not match verification SourceOfTruth '" + sourceOfTruth + "'.");
        }
    }

    var enforceNoAutoCommit = parseBooleanLike(getField(parsed, 'EnforceNoAutoCommit'), false);
    var claudeOrchestratorFullAccess = parseBooleanLike(getField(parsed, 'ClaudeOrchestratorFullAccess'), false);
    var tokenEconomyEnabled = parseBooleanLike(getField(parsed, 'TokenEconomyEnabled'), true);

    var aafRaw = getField(parsed, 'ActiveAgentFiles');
    var activeAgentFiles = [];
    if (aafRaw) {
        activeAgentFiles = aafRaw.split(/[;,]/g).map(function(s){return s.trim();}).filter(function(s){return s.length>0;});
    }
    var ce = getCanonicalEntrypoint(sourceOfTruth);
    if (activeAgentFiles.length === 0 && ce) { activeAgentFiles = [ce]; }

    return {
        violations: violations,
        assistantLanguage: assistantLanguage ? assistantLanguage.trim() : null,
        assistantBrevity: assistantBrevity ? assistantBrevity.trim().toLowerCase() : null,
        enforceNoAutoCommit: enforceNoAutoCommit,
        claudeOrchestratorFullAccess: claudeOrchestratorFullAccess,
        tokenEconomyEnabled: tokenEconomyEnabled,
        activeAgentFiles: activeAgentFiles
    };
}

function detectCommandsViolations(targetRoot) {
    var violations = [];
    var cp = path.join(targetRoot, 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md');
    if (!pathExists(cp)) return violations;
    var content = readTextFile(cp);
    var req = [
        '### Compile Gate (Mandatory)',
        'node Octopus-agent-orchestrator/bin/octopus.js gate classify-change',
        'node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate',
        'node Octopus-agent-orchestrator/bin/octopus.js gate required-reviews-check',
        'node Octopus-agent-orchestrator/bin/octopus.js gate doc-impact-gate',
        'node Octopus-agent-orchestrator/bin/octopus.js gate completion-gate',
        'node Octopus-agent-orchestrator/bin/octopus.js gate log-task-event',
        'node Octopus-agent-orchestrator/bin/octopus.js gate task-events-summary',
        'node Octopus-agent-orchestrator/bin/octopus.js gate build-scoped-diff',
        'node Octopus-agent-orchestrator/bin/octopus.js gate build-review-context',
        'node Octopus-agent-orchestrator/bin/octopus.js gate validate-manifest'
    ];
    for (var i=0;i<req.length;i++) { if (!content.includes(req[i])) violations.push("40-commands.md must include gate contract snippet '"+req[i]+"'."); }
    for (var j=0;j<PROJECT_COMMAND_PLACEHOLDERS.length;j++) { if (content.includes(PROJECT_COMMAND_PLACEHOLDERS[j])) violations.push('40-commands.md contains unresolved command placeholder: '+PROJECT_COMMAND_PLACEHOLDERS[j]); }
    return violations;
}

function detectCoreRuleViolations(targetRoot, assistantLanguage, assistantBrevity) {
    var violations = [];
    var cp = path.join(targetRoot, 'Octopus-agent-orchestrator/live/docs/agent-rules/00-core.md');
    if (!pathExists(cp)) { violations.push('00-core.md missing; core contract validation failed.'); return violations; }
    var content = readTextFile(cp);
    if (!/^Respond in .+ for explanations and assistance\.$/m.test(content)) violations.push('00-core.md must define configured assistant language sentence.');
    if (!/^Default response brevity: .+\.$/m.test(content)) violations.push('00-core.md must define configured assistant response brevity sentence.');
    if (assistantLanguage) {
        var el = 'Respond in '+assistantLanguage+' for explanations and assistance.';
        if (!new RegExp('^'+el.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','m').test(content))
            violations.push("00-core.md language does not match init answers artifact. Expected: '"+el+"'.");
    }
    if (assistantBrevity) {
        var bl = 'Default response brevity: '+assistantBrevity+'.';
        if (!new RegExp('^'+bl.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','m').test(content))
            violations.push("00-core.md response brevity does not match init answers artifact. Expected: '"+bl+"'.");
    }
    return violations;
}

function detectTaskViolations(targetRoot, canonicalEntrypoint) {
    var violations = [];
    var tp = path.join(targetRoot, 'TASK.md');
    if (!pathExists(tp)) { violations.push('TASK.md missing.'); return violations; }
    var content = readTextFile(tp);
    var mb = extractManagedBlock(content);
    if (!mb) { violations.push('TASK.md managed block missing.'); return violations; }
    if (!/\|\s*ID\s*\|\s*Status\s*\|\s*Priority\s*\|\s*Area\s*\|\s*Title\s*\|\s*Owner\s*\|\s*Updated\s*\|\s*Depth\s*\|\s*Notes\s*\|/.test(mb))
        violations.push('TASK.md queue header must include `Depth` column.');
    if (mb.includes('{{CANONICAL_ENTRYPOINT}}'))
        violations.push('TASK.md contains unresolved `{{CANONICAL_ENTRYPOINT}}` placeholder.');
    if (canonicalEntrypoint) {
        var ecl = 'Canonical instructions entrypoint for orchestration: `'+canonicalEntrypoint+'`.';
        if (!mb.includes(ecl)) violations.push("TASK.md must reference canonical instructions entrypoint '"+canonicalEntrypoint+"'.");
    }
    return violations;
}

function detectEntrypointViolations(targetRoot, canonicalEntrypoint) {
    var violations = [];
    if (!canonicalEntrypoint) return violations;
    var ep = path.join(targetRoot, canonicalEntrypoint);
    if (!pathExists(ep)) { violations.push('Canonical entrypoint missing: '+canonicalEntrypoint); return violations; }
    var content = readTextFile(ep);
    if (!/^# Octopus Agent Orchestrator Rule Index$/m.test(content))
        violations.push(canonicalEntrypoint+' must contain canonical rule index content.');
    var rl = content.match(/Octopus-agent-orchestrator\/live\/docs\/agent-rules\/[0-9]{2}[-a-z]+\.md/g);
    var ul = rl ? Array.from(new Set(rl)) : [];
    if (ul.length < RULE_FILES.length)
        violations.push(canonicalEntrypoint+' has fewer rule links than expected. Found='+ul.length+', ExpectedAtLeast='+RULE_FILES.length);
    for (var i=0;i<ul.length;i++) { if (!pathExists(path.join(targetRoot,ul[i]))) violations.push(canonicalEntrypoint+' route target missing: '+ul[i]); }
    return violations;
}

function detectQwenSettingsViolations(targetRoot, canonicalEntrypoint) {
    var violations = [];
    var sp = path.join(targetRoot, '.qwen/settings.json');
    if (!pathExists(sp)) return violations;
    var settings;
    try { settings = JSON.parse(readTextFile(sp)); } catch(e) { violations.push('.qwen/settings.json is not valid JSON: '+e.message); return violations; }
    var fn = [];
    if (settings && settings.context && settings.context.fileName) {
        var rf = Array.isArray(settings.context.fileName) ? settings.context.fileName : [settings.context.fileName];
        for (var i=0;i<rf.length;i++) { if (rf[i] && typeof rf[i]==='string' && rf[i].trim()) fn.push(rf[i].trim()); }
    }
    var uf = Array.from(new Set(fn));
    if (canonicalEntrypoint && uf.indexOf(canonicalEntrypoint)===-1) violations.push('.qwen/settings.json must include context.fileName entry `'+canonicalEntrypoint+'`.');
    if (uf.indexOf('TASK.md')===-1) violations.push('.qwen/settings.json must include context.fileName entry `TASK.md`.');
    return violations;
}

function detectManifestContractViolations(targetRoot) {
    var violations = [];
    var mp = path.join(targetRoot, 'Octopus-agent-orchestrator/MANIFEST.md');
    if (!pathExists(mp)) return violations;
    var content = readTextFile(mp);
    if (!content.includes('live/USAGE.md')) violations.push("MANIFEST.md must include 'live/USAGE.md'.");
    return violations;
}

function runVerify(options) {
    var targetRoot = path.resolve(options.targetRoot);
    var sourceOfTruth = options.sourceOfTruth.trim();
    var canonicalEntrypoint = getCanonicalEntrypoint(sourceOfTruth);
    var iar = readVerifyInitAnswers(targetRoot, options.initAnswersPath, sourceOfTruth);
    var rp = buildRequiredPaths({ activeAgentFiles: iar.activeAgentFiles, claudeOrchestratorFullAccess: iar.claudeOrchestratorFullAccess });
    var mp = detectMissingPaths(targetRoot, rp);
    var vr = detectVersionViolations(targetRoot, sourceOfTruth, canonicalEntrypoint);
    var rcv = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/review-capabilities.json');
    var pv = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/paths.json');
    var tev = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/token-economy.json');
    var ofv = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/output-filters.json');
    var spv = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/skill-packs.json');
    var six = detectManagedConfigViolations(targetRoot, 'Octopus-agent-orchestrator/live/config/skills-index.json');
    var rfr = detectRuleFileViolations(targetRoot);
    var cv = detectCommandsViolations(targetRoot);
    var crv = detectCoreRuleViolations(targetRoot, iar.assistantLanguage, iar.assistantBrevity);
    var tv = detectTaskViolations(targetRoot, canonicalEntrypoint);
    var ev = detectEntrypointViolations(targetRoot, canonicalEntrypoint);
    var qv = detectQwenSettingsViolations(targetRoot, canonicalEntrypoint);
    var skillPackValidation = validateSkillPacks(path.join(targetRoot, 'Octopus-agent-orchestrator'));
    var skillsIndexValidation = validateSkillsIndex(path.join(targetRoot, 'Octopus-agent-orchestrator'));
    var ge = ['Octopus-agent-orchestrator/','TASK.md'];
    if (pathExists(path.join(targetRoot, '.qwen/settings.json'))) {
        ge.push('.qwen/');
    }
    var gm = detectGitignoreViolations(targetRoot, ge);
    var mv = detectManifestContractViolations(targetRoot);

    var violations = {
        missingPaths: mp,
        initAnswersContractViolations: iar.violations,
        versionContractViolations: vr.violations,
        reviewCapabilitiesContractViolations: rcv,
        pathsContractViolations: pv,
        tokenEconomyContractViolations: tev,
        outputFiltersContractViolations: ofv,
        skillPacksConfigContractViolations: spv,
        skillsIndexConfigContractViolations: six,
        ruleFileViolations: rfr.ruleFileViolations,
        templatePlaceholderViolations: rfr.templatePlaceholderViolations,
        commandsContractViolations: cv,
        manifestContractViolations: mv,
        coreRuleContractViolations: crv,
        entrypointContractViolations: ev,
        taskContractViolations: tv,
        qwenSettingsViolations: qv,
        skillsIndexContractViolations: skillsIndexValidation.issues,
        skillPackContractViolations: skillPackValidation.issues,
        gitignoreMissing: gm
    };

    var total = 0;
    var keys = Object.keys(violations);
    for (var i=0;i<keys.length;i++) total += violations[keys[i]].length;

    return {
        passed: total === 0,
        targetRoot: targetRoot,
        sourceOfTruth: sourceOfTruth,
        canonicalEntrypoint: canonicalEntrypoint,
        bundleVersion: vr.bundleVersion,
        requiredPathsChecked: rp.length,
        violations: violations,
        totalViolationCount: total
    };
}

function formatVerifyResult(result) {
    var lines = [];
    lines.push('TargetRoot: '+result.targetRoot);
    lines.push('SourceOfTruth: '+result.sourceOfTruth);
    lines.push('CanonicalEntrypoint: '+(result.canonicalEntrypoint||'n/a'));
    lines.push('RequiredPathsChecked: '+result.requiredPathsChecked);
    lines.push('MissingPathCount: '+result.violations.missingPaths.length);
    lines.push('ReviewCapabilitiesContractViolationCount: '+result.violations.reviewCapabilitiesContractViolations.length);
    lines.push('PathsContractViolationCount: '+result.violations.pathsContractViolations.length);
    lines.push('TokenEconomyContractViolationCount: '+result.violations.tokenEconomyContractViolations.length);
    lines.push('OutputFiltersContractViolationCount: '+result.violations.outputFiltersContractViolations.length);
    lines.push('SkillPacksConfigContractViolationCount: '+result.violations.skillPacksConfigContractViolations.length);
    lines.push('SkillsIndexConfigContractViolationCount: '+result.violations.skillsIndexConfigContractViolations.length);
    lines.push('BundleVersion: '+(result.bundleVersion||'n/a'));
    lines.push('VersionContractViolationCount: '+result.violations.versionContractViolations.length);
    lines.push('RuleFileViolationCount: '+result.violations.ruleFileViolations.length);
    lines.push('TemplatePlaceholderViolationCount: '+result.violations.templatePlaceholderViolations.length);
    lines.push('CommandsContractViolationCount: '+result.violations.commandsContractViolations.length);
    lines.push('ManifestContractViolationCount: '+result.violations.manifestContractViolations.length);
    lines.push('InitAnswersContractViolationCount: '+result.violations.initAnswersContractViolations.length);
    lines.push('CoreRuleContractViolationCount: '+result.violations.coreRuleContractViolations.length);
    lines.push('EntrypointContractViolationCount: '+result.violations.entrypointContractViolations.length);
    lines.push('TaskContractViolationCount: '+result.violations.taskContractViolations.length);
    lines.push('QwenSettingsViolationCount: '+result.violations.qwenSettingsViolations.length);
    lines.push('SkillsIndexContractViolationCount: '+result.violations.skillsIndexContractViolations.length);
    lines.push('SkillPackContractViolationCount: '+result.violations.skillPackContractViolations.length);
    var keys = Object.keys(result.violations);
    for (var i=0;i<keys.length;i++) {
        var items = result.violations[keys[i]];
        if (items.length>0) {
            lines.push(keys[i]+':');
            for (var j=0;j<items.length;j++) lines.push(' - '+items[j]);
        }
    }
    if (!result.passed) lines.push('Verification failed. Resolve listed issues and rerun.');
    else lines.push('Verification: PASS');
    return lines.join('\n');
}

module.exports = {
    detectCommandsViolations,
    detectCoreRuleViolations,
    detectEntrypointViolations,
    detectManifestContractViolations,
    detectQwenSettingsViolations,
    detectTaskViolations,
    formatVerifyResult,
    parseBooleanLike,
    readVerifyInitAnswers,
    runVerify
};
