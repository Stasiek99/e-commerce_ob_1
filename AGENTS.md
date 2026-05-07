# Agent Orchestration Protocol

## Roles

| Role | Model | Responsibility |
|---|---|---|
| **Brain (Orchestrator)** | Claude Sonnet 4.6 | Architecture, security decisions, code review, complex logic, final integration |
| **Muscle (Subagent)** | DeepSeek via local proxy | Boilerplate, unit tests, documentation, isolated refactors |

---

## Invoking the Subagent

Call the bridge script from a Bash tool call:

```powershell
.\subagent.ps1 -Task "Detailed instructions here, including all relevant code snippets"
```

Optional model override (if the proxy advertises a different ID):

```powershell
.\subagent.ps1 -Task "..." -Model "deepseek/deepseek-chat"
```

The script sets `ANTHROPIC_BASE_URL=http://localhost:8082` and `ANTHROPIC_API_KEY=freecc` for that subprocess only — the current Claude Code session is unaffected.

---

## Delegation Rules

### Delegate to the Subagent when the task is:
1. **Repetitive boilerplate** — DTOs, interfaces, Angular component shells, Prisma seed entries
2. **Unit / integration tests** — for functions the Brain has already designed and verified
3. **Inline documentation** — JSDoc, OpenAPI descriptions, README sections
4. **Isolated refactors** — renaming, extracting small pure functions, formatting

### Keep in the Brain when the task requires:
- Security reasoning (auth flows, payment handling, input validation)
- Cross-module architecture decisions
- Complex business logic (order state machine, refund eligibility)
- Reviewing or integrating Subagent output

---

## Workflow

```
Brain receives task
  │
  ├─ Simple / sensitive? → Handle directly
  │
  └─ Delegatable?
       │
       ├─ Prepare context (paste relevant code + clear instructions)
       ├─ Call: .\subagent.ps1 -Task "..."
       ├─ Review output for correctness + security
       └─ Integrate into codebase with Edit / Write tools
```

---

## Operational Constraints

- **Always review** Subagent output before writing it to disk — it has no project context beyond what you pass in the `-Task` string.
- **Self-contain the prompt** — include file paths, relevant types, and expected behavior; the Subagent cannot read the repo.
- **Two-strike rule** — if the Subagent produces wrong output twice on the same task, handle it directly.
- **Security gate** — never let Subagent output touch auth, payment, or webhook code without a line-by-line Brain review.

---

## Example Session Start

```
"Check AGENTS.md. Act as the Orchestrator — use the subagent for tests and boilerplate,
keep architecture and security decisions yourself."
```