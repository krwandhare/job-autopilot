# Session Handoff

## Current project state

Job Autopilot is an implemented local MVP on the `main` branch. The working application includes profile/resume setup, configurable job-source synchronization, one-off LinkedIn URL import, deterministic matching and ranking, deterministic draft generation, local status tracking, and visible-browser assisted form filling. There is no automated test suite, authentication layer, deployment configuration, or verified submission tracking.

The current working tree includes a completed batch of workflow improvements awaiting commit: explicit applied/close/watchlist actions; conservative skill comparison and posting-gap display; Remote-only location enforcement; opt-in guarded submission; grouped-field, autocomplete, CAPTCHA, and verification-code handling; serialized Playwright actions; resumable `needs_code` jobs; additional local workflow statuses; diagnostic inspect/snapshot routes; and an unattended queue runner that parks uncertain jobs rather than guessing. The local workspace also contains ignored runtime artifacts such as the SQLite database, resume uploads, environment configuration, dependencies, Next.js build output, and queue-runner logs/PIDs; they are sensitive or generated and must remain uncommitted.

## Latest completed milestone and Git commit

The latest committed repository milestone is **GitHub Actions quality checks**, committed as:

- `933c4bc1c34872f96b94ffc7d4ced4175c380bc0` (`933c4bc`)
- Commit date: 2026-07-29
- Subject: `ci: add GitHub Actions quality checks`

The preceding documentation milestone is `d314240` (`docs: add shared Claude and Codex project context`). The latest committed application milestone remains `3059f22` (`feat: add job search, profile, and autofill foundation`), preceded by the `70dc5b1` Create Next App scaffold.

## Implemented features

- Upload and parse PDF, DOCX, and TXT resumes.
- Persist extracted resume text, detected skills, and a stored upload path; edit detected skills.
- Configure title, location, remote-only, salary, required-skill, and excluded-company filters.
- Add/remove Greenhouse, Lever, and Adzuna source configurations and seed a curated company list.
- Synchronize and normalize source jobs into SQLite with conflict-based updates.
- Import exactly one manually supplied public LinkedIn job URL.
- Score jobs deterministically, hard-fail disallowed matches to zero, save match reasons, rank results, filter by status, hide/show zero scores, and paginate.
- Review job details and manually manage `new`, `drafted`, `applied`, `rejected`, and `skipped` tracking states.
- Generate and persist template-based cover letters and common screening answers from resume text and match results.
- Select the highest-scoring `new` job for autofill.
- Launch a visible Playwright Chromium session, navigate Lever listing URLs to `/apply`, resolve embedded Greenhouse/Lever forms, scan fields, attach the stored resume, and fill known answers or a generated/stored cover letter.
- Remember profile answers, support native selects and React-style comboboxes, surface missing inputs, and retain manual-only categories.
- Detect visible CAPTCHAs, bot-block pages, common load failures, and disconnected browser sessions.
- Close browser sessions on “Done” and mark explicitly skipped jobs as `skipped`.
- Awaiting review: explicitly mark a job `applied` only after the user confirms they submitted it; close without marking preserves `new`, while a failed status update keeps the browser session open.
- Awaiting review: show stored matched and missing skills directly on the Auto-fill queue card.
- Awaiting review: require Remote-only jobs to match configured preferred locations instead of accepting geographically restricted remote roles worldwide.
- Awaiting review: use boundary-aware canonical skill aliases, relabel results as mentioned/not mentioned in the posting, and stop drafts from treating unmentioned target skills as user skill gaps.
- Awaiting review: added an opt-in "Auto-fill & submit" mode alongside the original "Auto-fill (review)" mode, at the sole user's explicit request for their own single-user instance. `submitApplication()` in `lib/autofill/filler.ts` locates and clicks the real submit control only once every field is filled and no fields require manual judgment; it falls back to leaving the browser open for the human whenever it can't confidently find the submit control, detects a CAPTCHA, or can't confirm the click produced a result. Review mode is unchanged and remains the default.

