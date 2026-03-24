const path = require('node:path');

const { DEFAULT_BUNDLE_NAME } = require('../../core/constants.ts');
const {
    addSkillPack,
    listBuiltinSkillPacks,
    listSkillPacks,
    removeSkillPack,
    suggestSkills,
    validateSkillPacks
} = require('../../runtime/skills.ts');

const {
    normalizePathValue,
    padRight,
    parseOptions,
    printHelp
} = require('./cli-helpers.ts');

const SKILLS_SHARED_DEFINITIONS = {
    '--target-root': { key: 'targetRoot', type: 'string' },
    '--bundle-root': { key: 'bundleRoot', type: 'string' }
};

const SKILLS_SUGGEST_DEFINITIONS = {
    ...SKILLS_SHARED_DEFINITIONS,
    '--task-text': { key: 'taskText', type: 'string' },
    '--changed-path': { key: 'changedPaths', type: 'string[]' },
    '--limit': { key: 'limit', type: 'string' },
    '--pack-limit': { key: 'packLimit', type: 'string' }
};

function resolveBundleRoot(options) {
    const targetRoot = normalizePathValue(options.targetRoot || '.');
    const bundleRoot = options.bundleRoot
        ? normalizePathValue(options.bundleRoot)
        : path.join(targetRoot, DEFAULT_BUNDLE_NAME);
    return { targetRoot, bundleRoot };
}

function buildSkillsListOutput(listing, bundleRoot) {
    const lines = [];
    lines.push('OCTOPUS_SKILLS');
    lines.push('Action: list');
    lines.push(`Bundle: ${bundleRoot}`);
    lines.push(`ConfigPath: ${listing.configPath}`);
    lines.push(`IndexPath: ${listing.indexPath}`);
    lines.push('PackVsSkill: optional pack = installable bundle; skill = live/skills/<skill-id>/ after install');
    lines.push(`BaselineSkills: ${listing.baselineSkillDirectories.length > 0 ? listing.baselineSkillDirectories.join(', ') : 'none'}`);
    lines.push(`InstalledPacks: ${listing.installedPackIds.length > 0 ? listing.installedPackIds.join(', ') : 'none'}`);
    lines.push(`InstalledOptionalSkills: ${listing.installedOptionalSkillDirectories.length > 0 ? listing.installedOptionalSkillDirectories.join(', ') : 'none'}`);
    lines.push(`AvailableLiveSkills: ${listing.liveSkillDirectories.length > 0 ? listing.liveSkillDirectories.join(', ') : 'none'}`);
    lines.push(`CustomSkillDirectories: ${listing.customSkillDirectories.length > 0 ? listing.customSkillDirectories.join(', ') : 'none'}`);
    lines.push('');
    lines.push('Ready Optional Packs');
    const readyPacks = listing.builtinPacks.filter((pack) => pack.implemented !== false);
    if (readyPacks.length === 0) {
        lines.push('  none');
    } else {
        for (const pack of readyPacks) {
            const readySkillLabel = pack.readySkillDirectories.length > 0 ? pack.readySkillDirectories.join(', ') : 'none';
            const collisionNote = pack.collidesWithBaseline ? ` [extends baseline skill ${pack.id}]` : '';
            lines.push(`  ${pack.installed ? '[x]' : '[ ]'} ${padRight(pack.id, 20)} ${pack.label} -> skills=${readySkillLabel}${collisionNote}`);
            lines.push(`      ${pack.description}`);
        }
    }
    const stubPacks = listing.builtinPacks.filter((pack) => pack.implemented === false);
    if (stubPacks.length > 0) {
        lines.push('');
        lines.push('Optional Pack Stubs (Not Recommended Yet)');
        for (const pack of stubPacks) {
            lines.push(`  [ ] ${padRight(pack.id, 20)} ${pack.label} -> placeholder skills=${pack.placeholderSkillDirectories.join(', ') || 'none'}`);
            lines.push(`      ${pack.description}`);
        }
    }
    return lines.join('\n');
}

function buildSkillPackMutationOutput(action, result) {
    const lines = [];
    lines.push('OCTOPUS_SKILLS');
    lines.push(`Action: ${action}`);
    lines.push(`Pack: ${result.packId}`);
    lines.push(`Status: ${result.changed ? 'CHANGED' : 'NO_CHANGE'}`);
    if (result.installedSkillDirectories) {
        lines.push(`InstalledSkillDirectories: ${result.installedSkillDirectories.join(', ')}`);
    }
    if (result.removedSkillDirectories) {
        lines.push(`RemovedSkillDirectories: ${result.removedSkillDirectories.join(', ') || 'none'}`);
    }
    lines.push(`InstalledPacks: ${result.installedPackIds.length > 0 ? result.installedPackIds.join(', ') : 'none'}`);
    lines.push(`ConfigPath: ${result.configPath}`);
    return lines.join('\n');
}

