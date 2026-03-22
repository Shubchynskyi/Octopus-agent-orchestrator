const NODE_BUNDLE_CLI_COMMAND = 'node Octopus-agent-orchestrator/bin/octopus.js';
const NODE_GATE_COMMAND_PREFIX = `${NODE_BUNDLE_CLI_COMMAND} gate`;

const NODE_HUMAN_COMMIT_COMMAND = `${NODE_GATE_COMMAND_PREFIX} human-commit --message "<message>"`;
const NODE_INTERACTIVE_UPDATE_COMMAND = `${NODE_BUNDLE_CLI_COMMAND} update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"`;
const NODE_NON_INTERACTIVE_UPDATE_COMMAND = `${NODE_BUNDLE_CLI_COMMAND} update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt`;

module.exports = {
    NODE_BUNDLE_CLI_COMMAND,
    NODE_GATE_COMMAND_PREFIX,
    NODE_HUMAN_COMMIT_COMMAND,
    NODE_INTERACTIVE_UPDATE_COMMAND,
    NODE_NON_INTERACTIVE_UPDATE_COMMAND
};