## Important architecture decisions

- The app is local-first and single-user; it has no authentication.
- SQLite at `data/app.db` is the system of record for app state. WAL mode is enabled and schema setup is lazy/idempotent.
- Resume files remain on local disk under `data/resumes/`; extracted text and skills are stored in SQLite.
- All job sources normalize to a shared `NormalizedJob` structure before scoring and persistence.
- Matching is transparent and deterministic, not ML/LLM-based. Configured hard exclusions force score zero.
- Draft generation is a deterministic template, not an external AI call.
- Source synchronization rescans current source results but does not delete postings absent from a later fetch.
- Job statuses are local user-entered workflow labels and are not synchronized with employer systems.
- Autofill uses a visible, in-memory Playwright session keyed by job ID. It always fills for review; an opt-in per-job "submit" mode additionally clicks the real submit control once nothing needs manual judgment, with fallback to review whenever the submit control or a confirmation can't be identified confidently. Neither mode can prove application completion to the employer -- `applied` is a user-confirmed local status only.
- Sensitive or ambiguous fields and CAPTCHA challenges are manual boundaries.

## Validation already performed

On 2026-07-29:

- `npm run lint` passed with no reported errors after the autofill completion change.
- `npx tsc --noEmit` passed with no reported errors.
- `npm run build` reached the optimized production build but failed because the restricted environment could not fetch Geist and Geist Mono from Google Fonts through `next/font`. No source compilation error was reported before that external-resource failure.
- Repository scope was checked with `git status`; the only application source change is `app/autofill/page.tsx`, accompanied by the required handoff documentation.