function buildSkillValidationOutput(result, bundleRoot) {
    const lines = [];
    lines.push('OCTOPUS_SKILLS');
    lines.push('Action: validate');
    lines.push(`Bundle: ${bundleRoot}`);
    lines.push(`ConfigPath: ${result.configPath}`);
    lines.push(`IndexPath: ${result.indexPath}`);
    lines.push(`InstalledPacks: ${result.installedPackIds.length > 0 ? result.installedPackIds.join(', ') : 'none'}`);
    lines.push(`IssueCount: ${result.issues.length}`);
    lines.push(`Validation: ${result.passed ? 'PASS' : 'FAIL'}`);
    if (result.issues.length > 0) {
        lines.push('');
        for (const issue of result.issues) {
            lines.push(`- ${issue}`);
        }
    }
    return lines.join('\n');
}

function buildSkillsSuggestOutput(result) {
    const lines = [];
    lines.push('OCTOPUS_SKILLS');
    lines.push('Action: suggest');
    lines.push(`Bundle: ${result.bundleRoot}`);
    lines.push(`TargetRoot: ${result.targetRoot}`);
    lines.push(`IndexPath: ${result.indexPath}`);
    lines.push('PackVsSkill: optional pack = installable bundle; skill = concrete live/skills/<skill-id>/ directory');
    lines.push(`BaselineSkills: ${result.baselineSkillDirectories.length > 0 ? result.baselineSkillDirectories.join(', ') : 'none'}`);
    lines.push(`InstalledPacks: ${result.installedPackIds.length > 0 ? result.installedPackIds.join(', ') : 'none'}`);
    lines.push(`InstalledOptionalSkills: ${result.installedOptionalSkillDirectories.length > 0 ? result.installedOptionalSkillDirectories.join(', ') : 'none'}`);
    lines.push(`AvailableLiveSkills: ${result.liveSkillDirectories.length > 0 ? result.liveSkillDirectories.join(', ') : 'none'}`);
    lines.push(`CustomSkillDirectories: ${result.customSkillDirectories.length > 0 ? result.customSkillDirectories.join(', ') : 'none'}`);
    lines.push(`DetectedStacks: ${result.discovery.detectedStacks.length > 0 ? result.discovery.detectedStacks.join(', ') : 'none'}`);
    lines.push(`TopLevelDirectories: ${result.discovery.topLevelDirectories.length > 0 ? result.discovery.topLevelDirectories.join(', ') : 'none'}`);
    lines.push(`TaskText: ${result.taskText || 'n/a'}`);
    lines.push(`ChangedPaths: ${result.changedPaths.length > 0 ? result.changedPaths.join(', ') : 'none'}`);
    lines.push('');
    lines.push('Relevant Skills Already Available');
    if (result.availableRelevantSkills.length === 0) {
        lines.push('  none');
    } else {
        for (const skill of result.availableRelevantSkills) {
            const reasons = [
                skill.matches.stack_signals.length > 0 ? `stack=${skill.matches.stack_signals.join('|')}` : null,
                skill.matches.task_signals.length > 0 ? `task=${skill.matches.task_signals.join('|')}` : null,
                skill.matches.changed_path_signals.length > 0 ? `changed=${skill.matches.changed_path_signals.join('|')}` : null,
                skill.matches.project_path_signals.length > 0 ? `project=${skill.matches.project_path_signals.join('|')}` : null,
                skill.matches.aliases_or_tags.length > 0 ? `alias=${skill.matches.aliases_or_tags.join('|')}` : null
            ].filter(Boolean).join('; ');
            lines.push(`  ${padRight(skill.id, 28)} already-available pack=${skill.pack}${reasons ? ` ${reasons}` : ''}`);
        }
    }
    lines.push('');
    lines.push('Relevant Optional Packs Already Installed');
    if (result.availableRelevantPacks.length === 0) {
        lines.push('  none');
    } else {
        for (const pack of result.availableRelevantPacks) {
            const collisionNote = pack.collidesWithBaseline ? ` [extends baseline skill ${pack.id}]` : '';
            lines.push(`  [x] ${padRight(pack.id, 22)} ${pack.label} score=${pack.score.toFixed(2)} skills=${pack.skillIds.join(', ')}${collisionNote}`);
            lines.push(`      ${pack.description}`);
        }
    }
    lines.push('');
    lines.push('Suggested Optional Packs To Add');
    if (result.suggestedPacks.length === 0) {
        lines.push('  none');
    } else {
        for (const pack of result.suggestedPacks) {
            const collisionNote = pack.collidesWithBaseline ? ` [extends baseline skill ${pack.id}]` : '';
            lines.push(`  [ ] ${padRight(pack.id, 22)} ${pack.label} score=${pack.score.toFixed(2)} skills=${pack.skillIds.join(', ')}${collisionNote}`);
            lines.push(`      ${pack.description}`);
        }
    }
    lines.push('');
    lines.push('Suggested Skills To Add');
    if (result.suggestedSkills.length === 0) {
        lines.push('  none');
    } else {
        for (const skill of result.suggestedSkills) {
            const reasons = [
                skill.matches.stack_signals.length > 0 ? `stack=${skill.matches.stack_signals.join('|')}` : null,
                skill.matches.task_signals.length > 0 ? `task=${skill.matches.task_signals.join('|')}` : null,
                skill.matches.changed_path_signals.length > 0 ? `changed=${skill.matches.changed_path_signals.join('|')}` : null,
                skill.matches.project_path_signals.length > 0 ? `project=${skill.matches.project_path_signals.join('|')}` : null,
                skill.matches.aliases_or_tags.length > 0 ? `alias=${skill.matches.aliases_or_tags.join('|')}` : null
            ].filter(Boolean).join('; ');
            lines.push(`  ${padRight(skill.id, 28)} score=${skill.score.toFixed(2)} pack=${skill.pack} summary=${skill.summary}${reasons ? ` ${reasons}` : ''}`);
        }
    }
    return lines.join('\n');
}

