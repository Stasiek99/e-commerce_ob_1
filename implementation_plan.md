# Implementation Plan: `run-e2e-smoke` Skill

We need to set up the `run-e2e-smoke` skill to automate the Phase 1D 13-step checklist. Following your architecture (`CLOUDE.md`), the skill should bundle natural-language intent (the `SKILL.md`) with deterministic execution (a Playwright script).

## User Review Required

> [!IMPORTANT]
> **Playwright Placement**: Since your `CLOUDE.md` specifies that skills should be "Self-contained", I propose creating a standalone `package.json` inside `.claude/skills/run-e2e-smoke/scripts/` to house Playwright and its dependencies, rather than polluting your main monorepo `package.json`. This keeps the agent's tools completely separate from the application code. Does this sound good to you, or would you prefer Playwright integrated directly into the monorepo root?

> [!IMPORTANT]
> **External Service Verification**: Steps 3 (Google OAuth), 7 (Stripe), and 8 (Resend) involve third-party services. End-to-end testing these usually involves either mocking the third-party response, or using specialized test API keys. Initially, the script will scaffold these as standard Playwright tests, but we will need your test credentials in a `.env` file for the script to run fully against real sandboxes.

## Proposed Changes

### 1. Skill Documentation
#### [NEW] `C:\Users\Administrator\.claude\skills\run-e2e-smoke\SKILL.md`
- Documentation for the agent on when and how to run this skill.
- Instructions to parse Playwright's terminal output.
- Guidance on how to read the Playwright HTML report/traces if a test fails, enabling the agent to visually or programmatically debug the UI failure.

### 2. Deterministic Scripts & Configuration
#### [NEW] `C:\Users\Administrator\.claude\skills\run-e2e-smoke\scripts\package.json`
- Minimal package to install `@playwright/test`, `@types/node`, and `dotenv`.

#### [NEW] `C:\Users\Administrator\.claude\skills\run-e2e-smoke\scripts\playwright.config.ts`
- Playwright configuration tailored for running locally or against staging.
- Configured to output traces and screenshots on failure so the agent can inspect them later.

#### [NEW] `C:\Users\Administrator\.claude\skills\run-e2e-smoke\scripts\tests\smoke.spec.ts`
- The core deterministic script.
- We will scaffold a single, continuous test flow using Playwright's `test.step()` for all 13 items defined in Phase 1D. This ensures that state is preserved across steps (e.g., register -> logout -> login -> cart -> checkout).
- DB verification steps will use a basic Postgres client (or `fetch` to backend APIs) to assert state without relying on Prisma Studio's UI, which is notoriously flaky for automated E2E testing.

## Verification Plan
1. Ensure `npm install` inside the `scripts` directory succeeds.
2. Ensure Playwright browsers can be downloaded (`npx playwright install`).
3. Run the empty/scaffolded test suite using `npx playwright test` to confirm the scaffolding is syntactically correct and the skill is fully ready for implementation details.