Later the same day, after adding the opt-in "Auto-fill & submit" mode (`lib/autofill/filler.ts`'s `submitApplication()`, `app/api/autofill/submit/route.ts`, and `app/autofill/page.tsx` mode UI) plus mobile-hydration (`suppressHydrationWarning`) and `allowedDevOrigins` LAN-access fixes:

- `npm run lint` passed with no reported errors.
- `npx tsc --noEmit` passed with no reported errors.
- `npm run build` completed successfully this time (Google Fonts were reachable), producing `/api/autofill/submit` as a registered dynamic route alongside the existing routes.
- Not verified: an actual live submit-mode run against a real employer ATS form. Only static checks and a production build were run for this change.

After a user-authorized Twilio run exposed grouped-field reporting:

- Diagnosed nine referral-source options being emitted as nine manual blockers instead of one “How did you hear about Twilio?” question.
- Identified the two generic “Acknowledge” blockers as Twilio's Applicant Privacy Policy and Candidate AI Responsible Use Policy agreements.
- Updated grouped checkbox/radio handling to present one answerable question with real options, while acknowledgements/certifications remain manual and retain their full parent question.
- Updated submit-mode refusal text to state that refusal occurred before clicking Submit and enumerate every exact manual blocker.
- `npm run lint`, `npx tsc --noEmit`, and `git diff --check` passed.
- The first sandboxed `npm run build` failed only because Google Fonts were unreachable; the approved network-enabled rerun completed successfully and registered all expected routes.
- A subsequent live Twilio attempt exposed location-autocomplete retries appending to stale input and failing to select “New York, NY, USA.” `fillSearchCombobox()` now clears with real keyboard events, waits for the dynamically attached listbox, and retries progressively shorter city queries while still requiring a real suggestion click. Lint, TypeScript, diff checking, and the network-enabled production build passed; live ATS retest remains required.
- At the user's explicit request, submit mode now automatically checks only the two exact Twilio Applicant Privacy Policy and Candidate AI Responsible Use Policy acknowledgements. The submit confirmation dialog discloses this action; review mode and all unrelated agreements remain manual, and a failed check remains a blocker. Lint, TypeScript, diff checking, and the production build passed; live retest is pending.
- Still required: live Twilio retest after this fix; no submit was triggered during implementation.

On 2026-07-30, after the queue, verification-code, session-serialization, diagnostic-route, and dashboard workflow changes:

- `npm run lint` passed with no reported errors.
- `npx tsc --noEmit` passed with no reported errors.
- `npm run build` completed successfully and registered the new inspect, snapshot, and submit routes.
- `git diff --check` passed.
- No live ATS submission or unattended queue run was performed during this validation.

Later on 2026-07-30, concurrent-agent integration foundations were added on
`feature/shared-runtime`:

- Created `feature/shared-runtime`, `feature/codex-tests`,
  `feature/claude-autofill`, and `integration/concurrent-work` from commit
  `4b88042`.
- Added task ownership manifests and a fail-closed integration command that
  uses disposable worktrees, full validation, and an atomic target-ref update.
- Added an end-to-end harness using disposable Git repositories. Clean
  integration passed, while ownership violations, textual conflicts, and
  validation failures were all rejected without moving the target branch.
- `bash -n scripts/integrate-branch.sh scripts/test-integration-automation.sh`,
  `npm run test:integration-automation`, `npm run lint`,
  `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed.
- The first real-branch trial correctly left the integration ref unchanged
  when Turbopack rejected an external `node_modules` symlink. Dependency reuse
  now creates an in-worktree copy-on-write or hard-linked directory, and the
  E2E harness verifies that layout before the real trial is rerun.
- The corrected real-branch run passed full validation and atomically advanced
  `integration/concurrent-work` to merge commit `6cd53d0`.
- `feature/codex-tests` and `feature/claude-autofill` now start at the validated
  foundation commit `b962094` in sibling `job-autopilot-codex` and
  `job-autopilot-claude` worktrees. Each has an independent copy-on-write
  dependency tree suitable for simultaneous Next.js processes.
- A standing checkpoint policy now authorizes both feature agents to commit
  coherent validated units without repeated user prompting, normally every
  30–90 minutes and before handoff. The guarded integrator rejects any checked
  out source worktree with tracked or untracked changes.
- The expanded five-scenario E2E harness passed: clean merge succeeds; dirty
  source, ownership violation, textual conflict, and failed validation all
  leave the target unchanged. Shell syntax, lint, TypeScript, production build,
  and diff checks also passed.
- The Action Center checkpoint `608c42c` added prioritized manual-action
  summaries/cards, persisted structured reasons, conservative status fallbacks,
  bounded route validation, and a disposable SQLite model test.
- Responsive refinements and the corrected ownership manifest were committed as
  `263ff85` and `6c2f9af`. The guarded integrator then passed lint, TypeScript,
  and the production build and atomically advanced
  `integration/concurrent-work` to `8aecb65`.
- The first Action Center integration attempt was safely rejected because the
  dynamic route brackets in its ownership pattern were interpreted as glob
  syntax. Escaping those brackets fixed the policy without weakening the
  ownership gate.
- A disposable detached checkout with six synthetic jobs verified desktop and
  390px mobile rendering, all five action groups, exact blocker details,
  summary-to-pipeline filtering, and structured reason persistence through the
  real route. No live database, resume, employer page, or application was used.
- The shared-runtime foundation now resolves database and resume storage
  through `JOB_AUTOPILOT_DATA_DIR`. `npm run dev:shared -- <instance> <port>`
  gives Codex and Claude distinct identities while pointing both worktrees at
  the primary worktree's ignored runtime data.
- `job_claims` provides expiring per-job and per-owner SQLite leases. Queue
  selection and specific-job resumption reserve for five minutes, autofill
  start extends the owning runtime's lease to two hours, and finish releases
  only that owner's claim. A second runtime receives HTTP 409 for a currently
  claimed job.
- A disposable SQLite test using two independent connections verified
  deterministic queue separation, conflict refusal, renewal, token/owner-safe
  release, one active job per runtime, expiry takeover, and shared path
  resolution. No live application data was inspected or changed.
- The shared-runtime checkpoint (`ff26804`, policy correction `4b7ed4e`) passed
  guarded lint, TypeScript, and production-build validation and integrated as
  `2046d79`. The dashboard extension-attribute hydration fix (`0b9aada`) passed
  the same gate and integrated as `792076e`.
- Claude's committed Gmail-alert importer and LinkedIn company-name fix were
  semantically merged with `792076e` in a disposable worktree. Targeted tests,
  lint, TypeScript, and the production build passed; the Claude feature
  worktree fast-forwarded to `dd6cb15` while its untracked watcher script was
  deliberately left untouched.
- Autofill start results now park safe structured reasons for unanswered
  questions, manual fields/agreements, browser challenges, load/session
  failures, and review-ready forms. Submit-time verification codes use
  `needs_code`; queue-runner failures add unconfirmed/error context; confirmed
  local completion resolves open actions. Only bounded labels and generic
  reasons are stored, never answers, HTML, cookies, credentials, or payloads.
- The live development database had been opened before the new schema module
  loaded, so its cached connection lacked `job_actions` and `job_claims`. A
  SQLite backup was created before applying only the two idempotent tables and
  indexes already defined by the validated code. Status-only Action Center
  fallbacks then had 129 actionable local rows available; no job content or
  resume data was printed.
- `npm run test:shared-runtime-routes` started two production servers with
  distinct instance IDs against one disposable database. Synthetic route E2E
  verified jobs 1 and 2 were claimed separately, cross-owner resumption
  returned HTTP 409, owner cleanup made a job reclaimable, structured action
  details round-tripped through `/api/jobs/[id]` and `/api/actions`, and all
  claims were released. The temporary processes and database were removed.
- Structured blocker outcomes were committed as `0f2c470`; the reusable
  two-instance route E2E and final handoff updates were committed as
  `606d5d4`. The guarded `action-outcomes` integration passed lint, strict
  TypeScript, and the production build and atomically advanced
  `integration/concurrent-work` to `0a061d2`.

No automated application unit, route-integration, or browser end-to-end tests
exist. Live source synchronization, resume parsing across all supported
formats, and real ATS autofill behavior were not re-run during this
implementation session.

Later on `feature/claude-autofill`, a rate-limited Gmail-alert-to-lead import
script was added (`scripts/import-gmail-leads.mjs`), with a small additive
change to `POST /api/jobs/import-url` (out-of-scope-by-default under
`shared-runtime.allow`, touched here with the user's explicit one-task
exception) so the response includes the upserted row's `id` and `status`.
The script imports LinkedIn job-alert URLs already extracted from Gmail
(never scrapes LinkedIn itself), relies on the existing
`(source, source_job_id)` upsert for dedup, caps imports per run at a
configurable rate limit (default 5), and tags a freshly-created job
`external_lead` so it never enters the `new` autofill queue -- unless the
job already has a further-along status, which is left untouched. `node
--check`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` passed.
Not run live: this worktree's `data/` is empty (no resume/filters/jobs), and
the original worktree currently has Codex's uncommitted shared-runtime work
in progress against real data, so no execution against a live server was
performed this session.

Later still on `feature/claude-autofill`, the Gmail-alert pipeline went from
manual/session-bound to fully independent, and application tracking was
added:

- Fixed a live bug affecting every LinkedIn import: LinkedIn stopped serving
  a JobPosting JSON-LD block or an `og:site_name` meta tag to unauthenticated
  fetches, so `company` silently fell through to `"Unknown"` on 100% of
  imports. `lib/sources/linkedinUrl.ts` now falls back to the page's
  `a.topcard__org-name-link` element (`6b260fb`), verified against two live
  LinkedIn pages before committing.
- `4897a00` turned Action Center `external_lead` cards into an actual
  decision UI: the primary action now opens the real posting URL directly
  (was a redundant link to the same internal page as "Job details"), plus
  one-click "I applied"/"Not interested" buttons that PATCH status inline.
  `lib/actions.ts` gained the `url` field needed for this. E2e-verified via
  Playwright screenshot against 22 real LinkedIn leads pulled from the
  user's actual Gmail alerts (imported into an isolated test database, not
  the live one, specifically to allow this testing without risk).
