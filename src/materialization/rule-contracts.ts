export interface RuleContractSectionMigration {
    liveRelativePath: string;
    templateRelativePath: string;
    heading: string;
    requiredSnippets: readonly string[];
}

export const TASK_MODE_RULE_SECTION_MIGRATIONS: readonly RuleContractSectionMigration[] = Object.freeze([
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md',
        heading: '### Compile Gate (Mandatory)',
        requiredSnippets: Object.freeze([
            '### Compile Gate (Mandatory)',
            'node Octopus-agent-orchestrator/bin/octopus.js gate compile-gate'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/40-commands.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/40-commands.md',
        heading: '## Agent Gates',
        requiredSnippets: Object.freeze([
            'node Octopus-agent-orchestrator/bin/octopus.js gate enter-task-mode',
            'node Octopus-agent-orchestrator/bin/octopus.js gate load-rule-pack',
            '`classify-change` fails without rule-pack evidence',
            'Compile gate additionally validates post-preflight rule-pack evidence',
            '`required-reviews-check` additionally validates post-preflight rule-pack evidence',
            'Compile gate additionally validates explicit task-mode entry evidence from `enter-task-mode`.',
            '`required-reviews-check` additionally validates explicit task-mode entry evidence (`TASK_MODE_ENTERED`) before review pass can succeed.'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/80-task-workflow.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/80-task-workflow.md',
        heading: '## Mandatory Gate Contract',
        requiredSnippets: Object.freeze([
            'Task-mode entry command must pass before preflight or implementation:',
            'TASK_MODE_ENTERED',
            'Baseline downstream rules must be opened and recorded before preflight:',
            'RULE_PACK_LOADED',
            'After preflight decides `required_reviews.*`, re-run `load-rule-pack --stage "POST_PREFLIGHT" --preflight-path ...`',
            'Compile gate validates post-preflight rule-pack evidence',
            'Review gate command validates task-mode entry evidence (`TASK_MODE_ENTERED`) for the same task id.',
            'Review gate command validates post-preflight rule-pack evidence (`RULE_PACK_LOADED`)',
            'Completion gate validates task-mode entry evidence',
            'HARD STOP: do not skip `load-rule-pack`',
            'HARD STOP: do not skip `enter-task-mode`'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md',
        heading: '## Preflight Gate (Mandatory)',
        requiredSnippets: Object.freeze([
            'Before preflight, enter task mode explicitly:',
            'node Octopus-agent-orchestrator/bin/octopus.js gate enter-task-mode',
            'record the baseline downstream rules that were actually opened',
            'node Octopus-agent-orchestrator/bin/octopus.js gate load-rule-pack',
            'After preflight, re-run `load-rule-pack --stage "POST_PREFLIGHT"`'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md',
        heading: '## Enforcement',
        requiredSnippets: Object.freeze([
            'Missing task-mode entry artifact (`runtime/reviews/<task-id>-task-mode.json`) blocks progression.',
            'Missing rule-pack artifact (`runtime/reviews/<task-id>-rule-pack.json`) blocks progression.',
            'Missing baseline `RULE_PACK_LOADED` blocks preflight.',
            'Missing post-preflight rule-pack proof blocks compile/review/completion.'
        ])
    })
]);
