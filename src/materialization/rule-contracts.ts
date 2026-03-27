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
            'Review gate command validates task-mode entry evidence (`TASK_MODE_ENTERED`) for the same task id.',
            'Completion gate validates task-mode entry evidence',
            'HARD STOP: do not skip `enter-task-mode`'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md',
        heading: '## Preflight Gate (Mandatory)',
        requiredSnippets: Object.freeze([
            'Before preflight, enter task mode explicitly:',
            'node Octopus-agent-orchestrator/bin/octopus.js gate enter-task-mode'
        ])
    }),
    Object.freeze({
        liveRelativePath: 'Octopus-agent-orchestrator/live/docs/agent-rules/90-skill-catalog.md',
        templateRelativePath: 'Octopus-agent-orchestrator/template/docs/agent-rules/90-skill-catalog.md',
        heading: '## Enforcement',
        requiredSnippets: Object.freeze([
            'Missing task-mode entry artifact (`runtime/reviews/<task-id>-task-mode.json`) blocks progression.'
        ])
    })
]);