- `0c6a709` gave the app its own Gmail access, independent of any agent
  session: `lib/gmail.ts` (REST client using a stored OAuth refresh token),
  `lib/sources/gmailLeads.ts` (parses LinkedIn alert digest emails into
  individual leads -- these are multi-job digests, not single postings; an
  earlier manual pass had only taken the first link per email and silently
  dropped the rest), `lib/jobs/importLead.ts` (upsert/tag helper shared with
  the manual URL importer), `app/api/jobs/sync-gmail` (searches unread
  alert-label threads, imports+tags up to a rate limit, only marks a thread
  read once every lead in it has been attempted so a rate-limited cutoff
  never loses jobs), a "Sync Gmail leads" dashboard button,
  `scripts/gmail-sync-runner.sh` for scheduled runs, and
  `scripts/gmail-oauth-setup.mjs` -- a one-time local OAuth consent flow
  helper so the user never hand-crafts a refresh token. The user completed
  that real OAuth flow (Google Cloud project + Desktop-app OAuth client);
  `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN` are live in
  this worktree's untracked `.env.local`. The first real sync (button-
  triggered, not curl) imported 5 real leads with zero errors, confirmed via
  the live Action Center count.
- `3128abf`: while investigating a live bug the user hit (clicking "Resume
  verification" on a `needs_code` job showed "No jobs with status New left"
  instead of the real problem), found the root cause -- a stale job-claim
  lease from an earlier session on a different job was blocking the new
  claim with a 409, but `app/autofill/page.tsx`'s `loadNextJob()` never
  checked `res.ok`, so the error body's missing `job` key was
  misinterpreted as an empty queue. That same missing-`res.ok`-check pattern
  turned out to be widespread across all four client pages, including two
  actually dangerous instances: `answerField`/`answerFileField` in autofill
  treated a failed save as successful and silently advanced the form past
  an answer that was never recorded, and `profile/page.tsx`'s `saveSkills`
  optimistically committed UI state before the PATCH with no rollback on
  failure. Fixed all of them with a consistent pattern (check status,
  surface the real error, never advance past an unpersisted change).
  Live-reproduced the exact triggering scenario via Playwright after the
  fix and confirmed it now shows "This job is currently being handled by
  another local worker." with a Retry button instead of the misleading
  message (screenshot-verified).
