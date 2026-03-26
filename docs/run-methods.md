# Run Methods

Copy-paste command reference for all common Octopus Agent Orchestrator launch methods.

Current package version source in this repository: `VERSION`.

## 1. Run Directly From Source Tree

Use this when testing the repository itself without packing or installing.

```text
cd D:\Projects\Octopus-agent-orchestrator

node .\bin\octopus.js
node .\bin\octopus.js --help
node .\bin\octopus.js setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
node .\bin\octopus.js status --target-root .
node .\bin\octopus.js agent-init --target-root . --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "AGENTS.md" --project-rules-updated yes --skills-prompted yes
node .\bin\octopus.js doctor --target-root . --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

## 2. Global Install From Published npm Package

Use this for normal day-to-day CLI usage.

```text
npm install -g octopus-agent-orchestrator

octopus
octopus setup
octopus status --target-root .

oao
octopus-agent-orchestrator
```

## 3. Run Through `npx` From Published npm Package

Use this after `npm publish`.
Use this only when you want a temporary run without global install.
Use the package name with `npx`; the shorter `octopus` and `oao` names are CLI aliases after install, not npm package names.

```text
npx -y octopus-agent-orchestrator
npx -y octopus-agent-orchestrator setup
npx -y octopus-agent-orchestrator status --target-root .
```

## 4. Install From Local Repository Folder

Use this to test package behavior without publishing.

```text
mkdir C:\Temp\octopus-folder-test
cd C:\Temp\octopus-folder-test
npm init -y
git init

npm install D:\Projects\Octopus-agent-orchestrator

npx octopus-agent-orchestrator
npx octopus-agent-orchestrator setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
npx octopus-agent-orchestrator status --target-root .
```

## 5. Pack To `.tgz` And Test Like Real npm Artifact

This is the best pre-publish smoke test.

```text
cd D:\Projects\Octopus-agent-orchestrator
npm pack --dry-run
npm pack

mkdir C:\Temp\octopus-npm-test
cd C:\Temp\octopus-npm-test
npm init -y
git init

npm install D:\Projects\Octopus-agent-orchestrator\octopus-agent-orchestrator-<current-version>.tgz

npx octopus-agent-orchestrator
npx octopus-agent-orchestrator setup --target-root . --no-prompt --assistant-language English --assistant-brevity concise --source-of-truth Codex --enforce-no-auto-commit false --claude-orchestrator-full-access false --token-economy-enabled true
npx octopus-agent-orchestrator status --target-root .
```

## 6. Run Local Binary After `npm install`

Useful when you want to avoid `npx`.

```text
.\node_modules\.bin\octopus.cmd
.\node_modules\.bin\oao.cmd
.\node_modules\.bin\octopus-agent-orchestrator.cmd
```

## 7. Global Install From Local `.tgz`

Use this to test the global CLI before publish.

```text
cd D:\Projects\Octopus-agent-orchestrator
npm pack
npm install -g .\octopus-agent-orchestrator-<current-version>.tgz

octopus
octopus setup
octopus status --target-root .
```

## 8. Recommended Local Validation Before Publish

```text
cd D:\Projects\Octopus-agent-orchestrator

node --test "tests/node/**/*.test.ts"
node .\bin\octopus.js gate validate-manifest --manifest-path MANIFEST.md
npm pack --dry-run
```

## 9. Update And Rollback In A Deployed Workspace

```text
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus check-update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --apply --no-prompt
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
octopus update git --target-root "." --repo-url "." --check-only
octopus rollback --target-root "."
```

Notes:
- `check-update` is compare-first.
- `update` applies immediately.
- `update git` uses a git clone source instead of npm; with no extra flags it uses the default GitHub repository.
- `rollback` restores the latest saved rollback snapshot and the matching bundle backup when available.

## 10. After CLI Setup: Agent Handoff

After primary setup, give the agent:

```text
<project-root>\Octopus-agent-orchestrator\AGENT_INIT_PROMPT.md
```

The agent should then:
- validate and normalize `AssistantLanguage`;
- fill project context files;
- optionally use `octopus skills suggest --target-root .` to recommend built-in packs from the compact skills index;
- replace placeholders in `live/docs/agent-rules/40-commands.md`;
- run `octopus agent-init --target-root . --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --active-agent-files "<active-agent-files>" --project-rules-updated yes --skills-prompted yes`;
- only after `agent-init` passes, run `octopus doctor --target-root . --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"`.
