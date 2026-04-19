# CLOUDE.md — Agent Workflow & Field Notes

Operating manual for future Claude instances on this project. Read before acting. Two parts:
1. **Skills Architecture** — how work is decomposed and executed.
2. **Experiment Log** — dated record of mistakes. Append on every unexpected failure.

---

## Skills Architecture

Skills bundle **natural-language intent** with **deterministic scripts**. The point: keep probabilistic decision-making out of the execution path. 90% per-step reliability compounds to 59% over 5 steps — push complexity into code so the LLM only handles routing.

### Three layers

**Layer 1 — Skills** (`.claude/skills/<name>/`)
- `SKILL.md` = when to invoke, inputs/outputs, flow.
- `scripts/` = deterministic execution (Node/TS/Python).
- Self-contained. Auto-activate from task context.

**Layer 2 — Orchestration** (the agent)
- Read `SKILL.md`, run bundled scripts in order, handle errors.
- Ask for clarification when intent is ambiguous.
- Update `SKILL.md` when you learn something the next run should know.

**Layer 3 — Shared utilities** (cross-skill code)
- Common helpers (auth, storage, HTTP clients). Used by multiple skills.
- This project's analogue: `backend/src/modules/prisma`, `backend/src/modules/storage`, `frontend/src/app/core`.

Skills for this project will be added in a later step. Do **not** invent or scaffold skills until requested.

---

## Subagent Design-and-Build Loop

For any non-trivial change (new feature, refactor, script):

1. **Write/edit** the code.
2. **Review** — spawn `code-reviewer` subagent on the changed files. It reports issues; it does not fix them.
3. **QA** — spawn `qa` subagent on the code. It generates tests, runs them, reports pass/fail. It does not fix them.
4. **Fix** — the parent agent (you) applies all fixes from review + QA reports.
5. **Ship** — only after review passes and tests pass.

Subagents are **read-only reporters**. All edits happen in the parent.

For research-heavy tasks, spawn `research` first so exploration doesn't pollute the main context.

**Parallel execution:** when reviewing and QA-ing independent files, spawn both in parallel.

---

## Self-Annealing Loop

Errors are signal. When something breaks:
1. Read the error and stack trace — don't paper over it.
2. Fix the script/code and re-test.
3. Update the relevant `SKILL.md` or this file with what you learned.
4. Append a dated entry to the Experiment Log below if the failure was unexpected.

The system gets stronger with every failure that's written down.

---

## File Organization

- `.claude/skills/` — skills (SKILL.md + scripts/). Empty until skills are added.
- `.tmp/` — intermediate files. Never commit.
- `backend/`, `frontend/`, `packages/shared-types/` — monorepo packages.
- `.env` (backend) — secrets. Check it exists before starting any server.
- Deliverables for e-commerce work live in Supabase (images), Postgres (data), Stripe/Resend dashboards (ops) — not in local files.

See [CLAUDE.md](CLAUDE.md) for project-specific context (stack, deployment, Prisma, Stripe, InPost mock mode).

---

## Experiment Log

Append new entries at the top. Format: `### [YYYY-MM-DD] One-line title` → What happened / Why misleading / What to do instead.

### [2026-04-09] InPost ShipX sandbox requires NIP even for testing
**What happened:** Researched InPost ShipX API documentation for sandbox testing.
**Discovery:** InPost sandbox (`sandbox-manager.paczkomaty.pl`) requires company profile data including Tax ID (NIP) before API credentials can be generated — no public demo creds or anonymous access.
**Why it matters:** For Phase 0 testing without NIP, mock mode is necessary. Real sandbox possible only in Phase 1+ once NIP is available.
**What to do instead:** Use `INPOST_MOCK_ENABLED=true` for Phase 0. Switch to real sandbox later by registering the account + flipping the flag.

### [2026-04-09] Port conflicts when restarting backend
**What happened:** Restarted backend with new credentials, got `EADDRINUSE` on port 3000 because the old instance was still listening.
**Why it was misleading:** New process exited with error, but it wasn't clear whether the old one was still running or the new one had failed.
**What to do instead:** When restarting a dev server, kill the old process first (or wait), then verify the new one is listening with `curl` before testing endpoints.

### [2026-04-09] Background task exit code 0 doesn't mean success
**What happened:** Started backend with `pnpm dev &` in background; after 20s it was running and responsive, but the shell task eventually reported exit 0.
**Why it was misleading:** Exit 0 can mean success OR the background shell exited normally after spawning the child.
**What to do instead:** After starting a dev server in the background, verify it's actually listening with `curl` or tail its logs. Exit code alone is not reliable for long-running services.

### [2026-04-09] Tried to run backend without checking for .env
**What happened:** Ran `pnpm dev:backend`; it compiled fine (exit 0) but NestJS never served — silently crashed because no `.env` was present.
**Why it was misleading:** `nest start --watch` printed "Found 0 errors. Watching for file changes." which looked like success.
**What to do instead:** Before starting the backend, check `ls backend/.env` first. If missing, tell the user to create it from `.env.example` before the backend can run. Don't assume the env is configured.
