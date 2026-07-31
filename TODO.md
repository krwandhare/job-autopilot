# Project TODO

## In Progress

- **Re-upload the current resume.** Its `file_path` was accidentally
  overwritten during error-handling audit testing (`f56521d`) and had to be
  nulled out rather than left pointing at a fake test file -- the real file
  couldn't be safely recovered. Matching/drafts are unaffected (extracted
  text/skills are untouched); only auto-attaching the actual file during
  autofill's file-upload step needs a fresh upload to restore.
- Decide whether to delete the untracked `data/watch-and-integrate.sh`
  scratch file (abandoned background-merge-watcher, never used).
- Tune the fit-scoring formula in `lib/matching.ts` per user judgment on
  what should weigh more (skills vs. salary vs. location, etc) -- explicitly
  deferred, not started.
- Review and validate the uncommitted workflow improvements: canonical skill aliases and mentioned/not-mentioned wording, removal of inaccurate draft skill-gap claims, Remote-only preferred-location enforcement, Auto-fill skill visibility, user-confirmed `applied`, close-without-marking, failure handling, and unchanged skip behavior.
- Manually verify the new opt-in "Auto-fill & submit" mode against a real, user-authorized test application before relying on it for real submissions -- static checks and a production build passed, but no live ATS run has confirmed the submit-control detection or confirmation logic yet.
- Retest Twilio's location autocomplete, grouped referral-source question, the narrowly allowlisted submit-mode policy acknowledgements, and exact manual-blocker messaging in a visible browser; static checks pass, but the live form has not been rerun after the latest fixes.
- Live-test the unattended queue runner and verification-code recovery against user-authorized forms; confirm uncertain jobs are parked as `needs_review` or `needs_code` and no manual blocker is bypassed.

## Next

- Add an automated test framework, an `npm test` script, and deterministic fixtures for matching, skill extraction, TXT resume parsing, draft generation, and source normalization.
- Add route/database integration coverage using an isolated temporary SQLite database so tests never read or mutate `data/app.db`.
- Make production builds reproducible without requiring a live Google Fonts fetch, then rerun `npm run build`.
- Add server-side upload limits and content/type validation for resume and autofill file uploads.

## Later

- Add explicit retention and cleanup controls for old resume rows, stored resume files, ad hoc autofill uploads, drafts, and remembered profile answers.
- Add validation and deduplication for source configurations before insertion.
- Add timeouts/size limits for remote LinkedIn page reads and strengthen URL validation while keeping import limited to one user-supplied public posting.
- Add structured observability that reports source/autofill errors without logging resume contents, profile answers, credentials, cookies, or full application pages.
- Add user-visible editing of generated drafts before use; the current job-detail view displays drafts but does not persist edits.
- Add authentication and authorization before any non-local or multi-user deployment.
- Add repeatable, user-authorized browser tests for field classification, native selects, React-style comboboxes, embedded forms, CAPTCHA boundaries, and the guarantee that submit controls are never activated.

## Completed

- Extended the error-handling audit to API routes (`f56521d`): ~9 of 20
  routes crashed to an empty 500 on malformed/absent JSON bodies (confirmed
  live), fixed via a shared `lib/apiUtils.ts` helper rather than repeating
  the fix per-route. Also fixed `upload-file`'s formData parsing the same
  way, plus a real "silent false success" bug -- `fillFileField()` always
  returned void/success even when the Playwright file-attach failed
  internally; now returns and threads through an actual `filled` boolean.
  `runFiller`/`submitApplication` in `filler.ts` were reviewed and already
  solidly hardened from earlier session work -- no change needed there.
- Started `scripts/gmail-sync-runner.sh` (30 min interval) against the live
  instance -- both on-demand and scheduled Gmail sync are now actually
  running, not just built. Found and fixed a real bug while starting it:
  the script was committed non-executable (`100644`, "permission denied"
  on launch) -- the other direct-invocation shell scripts were already
  `100755`; this one was missed (`16e607b`). First scheduled tick fired
  immediately and imported 5 more real leads.
- Clarified the Gmail-sync summary message (`b82c514`): the confusing
  "Imported 5 lead(s) from 0 alert email(s)" case (rate limit hit partway
  through the first thread) now gets its own accurate message instead of
  reusing the normal-case template. Live-verified via the dashboard button.
- Gave the app independent Gmail access (no agent session required):
  `lib/gmail.ts` REST client, digest-email parser, shared import/tag helper,
  `POST /api/jobs/sync-gmail`, an on-demand dashboard button, a scheduled-run
  script, and a one-time OAuth setup helper (`0c6a709`). User completed the
  real OAuth flow; a real live sync (button-triggered) imported 5 real leads
  with zero errors.
- Fixed the LinkedIn company-name extraction bug (100% of imports showed
  "Unknown" after LinkedIn stopped serving JSON-LD/og:site_name to
  unauthenticated fetches) via a `topcard__org-name-link` fallback,
  verified against two live pages (`6b260fb`).
