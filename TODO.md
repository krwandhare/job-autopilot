# Project TODO

## In Progress

- Rerun `npm run explorer-agent` whenever the UI changes meaningfully --
  `docs/explorer-agent/site-map.json`/`e2e-test-plan.md` reflect one
  disposable-fixture crawl, not the live app, and nothing regenerates them
  automatically. `Sync jobs`, `Save filters`, `Later`, and the profile resume
  file input from that manual-review queue still have no test coverage
  (only `Sync Gmail leads`, `Import`, `Generate draft`, and resume *upload*
  do so far -- see Completed).
- Run `node scripts/live-check-gmail-sync.mjs --confirm` and `node
  scripts/live-check-linkedin-import.mjs --confirm --url <a real posting>`
  yourself when you want to validate those two routes live -- both refuse to
  do anything without `--confirm` and were only verified to refuse correctly,
  not actually run, since a real run reads your real Gmail inbox / fetches a
  real LinkedIn page and writes real rows into your real database.
- Live-test the submission-guard field-validation audit and consent-phrase
  detection against a real, user-authorized employer form -- only verified
  so far against a synthetic local HTML fixture (native HTML5 constraint
  validation path) in an isolated worktree; the ARIA
  `aria-invalid`/`aria-describedby` detection branch has not been exercised
  against any real posting.
- **Add your own `ANTHROPIC_API_KEY` to `.env.local` to activate LLM
  resume tailoring** -- the pipeline wiring (`lib/llmTailoring.ts`,
  `POST /api/jobs/[id]/resume-variant`) is done and validated, and the job
  detail page now has a "Regenerate with AI" button plus a persisted
  "AI-tailored"/"Deterministic" pill per variant, but with no key configured
  every request still transparently falls back to deterministic (visible now
  as a real blue notice, and forcing "Regenerate with AI" shows a clear 409
  instead of doing nothing). No live Claude API call has been made yet in
  this environment -- verify the actual tailored wording and the violet
  "AI-tailored" pill once a key is added.
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

- `npm run test:resume-artifacts` fails in this sandbox with `Executable
  doesn't exist at .../chromium_headless_shell-1234/...` -- Playwright's
  default `chromium` channel resolves to `chrome-headless-shell`, which
  isn't installed here (only the plain `chromium` build is); unrelated to
  any change in this session. Do not run `playwright install` without
  approval; rerun where the headless-shell binary is available.
- Add an automated test framework, an `npm test` script, and deterministic fixtures for matching, skill extraction, TXT resume parsing, draft generation, and source normalization.
- Add route/database integration coverage using an isolated temporary SQLite database so tests never read or mutate `data/app.db`.
- Make production builds reproducible without requiring a live Google Fonts fetch, then rerun `npm run build`.

## Later

- Add explicit retention and cleanup controls for old resume rows, stored resume files, ad hoc autofill uploads, drafts, and remembered profile answers.
- Add validation and deduplication for source configurations before insertion.
- Add timeouts/size limits for remote LinkedIn page reads and strengthen URL validation while keeping import limited to one user-supplied public posting.
- Add structured observability that reports source/autofill errors without logging resume contents, profile answers, credentials, cookies, or full application pages.
- Add user-visible editing of generated drafts before use; the current job-detail view displays drafts but does not persist edits.
- Add authentication and authorization before any non-local or multi-user deployment.
- Add repeatable, user-authorized browser tests for field classification, native selects, React-style comboboxes, embedded forms, CAPTCHA boundaries, and the guarantee that submit controls are never activated.

## Completed

- Added server-side upload limits and content/type validation for both
  file-upload routes (`lib/uploadValidation.ts`, a shared helper checked
  before either route reads the full file into memory): `POST /api/resume`
  now rejects empty files, files over 10MB, and non-PDF/DOCX/TXT
  extensions with a clean 400 (previously unlimited size, and the only
  extension check happened deep inside `extractResumeText()` after the
  whole file was already buffered). `POST /api/autofill/upload-file`
  rejects empty files, files over 25MB, and a blocklist of
  executable/script extensions (`.exe`, `.sh`, `.js`, `.dll`, ...) -- an
  allowlist isn't appropriate there since that route legitimately attaches
  whatever file type an employer's ATS field asks for (resume, cover
  letter, portfolio, transcript). Extended
  `scripts/test-resume-upload.sh` (empty/oversized/wrong-extension all
  rejected with the exact expected message, and confirmed none of the 3
  rejected uploads left a stray `resumes` row) and added
  `scripts/test-autofill-upload-validation.sh`/`npm run
  test:autofill-upload-validation` (same three rejections, plus confirming
  a plausible non-dangerous attachment like a portfolio PDF is *not*
  rejected by validation, so the guard isn't an accidental resume-only
  allowlist). Lint, strict TypeScript, and the production build all
  passed; both test scripts pass live against a disposable database.