- Ran a full live e2e pass afterward: Gmail sync via the real dashboard
  button, the "I applied" quick-action on a real newly-synced lead, and the
  claim-conflict fix, all against the real shared database, with claims
  cleaned up afterward so nothing was left locked.
- Application tracking (a separate `companies`/`applications` schema, per
  explicit direction, rather than folding into `jobs.status`) shipped in
  three slices:
  - `51e1677`: `companies`/`applications` tables (one application per job;
    `jobs` already covers postings, so this only models the apply event
    itself -- when, with which resume, from which path, whether/how the
    employer responded), `lib/applications.ts` service layer, and a hook
    into `PATCH /api/jobs/[id]` -- the single place all three "mark applied"
    paths (autofill, job-detail dropdown, Action Center quick-action)
    already funnel through, so no separate instrumentation was needed per
    call site. Found and fixed a real tie-breaking bug during testing:
    `listApplications` ordered by `applied_at DESC` alone, non-deterministic
    for same-second timestamps (routine with a fast auto-import); added
    `, id DESC` as a secondary sort.
  - `1963b4e`: `PATCH /api/applications/[jobId]` and a new `/applications`
    dashboard page -- stats strip, response-type buttons
    (interview/offer/rejected/ghosted, toggle on/off), a follow-up date
    picker, and a "no response in 14+ days" filter.
  - `96b4599`: a "Top jobs to apply next" panel using the first slice's
    `getTopJobsByFit`. Found and fixed a real bug live: that function had no
    `match_score > 0` filter, and on the real dataset every `new`-status job
    turned out to be score 0 (the session's earlier queue-runner activity
    had already worked through everything with a real score, leaving only
    the hard-excluded remainder). `match_score = 0` is a deliberate
    exclusion in `lib/matching.ts`, not "low fit" -- the rest of the app
    already hides it by default. Fixed the query to match that convention.
  - All three slices were e2e-tested live via Playwright against real (or
    temporary, cleaned-up-afterward) data: real job status transitions
    correctly create/dedupe application rows with the right company/resume
    version/source, response logging and follow-up dates persist and update
    the stats strip immediately, and the top-fit panel correctly shows
    nothing rather than misleadingly listing non-matches.