- Turned Action Center `external_lead` cards into a real decision UI: direct
  link to the posting, one-click "I applied"/"Not interested" (`4897a00`).
- Audited and fixed missing `res.ok` checks across all four client pages
  (`3128abf`), including two silent-false-success bugs in autofill's answer-
  saving and profile's skill-saving, found via a live bug the user hit
  (misleading "queue empty" message that was actually a stale-claim 409).
  Live-reproduced and confirmed fixed via Playwright.
- Built application tracking as a separate `companies`/`applications`
  schema (three slices: schema+service layer+apply-flow hook `51e1677`,
  response/follow-up UI `1963b4e`, top-fit panel `96b4599`), hooked into all
  three existing "mark applied" paths without per-site instrumentation.
  Found and fixed two real bugs along the way (a non-deterministic sort tie-
  break, and a missing `match_score > 0` filter that was surfacing hard-
  excluded jobs as "top picks"). All three slices e2e-tested live.
- Ran Codex's full test suite alongside this session's new ones (6 total)
  after all of the above landed; confirmed no regressions from touching
  shared files.
- Pushed `feature/claude-autofill` to `origin` at the user's request.
- Guarded-integrated structured blocker outcomes (`0f2c470`) and the disposable
  two-instance route E2E (`606d5d4`) as integration baseline `0a061d2`; lint,
  TypeScript, and production build passed in the trial merge.
- Added and passed a disposable two-server route E2E covering distinct atomic
  claims, cross-owner conflict, release/reclaim, structured action persistence,
  and cleanup without touching the live database.
- Connected autofill start, verification-code, submission-watcher, and
  unattended queue outcomes to privacy-bounded Action Center reasons. Added
  deterministic model and queue-payload checks.
- Added explicit shared runtime paths, a two-server development launcher,
  SQLite busy handling, and expiring atomic autofill job claims. Queue
  reservation/start/finish now enforce owner-safe selection and cleanup;
  isolated two-connection claim/path checks pass.
- Added the Action Center data model, read API, validated action context on job
  status updates, prioritized responsive dashboard summaries/cards, and a
  disposable SQLite model test (`608c42c`); desktop/mobile synthetic browser
  E2E and real route persistence checks passed. Responsive refinements and the
  corrected dynamic-route ownership policy were committed as `263ff85` and
  `6c2f9af`; guarded validation passed and the work was integrated as
  `8aecb65`.
- Created isolated shared-runtime, Codex, Claude, and integration branches and
  sibling feature worktrees; added ownership policies and end-to-end-tested
  fail-closed merge automation (`1f3f9dc`, `b962094`, integrated as `6cd53d0`).
- Added autonomous validated checkpoint-commit policy and dirty-source
  worktree rejection to prevent integration from silently omitting an agent's
  local changes (uncommitted on `feature/shared-runtime`).
- Created the Next.js/React/TypeScript/Tailwind application scaffold (`70dc5b1`).
- Implemented local SQLite persistence and schema initialization.
- Implemented resume upload, PDF/DOCX/TXT extraction, skill detection, and editable filters.
- Implemented Greenhouse, Lever, and optional Adzuna source synchronization plus curated source seeding.
- Implemented one-off LinkedIn URL import without login or bulk crawling.
- Implemented deterministic matching, ranking, match explanations, pagination, and local status filtering.
- Implemented deterministic cover-letter and screening-answer drafts.
- Implemented visible-browser Playwright autofill with remembered answers, file attachment, combobox support, manual-field boundaries, CAPTCHA/load-failure handling, and no automatic submit (`3059f22`).
- Added an opt-in "Auto-fill & submit" mode alongside the original review-only mode, with fallback to review whenever the submit control or a confirmation can't be identified confidently (uncommitted, awaiting live-ATS verification).
- Implemented an explicit user-confirmed “I submitted it” autofill action that records local `applied` status before closing and advancing; closing without marking leaves the job `new` (uncommitted, awaiting review).
- Displayed stored matched and missing skills directly on the Auto-fill queue card (uncommitted, awaiting review).
- Enforced configured preferred locations for Remote-only matching so geographically restricted remote roles do not qualify solely as remote (uncommitted, awaiting review).
- Added conservative canonical skill aliases, clearer mentioned/not-mentioned labels, and removed draft language that treated an unmentioned target skill as a user skill gap (uncommitted, awaiting review).
- Collapsed grouped referral-source checkboxes into one answerable question, kept policy acknowledgements manual with full labels, and made auto-submit refusal messages enumerate the exact blockers (uncommitted, awaiting live retest).
- Added watchlist, verification-code, review, and external-lead workflow statuses; resumable jobs; serialized Playwright actions; guarded success watching; diagnostic inspect/snapshot routes; and an unattended queue runner that parks uncertain jobs (uncommitted, static validation passed).
- Established shared agent, session, workflow, architecture, and roadmap documentation.
- Added GitHub Actions quality checks (`933c4bc`), following the shared-context documentation commit (`d314240`).
- Verified `npm run lint` on 2026-07-29; documented the network-bound Google Fonts build failure.
