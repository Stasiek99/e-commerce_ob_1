# CLOUDE.md — Field Notes for Future Claude Instances

Running log of mistakes made in this project. Read this before acting. These are things that looked reasonable but failed.

---

## Experiment Log

### [2026-04-09] Tried to run backend without checking for .env
**What happened:** Ran `pnpm dev:backend`, it compiled fine (exit 0) but NestJS never actually started serving — silently crashed because there was no `.env` file present.  
**Why it was misleading:** `nest start --watch` printed "Found 0 errors. Watching for file changes." which looked like success. No obvious error in the output.  
**What to do instead:** Before starting the backend, always check `ls .env` first. If missing, tell the user they need to create it from `.env.example` before the backend can run. Don't assume the env is configured.

### [2026-04-09] Background task exit code 0 doesn't mean failure
**What happened:** Started backend with `pnpm dev &` in background, checked output after 20 seconds, backend was running and responsive, but task eventually completed with exit 0.  
**Why it was misleading:** Exit code 0 could mean success OR the background shell exited normally after spawning the child process.  
**What to do instead:** After starting a dev server in background, verify it's actually listening with `curl` or check its output logs. Exit code alone isn't reliable for long-running services.

### [2026-04-09] Port conflicts when restarting backend
**What happened:** Tried to restart backend with new credentials, got EADDRINUSE error on port 3000 because old instance was still listening.  
**Why it was misleading:** New process exited with error, but we weren't sure if the old process was still running or if the new one failed.  
**What to do instead:** When restarting a dev server, kill the old process first (or wait a bit), then verify the new one is listening with `curl` before testing endpoints.

### [2026-04-09] InPost ShipX sandbox requires NIP even for testing
**What happened:** Researched InPost ShipX API documentation for sandbox testing.  
**Discovery:** InPost sandbox environment (`sandbox-manager.paczkomaty.pl`) requires filling in company profile data including Tax ID (NIP) before API credentials can be generated — no public demo credentials or anonymous access.  
**Why it matters:** For Phase 0 testing without NIP, mock mode is necessary. Real sandbox testing possible only in Phase 1+ once NIP is available.  
**What to do instead:** Use `INPOST_MOCK_ENABLED=true` flag for Phase 0. Implemented mock shipment creation matching P24 mock pattern. Switch to real sandbox later by registering account + setting flag to false.