- Fixed the root layout nav (`app/layout.tsx`) wrapping/clipping at a 390px
  viewport: the title wrapped to two lines, "Profile & Filters" broke
  mid-phrase, and "Applications" was clipped off-screen entirely. Compacted
  mobile sizing/gaps, shortened "Profile & Filters" to "Profile" below the
  `sm` breakpoint, and added an `overflow-x-auto` scroll fallback matching
  the dashboard's Action Center pill row. Verified live: `nav.scrollWidth
  === clientWidth` at 390px (fits with no scroll needed), all four links
  still navigate to the correct route, desktop layout unchanged.
- Extended the 2026-07-31 Applications-page `--color-accent`/
  `--color-status-*` token visual language to the rest of the app
  (`app/page.tsx`, `app/autofill/page.tsx`, `app/jobs/[id]/page.tsx`,
  `app/profile/page.tsx`) -- previously only `app/applications/page.tsx`
  actually used the tokens (19 occurrences vs. zero elsewhere). Migrated
  genuine outcome-severity colors only (blocking/error=critical, attention=
  warning, positive=good, in-progress/neutral=accent); left categorical,
  non-outcome colors alone (dashboard's `external_lead`/`watchlist`
  categories, the job detail "AI-tailored" pill) since forcing them onto a
  4-color outcome palette would reduce visual distinguishability rather than
  improve it. Computed real WCAG contrast ratios per swap rather than
  guessing: `status-critical` (~5.22:1) and `accent` (~4.41:1, matching the
  Applications page's own precedent) pass as text color; `status-good`
  (~3.35:1) and especially `status-warning` (~1.84:1) fail outright, so
  those swaps tokenize only background/border/dot and keep the existing
  dark Tailwind text shade -- and no solid white-text button's background
  was swapped to a token that fails white-text contrast at that weight
  (several buttons, e.g. "Approve this variant", "Generate files", deliberately
  kept their darker raw Tailwind shade instead). Before starting, synced with
  Codex's branch per AGENTS.md and confirmed via `git merge-base
  --is-ancestor` that no merge was actually needed -- Codex's work was
  already fully incorporated. Lint, strict TypeScript, and the production
  build passed after every page; each was verified live in headless Chromium
  against a disposable database seeded to exercise every tone (all five
  Action Center statuses, all three Auto-fill status-pill tones, both
  coverage outcomes plus a created draft on job detail, all three evidence
  states on Profile) with screenshots inspected directly and zero console
  errors.
- Surfaced `tailoringMode` and added a "Regenerate with AI" control to the
  resume-variant review UI (`app/jobs/[id]/page.tsx`): the field previously
  only existed in one API response and was never persisted, so it couldn't
  survive a reload -- added a real `tailoring_mode` column to
  `resume_variants` (`lib/db.ts`, idempotent migration for existing
  databases, verified live against a simulated pre-existing DB) and threaded
  it through `createResumeVariant()`/`serializeResumeVariant()`
  (`lib/resumeVariants.ts`). The job detail page now shows a persisted
  "AI-tailored"/"Deterministic" pill per variant and a "Regenerate with AI"
  button that forces `mode: "llm"` (distinct from the default button's
  silent `auto` fallback, which now also surfaces a real notice when it
  falls back instead of being silent). Fixed a real latent bug found while
  wiring the new button: the existing button passed
  `onClick={generateResumeVariant}` directly, which would have silently fed
  React's `MouseEvent` in as the new `mode` parameter -- fixed both call
  sites to `onClick={() => generateResumeVariant(...)}`. Verified live in
  headless Chromium against a disposable database (no `ANTHROPIC_API_KEY`
  configured in this environment): confirmed `tailoringMode: "deterministic"`
  on the default path, a real 409 when forcing `llm` mode, the pill and
  button render correctly, and the 409 surfaces as a clear UI message
  rather than doing nothing. Lint, strict TypeScript, and the production
  build all passed. The `mode: "llm"` success path (a real tailored
  response, violet "AI-tailored" pill) remains unverified pending a real
  API key, per the existing TODO item above.
- Added test coverage for four of explorer-agent's flagged manual-review
  controls, split by actual risk (`Fill`/`Auto-submit` deliberately left
  manual-only, unchanged -- an automated test would submit a real job
  application): `scripts/test-draft-generation.sh`
  (`npm run test:draft-generation`) and `scripts/test-resume-upload.sh`
  (`npm run test:resume-upload`) are real, repeatable route E2E tests against
  a disposable database (the latter uploads the existing synthetic
  `fixtures/resume-tailoring/sample-resume.txt`, never a real resume, per the
  prior incident noted above). `scripts/live-check-gmail-sync.mjs` and
  `scripts/live-check-linkedin-import.mjs` are manual-only Node scripts for
  `Sync Gmail leads`/`Import` (real external side effects against real
  accounts) -- intentionally not wired to any npm script or repeatable
  suite, refuse to run without `--confirm`, and the LinkedIn one requires an
  explicit real `--url` rather than guessing one. Two real bugs found and
  fixed while getting the new tests green: a `curl -f` on an
  intentional-404 check aborted the whole script before its own assertion
  ran, and a macOS `$TMPDIR` double-slash defeated a literal-slash
  disposable-directory check. `npm run lint`, `npx tsc --noEmit`, and
  `npm run build` all passed; both new automated tests verified passing
  live. The two live-check scripts were only verified to correctly refuse
  without `--confirm` -- an actual `--confirm` run against a real Gmail
  inbox/LinkedIn posting is left for the user to trigger deliberately.
- Added a generic post-submit field-validation audit ("submission-guard"):
  `lib/autofill/fieldValidation.ts` detects the first visible invalid
  required field (native HTML5 constraint validation, covering a plain
  `required` consent checkbox with no extra logic, plus the ARIA
  `aria-invalid`/`aria-describedby` pattern) after a submit click that
  didn't confirm and neither known captcha/verification-code/consent-phrase
  pattern matched. Surfaces the exact captured label/message through a new
  `needs_field_fix` UI phase (red banner, mirrors the existing
  verification-code banner) and parks the job in the existing `needs_review`
  queue. Never auto-fills or auto-checks anything. Verified live end-to-end
  in a disposable worktree/temp-DB/dev-server against a self-authored HTML
  fixture with a consent checkbox injected only on submit-click (so the
  initial scan sees it as zero manual fields); confirmed the exact scraped
  error text reached both the API response and the `job_actions` row. Lint
  and strict TypeScript passed.
- Added post-submit consent-checkbox-required detection following the
  verification-code pattern: `lib/autofill/captcha.ts` gained a dedicated
  `consentRequiredPhrases` check distinct from generic bot-detection and
  verification-code phrases; `handleUnconfirmedSubmit()` parks matching jobs
  into `needs_review` (actionType `consent`). Detection/reporting only,
  never auto-checks the box. Lint and strict TypeScript passed.
- Investigated a reported "silent submission instead of visible browser"
  issue: confirmed the autofill browser is already `headless: false` (not
  the cause; the only `headless: true` launch in the codebase is
  unrelated PDF rendering). Assessed the more likely real explanation as
  the compact "Fill"/"Submit" icon row (this session's own earlier
  redesign) being easy to misclick, plus a fast fully-answered auto-submit
  closing the visible window again within seconds. Added a real safety
  gate: `pageIsVisibleForSubmit()` checks `document.visibilityState`
  immediately before the real submit click, calls `page.bringToFront()`
  if not visible (recovers the existing filled-in session instead of
  discarding it), and refuses to click if still not visible. Relabeled
  the button to two-line "Auto-submit" for clarity. Lint, strict
  TypeScript, and the production build passed; a live regression run
  through the real submit flow showed no false-positive blocking.
  **Not fully provable by automation**: two attempts to simulate a real
  "window not visible" state (CDP minimize, cross-window occlusion) both
  failed to produce it in this sandboxed macOS environment (CDP window-
  state control has known macOS limitations) -- recommend manually
  minimizing the real browser window during a live auto-submit run to
  confirm the refusal/recovery behavior in practice.
- Built human-in-the-loop verification-code entry
  (`lib/autofill/verificationCode.ts`, `lib/autofill/filler.ts`,
  `app/api/autofill/verification-code`, `app/autofill/page.tsx`,
  `app/page.tsx`): detection and pausing already existed; added the
  missing pieces -- a dedicated in-app alert with a code input (reached
  live the instant a submit-mode attempt hits the prompt, and also when
  resuming an already-parked `needs_code` job, which previously dead-ended
  at a generic "blocked" banner with no way forward except the real,
  separate browser window), injection via the same proven fill pipeline
  (`data-autofill-id` tagging, `fillMatched`), and an atomic resume that
  re-clicks the real submit control in the same backend call rather than a
  second round trip that would re-trigger the same page-text block check
  (found and fixed that exact bug while wiring this up -- see SESSION.md).
  A 20s background poll on the dashboard surfaces a newly-parked
  `needs_code` job for a user who's just looking at the dashboard, not
  watching `/autofill` live. Verified live end-to-end against a synthetic
  form modeled on the already-live-verified real page text, through a real
  non-headless browser window, with the final `applied` status and
  `applications` row cross-checked directly in the database. Lint, strict
  TypeScript, and the production build all passed.
  **Not yet live-tested against a real employer's verification screen**
  (only a synthetic reconstruction) -- recommended next step before fully
  trusting the auto-locate path; the manual "I entered it directly in the
  browser" fallback covers this in the meantime.
- Fixed a real backend bug in resume-artifact regeneration, found via a
  requested diagnostic log-check rather than assumed:
  `generateResumeArtifacts()` never returned `downloadUrl`/`createdAt`, so
  the POST `/api/resume-variants/[id]/artifacts` route's direct response
  left every artifact's download link `undefined` right after a successful
  generation (only self-healing later via an unrelated GET refresh). Fixed
  by having the route re-read via `getResumeArtifactSummaries()` after
  generation. Also fixed the frontend (`app/jobs/[id]/page.tsx`) to clear
  stale artifacts immediately when regeneration starts (previously old,
  soon-to-be-overwritten download links stayed visible/clickable for the
  whole in-flight window) and to stop discarding the POST response's
  artifacts on partial validation failure. Added console tracing of each
  format's before/after downloadUrl plus an explicit warning for a
  "passed but null URL" contract violation. Overhauled the "Tailored
  resume draft" UI: verified-source/tailored-version cards merged into one
  block per item with a single top-level toggle switch, "Parsing passed"
  became a small green pill next to the filename, and artifact cards
  tightened with a proper button-styled download link. Verified live
  end-to-end (real evidence verification, draft creation, approval,
  generation, and regeneration via actual UI clicks): reproduced the bug's
  warning trace before the fix, confirmed it no longer fires after: lint,
  strict TypeScript, and the production build all passed.
- Optimized the job detail "Resume requirement coverage" section for
  mobile (`app/jobs/[id]/page.tsx`): the always-expanded list of full
  requirement cards is now a bounded, internally-scrolling summary widget
  (one-line rows: priority badge, truncated text, status pill) with an
  "Expand all" bottom-sheet drawer showing the original full-detail cards
  unchanged (reusing the same drawer pattern already built for the
  Profile page's evidence editor). The "Why this score" mentioned/
  not-mentioned skill lists became a compact 2-column pill grid. Because
  the list no longer inline-expands the section, "Refresh analysis" stays
  near the top in practice. Verified live at 390px/1280px in headless
  Chromium with a real analysis run (13 requirements, verified evidence
  via the real API) -- confirmed real bounded scroll
  (scrollHeight 480 > clientHeight 286) and that the drawer shows the
  identical 13 items. Lint, strict TypeScript, and the production build
  all passed.
- Root-caused and fixed the empty "submitted applications" list on the live
  dashboard: 11 real jobs were `status = 'applied'` in the shared database
  with zero matching `applications` rows, because the primary worktree
  (Codex's `feature/codex-work`, which the live server's data directory
  resolves to) never received the 2026-07-31 fix to
  `lib/autofill/filler.ts`'s `startSubmissionWatcher()` that this branch
  already had. Ported the identical fix into the primary worktree
  (left uncommitted there -- not this agent's branch to commit),
  backfilled the 11 missing `applications` rows in the shared live
  database (backed up first; `applied_at` approximated from an older
  backup snapshot boundary and documented as such per row, not silently
  guessed), and set `JOB_AUTOPILOT_DATA_DIR` in this worktree's
  `.env.local` so a plain `npm run dev` here can no longer silently
  diverge onto its own separate local database. Lint, strict TypeScript,
  and the production build all passed in the primary worktree; verified
  live that the join between `jobs` and `applications` is now clean in
  both directions.
- **Needs follow-up (not done by this agent):** review and commit the
  `filler.ts` fix on `feature/codex-work` in the primary worktree
  (`/Users/kamleshwandhare/projects/job-autopilot`) -- currently sitting
  there uncommitted.
- Fixed a reported hydration-mismatch console error on `/applications`
  (the new Sort-by `<select>`, plus the no-response checkbox and follow-up
  date input): added `suppressHydrationWarning`, the same fix already
  applied to form controls on every other page in this repo for
  browser-extension-injected attributes. Lint, strict TypeScript, and the
  production build passed; live-verified the Sort-by select and
  no-response checkbox still function correctly with zero console errors.
- Overhauled the Applications view into an analytical hub
  (`app/applications/page.tsx`, `lib/applications.ts`): a compact
  3-column metric bar with week-over-week trend arrows (Applications,
  Response rate, This week), a visual funnel (Applied/Interview/Offer/
  Rejected % with per-stage sparkline trend lines, all-time percentages
  from new `interview`/`offer`/`rejected` stats fields), a Company/Domain/
  Title grouping segmented control, and a Sort-by (date/status) dropdown --
  all client-side except the new `funnelWeekly` weekly-cohort data
  `getApplicationStats()` now returns (superseding the old `perWeek`
  field). Removed the now-superseded `StatTile`/`WeeklyTrendChart`
  components. Verified live at 390px and 1280px in headless Chromium
  against an 11-application, 7-company, 4-week synthetic dataset --
  hand-verified every trend/funnel delta against the seeded data, and
  confirmed grouping, sorting, and the existing no-response filter all
  work together with zero console errors. Extended
  `scripts/test-applications.mjs` for the new stats fields; lint, strict
  TypeScript, the production build, and `test:applications` all passed.
  Known limitation (inherent to the existing schema, not new): the funnel
  reflects each application's *current* `response_type` only, not a
  historical log of every stage it passed through.
- Redesigned the Auto-fill queue card for mobile scanning
  (`app/autofill/page.tsx`): the detail paragraph block (salary, resume
  attachment, matched/gap skills, responsibilities, qualifications) is now
  hidden by default behind a "Show details" disclosure toggle; the two
  previously separate warning lines (missing resume, skill gaps) collapsed
  into one status pill (`getStatusPill()`, critical/warning/good tones) at
  the card base with the "View job details" link right below it; and the
  four idle-phase action buttons (Fill/Submit/Later/Skip -- all four kept)
  became a dense `grid-cols-4` icon-over-label row. Verified live at 390px
  and 1280px in headless Chromium against a disposable database (real
  fixture resume + a synthetic job with crafted match/skill-gap data and a
  parsed Responsibilities/Qualifications description) -- confirmed the
  collapsed/expanded states, all three pill tones (including live-tested
  "No resume attached" after removing the seeded resume file), and zero
  console errors. Lint, strict TypeScript, and the production build all
  passed.
- Redesigned the Profile page's "Verified career evidence" section and job
  filters for mobile density (`app/profile/page.tsx`): the nested
  card-per-item list is now a dense table-like row list (category label +
  truncated content snippet + compact status dot/label per row), tapping a
  row opens a bottom-sheet modal for status/text editing (Escape-to-close,
  body-scroll-locked, closes only after a real successful save), the job
  filters' text inputs are now a fully-paired 2-column/3-row grid, and
  "Remote only" is a compact `role="switch"` toggle instead of a checkbox.
  Verified live at 390px and 1280px in headless Chromium against a
  disposable database seeded with the repo's real sample resume fixture (9
  extracted evidence rows) -- confirmed the list renders, the sheet opens
  on tap, a status change persists after Save, Escape closes it, and there
  were zero console errors. Lint, strict TypeScript, and the production
  build all passed.
- Redesigned the dashboard's "Needs your attention" Action Center for
  mobile-first productivity (`app/page.tsx`): header status tiles are now a
  horizontal scrollable pill row (wraps on desktop), action cards collapse
  to employer/role/status-badge by default with a per-card accordion toggle
  that reveals "Why you're needed" and the continue action on tap, and
  status badges switched from solid-color to contrast-safe tinted pills.
  Verified live at 390px and 1280px in headless Chromium with a disposable
  seeded database -- confirmed real horizontal scroll on mobile, wrap on
  desktop, working expand/collapse, and zero console errors. Lint, strict
  TypeScript, and the production build all passed. Scoped to this one
  section, not the whole page.
- Wired real LLM resume tailoring into the existing deterministic
  pipeline (`lib/llmTailoring.ts`, `claude-opus-5`, forced strict
  tool-use, no free text): tailors only the free-text evidence kinds
  (summary/experience/project/publication), never the ones already stable
  (skill/education/certification/other) or immutable facts (dates,
  employer, title). `composeVariantItems()`/`createResumeVariant()` accept
  the tailored overrides but are otherwise unchanged; the DOCX/PDF
  renderer and round-trip validation are completely untouched.
  `POST /api/jobs/[id]/resume-variant` gained an optional
  `mode: "auto" | "llm" | "deterministic"` body (auto by default, falls
  back safely without a key). Added `test:llm-tailoring` and extended
  `test:resume-analysis-routes`; lint, strict TypeScript, build, and all
  four relevant test suites passed. Live Claude API call not yet verified
  -- no API key configured in this environment yet.
- Redesigned the Applications page UI (senior UI/UX pass, `app/applications
  /page.tsx` + new `--color-accent`/`--color-status-*` tokens in
  `app/globals.css`): KPI stat tiles with icons, a real "Applications per
  week" bar chart from previously-unused `stats.perWeek` data (hover +
  keyboard-focus tooltips, dataviz-skill-validated accent/de-emphasis
  coloring), status-colored response-type pills (good/warning/critical by
  outcome semantics, accent for in-progress), redesigned application cards
  with initials avatars and clearer hierarchy, and focus-visible rings
  throughout. Verified with a disposable synthetic database (7 varied
  applications) at 1280px and 390px in a real headless browser with zero
  console errors; lint, strict TypeScript, and the production build passed.
- Fixed LinkedIn Gmail-alert job titles/companies displaying literal HTML
  entities (e.g. `&amp;` instead of `&`): LinkedIn's alert-email
  `text/plain` MIME part is generated from the HTML alternative without
  decoding entities, and `lib/sources/gmailLeads.ts` used those lines
  as-is. Exported the existing `decodeEntities()` helper from
  `lib/sources/html.ts` and applied it to the parsed title/company.
  Corrected the one already-affected live row (job 23's title) after
  backing up `data/app.db`. Added a regression case to
  `scripts/test-gmail-leads.mjs`; `npm run test:gmail-leads`,
  `test:action-center`, `test:applications`, lint, strict TypeScript, and
  the production build all passed. Live-verified via a real headless
  browser screenshot of `/applications` showing the decoded title.
- Fixed the Applications page showing 0 applications: the Auto-fill &
  submit background confirmation watcher (`startSubmissionWatcher()` in
  `lib/autofill/filler.ts`) marked jobs `applied` via a direct SQL update
  that bypassed the `createApplication()` hook every other "mark applied"
  path already used, so background-confirmed submissions never got an
  `applications` row. Fixed the watcher to call `createApplication()` the
  same way `PATCH /api/jobs/[id]` does, backfilled the one live job (23)
  already affected (backed up `data/app.db` first, user-approved), and
  verified live in a real headless browser that the page now shows the
  correct total with zero console errors. Lint, strict TypeScript, the
  production build, and `git diff --check` passed.
- Fixed a real dashboard bug found via live E2E: clicking the Action
  Center's "Verification" tile (or Needs Review/External/Drafts/Decisions)
  filtered the job pipeline to that status, but `GET /api/jobs` still
  applied the default `match_score > 0` exclusion even for an explicit
  actionable-status filter, so a job with a zero match score (e.g. one
  resumed directly via `/autofill?jobId=`) silently vanished from the list
  the user just clicked through to -- showing "No jobs yet" right under an
  Action Center card that said the opposite. Fixed by skipping that default
  exclusion whenever the status filter is one of `ACTIONABLE_STATUSES`
  (`lib/actions.ts`), matching `getDashboardActions()`'s existing behavior.
  Added a permanent route E2E regression (`npm run
  test:jobs-status-filter-routes`) covering the fixed case, the unaffected
  general "new" browsing default, and `showAll=1`. Verified live in a real
  headless browser against a disposable data directory (screenshots of
  both the broken and fixed states); lint, strict TypeScript, and a
  production build all passed, plus the full existing test suite except
  the pre-existing environment gap noted below.
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
- Added the vendor-neutral `ship-feature` requirement-to-handoff workflow,
  project adapters for Claude Code and Gemini CLI, the universal
  `SHIP-FEATURE:` trigger, and a personal Codex `$ship-feature` skill with a
  bundled fallback for repositories that do not define their own workflow.
  The ownership-scoped workflow passed guarded integration into
  `integration/concurrent-work`, and the portable skill is also installed in
  the personal Claude skills directory for branch-independent discovery.

- Reconciled Claude's Gmail lead intake and application/response tracking with
  Codex's truthful resume-tailoring stack. Both schema families, job/profile/
  autofill UI behavior, and all test commands are preserved; focused model,
  artifact, route, shared-runtime, queue, integration-automation, lint,
  TypeScript, and production-build checks passed.
- Added consistent experience hierarchy to generated DOCX and PDF resumes:
  employer/date/location rows are bold, role titles are bold italic, and
  accomplishment text remains normal. Both `year - Present` and
  `year - Month year` ranges are covered. Synthetic visual QA and current-job
  round-trip validation passed without changing resume content.
- Made job-specific resume download controls resilient to restored/mobile tab
  state. Artifact reads bypass caches, visible/restored job tabs refresh their
  file summaries, and downloads open separately from the job-detail page.
- Made generated-PDF validation robust to punctuation-glyph normalization for
  multi-word narrative lines while preserving strict matching for short skills
  and values. This removes false missing-line failures without weakening
  content-presence checks into loose keyword matching.
- Separated source-PDF layout reconstruction from generated-artifact
  round-trip extraction, eliminating false PDF validation failures after the
  coordinate-aware parser was introduced.
- Replaced source-order PDF text extraction with coordinate-aware resume
  reconstruction. Wrapped experience bullets are joined, line-break hyphens
  are preserved correctly, side-by-side impact metrics remain separate, and
  parallel education/certification columns keep distinct sections. Added a
  safe Profile repair action that creates a new resume revision instead of
  rewriting prior evidence or approved variants.
- Restored full-resume tailoring for PDF text with letter-spaced headings by
  normalizing section labels and safely reclassifying existing evidence.
  Added one-confirmation verification of all pending resume content while
  preserving rejected records; newly generated variants now include verified
  experience, education, certifications, and other resume sections.
- Added one-confirmation bulk verification for pending skill evidence while
  preserving rejected skills and keeping non-skill career claims under
  individual review. Disposable route coverage confirms the server-side
  boundary.
- Completed truthful per-job resume tailoring across five validated commits:
  verified evidence (`051632b`), deterministic requirement coverage
  (`ddd3a2e`), reviewable approved variants (`b9bd33e`), round-trip-validated
  DOCX/PDF export (`bdb81ac`), and exact-job autofill attachment with master
  fallback (`62fee11`).
- Added the resume-tailoring evidence foundation: immutable master-resume
  source records, deterministic line/skill evidence extraction, explicit
  verify/reject/edit controls, an idempotent API, and isolated model coverage.
  A disposable browser E2E verified synthetic upload, persisted verification,
  zero console errors, and a 390px layout without horizontal overflow.
- Added deterministic job-requirement extraction and stored analysis with
  required/preferred/context classification, evidence-backed coverage, posting
  fingerprint invalidation, a job-detail review surface, isolated model tests,
  and a disposable production-route E2E. Unverified evidence never counts,
  experience duration is not inferred from dates, and the UI does not claim a
  universal ATS score or review probability.
- Added evidence-constrained resume variants with relevance ordering, safe
  punctuation-only normalization, per-item source/after/rationale review,
  include/exclude controls, explicit job-specific approval, stale
  job/resume/evidence rejection, superseded draft history, and approved
  immutability. Isolated model and disposable route E2E checks passed.
- Added ATS-safe single-column DOCX and text-based PDF generation for approved
  variants, conventional headings, preserved contact header, round-trip
  extraction checks for every included item, validated-only downloads, and
  route E2E coverage. Visual PDF QA caught and fixed a transparent-page
  background before acceptance.
- Integrated exact-job resume selection into autofill. The queue previews the
  filename and source, DOCX is preferred unless PDF is explicitly selected,
  missing/stale/mutated artifacts fall back to the master resume, another job
  can never receive the variant, and a failed Playwright attachment is surfaced
  for manual handling.
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
