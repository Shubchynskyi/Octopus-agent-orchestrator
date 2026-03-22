# Run Methods

Copy-paste command reference for all common Octopus Agent Orchestrator launch methods.

Current package version in this repository: `1.0.8`.

## 1. Run Directly From Source Tree

Use this when testing the repository itself without packing or installing.

```powershell
cd D:\Projects\Octopus-agent-orchestrator

node .\bin\octopus.js
node .\bin\octopus.js --help
node .\bin\octopus.js setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --active-agent-files "AGENTS.md, CLAUDE.md" --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
node .\bin\octopus.js status --target-root .
node .\bin\octopus.js doctor --target-root .
```

## 2. Run Through `npx` From Published npm Package

Use this after `npm publish`.

```powershell
npx -y octopus-agent-orchestrator
npx -y octopus-agent-orchestrator setup
npx -y octopus-agent-orchestrator status --target-root .
npx -y octopus-agent-orchestrator doctor --target-root .
```

## 3. Install From Local Repository Folder

Use this to test package behavior without publishing.

```powershell
mkdir C:\Temp\octopus-folder-test
cd C:\Temp\octopus-folder-test
npm init -y
git init

npm install D:\Projects\Octopus-agent-orchestrator

npx octopus-agent-orchestrator
npx octopus-agent-orchestrator setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --active-agent-files "AGENTS.md, CLAUDE.md" --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
npx octopus-agent-orchestrator status --target-root .
```

## 4. Pack To `.tgz` And Test Like Real npm Artifact

This is the best pre-publish smoke test.

```powershell
cd D:\Projects\Octopus-agent-orchestrator
npm pack --dry-run
npm pack

mkdir C:\Temp\octopus-npm-test
cd C:\Temp\octopus-npm-test
npm init -y
git init

npm install D:\Projects\Octopus-agent-orchestrator\octopus-agent-orchestrator-1.0.8.tgz

npx octopus-agent-orchestrator
npx octopus-agent-orchestrator setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --active-agent-files "AGENTS.md, CLAUDE.md" --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
npx octopus-agent-orchestrator status --target-root .
npx octopus-agent-orchestrator doctor --target-root .
```

## 5. Run Local Binary After `npm install`

Useful when you want to avoid `npx`.

```powershell
.\node_modules\.bin\octopus.cmd
.\node_modules\.bin\oao.cmd
.\node_modules\.bin\octopus-agent-orchestrator.cmd
```

## 6. Global Install From Published npm Package

Use this when you want plain `octopus` in terminal.

```powershell
npm install -g octopus-agent-orchestrator

octopus
octopus setup
octopus status --target-root .
octopus doctor --target-root .

oao
octopus-agent-orchestrator
```

## 7. Global Install From Local `.tgz`

Use this to test the global CLI before publish.

```powershell
cd D:\Projects\Octopus-agent-orchestrator
npm pack
npm install -g .\octopus-agent-orchestrator-1.0.8.tgz

octopus
octopus setup
octopus status --target-root .
octopus doctor --target-root .
```

## 8. Recommended Local Validation Before Publish

```powershell
cd D:\Projects\Octopus-agent-orchestrator

Invoke-Pester -Path template\scripts\tests\npm-cli-bootstrap.Tests.ps1 -CI
Invoke-Pester -Path template\scripts\tests\node-migration-contract.Tests.ps1 -CI
node .\bin\octopus.js gate validate-manifest --manifest-path MANIFEST.md
npm pack --dry-run
```

## 9. After CLI Setup: Agent Handoff

After primary setup, give the agent:

```text
<project-root>\Octopus-agent-orchestrator\AGENT_INIT_PROMPT.md
```

The agent should then:
- validate and normalize `AssistantLanguage`;
- fill project context files;
- replace placeholders in `live/docs/agent-rules/40-commands.md`;
- run `octopus doctor --target-root .`.
