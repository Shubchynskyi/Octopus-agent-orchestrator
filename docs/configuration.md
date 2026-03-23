# Configuration

All configuration files live in `Octopus-agent-orchestrator/live/config/`.

## Config Files Overview

| File | Purpose | Editable? |
|---|---|---|
| `token-economy.json` | Reviewer-context compaction and token savings | Yes |
| `output-filters.json` | Gate output compaction profiles (compile, test, lint, review) | Yes |
| `review-capabilities.json` | Which specialist reviews are enabled | Yes |
| `paths.json` | Preflight classification roots and trigger regexes | Yes |
| `skill-packs.json` | Installed built-in domain packs | Yes, through `octopus skills add/remove` |
| `skills-index.json` | Compact optional-skill discovery index | No, generated from pack manifests |

## Token Economy

Controls reviewer-context compaction and determines how aggressively context is trimmed at different task depths.

**File:** `live/config/token-economy.json`

```json
{
  "enabled": true,
  "enabled_depths": [1, 2],
  "strip_examples": true,
  "strip_code_blocks": true,
  "scoped_diffs": true,
  "compact_reviewer_output": true,
  "fail_tail_lines": 50
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | `true` | Master toggle for reviewer-context token economy |
| `enabled_depths` | `[1, 2]` | Depths at which context compaction applies |
| `strip_examples` | `true` | Remove verbose examples from rule context |
| `strip_code_blocks` | `true` | Compress code-block sections in rules |
| `scoped_diffs` | `true` | Use scoped diff instead of full diff |
| `compact_reviewer_output` | `true` | Apply output-filter profiles to gate output |
| `fail_tail_lines` | `50` | Max lines of compile failure output |

### Depth Behavior

| Depth | Context Scope | Token Economy | Typical Use |
|---|---|---|---|
| `1` | Minimal (core + workflow + touched module) | Full compaction | Small, low-risk, localized tasks |
| `2` | Standard (most rule files + module context) | Full compaction | Default for most tasks |
| `3` | Complete (all rules + cross-module checks) | Gate filtering only | High-risk, cross-cutting changes |

### What Stays Active Regardless of Token Economy

Shared gate output filtering (`output-filters.json`) and `fail_tail_lines` remain active even when `enabled=false` or at `depth=3`. These are independent of reviewer-context scope.

## Output Filters

Controls how gate scripts compress their stdout/stderr output before returning to the agent.

**File:** `live/config/output-filters.json`

Contains profiles for:
- **Compile success/failure** — per build tool (npm, gradle, maven, dotnet, cargo, go, tsc, generic)
- **Test success/failure** — generic test runner patterns
- **Lint success/failure** — generic lint patterns
- **Review gate success/failure** — gate verdict formatting

### Key Mechanisms

| Mechanism | Description |
|---|---|
| `drop_lines_matching` | Regex patterns; matching lines are removed |
| `keep_lines_matching` | Regex patterns; only matching lines are kept |
| `strip_ansi` | Remove ANSI color/control codes |
| `truncate_line_length` | Max characters per line (default: 240) |
| `parser.max_matches` | Max error/warning matches to keep |
| `parser.tail` | Lines from end of output to always include |
| `passthrough_ceiling` | Below this line count, output passes through unfiltered |

Success profiles typically use `drop_lines_matching: ".*"` to drop 100% of output on green builds.

## Review Capabilities

Controls which specialist reviews are enabled for the project.

**File:** `live/config/review-capabilities.json`

```json
{
  "mandatory": ["code", "db", "security", "refactor"],
  "optional": {
    "api": false,
    "test": false,
    "performance": false,
    "infra": false,
    "dependency": false
  }
}
```

Mandatory reviews are always required when preflight detects their triggers. Optional reviews can be enabled per-project.

## Skill Packs

Tracks which built-in domain packs are currently installed in the workspace.

**File:** `live/config/skill-packs.json`

Manage it through the CLI:
- `octopus skills list`
- `octopus skills add <pack-id>`
- `octopus skills remove <pack-id>`
- `octopus skills validate`

This file is runtime state and should normally be changed through the CLI rather than by hand.

## Skills Index

Compact discovery metadata for optional skills.

**File:** `live/config/skills-index.json`

Used by:
- `octopus skills suggest`
- the agent-init specialist-skills recommendation flow

Contract:
- this index is the only file that should be read for first-pass optional-skill discovery;
- after the user selects a pack, installation should only materialize files into `live/skills/**` and must not require reading the full optional `SKILL.md`;
- full optional `SKILL.md` files must stay unopened until a selected skill is actually activated for a task or a hard activation rule requires it;
- the index is generated from pack manifests and should not be edited manually in deployed workspaces.

## Paths Configuration

Controls preflight classification roots and regex triggers for each review type.

**File:** `live/config/paths.json`

Defines:
- **Root directories** for source code classification.
- **Trigger patterns** (regexes) that map file paths to required review types.
- **Sensitive path markers** for security, auth, payment, database, migration, and infrastructure paths.

## Compact Command Hints

Agent rules in `live/docs/agent-rules/40-commands.md` include a **Compact Command Hints** section that teaches agents to use efficient CLI flags. This reduces token consumption on everyday shell commands without any infrastructure changes.

See `template/docs/agent-rules/40-commands.md` section `## Compact Command Hints` for the full reference.
