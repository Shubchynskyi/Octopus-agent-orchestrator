const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findRepoRoot() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'VERSION')) && fs.existsSync(path.join(dir, 'AGENT_INIT_PROMPT.md'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    throw new Error('Cannot find repo root');
}

test('AGENT_INIT_PROMPT requires explicit active-agent-files confirmation', () => {
    const content = fs.readFileSync(path.join(findRepoRoot(), 'AGENT_INIT_PROMPT.md'), 'utf8');
    assert.match(content, /you must ask the user which agent entrypoint files are actively used/i);
    assert.match(content, /Never silently infer or expand `ActiveAgentFiles`\./);
    assert.doesNotMatch(content, /decide yourself whether additional managed entrypoint files are actually needed/i);
});

test('AGENT_INIT_PROMPT promotes CollectedVia to AGENT_INIT_PROMPT on language or agent-file clarification', () => {
    const content = fs.readFileSync(path.join(findRepoRoot(), 'AGENT_INIT_PROMPT.md'), 'utf8');
    assert.match(content, /set `CollectedVia` to `AGENT_INIT_PROMPT\.md` if the agent had to collect one or more missing mandatory answers, clarify `AssistantLanguage`, or ask\/confirm `ActiveAgentFiles`\./);
});

test('AGENT_INIT_PROMPT requires the hard agent-init command before declaring readiness', () => {
    const content = fs.readFileSync(path.join(findRepoRoot(), 'AGENT_INIT_PROMPT.md'), 'utf8');
    assert.match(content, /node Octopus-agent-orchestrator\/bin\/octopus\.js agent-init/);
    assert.match(content, /Never declare the workspace ready until `node Octopus-agent-orchestrator\/bin\/octopus\.js agent-init/i);
});
