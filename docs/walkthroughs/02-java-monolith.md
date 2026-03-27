# Walkthrough: Java Monolith

A Spring Boot monolith with Maven, JUnit 5, and a 3–8 person team using Codex and Gemini.

---

## Before: Project Structure

```
billing-platform/
├── src/
│   ├── main/java/com/acme/billing/
│   │   ├── BillingApplication.java
│   │   ├── controller/
│   │   │   └── InvoiceController.java
│   │   ├── service/
│   │   │   └── InvoiceService.java
│   │   ├── repository/
│   │   │   └── InvoiceRepository.java
│   │   └── model/
│   │       └── Invoice.java
│   ├── main/resources/
│   │   ├── application.yml
│   │   └── db/migration/
│   │       └── V1__init.sql
│   └── test/java/com/acme/billing/
│       └── InvoiceServiceTest.java
├── pom.xml
├── .gitignore
└── README.md
```

---

## Install

### Step 1: Run Setup

```shell
cd billing-platform
octopus setup
```

Init answers for this team:

| # | Question | Answer |
|---|---|---|
| 1 | Assistant response language | `English` |
| 2 | Default response brevity | `detailed` |
| 3 | Source-of-truth entrypoint | `Codex` |
| 4 | Hard no-auto-commit guard | `yes` |
| 5 | Claude full access to orchestrator | `no` |
| 6 | Token economy enabled | `yes` |

### Step 2: Agent Initialization

Provide `Octopus-agent-orchestrator/AGENT_INIT_PROMPT.md` to Codex.

The agent:
1. Reads saved init answers — source-of-truth is Codex, so `AGENTS.md` is the canonical entrypoint.
2. Asks which entrypoint files are active → you answer `AGENTS.md, GEMINI.md`.
3. Runs install and materializes `live/`.
4. Runs `octopus agent-init`.
5. Suggests skill packs — you add `java-spring` and `data-database`.

```shell
octopus skills add java-spring --target-root "."
octopus skills add data-database --target-root "."
```

---

## After: Project Structure

```
billing-platform/
├── src/                              # ← unchanged
├── Octopus-agent-orchestrator/       # ← new: orchestrator bundle
│   ├── bin/octopus.js
│   ├── live/
│   │   ├── config/
│   │   │   ├── paths.json
│   │   │   ├── review-capabilities.json
│   │   │   ├── token-economy.json
│   │   │   ├── output-filters.json
│   │   │   ├── skill-packs.json
│   │   │   └── skills-index.json
│   │   ├── docs/
│   │   │   ├── agent-rules/          # 00-core … 90-skill-catalog
│   │   │   └── project-memory/
│   │   │       ├── context.md
│   │   │       ├── architecture.md
│   │   │       ├── conventions.md
│   │   │       ├── stack.md
│   │   │       └── decisions.md
│   │   ├── skills/
│   │   │   ├── orchestration/
│   │   │   ├── code-review/
│   │   │   ├── db-review/
│   │   │   ├── security-review/
│   │   │   ├── java-spring/          # ← installed pack
│   │   │   ├── data-database/        # ← installed pack
│   │   │   └── …
│   │   └── version.json
│   └── runtime/
│       ├── init-answers.json
│       └── agent-init-state.json
├── AGENTS.md                         # ← canonical entrypoint (source-of-truth: Codex)
├── GEMINI.md                         # ← active bridge (confirmed in agent init)
├── TASK.md                           # ← shared task queue
├── .github/
│   └── agents/
│       ├── orchestrator.md
│       ├── reviewer.md
│       ├── code-review.md
│       ├── db-review.md
│       ├── security-review.md
│       └── …
├── .git/hooks/
│   └── pre-commit                    # ← no-auto-commit guard
├── .gitignore                        # ← managed entries appended
├── pom.xml
└── README.md
```

### Key Points

- `AGENTS.md` is canonical (Codex source-of-truth); `GEMINI.md` is a bridge redirect.
- No `.claude/settings.local.json` — Claude full access was set to `no`.
- The `db-review` skill triggers automatically when `db/migration/` files change.

---

## Example Task Execution

### Create a Task

> Create a task for "Add late-payment fee calculation to InvoiceService".

| ID | Status | Priority | Area | Title | Depth |
|---|---|---|---|---|---|
| T-301 | 🟦 TODO | P1 | backend | Add late-payment fee calculation to InvoiceService | 3 |

This task touches service logic, database queries, and monetary calculations — `depth=3` is appropriate.

### Execute the Task

```
Execute task T-301 depth=3
```

#### Agent Lifecycle