function handleSkills(commandArgv, packageJson) {
    const firstArg = String(commandArgv[0] || '').trim();
    const hasExplicitSubcommand = firstArg.length > 0 && !firstArg.startsWith('-');
    const subcommand = hasExplicitSubcommand ? firstArg : 'list';
    const subcommandArgv = hasExplicitSubcommand ? commandArgv.slice(1) : commandArgv;
    const optionDefinitions = subcommand === 'suggest'
        ? SKILLS_SUGGEST_DEFINITIONS
        : SKILLS_SHARED_DEFINITIONS;
    const { options, positionals } = parseOptions(subcommandArgv, optionDefinitions, {
        allowPositionals: subcommand === 'add' || subcommand === 'remove',
        maxPositionals: 1
    });

    if (options.help) { printHelp(packageJson); return null; }
    if (options.version) { console.log(packageJson.version); return null; }

    const { bundleRoot } = resolveBundleRoot(options);

    if (subcommand === 'list') {
        const listing = listSkillPacks(bundleRoot);
        console.log(buildSkillsListOutput(listing, bundleRoot));
        return listing;
    }

    if (subcommand === 'validate') {
        const result = validateSkillPacks(bundleRoot);
        console.log(buildSkillValidationOutput(result, bundleRoot));
        return result;
    }

    if (subcommand === 'suggest') {
        const targetRoot = normalizePathValue(options.targetRoot || '.');
        const result = suggestSkills(bundleRoot, targetRoot, {
            taskText: options.taskText || '',
            changedPaths: options.changedPaths || [],
            limit: options.limit,
            packLimit: options.packLimit
        });
        console.log(buildSkillsSuggestOutput(result));
        return result;
    }

    const packId = String(positionals[0] || '').trim();
    if (!packId) {
        throw new Error(`Skill pack id is required for 'skills ${subcommand}'.`);
    }

    if (subcommand === 'add') {
        const result = addSkillPack(bundleRoot, packId);
        console.log(buildSkillPackMutationOutput('add', result));
        return result;
    }

    if (subcommand === 'remove') {
        const result = removeSkillPack(bundleRoot, packId);
        console.log(buildSkillPackMutationOutput('remove', result));
        return result;
    }

    throw new Error(`Unknown skills action: ${subcommand}. Allowed values: list, suggest, add, remove, validate.`);
}

module.exports = {
    SKILLS_SHARED_DEFINITIONS,
    SKILLS_SUGGEST_DEFINITIONS,
    buildSkillPackMutationOutput,
    buildSkillsSuggestOutput,
    buildSkillValidationOutput,
    buildSkillsListOutput,
    handleSkills,
    listBuiltinSkillPacks
};