- Ran the full existing test suite (`test:shared-runtime`,
  `test:shared-runtime-routes`, `test:queue-runner`,
  `test:integration-automation` -- all Codex's -- plus this session's own
  `test:gmail-leads`, `test:action-center`, `test:applications`) after all
  of the above; all six passed, confirming no regressions from touching
  shared files (`lib/db.ts`, both `app/api/jobs/**` routes).
- `feature/claude-autofill` was pushed to `origin` at the user's request
  (new remote branch, upstream tracking set); no PR opened.
- Added two skills for future sessions: `.claude/skills/run-job-autopilot/`
  (build/launch/drive instructions plus a minimal Playwright REPL driver,
  since `chromium-cli` isn't installed here) and `.claude/skills/verify/`
  (operational notes from this session's verification pass). Every command
  in both was actually run; a literal re-verification pass of the first one
  caught a real gap (single-instance-per-directory lock, documented with
  the exact error text) (`e029e06`).
- Started `scripts/gmail-sync-runner.sh` (30 min interval) against the live
  instance -- both on-demand and scheduled Gmail sync now actually run, not
  just built. Found the script had been committed non-executable
  (`100644`), which the other direct-invocation shell scripts weren't;
  fixed (`16e607b`). First scheduled tick fired immediately and imported 5
  more real leads.
- Clarified the Gmail-sync summary message for the rate-limited-mid-thread
  case (`b82c514`), live-verified via the dashboard button.

No automated application unit, route-integration, or browser end-to-end tests
exist. Live source synchronization, resume parsing across all supported
formats, and real ATS autofill behavior were not re-run during this
implementation session.

## Current objective

Continue the application-tracking/Gmail-automation line of work, or address
the open items below, per user direction.

## Blockers

- There is no test framework, fixtures, or `npm test` command (Codex has
  since added several standalone `test:*` scripts outside that gap, but
  there is still no single `npm test` entry point).
- A production build can fail in a network-restricted environment because
  `next/font` fetches Google-hosted Geist assets; not an issue in this
  session's environment.
- Real ATS forms and external source responses are unstable third-party
  dependencies; their current end-to-end behavior is unverified beyond what
  this session's live tests covered.
- "Applied" remains a user-confirmed/system-inferred local status; the app
  has no verified employer receipt or submission evidence.
- The fit-scoring formula itself (skills/title/location overlap in
  `lib/matching.ts`) was not touched this session -- only where its output
  (`match_score`) is filtered/displayed.

## Exact next recommended task

Several independent threads are open, not yet prioritized by the user as of
this handoff:

1. The error-handling audit covered the four client pages only; API route
   handlers and `lib/autofill/filler.ts`'s Playwright internals are
   unaudited.
2. An untracked scratch file, `data/watch-and-integrate.sh` (an abandoned
   background-merge-watcher from earlier in the session, never used since
   `git merge` got blocked by the auto-mode classifier), is still sitting in
   the worktree -- harmless, but the user hasn't said whether to delete it.
3. Fit-scoring formula tuning was explicitly deferred pending the user's
   judgment on what should weigh more (skills vs. salary vs. location, etc).