```
 1. Read task + rules                → PLAN_CREATED
 2. Classify changes                 → PREFLIGHT_CLASSIFIED
    octopus gate enter-task-mode --task-id "T-301" --task-summary "Add late-payment fee calculation"
    octopus gate classify-change --use-staged --task-id "T-301" --task-intent "Add late-payment fee calculation"
    Result: FULL_PATH, reviews: [code, db, security]
 3. Implement code + tests           → (working…)
    - InvoiceService.java — new calculateLateFee() method
    - Invoice.java — new lateFeeAmount field
    - V2__add_late_fee.sql — new migration
    - InvoiceServiceTest.java — new test cases for fee calculation
 4. Run compile gate                 → COMPILE_GATE_PASSED ✅
    octopus gate compile-gate --task-id "T-301"
    (Maven build: `mvn compile test` — output filtered by maven profile)
 5. Launch code review               → reviewer spawned
 6. Launch DB review                 → reviewer spawned (triggered by V2__add_late_fee.sql)
 7. Launch security review           → reviewer spawned (monetary calculation path)
 8. Review gate check                → REVIEW_GATE_FAILED ❌
    octopus gate required-reviews-check --task-id "T-301" --code-review-verdict "pass" --db-review-verdict "findings" --security-review-verdict "pass"
    DB reviewer found: missing index on late_fee_amount column
 9. Rework: add index to migration   → REWORK_STARTED
10. Re-run compile gate              → COMPILE_GATE_PASSED ✅
11. Re-run DB review                 → REVIEW_GATE_PASSED ✅
12. Doc impact gate                  → DOC_IMPACT_ASSESSED ✅
13. Completion gate                  → COMPLETION_GATE_PASSED ✅
14. Mark DONE                        → TASK_DONE
```

#### Classify-Change Detail

With `depth=3`, the classify-change gate loads the full rule set and detects:
- `*.java` in `service/` → triggers **code** review (mandatory).
- `db/migration/*.sql` → triggers **db** review (mandatory).
- Monetary field in model → triggers **security** review (mandatory).

Output filters in `live/config/output-filters.json` automatically compact Maven build output — on a green build, the agent sees only a pass summary instead of the full Maven log.

#### Task Timeline

```shell
octopus gate task-events-summary --task-id "T-301"
```

```
Task: T-301
Events: 12
Timeline:
[01] 2026-03-21T14:00:00Z | PLAN_CREATED              | INFO  | actor=orchestrator
[02] 2026-03-21T14:01:00Z | PREFLIGHT_CLASSIFIED      | INFO
[03] 2026-03-21T14:25:00Z | COMPILE_GATE_PASSED       | PASS
[04] 2026-03-21T14:26:00Z | REVIEW_PHASE_STARTED      | INFO
[05] 2026-03-21T14:27:00Z | REVIEW_REQUESTED          | INFO  | actor=code-review
[06] 2026-03-21T14:28:00Z | REVIEW_REQUESTED          | INFO  | actor=db-review
[07] 2026-03-21T14:29:00Z | REVIEW_REQUESTED          | INFO  | actor=security-review
[08] 2026-03-21T14:40:00Z | REVIEW_GATE_FAILED        | FAIL
[09] 2026-03-21T14:41:00Z | REWORK_STARTED            | INFO
[10] 2026-03-21T14:55:00Z | REVIEW_GATE_PASSED        | PASS
[11] 2026-03-21T14:56:00Z | COMPLETION_GATE_PASSED    | PASS
[12] 2026-03-21T14:57:00Z | TASK_DONE                 | PASS
IntegrityStatus: VALID
```

---

## Update Scenario

The team wants to upgrade from one deployed orchestrator version to a newer published version.

### Dry Run First

```shell
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json" --dry-run
```

The dry run shows which files would change without writing anything.

### Apply

```shell
octopus update --target-root "." --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

What happens:
1. Rollback snapshot saved to `runtime/update-rollbacks/`.
2. Bundle synced; `live/` re-materialized with updated rules.
3. `live/docs/project-memory/` is untouched (user-owned).
4. Installed skill packs (`java-spring`, `data-database`) are preserved.
5. `VERSION` updates to the applied version.
6. `octopus verify` runs automatically.

### Roll Back

If a problem surfaces after the update:

```shell
octopus rollback --target-root "."
```

Or roll back to a specific version:

```shell
octopus rollback --target-root "." --to-version "<target-version>" --init-answers-path "Octopus-agent-orchestrator/runtime/init-answers.json"
```

---

## Uninstall

### Interactive

```shell
octopus uninstall --target-root "."
```

Choices:
- Keep `AGENTS.md`? → **no**
- Keep `TASK.md`? → **yes**
- Keep runtime artifacts? → **yes**

### Non-Interactive

```shell
octopus uninstall --target-root "." --no-prompt --keep-primary-entrypoint no --keep-task-file yes --keep-runtime-artifacts no
```

### After Uninstall

```
billing-platform/
├── src/                              # ← unchanged
├── TASK.md                           # ← kept
├── pom.xml
├── .gitignore                        # ← managed entries removed
└── README.md
```

Removed:
- `Octopus-agent-orchestrator/` directory
- `AGENTS.md`, `GEMINI.md`
- `.github/agents/`
- `.git/hooks/pre-commit`
- Managed blocks in `.gitignore`

---

## Tips for Java Projects

- **Output filters**: The `maven` and `gradle` profiles in `live/config/output-filters.json` handle build output compaction automatically.
- **Skill packs**: `java-spring` adds Spring-specific review guidance. Pair with `data-database` if you have Flyway/Liquibase migrations.
- **paths.json**: Add your project-specific source roots if the defaults (`src/main/java`, `src/test/java`) don't match. Trigger patterns for `db/migration/` are already included.
- **Depth selection**: Use `depth=3` for tasks that touch database migrations, security-sensitive code, or cross-module logic. Use `depth=2` for standard feature work.
- **Multi-module Maven**: If you have submodules, ensure the compile gate command in the agent rules points to the correct `mvn` invocation for your root POM.

---

*See also: [docs/work-example.md](../work-example.md) for the generic task lifecycle reference.*
