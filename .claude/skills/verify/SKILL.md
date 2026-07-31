---
name: verify
description: How to get a running instance of Job Autopilot and drive it for verification.
---

# Verifying Job Autopilot

Single-package Next.js 16 (App Router) app. `npm run build` then `npm run lint`/`tsc` are CI checks, not verification -- always launch and drive the real server.

## Launch

This repo runs as concurrent Claude/Codex worktrees sharing one SQLite database (see AGENTS.md). From this worktree:

```bash
npm run dev:shared -- claude 3003   # or another instance id/port
```

This resolves the primary worktree's `data/` dir via `JOB_AUTOPILOT_DATA_DIR` and sets `JOB_AUTOPILOT_INSTANCE_ID=claude` for atomic job claims. **Only one `next dev` process can run per worktree directory, regardless of port** -- if you need an isolated (non-shared) instance for a test that shouldn't touch real data, stop this one first (`lsof -i :PORT`, kill it), run plain `unset JOB_AUTOPILOT_DATA_DIR JOB_AUTOPILOT_INSTANCE_ID && npx next dev -p PORT` (uses this worktree's own empty `data/`), then restart the shared one afterward.

Wait for readiness with a poll loop (`curl -s -o /dev/null -w "%{http_code}"`), not a fixed sleep.

If you change `lib/db.ts` (schema), the running server's cached DB connection won't pick up new `CREATE TABLE IF NOT EXISTS` statements -- restart the dev server.

## Drive it

- API routes: `curl` directly, e.g. `curl -s -X PATCH localhost:3003/api/jobs/123 -d '{"status":"applied"}'`.
- UI: Playwright (`node -e '...'` with `require("playwright")`, already a dependency), screenshot to `/tmp` and Read it back. `page.locator("article", { hasText: "..." })` / `div.rounded-lg.border.p-4` are the common card patterns across the Action Center and Applications pages.

## This app touches real production data

The shared DB is the user's actual job-search data (real leads, real applications, real Gmail sync). When testing status-changing endpoints:
- **Check a job's current status before PATCHing it for a "happy path" test, not just after.** Don't grab "the first job the API returns" and assume it's safe -- `GET /api/jobs` sorts by match_score/fetched_at, not by status, so the first result can easily be a real `applied` job. Mistakenly overwrote one to `new` this way once; fixing it required checking whether an `applications` row existed (it predated the tracking feature, so it didn't) and restoring the status via direct SQL rather than through the API, since re-PATCHing to `applied` through the app would create a fresh "applied today" tracking record for an application that actually happened earlier.
- Prefer picking a fresh `status=new` job and reverting it (`PATCH status back to "new"`, `DELETE FROM applications WHERE job_id=...`) afterward.
- Check `job_claims` before and after (`SELECT * FROM job_claims`) -- release anything you claimed via `POST /api/autofill/finish {"jobId":...}` so nothing is left locked.
- A **separate `codex` owner may hold active claims concurrently** -- this is expected (Codex works the same live DB in a sibling worktree), not a bug. Never touch a claim you don't own.
- The Gmail sync button (`POST /api/jobs/sync-gmail`) has a real side effect: it imports real leads from the user's actual Gmail. Clicking it during verification is a real sync, not a no-op test.
