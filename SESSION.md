# Session Handoff

## Test coverage for explorer-agent's manual-review queue (continuation of prior session)

Requirement, continued from a prior conversation (recovered via `SESSION.md`/
`TODO.md` since the original session's transcript wasn't accessible here):
generate real test coverage for the items explorer-agent's classifier flagged
as "manual review required" in `docs/explorer-agent/e2e-test-plan.md`, without
weakening what the classifier means or auto-triggering real external side
effects. The prior conversation had already rejected relabeling everything
"safe" and rejected wiring `Fill`/`Auto-submit` into any automated test (both
can submit a real job application for real, exactly what AGENTS.md forbids
outside the two explicit human-driven modes), and settled on a narrower,
user-approved split by actual risk:

- **`Fill` / `Auto-submit`**: left as documented manual-verification steps
  only, unchanged -- not touched by this session, consistent with the prior
  refusal.
- **`Sync Gmail leads` (`POST /api/jobs/sync-gmail`) / `Import` (`POST
  /api/jobs/import-url`, LinkedIn URL import)**: real external side effects
  (a real Gmail inbox read, a real LinkedIn page fetch) but read-oriented, no
  application submission. Asked the user directly whether these should be
  repeatable/re-runnable or occasional-manual-only, since re-running either
  against real accounts on every test run risks duplicate imports/quota
  burn; user chose **occasional, manual-only**. Built
  `scripts/live-check-gmail-sync.mjs` and
  `scripts/live-check-linkedin-import.mjs` -- plain Node scripts, deliberately
  **not** wired to any `npm run test:*` alias or repeatable suite. Both
  refuse to do anything without an explicit `--confirm` flag (verified live:
  both print a clear warning and exit 1 without it), print only the
  privacy-bounded summary fields the routes already return (title/company/
  url/counts, never raw email bodies or full page content), and the LinkedIn
  script requires an explicit `--url` for a real posting the user actually
  wants imported -- it never guesses or defaults a target URL.
- **`Generate draft` (`POST /api/draft/[id]`)**: purely local/deterministic
  (`lib/draft.ts`), no external call, no real submission -- given real
  automated, repeatable route-E2E coverage. New
  `scripts/test-draft-generation.sh` (`npm run test:draft-generation`,
  following the existing `test-jobs-status-filter-routes.sh` disposable-
  server pattern: `npm run start` against a temp `JOB_AUTOPILOT_DATA_DIR`,
  seeded via a direct `better-sqlite3` insert, exercised via `curl`) covers a
  404 for a nonexistent job, a successful generation asserting the job
  title/company and matched skills actually appear in the returned cover
  letter, that the drafts row is actually persisted (not just returned), and
  that generating twice for the same job succeeds rather than erroring.
- **Resume upload (`POST /api/resume`)**: the file input itself handles real
  personal data, but the route can be safely covered by automating the
  upload of a *synthetic* fixture file instead of a real resume -- the exact
  distinction `TODO.md` already calls out from a real prior incident where
  test automation overwrote the live resume's `file_path`. New
  `scripts/test-resume-upload.sh` (`npm run test:resume-upload`) uploads the
  existing synthetic `fixtures/resume-tailoring/sample-resume.txt` fixture
  (already `Jordan Example`/`@example.test` placeholder data, not new) against
  a disposable `JOB_AUTOPILOT_DATA_DIR`, and asserts the response filename,
  detected skills, the persisted `resumes` row, and that the file actually
  landed under the *disposable* `resumes/` directory, not the real one.
- Two real bugs found and fixed while getting these green, not left as
  "known failures": (1) `curl -f` on the two intentional-non-200 status
  checks (`/api/draft/999` expecting 404) made curl itself fail before the
  assertion ever ran, aborting the whole script under `set -euo pipefail`
  every time -- removed `-f` from status-code-only checks, kept it on calls
  that should always succeed. (2) The resume-upload script's disposable-
  directory assertion never matched: macOS's `$TMPDIR` already ends in `/`,
  so `mktemp -d "$TMPDIR/..."` produces a double slash that Node's
  `path.join()` silently normalizes away when writing `file_path`, so a
  literal-slash-count glob comparison against the raw `mktemp` output never
  matched a real (correct) upload. Fixed by canonicalizing `TEST_DATA` via
  `cd "$TEST_DATA" && pwd` immediately after creation.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed --
  confirmed the only lint findings anywhere in the tree are pre-existing,
  in the untracked `.claude/helpers/*` Ruflo scaffolding, unrelated to this
  change. `npm run test:draft-generation` and `npm run test:resume-upload`
  both pass live, not just "should pass."
- **Not yet done, deliberately left for the user**: neither
  `live-check-gmail-sync.mjs` nor `live-check-linkedin-import.mjs` has
  actually been run with `--confirm` -- that performs a real Gmail sync /
  real LinkedIn fetch against real accounts and was correctly left for the
  user to trigger deliberately, not something to run unilaterally while
  building the harness. Only the refusal-without-`--confirm` path was
  verified live.

## Explorer-agent: read-only route/DOM crawler + generated E2E test plan (ship-feature run)

Requirement: a recursive Playwright crawler that maps all reachable routes on
localhost:3000, extracts actionable DOM elements (buttons/inputs/forms) per
route and categorizes their input requirements, and outputs a JSON
state-machine map flagging sensitive-input/complex-state-transition steps for
manual review before generating a final E2E test plan.

Built as a strictly **read-only** reconnaissance tool, not a test executor --
several controls in this app (Start/"Fill" auto-fill, Auto-fill & submit,
Sync, Delete, Save, Generate draft) are real state-mutating actions that
AGENTS.md reserves for explicit user-authorized use, so the crawler only ever
`page.goto`s and reads the DOM; it never clicks, types, or submits anything.

- `lib/explorer/routes.ts`: pure `buildRouteTemplates`/`matchRoutePattern` --
  normalizes concrete crawled paths (`/jobs/17`) to this app's actual
  dynamic-route pattern (`/jobs/[id]`), discovered from the real
  `app/**/page.tsx` and `app/api/**/route.ts` folder structure rather than
  hardcoded, with an explicit `unmatched:<path>` fallback instead of a silent
  wrong match.
- `lib/explorer/classify.ts`: pure `classifyElement()` -- assigns a
  requirement kind (text-input/file-upload/selection/boolean-input/
  action-button/form-submit), a `sensitive` flag (password/file inputs,
  SSN/passport/DOB-style label patterns), and a `flagForReview` + reason
  using a recall-oriented verb heuristic (delete, submit, sync, import,
  upload, save, generate, auto-fill/auto-submit, ...) -- the same
  label/attribute-based classification style already used by
  `lib/autofill/fieldMatcher.ts` for third-party ATS forms, with the same
  fundamental limitation (can't see what an `onClick` handler does, only its
  visible label).
- `scripts/explorer-agent.mjs`: the Playwright BFS crawler. Preflights that
  `--base-url` is reachable (never starts a server itself), discovers this
  app's real route templates from the filesystem, crawls same-origin links
  breadth-first capped at `--max-pages` *distinct route patterns* (not raw
  pages -- every job row collapses to one `/jobs/[id]` visit), and writes
  `docs/explorer-agent/site-map.json` (the state-machine: nodes, edges,
  `unreachedRoutes` coverage-gap list, flat `manualReviewQueue`) plus a
  generated `docs/explorer-agent/e2e-test-plan.md`.
- **Privacy-safe extraction by construction, not by discipline**: the DOM
  extraction inside `page.evaluate` never reads `<a>` link text, input
  `value`s, or `<select>`/`<option>` contents -- all of which carry real
  job/resume data in this app (job title as link text, skill chips, source
  lists). It only records element type/attributes and `<button>`/form-field
  label text, which in this codebase is static JSX copy, never a per-record
  database value. Verified live (see below): the generated output contains
  zero occurrences of the seeded fixture's job title, company, or URL.

Verified live end to end, twice (once before and once after two
classification fixes found by the first real run -- see below), against a
disposable `git worktree` + isolated `JOB_AUTOPILOT_DATA_DIR` + a distinct
port (3099), mirroring the pattern already established in this file's
submission-guard/verification-code entries. `npm install` was required in
the worktree (a symlinked `node_modules` breaks Turbopack's path checks --
"Symlink [project]/node_modules is invalid, it points out of the filesystem
root"). Seeded one clearly-synthetic job row ("Synthetic Fixture Role" /
"Fixture Co" / `https://example.invalid/job/1`) directly via `better-sqlite3`
so `/jobs/[id]` had something real to crawl. The crawl reached all 5 known
page routes (`/`, `/profile`, `/autofill`, `/applications`, `/jobs/[id]`)
with an empty `unreachedRoutes` list, and `grep` for the fixture's title/
company/URL across both output files returned zero matches, confirming the
privacy design holds against a real run, not just in theory.

The first real run caught two genuine classification gaps that the unit
tests, being hand-written, couldn't have exposed on their own -- both fixed
and now covered by regression tests in
`scripts/test-explorer-classify.mjs`:
- `/autofill`'s "Fill" button -- the single most important control to flag,
  since it opens a real Playwright session against an external employer ATS
  -- wasn't matched by any verb pattern on its short visible text. Its
  `title` attribute (`"Auto-fill (review before submit)"`) does say enough,
  so `ExtractedElement` gained a `title` field folded into classification
  (not just visible `label`), fixing this and one other button
  ("Auto-submit") the same way.
- `/jobs/[id]`'s "Generate draft" button (writes a new `drafts` row) wasn't
  flagged -- the pattern list only matched "regenerate", not the plain
  "generate" shown before a draft exists. Broadened to `/generate|reprocess/i`.

Disposable worktree, isolated data dir, and background dev server were all
torn down cleanly afterward (`git worktree remove --force`, `rm -rf` the temp
data dir, killed the background process); `git worktree list` in this
checkout shows only the real Codex and Claude worktrees. `npm run lint`,
`npx tsc --noEmit`, and `npm run build` all pass on the final state.

**Not yet done**: no attempt was made to crawl with `--headed` for a visual
sanity check (headless-only so far); the `manualReviewQueue`/per-route plan
in the committed `docs/explorer-agent/` output reflects the disposable
fixture run above, not the user's real app state -- rerun
`npm run explorer-agent` against a real (or another disposable) instance any
time the UI changes meaningfully, since nothing regenerates it automatically.

## Submission-guard: generic post-submit field-validation audit (ship-feature run)

Requirement: implement a "submission-guard" that runs a field audit before/
around submitting -- verify required inputs including consent checkboxes are
valid, and if any field is empty or triggers a validation error, interrupt
the flow, capture the specific field's error message, and surface it for
manual intervention.

Built on the same session as the prior consent-checkbox-phrase detection
(`isConsentRequired` in `lib/autofill/captcha.ts`, previous entry below) but
generalizes past hardcoded page-text phrases:

- Added `lib/autofill/fieldValidation.ts`'s `findFieldValidationError()`: a
  read-only DOM audit that finds the first visible required input the
  browser has marked invalid, checking native HTML5 constraint validation
  (`:validity`/`.validationMessage` -- this alone covers a plain
  `<input required>` consent checkbox with no extra logic) and the ARIA
  `aria-invalid="true"` + `aria-describedby` pattern some ATSes use instead.
  Never focuses, checks, or corrects anything.
- Wired into `lib/autofill/filler.ts`'s `attemptSubmitClick()` as a new
  fallback tier, after the existing `detectCaptcha()` verification-code/
  consent-phrase check and before the fully generic "couldn't confirm"
  message -- so a specific field/error pair is reported whenever one is
  available. `SubmitResult`'s `unconfirmed` variant gained
  `fieldValidationError?: { label, message }`.
  `handleUnconfirmedSubmit()` parks the job into the existing `needs_review`
  human-in-the-loop queue (actionType `validation`, reasonCode
  `field_validation_error`) rather than adding a new status -- unlike the
  verification-code case, fixing an invalid field/checkbox is a one-click fix
  in the still-open browser window, not something worth a dedicated queue.
- `app/autofill/page.tsx` gained a `needs_field_fix` phase and a red
  validation-error banner (mirroring the existing amber verification-code
  banner) showing the exact captured label/message with "Fixed it in the
  browser -- continue" and "Skip this job" actions. Wired into both
  `maybeAutoSubmit()` and `submitVerificationCodeAndResume()`, since either
  path can hit a newly-revealed invalid field.
- Deliberately did not implement this in `lib/autofill/session.ts` (pure
  browser/lock state, no page-interaction logic) or introduce a new
  `needs_consent`-style status/JSON action schema as an early draft of the
  requirement suggested -- kept the detection and DOM-interaction logic in
  the modules that already own that concern, and reused the existing
  `needs_review` queue for a fix that doesn't need its own lane.

Verified live in a disposable `git worktree` + temporary SQLite DB (this
checkout's own dev server was already running against live production data
on port 3003, so testing happened in isolation, mirroring the prior
verification-code exercise): a self-authored local HTML fixture inserts a
required, unchecked consent checkbox into the DOM only inside the submit
button's click handler (so the initial field scan sees zero manual fields
and submit-mode proceeds to actually click). The full path was confirmed
end to end -- `start` (submit mode) reported zero manual fields, `submit`
returned `fieldValidationError: {label: "I agree to the Terms and
Conditions", message: "Please check this box if you want to proceed."}`,
and the job landed in SQLite as `status = 'needs_review'` with an
unresolved `validation`/`field_validation_error` job_actions row containing
the exact captured text. Lint, strict TypeScript, and the disposable
worktree/DB/dev-server were all torn down cleanly afterward; `git status` in
this checkout is unaffected except for the intended source changes.

**Not yet done**: no automated regression test exists for this path (no test
framework in the repo -- see TODO "Add an automated test framework"); only
manually verified against a synthetic fixture, not a real ATS. The ARIA
`aria-invalid`/`aria-describedby` branch is implemented but has not been
exercised against a real posting that uses that pattern instead of native
HTML5 validation.

## Post-submit consent-checkbox-required detection (ship-feature run)

Requirement: detect a post-submit "please accept the terms to proceed"
style error banner, following the same pattern as the existing
verification-code detection, and surface it for manual handling rather than
a generic unconfirmed-submit failure.

- `lib/autofill/captcha.ts`: added a dedicated `consentRequiredPhrases`
  pattern list (distinct from the generic bot-detection phrases and the
  verification-code phrases) and `isConsentRequired` on `CaptchaCheck`.
- `lib/autofill/filler.ts`: `SubmitResult`'s `unconfirmed` variant gained
  `needsConsent`, propagated from both the pre-click and post-click
  `detectCaptcha()` calls. `handleUnconfirmedSubmit()` parks the job into
  the existing `needs_review` queue (actionType `consent`, reasonCode
  `consent_checkbox_required`) -- no new status/dashboard entry, since (like
  the field-validation-error case documented above) the fix is a one-click
  action in the already-open browser window, not something worth a
  dedicated queue the way `needs_code` is for verification codes.
- Verified with `npx tsc --noEmit` and `npm run lint` only at the time; the
  broader submission-guard work above later exercised the same
  `handleUnconfirmedSubmit()`/`needs_review` path live in a browser and
  confirmed it parks correctly.
- Never auto-checks the box -- detection and reporting only, consistent with
  AGENTS.md's rule that consent/grouped-checkbox fields stay manual.

## Investigated "silent submission instead of visible browser" report (ship-feature run)

Requirement: "act as a senior automation engineer... investigate why the
auto-fill task is triggering a silent submission instead of opening the
visible browser window for manual review" -- check for a headless
default, add an explicit visibility check before submitting, and add a
fallback that opens a new window if the session fails to render.

- **Investigated before assuming the premise was correct.** Checked both
  `chromium.launch()` calls in this codebase: `lib/autofill/session.ts`
  (the one actually used for job-application autofill/submission) is
  already `headless: false` -- there is no code path where autofill runs
  headless. The other call (`lib/resumeArtifacts.ts`, `headless: true`) is
  unrelated: it only renders a static tailored-resume PDF and never
  touches a job application. So the literal "headless mode" premise
  doesn't hold; nothing needed forcing.
- **More likely real explanation, stated as an assessment, not proven
  fact**: this session's own earlier redesign compressed "Auto-fill
  (review)" and "Auto-fill & submit" into a dense 4-icon row with short
  labels ("Fill" / "Submit") sitting close together, mobile-first. "Auto-
  fill & submit" genuinely does auto-click the real submit control by
  design (the documented opt-in escape hatch) -- if a job's fields are
  already fully answered, the whole open→fill→submit→confirm→close cycle
  can finish in a couple of seconds, closing the visible window again
  almost immediately. That's real headed automation, just easy to miss
  or misclick into on a small screen, which plausibly reads as "silent
  submission."
- Implemented the genuinely valuable version of what was asked, mapped
  onto this app's real architecture rather than a false premise:
  - New `pageIsVisibleForSubmit()` in `lib/autofill/filler.ts`: checks
    `document.visibilityState === "visible"` immediately before the real
    submit click in `attemptSubmitClick()`. If not visible, calls
    `page.bringToFront()` (restores the existing filled-in session rather
    than discarding it and forcing a full refill, which a naive
    "relaunch a new window" fallback would do) and re-checks; if still
    not visible, refuses to click and returns `unconfirmed` with a clear
    reason, exactly matching this file's existing "never guess, fall back
    to manual" pattern everywhere else.
  - The existing session-recovery fallback (`getOrCreateSession()` in
    `session.ts`, already discards a disconnected/closed session and
    opens a fresh headed window) already covers requirement 3's literal
    "open a new window if the session fails to render" for the
    genuinely-dead-session case; not duplicated.
  - Relabeled the auto-submit button from "Submit" to two-line
    "Auto-submit" in `app/autofill/page.tsx` for extra clarity against
    "Fill" at a glance, addressing the misclick-risk assessment above.
- **Verification honesty note, not glossed over**: attempted to empirically
  prove the visibility check catches a real "window not visible" case via
  two automated methods -- CDP `Browser.setWindowBounds({windowState:
  "minimized"})` and cross-window occlusion via a second page's
  `bringToFront()`. Neither produced a `"hidden"` `document.visibilityState`
  in this sandboxed macOS environment (confirmed via `Browser.getWindowBounds`
  that the CDP minimize call had literally no effect -- `windowState`
  stayed `"normal"` before and after, a known limitation of CDP window-state
  control on macOS, not evidence against the underlying mechanism, which is
  a standard, long-established web platform API used broadly for exactly
  this purpose). What *was* verified: the check does not produce false
  positives -- confirmed `visibilityState` correctly reports `visible` in
  the normal case, and a full live regression run through the real submit
  flow (synthetic form, real non-headless browser, same technique as the
  prior verification-code session) completed normally with the new check
  in place, cross-checked at the database level (`jobs.status = 'applied'`,
  a real `applications` row). Recommended next step: manually minimize the
  real autofill browser window during a live auto-submit run to confirm
  the refusal/`bringToFront()` behavior in practice, since it could not be
  proven by automation here.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.

## Human-in-the-loop verification-code entry (ship-feature run)

Requirement: "act as a senior automation engineer... integrate a
human-in-the-loop verification step" -- detect an emailed verification
code prompt, pause automation immediately, push a real-time alert with an
input box, and once entered inject it into the form and resume the
submission loop.

Started by investigating what already existed rather than assuming a
blank slate, since this repo already has extensive verification-code
infrastructure (`lib/autofill/captcha.ts`'s live-verified page-text
detection for Twilio/Affirm/MongoDB, a `needs_code` job status, Action
Center surfacing, a background success watcher). Found the actual gaps
were narrower and more specific than "build this from scratch":

- **Detection (req 1) already existed**: `detectCaptcha()`'s
  `isVerificationCode` flag, live-verified against real postings.
- **Pause (req 2) already existed**: `submitApplication()` already
  returns `unconfirmed` and parks the job as `needs_code` without ever
  clicking anything further.
- **Alert + input box (req 3) and inject + resume (req 4) did not
  exist end to end.** The only path back to a parked `needs_code` job was
  the dashboard's "Resume" link, which just re-ran the full fill pipeline
  -- and its leading `detectCaptcha()` check (page-*text*-based) would
  immediately re-report the same block without exposing
  `needsVerificationCode` in that response shape at all, a dead end with
  no way forward except alt-tabbing into the real, separate, non-headless
  Playwright browser window and typing the code there by hand.
- New `lib/autofill/verificationCode.ts`: `findVerificationCodeField()`
  locates the single visible text-like input for the code (label/aria/
  placeholder/attribute heuristics, explicit false-positive exclusions for
  zip/postal/country/promo/coupon/referral/discount "code" fields),
  tagging it with the same `data-autofill-id` attribute `scanFields()`
  uses so the existing, already-proven fill pipeline
  (`fillAnsweredField`/`fillMatched`/`locatorFor`) fills it with zero new
  fill mechanics -- only a new way to find the field. Deliberately
  conservative: returns null (never guesses) unless exactly one candidate
  exists, matching this app's fallback-to-manual default everywhere else.
- **Found and fixed a real architectural bug while wiring the resume
  step**: naively resuming via the full `runStart()`/`submitApplication()`
  pipeline after filling the code would hit the *same* leading
  `detectCaptcha()` text check again -- the "a verification code was sent
  to..." instructional text plausibly stays in the DOM even after the
  field is filled, so it would immediately re-block instead of ever
  clicking submit again, bouncing right back into the code-entry phase.
  Fixed by extracting the click-and-confirm portion of
  `submitApplicationUnsafe()` into a shared `attemptSubmitClick()`, and
  having the new `submitVerificationCode()` call it *directly* -- skipping
  the redundant leading check it just handled by filling the code --
  immediately after a successful fill, so "inject the code" and "resume
  the loop" are one atomic backend action instead of two round trips that
  could re-trigger the same block. Also factored the
  park-as-`needs_code`-on-unconfirmed logic (previously only in
  `submitApplication()`) into a shared `handleUnconfirmedSubmit()` so both
  the original submit path and this new resume path park correctly (e.g.
  if the code was wrong or a second verification step appears).
- `lib/autofill/filler.ts`'s `RunFillerResult`'s `"blocked"` variant
  gained an optional `needsVerificationCode` field, and the early
  `detectCaptcha()` check in `runFillerUnsafe()` now sets it -- fixing the
  dashboard-"Resume"-link dead end above; a subsequent session resuming an
  already-parked job now also reaches the new alert UI instead of a
  generic unrecoverable "blocked" banner.
- New `POST /api/autofill/verification-code` route and
  `submitVerificationCode(jobId, code)`: fills the code and immediately
  re-attempts the submit click, returning `{status: "filled", submit:
  SubmitResult}` (or `field_not_found`/`error`). Deliberately never
  persists the code to `profile_answers` (unlike ordinary answered
  fields, which are remembered for reuse across jobs) -- a one-time code
  has no reuse value and a stale one has no business being offered as a
  remembered answer on a future job's unrelated field.
- `app/autofill/page.tsx`: new `"needs_verification_code"` phase, a
  dedicated amber alert box (code input + "Enter code & continue", a
  "I entered it directly in the browser -- continue" fallback for when
  the field can't be located automatically, and Skip), reached from two
  places -- `runStart()`'s blocked-with-code branch (the resume-from-
  dashboard path) and `maybeAutoSubmit()`'s needsVerificationCode branch
  (the live in-session path, the one this request's "real-time" framing
  mainly describes: the user is already watching this exact page when
  their own submit-mode attempt hits the code prompt, so transitioning
  phase in place *is* the real-time alert, no polling needed for that
  case). `startFilling()` was split into a thin confirm-dialog wrapper
  and a reusable `runStart()` core so resuming after code entry doesn't
  re-show the "this will auto-submit" confirm dialog the user already
  answered once for this job.
- `app/page.tsx`: added a 20-second background poll of `/api/actions`
  (only while the tab is visible) so a job parked as `needs_code` by an
  unattended process while the user is just looking at the dashboard --
  not watching `/autofill` live -- also surfaces without a manual
  "Refresh actions" click. The closest a local, single-process,
  single-user app gets to a real push without adding a websocket/SSE
  layer for it.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- **Verified live, end to end, through the real app (not mocked), with a
  real non-headless browser window** (confirmed launchable in this
  environment first): built a synthetic local HTTP-served application-form
  page modeled on `captcha.ts`'s live-verified real page text ("a
  verification code was sent to..."), seeded a job pointing at it, and
  drove the actual webapp UI (a separate headless Playwright browser
  driving the Next.js frontend, which itself drives the app's own
  non-headless Playwright session server-side -- the same architecture a
  real user's browser + this app's real backend would have) through: click
  Submit → confirm dialog → the new "Verification code needed" alert
  appeared with the exact live-verified detection reason text → typed a
  code → "Enter code & continue" → resumed, clicked the real synthetic
  submit control again, detected the "Thank you for applying" confirmation
  → marked Applied → loaded the next job → correctly reported the queue
  empty (single-job queue). Cross-checked directly against the database
  afterward, not just the UI: `jobs.status = 'applied'` and a real
  `applications` row (`source: autofill_submit`) existed. Zero console/page
  errors throughout. Temporary servers (app + synthetic form) and all
  scripts were removed afterward; the app's own browser session had
  already closed itself cleanly through the normal finish flow before
  cleanup ran.
- **Known limitation, stated plainly rather than glossed over**: the new
  `findVerificationCodeField()` locator strategies are verified against a
  synthetic reconstruction of the real, live-verified page text, not
  against an actual live employer verification screen (none was available
  to test against this session) -- a live retest against a real Greenhouse/
  Twilio/Affirm/MongoDB verification prompt remains the recommended next
  step before fully trusting the auto-locate path in production, consistent
  with how every other not-yet-live-verified autofill heuristic in this
  codebase is flagged. The manual "I entered it directly in the browser"
  fallback exists specifically so this doesn't become a dead end if the
  heuristic misses on a real form.

## Tailored resume draft: download state-management fix + UI overhaul (ship-feature run)

Requirement (dual persona): as a senior backend engineer, debug the
download button's state management -- ensure regenerate-files triggers a
clean UI reset, only re-enable the button once parsing completes, and add
a log-check to trace stale/null download URLs post-regeneration. As a
senior UI engineer, overhaul the "Tailored resume draft" section: merge
the verified-source/tailored-version cards into one block with a
top-level toggle, turn "Parsing passed" into a small green pill next to
the filename, and keep the layout tight so the download button stays
visible.

- **Found a real, pre-existing backend bug via the requested log-check,
  not a hypothetical one.** `generateResumeArtifacts()`
  (`lib/resumeArtifacts.ts`) returns
  `{format, filename, validationStatus, validation}` -- it never included
  `downloadUrl` or `createdAt`. The POST
  `/api/resume-variants/[id]/artifacts` route returned that raw shape
  directly as the response body. The frontend's `ResumeArtifact` type
  claims both fields are always present (TypeScript couldn't catch this --
  `res.json()` is untyped, so the mismatch was invisible at compile time),
  so on the *original* success path (all formats pass first try),
  `setResumeArtifacts(data.artifacts)` populated state with
  `downloadUrl: undefined` for every artifact -- no working download link
  right after a successful "Generate files" click, until something
  unrelated (a tab-visibility refresh, navigating away and back) happened
  to trigger `loadArtifacts()`, which *does* build the correct shape via
  `getResumeArtifactSummaries()`. That incidental self-healing masked the
  bug in normal use. Fixed at the source: the POST route now re-reads via
  `getResumeArtifactSummaries(db, variantId)` after generation, for both
  the 200 (all passed) and 422 (partial failure) responses, so the
  response is always correctly shaped -- confirmed by first reproducing
  the bug live via the new log-check (a `console.warn` fired for both
  formats: "reports passed but downloadUrl is null"), then confirming
  after the fix that the exact same warning no longer fires, only the
  informational before/after trace line.
- `generateArtifacts()` in `app/jobs/[id]/page.tsx`: `setResumeArtifacts([])`
  now runs immediately when regeneration starts, before the fetch -- the
  previous code left the *old* artifacts (including their downloadUrls)
  visible and clickable for the entire in-flight window, which matters
  because regeneration overwrites the same deterministic on-disk file path
  each time (not timestamped), so a stale link during that window could
  point at a file mid-rewrite. The trigger button itself was already only
  re-enabled in `finally` (after parsing/validation genuinely completes,
  success or failure) -- that part wasn't broken, just left as-is and
  reconfirmed live. Also stopped discarding the POST response's
  `data.artifacts` on the partial-failure (422) path and re-fetching via a
  separate GET -- the route already persists and returns the fresh state
  before responding, so applying `data.artifacts` directly (now correctly
  shaped per the backend fix) removes an unnecessary round trip; the GET
  fallback (`loadArtifacts()`) is kept only for the genuine
  no-attempt-made case (variant not approved, no included evidence, bad
  header -- nothing on disk changed, so restore rather than assume empty).
  Added `console.info`/`console.warn` tracing of each format's
  before/after `downloadUrl` and an explicit warning when a "passed"
  artifact has a null URL -- the literal "log-check" asked for, which is
  what surfaced the real bug above.
- UI: the four-line `grid-cols-2` "Verified source"/"Tailored version"
  cards per item became one block, with a single top-level `role="switch"`
  toggle (reusing the exact toggle sizing already established on the
  Profile page's "Remote only" control) above the whole items list --
  toggling flips every item's displayed text between source and tailored
  simultaneously, not per item. "Parsing passed"/"Validation failed" moved
  from a top-row label next to the format name to a small
  dot+text rounded-full pill directly beside the filename (green for
  passed, red for failed -- the request only specified green for the
  passed case, red for failed is a direct, low-risk extension of the same
  pill treatment, not a new color choice). Artifact cards tightened
  (`p-3`→`p-2.5`, fewer intermediate margins) and the download link
  restyled from a plain underlined text link into a small solid button, so
  it reads as a clear, always-visible primary action rather than something
  that could be scrolled past.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium against a disposable database driven
  through the *real* end-to-end flow via actual UI clicks (not mocked):
  extracted and bulk-verified evidence through the real API, clicked
  "Create tailored draft", toggled source/tailored on an item with a
  genuine difference ("...Present." vs "...Present", confirming the
  toggle truly swaps content, not coincidentally-identical text from an
  earlier check), approved the variant, generated files, then clicked
  "Regenerate files" and captured state 50ms after the click: confirmed
  zero download links present and the button showing "Generating…" during
  the in-flight window (the state-reset fix), and after completion
  confirmed both download links returned with real, non-null URLs and the
  button re-enabled -- with the diagnostic trace showing no "passed but
  null" warning, unlike the first (pre-fix) run against the same data,
  which did fire it for both formats. Screenshots at 390px and 1280px
  confirmed the merged single-column toggle view, the green "Passed" pills
  beside each filename, and tight, always-visible download buttons. Zero
  console/page errors throughout. The temporary server, disposable data
  directory, and verification scripts were all removed afterward; no live
  personal data was read or changed.

## Job detail "Resume requirement coverage" mobile overhaul (ship-feature run)

Requirement: "act as a senior UI engineer... optimize the resume
requirement coverage section for mobile" -- collapse the long
qualification list into a scrollable summary widget with an "expand all"
drawer, consolidate the "why this score" keyword list into a compact
2-column grid, and keep the "Refresh analysis" button visible at the top
without scrolling.

- Scoped to `app/jobs/[id]/page.tsx`'s "Why this score" panel and "Resume
  requirement coverage" section; the tailored-resume-draft section and
  description below were left untouched.
- Requirement list: replaced the always-expanded `space-y-3` stack of full
  `<article>` cards (priority/kind/status tags, full text, matched/missing
  terms, related evidence -- easily 6-10+ lines each) with a
  `max-h-72 overflow-y-auto` bounded widget of one-line rows (a tiny
  priority badge R/P/C, truncated requirement text, and a compact
  dot+label status pill). A count label ("N requirements") and an
  "Expand all" button sit above it. "Expand all" opens a bottom-sheet
  drawer (same slide-up/Escape-to-close/body-scroll-lock pattern already
  used for the Profile page's evidence editor, reused verbatim here for
  consistency) containing the original full-detail cards unchanged --
  nothing about the data or full-detail view was removed, it only moved
  behind the drawer so the section's default height stays small regardless
  of how many requirements a posting has.
- Because the requirement list no longer inline-expands the section's
  height, the "Refresh analysis"/"Analyze requirements" button (already
  structurally first in the section, before any list content) now stays
  near the top of the page in practice too -- verified live rather than
  assumed: screenshotted after a real analysis with 13 requirements at
  both 390px and 1280px and confirmed the button sits directly above a
  short, bounded widget with no long list pushing it out of initial view.
- "Why this score": the two keyword lists (skills mentioned/not mentioned
  in the posting, previously comma-joined prose paragraphs) became a
  `grid-cols-2` layout of wrapped pill chips, one column each, under the
  existing prose `reasons` bullet list (left untouched -- it's sentences,
  not a keyword list).
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium at 390px and 1280px against a
  disposable database: seeded a real resume (the repo's sample-resume.txt
  fixture) and a job with a 7-line qualifications + 5-line responsibilities
  description plus crafted match-reasons data; extracted and bulk-verified
  evidence through the real `/api/resume/evidence` endpoints (analysis
  requires verified evidence, matching this repo's existing design) so the
  live "Analyze requirements" flow produced real data, not a mock. Confirmed
  the "why this score" grid renders both columns, confirmed a real
  `Analyze requirements` click produced 13 requirements with the widget's
  `scrollHeight` (480) exceeding its `clientHeight` (286) -- proving actual
  bounded internal scroll, not just a tall box -- and confirmed the "Expand
  all" drawer shows the exact same 13 items in full detail (counts
  cross-checked, not assumed equal). Zero console/page errors at both
  widths. Screenshots inspected directly. The temporary server, disposable
  data directory, and verification script were all removed afterward; no
  live personal data was read or changed.

## Cross-branch investigation: 11 orphaned live applications (ship-feature run)

Requirement: "the submitted applications list is empty despite the
dashboard being live" -- investigate the data-ingestion flow and identify
the root cause.

- Live-inspected (read-only, then with explicit approval, read/write) the
  actual database backing the running dashboard rather than assuming the
  bug from the 2026-07-31 SESSION.md entry was already fully resolved.
  Traced the running `next dev` process on port 3003 to its actual cwd
  (`job-autopilot-claude`, this worktree, `feature/claude-autofill`) and
  its actual data directory (resolved via `npm run dev:shared`'s dynamic
  `git rev-parse --path-format=absolute --git-common-dir` lookup to the
  *primary* worktree's `data/`, `/Users/kamleshwandhare/projects/
  job-autopilot/data`) -- confirming the live dashboard's real data lives
  outside this worktree's own local `data/`, which is a separate,
  long-stale 163KB file this worktree only ever touches via a plain
  `npm run dev` (no `dev:shared`).
- Root cause, confirmed with certainty: the shared live database had 11
  jobs at `status = 'applied'` (Airbnb, Gusto, Twilio x2, Affirm x2,
  MongoDB, Reddit, Scale AI, Fivetran, SuprAIJobs) with zero matching
  `applications` rows. `lib/autofill/filler.ts`'s `startSubmissionWatcher()`
  is the only "mark applied" path that writes `jobs.status` directly via
  raw SQL instead of going through `createApplication()` -- exactly the bug
  already found and fixed on this branch (`feature/claude-autofill`) on
  2026-07-31 for one earlier job (23). This worktree's own `filler.ts`
  already has that fix (confirmed by reading it, not assumed); the
  *primary* worktree -- checked out on **Codex's `feature/codex-work`**,
  the branch that actually creates commits there -- did not. No Codex dev
  server was found currently running (`pgrep`/`lsof` for port 3002 came up
  empty), so these 11 are historical: almost certainly created by an
  earlier Codex session against the shared database before this branch's
  July 31 fix landed, then never discovered/backfilled the way job 23 was
  that day.
- User-directed resolution (asked via three clarifying rounds before
  touching anything, since this crosses into another agent's branch and
  real personal application data):
  1. **Code fix ported to the primary worktree**, `/Users/kamleshwandhare/
     projects/job-autopilot/lib/autofill/filler.ts` -- the identical,
     already-proven fix (read job's prior status/company inside the same
     transaction, call `createApplication()` with `source:
     "autofill_submit"` on a real `new -> applied` transition), plus the
     matching `createApplication` import. Lint, strict TypeScript, and
     `npm run build` all passed there. **Left uncommitted** in that
     worktree at the user's explicit direction -- `feature/codex-work` is
     Codex's branch, not mine to commit to; `git status` there shows only
     this one modified file plus the gitignored backup/`test-results/`
     noise.
  2. **Backfilled the 11 orphaned applications** in the shared live
     database, after backing it up first
     (`data/app.db.bak.20260801083502` in the primary worktree). Used
     `createApplication()` itself (not a raw INSERT) so company
     lookup/creation and the idempotent-per-job guarantee matched the real
     code path exactly, `source: "autofill_submit"`, then corrected
     `applied_at` (which `createApplication()` always defaults to "now")
     to `2026-07-31 00:19:00` -- confirmed via an older pre-repair backup
     snapshot that all 11 were already `applied` by that point, and no
     more precise per-job timestamp exists anywhere in the schema (no
     applied-at column on `jobs`, no matching `job_actions`/
     `queue-runner.log` entries for 10 of the 11). Documented as an
     explicit approximation in each row's `notes` field rather than
     silently backdating without a record. Backdating to "now" instead
     would have been worse: it would have misattributed all 11 to today in
     this session's own new weekly funnel/trend metrics. Verified
     afterward with a fresh read-only pass: every previously-orphaned
     `applied` job now has exactly one matching `applications` row, and no
     `applications` row references a nonexistent job (both directions of
     the join checked empty).
  3. **This worktree's `.env.local`** now sets `JOB_AUTOPILOT_DATA_DIR` to
     the primary worktree's `data/` explicitly, so a plain `npm run dev`
     here (without `dev:shared`) can no longer silently diverge onto its
     own separate local database the way it evidently already had.
     Verified the resolution logic directly (`resolveDataDir()`'s exact
     env-var-read behavior) rather than fighting Next.js's expected
     single-dev-server-per-directory lock, which correctly refused a
     second `next dev` in this same directory while port 3003's instance
     was already running. Not added to `.env.local.example` -- the
     absolute path is specific to this machine's worktree layout, not a
     portable template default.
- This worktree's own `filler.ts` needed no change (already fixed); the
  only file this produced here is the gitignored `.env.local` edit, so
  there is nothing new to commit on `feature/claude-autofill` for the code
  itself -- only this documentation update.
- Not yet done, deliberately left for the user/a Codex session: reviewing
  and committing the `filler.ts` fix on `feature/codex-work` in the
  primary worktree. The live dashboard (port 3003, this worktree's already
  -fixed code) is unaffected either way and does not need a restart.
- No live secrets were printed, copied, or committed while inspecting
  `.env.local` for this change.

## Applications page hydration-mismatch fix (ship-feature run)

Requirement: fix a reported hydration console error on `/applications` --
`select` (the new "Sort by" control) had a server/client attribute
mismatch (`__gcruniqueid`), matching the exact "browser extension messes
with the HTML before React loads" case named in React's own hydration
error message.

- This is a known, already-solved class of issue in this exact repo:
  `AGENTS.md`/prior sessions established `suppressHydrationWarning` as the
  fix for form controls a browser extension (password manager, form-fill
  tool, etc.) tags with its own attribute before hydration, and it's
  already applied to essentially every `<input>`/`<select>` on every other
  page (`app/page.tsx`, `app/profile/page.tsx`, `app/autofill/page.tsx`,
  `app/jobs/[id]/page.tsx`). `app/applications/page.tsx` -- rewritten this
  session as part of the analytical-hub overhaul -- was the one page that
  had never gotten it, because its form controls (the follow-up date
  input, and the new Sort-by select and no-response checkbox) are all new
  or newly relocated this session.
- Added `suppressHydrationWarning` to all three: the per-application
  follow-up `<input type="date">`, the new Sort-by `<select>` (the one in
  the reported error), and the no-response-in-14+-days `<input
  type="checkbox">`. No behavior change -- this prop only tells React to
  skip warning about a text/attribute mismatch on that one element during
  hydration, it doesn't change what renders or how the controls behave.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- The actual root cause (a real browser extension injecting an attribute)
  can't be reproduced in headless Chromium, which has no extensions
  installed -- so this couldn't be verified by reproducing the original
  error. Instead verified live against a disposable database that the page
  still renders correctly and both the Sort-by select and the no-response
  checkbox still function normally (selecting "Status", checking the
  filter, reading back the resulting values) with zero console errors,
  confirming the fix didn't regress functionality. Temporary server and
  disposable data directory removed afterward.
- Changed file: `app/applications/page.tsx` only.

## Applications view overhaul into an analytical hub (ship-feature run)

Requirement: "act as a senior product designer... overhaul the applications
view to be a high-performance analytical hub" -- a compact horizontal
metric bar with +/- trend indicators, a company/domain/title grouping
control, a visual funnel chart (applied/interview/offer/rejected % with
trend lines), a sort-by dropdown (date/status), dense and mobile-optimized.

This was the largest of this session's `/applications`-and-friends passes
because, unlike the earlier ones, it needed new backend aggregation, not
just layout: trend indicators and funnel sparklines need week-over-week
history that didn't exist in the API response before this change.

- `lib/applications.ts`: `getApplicationStats()` extended (superseding the
  old `perWeek` field) to also return all-time `interview`/`offer`/
  `rejected` counts and `funnelWeekly: FunnelWeek[]` (last 12 Sunday-start
  calendar weeks, most recent first, each with total/withResponse/
  interview/offer/rejected raw counts). Kept as raw counts, not
  pre-computed percentages or deltas -- that derivation is presentational
  and now lives entirely in the frontend, not the backend, so the API
  stays a plain data provider. Single combined SQL query per shape (one for
  all-time totals, one grouped-by-week), reusing the exact week-bucketing
  expression the old `perWeek` query already used, so trend math and the
  funnel sparklines share one consistent notion of "week."
  - Known, documented modeling limit carried over unchanged from the
    existing schema: `applications.response_type` is one current value per
    row (set via toggle), not a log of every stage an application passed
    through. An application now marked "offer" after an earlier interview
    no longer counts toward "interview" anywhere in these stats. The
    funnel is therefore an accurate snapshot of current outcome
    distribution, not a true "reached this stage at some point" pipeline --
    called out both in a code comment and in the UI's own caption text, not
    silently glossed over.
  - Extended `scripts/test-applications.mjs` with assertions for the new
    `interview`/`offer`/`rejected` all-time counts and the `funnelWeekly`
    shape; `npm run test:applications` passes.
- `app/applications/page.tsx` (full rewrite of the page body, same file):
  - **Metric bar** (req 1): the old 3-tile grid became one
    `grid-cols-3 divide-x` bar. Each cell's trend arrow/delta is derived
    from `funnelWeekly[0]` (this week) vs `funnelWeekly[1]` (last week):
    Applications shows raw weekly growth (always "+N", cumulative
    counters don't have a meaningful negative direction), Response rate
    shows a percentage-point delta colored by outcome semantics (up=good,
    down=critical -- the only cell where direction implies "good/bad"),
    This week shows the plain week-over-week count delta in neutral
    accent/gray (more or fewer applications isn't inherently good or bad).
    Renders "No trend yet" instead of a fabricated delta when fewer than
    two weekly buckets exist.
  - **Funnel chart** (req 3): `FunnelChart` renders Applied/Interview/
    Offer/Rejected as dense bar+sparkline+%+delta rows. Applied is always
    100% by definition, so its sparkline/delta show weekly *volume*
    instead of a flat, uninformative percentage line; the other three show
    % of that week's cohort and a percentage-point delta vs the prior
    week. `Sparkline` is a small inline `<svg><polyline>` (no charting
    dependency), always paired with the numeric %/delta text next to it,
    not the only signal.
  - **Grouping control** (req 2): a 3-way segmented control (Company /
    Domain / Title, default Company) groups the already-fetched
    `applications` array client-side -- no new endpoint. "Domain" parses
    `new URL(app.jobUrl).hostname` (stripping a leading `www.`), falling
    back to "Unknown" for an unparseable/empty URL. Groups are ordered by
    size (largest first), then alphabetically.
  - **Sort by** (req 4): a native `<select>` (Application date / Status).
    "Status" sorts by response-funnel stage (interview → offer → rejected
    → ghosted), with awaiting-response applications sorted first as an
    intentional, documented low-risk choice (most actionable state) rather
    than last; both modes secondarily sort by most-recently-applied.
  - Extracted the existing per-application card markup into an
    `ApplicationCard` component (needed once the list renders inside
    repeated group sections instead of one flat map) -- its behavior
    (response toggle buttons, follow-up date save) is unchanged.
  - Removed `StatTile` and `WeeklyTrendChart` (superseded by `MetricBar`
    and `FunnelChart`, which are strictly richer) and the `formatWeekLabel`
    helper that only they used -- an intentional simplification for
    density (req 5), not an accidental drop; nothing else in the repo
    referenced any of the three (checked before removing).
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium at 390px and 1280px against a
  disposable database seeded with 11 synthetic applications spanning four
  calendar weeks across 7 companies/domains with a deliberate response-type
  mix, specifically so the trend math would be exercised, not just the
  empty/flat-line path: confirmed metric-bar values and every trend arrow
  by hand-computing the expected delta from the seeded data (e.g. response
  rate 73% overall, -50pt this-week-vs-last, funnel Interview +17pt,
  Offer/Rejected -33pt -- all matched), confirmed Company/Domain grouping
  actually re-buckets the list (domains like `boards.greenhouse.io` and
  `jobs.lever.co` render correctly), confirmed Status sort puts
  awaiting-response first, confirmed the pre-existing "no response in 14+
  days" filter still works combined with the new controls, and confirmed
  zero console/page errors at either width throughout. Screenshots
  inspected directly. The temporary server, disposable data directory, and
  verification script were all removed afterward; no live personal data
  was read or changed.

## Auto-fill job card mobile-scanning overhaul (ship-feature run)

Requirement: "act as a senior UI engineer... overhaul the auto-fill job
card for mobile-first scanning" -- condense employer/title into a clean
header and hide the job detail body by default, collapse the missing-
resume/skill-gap warnings into one subtle status pill at the card base,
turn the action buttons into a dense icon row, and keep "view job details"
as a plain text link below the pill.

- Scoped to `app/autofill/page.tsx`'s job queue card (the `{job && (...)}`
  block); the rest of the fill flow (missing-field prompts,
  ready-for-review panel, blocked/error panels) was left behavior-identical,
  only reflowed to sit below the new header/action-row structure.
- Header: title/company/location/source/score condensed to two lines (was
  already close, just tightened weight/size); the previously always-visible
  detail paragraph block (salary, resume attachment, matched skills, skill
  gaps, responsibilities, qualifications) now renders only behind a
  `detailsOpen` disclosure toggle ("Show details"/"Hide details" with a
  rotating chevron), collapsed by default and reset on every job change.
  Chose a same-card expand over removing the content outright, since it's
  data already fetched for this job (no extra request) and "hide ... by
  default" implies a way to reveal it, not permanent removal -- the
  existing "View job details" link (req 4) still covers navigating to the
  full canonical job page.
- Status pill: `getStatusPill()` collapses the two previously separate,
  always-visible warning lines (missing resume file, skill-gap list) into
  one pill with three tones -- critical ("No resume attached") when
  `resumeAttachment` is null, warning ("N skill gaps vs. this posting")
  when `skillsInPostingNotInResume` is non-empty, else a good/green
  "Resume attached, no skill gaps" -- so exactly one pill always renders at
  the card base, dot + text per the never-color-alone convention already
  used elsewhere in this app. The tailored-vs-master-resume distinction
  moved into the collapsible detail body rather than the pill, since it
  isn't a warning.
- Actions: the four idle-phase buttons (Auto-fill review, Auto-fill &
  submit, Save for later, Skip -- all four kept; the requirement named
  three, but Save for later is a real, intentionally-distinct existing
  workflow state per its own code comment, not something to silently drop)
  became a `grid-cols-4` row of icon-over-label buttons (custom inline SVG,
  no new icon dependency), keeping their original color semantics (solid
  dark = primary review path, solid red = higher-risk auto-submit,
  outlined = secondary) and the existing submit-mode confirm dialog and
  hover tooltips unchanged.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium at 390px and 1280px against a
  disposable database (a copied fixture resume + one synthetic job with a
  crafted `match_reasons_json` and a description containing real
  Responsibilities/Qualifications sections, so `extractJobSections` had
  real content to parse): confirmed the detail body is absent from the DOM
  by default, "Show details" reveals it with the exact salary/resume/
  skills/responsibilities/qualifications content, the icon action row
  renders all four actions, and the pill correctly read "3 skill gaps vs.
  this posting". Separately re-verified live (same running server, resume
  file removed from the disposable data dir) that the pill switches to
  "No resume attached" when `resumeAttachment` is null. Zero console/page
  errors at either width in both passes. Screenshots inspected directly;
  the temporary server, disposable data directory, and verification
  scripts were all removed afterward. No live personal data was read or
  changed.

## Profile page "Verified career evidence" + job filters mobile-density overhaul (ship-feature run)

Requirement: "act as a senior UI engineer... overhaul the verified career
evidence section for mobile-first density" -- replace the nested
card-per-item list with a dense table-like list (category and content
snippet side by side), open a bottom-sheet modal on tap for verification,
group the job-filter text inputs into a 2x2 grid to cut vertical length in
half, and convert the "remote only" checkbox into a compact toggle switch.

- Scoped to `app/profile/page.tsx` (the only page with a "Verified career
  evidence" section and a job-filters form).
- Evidence list: each `article`-per-item card (status `<select>` + always-
  visible `<textarea>` + inline save button, ~6-8 lines tall each) became one
  `divide-y` row per item: a fixed-width capitalized `kind` label, a
  `min-w-0 flex-1 truncate` content snippet, and a compact status indicator
  (colored dot + short text label -- "Verified"/"Review"/"Rejected" --
  never color alone, matching the convention from the dashboard Action
  Center overhaul). Rejected items render the snippet muted+struck-through
  as an extra non-color signal.
- Tapping a row opens a bottom sheet (`editingEvidenceId` state, `fixed`
  overlay + `translate-y-full -> translate-y-0` panel animated a tick after
  mount via `requestAnimationFrame` so the closed state paints first) with
  the item's kind/section/source-line, a 3-way status choice
  (Review/Verified/Rejected as pressed toggle buttons), the editable
  textarea, the extracted-source diff note, Cancel, and Save. Escape closes
  it and body scroll is locked while open; no new dependency was needed
  (no dialog/sheet library existed or was added). `saveEvidence()` now
  returns a boolean so the sheet only auto-closes on a real save success,
  staying open with the error visible if the PATCH fails.
- Job filters: the previous grid already paired the first four text inputs
  2x2, but `excludedCompanies` forced a `col-span-2` full-width row and the
  checkbox sat alone below it (4 visual rows total for 5 text inputs + 1
  checkbox). Removed the span so `excludedCompanies` shares a row with the
  new control, and replaced the native checkbox with a `role="switch"`
  `aria-checked` toggle (no new dependency), giving a consistent 3-row,
  fully-paired 2-column grid with a visible "On"/"Off" text label next to
  the switch (not color-only).
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium at 390px and 1280px against a
  disposable database seeded from the repo's own
  `fixtures/resume-tailoring/sample-resume.txt` (9 real extracted evidence
  rows) and a populated filters row: confirmed the dense list renders all
  9 rows, tapping a row opens the sheet, changing status to Verified and
  saving persists (row's status label updated to "Verified" after the
  sheet closed, confirmed via a fresh read of the row, not an assumed
  state), Escape closes a second sheet, the filters grid renders as a
  tight 2-column/3-row layout with the toggle in its "On" state, and there
  were zero console/page errors at either width. Screenshots inspected
  directly. The temporary server, disposable data directory, and
  verification script were all removed afterward; no live personal data
  was read or changed.
- Not addressed (unrelated, pre-existing, out of scope for this pass): the
  Resume-upload/skills card above this section and the rest of the app
  were left untouched.

## Dashboard "Needs your attention" mobile-first overhaul (ship-feature run)

Requirement: "act as a senior UI engineer... overhaul my job application
dashboard for mobile-first productivity" -- compress header metrics into a
horizontal scrollable pill row, turn the application list into a compact
list (employer, role, small action badge), add per-card accordion expansion
(collapsed by default, tap reveals "why you're needed" + continue), clean
high-contrast one-handed mobile layout.

- Scoped to `app/page.tsx`'s "Needs your attention" Action Center section
  (header metric tiles + action cards), not the whole page. That section is
  the only place with the literal "Why you're needed" copy, the primary
  action button, and employer/role data the requirement describes; the
  separate paginated "Job pipeline" list below serves a different purpose
  (browsing all jobs) and was left untouched, matching how the prior
  Applications-page overhaul stayed scoped to one section rather than a
  page-wide rewrite.
- `ACTION_META`'s single `accent` field (previously only used as a
  decorative underline bar) split into `dot` (solid indicator) and `badge`
  (tinted bg-*-50/text-*-700ish pill). Solid `bg-amber-500` with white text
  fails WCAG contrast; the tinted-background-plus-dark-text pattern already
  established on the Applications page redesign was reused instead, still
  always paired with a text label per that page's never-color-alone rule.
- Header metric tiles (was a `grid-cols-2 sm:grid-cols-5` block of larger
  cards) are now a horizontal `overflow-x-auto` row of small pills on
  mobile, `sm:flex-wrap` on wider viewports; each pill keeps its original
  click-to-filter-and-scroll-to-pipeline behavior and an `aria-pressed`
  active state.
- Each action card is now collapsed by default to title/company/status
  badge/chevron behind one `aria-expanded`/`aria-controls` toggle button per
  card (`expandedActions` state, a `Set<string>` keyed the same way the
  cards already were). Tapping expands to reveal location/match/time,
  "Why you're needed" reasoning and details, the primary continue button
  (`action.primaryLabel`/`primaryHref`, unchanged logic), "Job details",
  and (for external leads) the "I applied"/"Not interested" buttons -- all
  previously always-visible, now behind the tap.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
- Verified live in headless Chromium against a disposable SQLite database
  (5 synthetic jobs, one per Action Center status) at both 390px and
  1280px: pill row's `scrollWidth` (656) exceeds `clientWidth` (390) on
  mobile confirming real horizontal scroll, while desktop shows equal
  widths confirming the wrap fallback; a card's `aria-expanded` toggles
  and "Why you're needed" becomes visible on tap at both widths; zero
  console/page errors. Screenshots inspected directly. The temporary
  server (port 3911), disposable data directory, and verification script
  were all removed afterward; no live personal data was read or changed.
- Not addressed (out of scope for this pass, matching the existing TODO
  note to extend the Applications-page visual language app-wide): the
  "Job pipeline" list, Sources/LinkedIn-import sections, and the rest of
  the app (Auto-fill, job detail, Profile) were not restyled.

## LLM-assisted resume tailoring wired into the existing pipeline (ship-feature run)

Requirement: extend the existing deterministic resume-tailoring pipeline
with a real Claude API call as the "smart generation engine" for wording,
while keeping the deterministic DOCX/PDF renderer and its round-trip
validation exactly as they were.

- Used the `claude-api` skill rather than guessing SDK usage or model
  behavior; two points it corrected from the initial plan, confirmed
  against live docs rather than assumed:
  - `temperature` (the user asked for "temperature 0" for reliability)
    does not exist on Claude Opus 5 -- non-default sampling params return
    400 on every request. Determinism instead comes from the forced
    `tool_choice` + `strict: true` schema (guarantees the JSON shape) and
    a fixed `effort: "high"`, not from a sampling parameter.
  - Confirmed via a live WebFetch of the thinking docs (not assumed) that
    forced `tool_choice: {type: "tool", ...}` **is** compatible with
    adaptive thinking on Opus 5 specifically ("Adaptive thinking,
    including on models where thinking is on by default, supports forced
    tool use") -- it's only manual/legacy extended thinking that forbids
    forced tool choice. Opus 5 has thinking on by default and disabling it
    has a documented failure mode (tool calls can leak into plain text
    instead of a real tool_use block) that would have broken this exact
    forced-single-tool-call design, so thinking was deliberately left on.
- New `lib/llmTailoring.ts`: `tailorEvidenceText()` sends only the
  free-text/narrative evidence kinds (summary, experience, project,
  publication) to `claude-opus-5` -- single-token kinds (skill, education,
  certification, other) never leave the deterministic path, since there's
  nothing useful for a rewrite to do to "Kubernetes". One forced tool call
  (`submit_tailored_resume_items`, `strict: true`, `tool_choice` forced to
  that tool) returns tailored text keyed by the original evidence id;
  dates, employer names, titles, and section/ordering logic never pass
  through the model at all. Validates the returned id set matches the
  requested set exactly, plus a coarse grounding check (word-overlap +
  length-ratio heuristic) per item, and throws a typed
  `LLMTailoringError` on any failure -- never returns a partial or guessed
  result.
- `lib/resumeVariants.ts`: `composeVariantItems()` and
  `createResumeVariant()` now accept an optional
  `tailoredOverrides: Map<evidenceId, text>`. When present, it substitutes
  for the deterministic `formatEvidenceText()` output per item; everything
  else (verified-evidence filtering, requirement-coverage rationale,
  section ordering, relevance sort) is completely untouched.
- `app/api/jobs/[id]/resume-variant` (`POST`) gained an optional
  `{"mode": "auto" | "llm" | "deterministic"}` body (still tolerates the
  existing no-body call from `app/jobs/[id]/page.tsx` unchanged -- body
  parsing distinguishes "empty body" from "malformed JSON"). `"auto"`
  (default) tries the LLM when `ANTHROPIC_API_KEY` is configured and
  falls back to the original deterministic path on *any* failure
  (missing key, refusal, truncation, network) rather than blocking variant
  creation -- but always reports which path actually ran via a new
  `tailoringMode` response field (plus `tailoringError` when it fell back
  from a real failure, not just a missing key), so nothing is silently
  mislabeled. `"llm"` requires success and returns 502 with the reason
  otherwise; `"deterministic"` skips the LLM entirely.
- Added `ANTHROPIC_API_KEY=` (empty) to `.env.local` and documented it in
  `.env.local.example` -- **the user still needs to fill in their own key
  before LLM tailoring activates**; until then every call transparently
  falls back to the pre-existing deterministic behavior, verified live.
- Installed `@anthropic-ai/sdk` (`^0.115.0`), the one new dependency this
  required, authorized by this session's explicit request.
- Added `scripts/test-llm-tailoring.mjs` (`npm run test:llm-tailoring`):
  kind classification, config detection, and confirms
  `tailorEvidenceText()` throws `LLMTailoringError{code:"not_configured"}`
  synchronously (no network call) when unconfigured, rather than hanging
  or silently succeeding.
- Extended the existing `scripts/test-resume-analysis-routes.sh` E2E
  (disposable server + database, no live Anthropic calls): confirmed
  `mode: "llm"` returns 409 with no `ANTHROPIC_API_KEY` configured, and
  that the default no-body call still returns `tailoringMode:
  "deterministic"` with no spurious `tailoringError`, alongside the
  pre-existing draft/patch/approve/DOCX/PDF-artifact assertions, all of
  which still pass unmodified.
- **Not verified: an actual live Claude API call.** No Anthropic API key
  is available in this environment/session, so the real `mode: "llm"`
  tailoring path (network request, response parsing, grounding check
  against real model output) has only been verified by code review, type
  checking, and the unconfigured-key failure path -- not by an actual
  request to the API. This is the single most important next step before
  relying on this feature: once the user adds their key to `.env.local`,
  create a variant for a real job with `mode: "llm"` (or default `"auto"`)
  and confirm the tailored wording, `tailoringMode: "llm"` in the
  response, and a normal DOCX/PDF generation afterward.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`,
  `test:resume-variants`, `test:resume-analysis-routes`,
  `test:resume-artifacts`, and the new `test:llm-tailoring` all passed.
- Scope: only `POST /api/jobs/[id]/resume-variant` gained AI tailoring;
  no UI changes were made (`app/jobs/[id]/page.tsx`'s existing
  no-body call works unchanged and already gets AI tailoring for free
  once a key is configured, defaulting to "auto"). No UI surfaces which
  mode ran per creation -- `tailoringMode` is in the API response but
  not yet rendered anywhere. That, plus a "regenerate with AI" control
  and per-item AI/deterministic labeling in the variant review UI, are
  natural follow-ups, logged in `TODO.md`.

## Applications page UI overhaul (senior UI/UX design pass, ship-feature run)

Requirement: "act as a senior UI/UX designer... comprehensive UI overhaul"
for the Applications page (`/applications`) -- better data visualization,
whitespace/hierarchy, a more intuitive status-card layout, backed by
specific Tailwind patterns, professional enough for managing a large
volume of applications.

- Used the `dataviz` skill (`references/choosing-a-form.md`,
  `color-formula.md`, `marks-and-anatomy.md`, `palette.md`) rather than
  eyeballing colors. Ran `validate_palette.js` against the chosen
  accent/status hex set; the only FAIL/WARN it reported (amber `#fab219`
  sub-3:1 on white) is the palette's own documented, accepted tradeoff for
  the "warning" role, mitigated the way the doc prescribes: an icon/dot
  plus a mandatory text label, never color alone.
- Added six CSS custom-property tokens to `app/globals.css`'s `@theme`
  block (`--color-accent`, `--color-accent-muted`, `--color-status-good
  /-warning/-serious/-critical`), which Tailwind v4 turns into real
  utilities (`bg-status-good`, `text-accent`, etc.) -- additive only,
  nothing existing changed, so every other page is unaffected.
- Rewrote `app/applications/page.tsx`:
  - Three KPI stat tiles (total / response rate / this week) with small
    inline SVG icons (no new icon dependency) replace the old bare 3-up
    number grid.
  - New "Applications per week" chart: the already-fetched but previously
    unused `stats.perWeek` (up to 12 weeks) now renders as a real thin-column
    bar chart (accent hue for the current week, a lighter step of the same
    ramp for prior weeks, per the stat-tile "trend" spec), each bar a
    focusable/aria-labeled `<button>` with a hover + keyboard-focus
    tooltip -- not just a decorative sparkline.
  - Response-type buttons (Interview/Offer/Rejected/Ghosted) now carry
    status color (a dot + tinted selected background), chosen by outcome
    semantics: Offer/Rejected map to the reserved good/critical status
    colors (terminal outcomes), Ghosted maps to warning (an ambiguous
    non-response that wants follow-up), and Interview gets the brand accent
    (active-but-not-final progress) rather than borrowing a status color.
    Text label is always present alongside the color, per the skill's
    never-color-alone rule.
  - Application cards gained a neutral initials avatar, clearer
    title/company/source/match hierarchy, a relative "Applied N days ago"
    with the exact date on hover/title, and `aria-pressed` +
    `focus-visible` rings on every interactive control.
  - Loading skeletons now cover the KPI/chart region too, not just the list.
  - Section headers standardized to a small uppercase tracking-wide label
    pattern; cards moved from tight `p-3`/`rounded-lg` boxes to
    `rounded-xl`/`shadow-sm`/`p-5` with explicit `border-gray-200` (Tailwind
    v4 changed the unqualified `border` utility's color default to
    `currentColor`, so borders are now colored explicitly everywhere they're
    used on this page).
- This request specifically targeted `app/applications/page.tsx`, which
  already had unrelated in-progress staged edits (better error-message
  text, a loading skeleton) from an earlier session. Read the current
  staged content first and preserved both changes' substance inside the
  rewrite rather than discarding them -- nothing from that earlier pass was
  lost. The other four still-staged, unrelated page files
  (`app/autofill/page.tsx`, `app/jobs/[id]/page.tsx`, `app/page.tsx`,
  `app/profile/page.tsx`) were left completely untouched.
- Verified with synthetic data only: seeded a disposable SQLite database
  (`JOB_AUTOPILOT_DATA_DIR` pointed at a temp dir, deleted afterward) with
  7 varied applications across multiple weeks/response types/sources plus
  2 unapplied high-match jobs, since the real database only has 1 row and
  couldn't exercise the redesign. A real headless-browser pass covered
  desktop (1280px) and mobile (390px) layouts, the chart's hover tooltip,
  a component's keyboard-focus ring, and the "No response in 14+ days"
  filter -- zero console errors in every state. Screenshots inspected
  directly; temporary server, seed/verification scripts, and the disposable
  data directory were all removed afterward. No live personal data was
  read or changed for this piece of work.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` passed.
- Scope decision (not asked back, low-risk/reversible/UI-only): kept the
  overhaul to the Applications page itself, not the whole app (dashboard,
  autofill, profile) -- that's available as a follow-up if wanted, noted in
  `TODO.md`.
- Known limitation not addressed here: the root layout's nav
  (`app/layout.tsx`) wraps awkwardly at 390px (pre-existing, outside this
  page's scope).

## LinkedIn digest title/company HTML-entity decoding fix

Follow-up to the 0-applications fix below: the user asked to also fix the
literal `&amp;` spotted in job 23's title on the Applications page.

- Root cause: LinkedIn's job-alert email's `text/plain` MIME part is
  generated from its HTML alternative without decoding entities, so a
  title/company containing e.g. `&` arrives in the digest body literally
  as `&amp;`. `lib/sources/gmailLeads.ts`'s `extractLeadsFromDigest()`
  used the raw lines as-is with no decoding step.
- Fixed by exporting the existing `decodeEntities()` helper from
  `lib/sources/html.ts` (previously only used internally by `stripHtml()`
  for Greenhouse's entity-encoded HTML descriptions) and applying it to
  the parsed `title`/`company` in `gmailLeads.ts`.
- A live scan of `data/app.db` (`title`/`company` LIKE '%&%;%') confirmed
  job 23 was the only affected row (its `company` field happened not to
  contain the entity, only `title` did). Backed up `data/app.db` again,
  then corrected job 23's stored title in place with a targeted SQL
  `replace()`.
- Added a regression case to `scripts/test-gmail-leads.mjs` covering a
  digest block with `&amp;` in both title and company lines, asserting
  the decoded `&` in the returned lead.
- `npm run test:gmail-leads`, `test:action-center`, `test:applications`,
  `npm run lint`, `npx tsc --noEmit`, and `npm run build` all passed.
  Live-verified via a real headless-browser screenshot of `/applications`
  showing "Jack & Jill hiring ..." instead of the literal entity, and via
  a direct `GET /api/applications` check. Temporary server and script
  removed afterward.
- Changed files: `lib/sources/html.ts` (exported `decodeEntities`),
  `lib/sources/gmailLeads.ts` (applies it), `scripts/test-gmail-leads.mjs`
  (regression case). The already-staged, unrelated page changes in this
  worktree were left untouched.

## Applications page showing 0 applications (ship-feature run)

Requirement: the user reported the `/applications` page showing 0
applications; troubleshoot and fix.

- Live database inspection (`data/app.db`, read-only counts) showed `jobs`
  had one `status = 'applied'` row (id 23) while the `applications` table
  had zero rows -- consistent with the page's real empty state, not a
  rendering bug.
- Root cause: `startSubmissionWatcher()` in `lib/autofill/filler.ts` (the
  background safety net that confirms an Auto-fill & submit attempt
  succeeded after a manual-completion recovery, e.g. a verification code)
  marks the job `applied` with a direct
  `UPDATE jobs SET status = 'applied'`, bypassing the only place that had
  previously been wired to call `createApplication()`
  (`PATCH /api/jobs/[id]`, per the 2026-07-31 application-tracking work).
  Every other "mark applied" path (autofill's own explicit confirmation,
  the job-detail dropdown, the Action Center quick-action, and
  `scripts/queue-runner.sh`'s `mark_status`, which calls the same PATCH
  route over HTTP) already went through that hook correctly -- this
  background watcher was the one path that wrote status directly.
- Fixed in `lib/autofill/filler.ts`: the watcher's transaction now reads
  the job's prior status/company, and on a real `new -> applied`
  transition calls `createApplication()` the same way the PATCH route
  does (latest resume filename, `source: "autofill_submit"` since this
  watcher only runs for the opt-in submit-mode confirmation flow).
- Backfilled the one already-affected live row: backed up `data/app.db`
  first, then inserted the missing `applications` row for job 23 (source
  `autofill_submit`) using the same `createApplication()` function via a
  disposable one-off script, deleted after use. User explicitly approved
  the live-data backfill before it ran.
- Verified live: after `npm run build` and `npm run start` on a separate
  port, `GET /api/applications` and `GET /api/applications?stats=1`
  returned the backfilled row and `total: 1`; a real headless Chromium
  pass against `/applications` confirmed the empty state no longer shows,
  the stats strip reads "1" total, and there were zero console errors.
  Screenshot inspected directly. Temporary server, script, and screenshot
  were all removed afterward.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff
  --check` all passed. No other file changed for this fix.
- Noted but out of scope for this fix: the LinkedIn-imported title for job
  23 renders a literal `&amp;` instead of a decoded `&` on the
  Applications page (pre-existing LinkedIn import/display issue, unrelated
  to the 0-applications bug). Left for a future task; recorded in
  `TODO.md`.
- Changed files: `lib/autofill/filler.ts` (fix) plus the pre-existing
  uncommitted page changes already in this worktree, which were left
  untouched as user-owned work.

## Dashboard "Verification" tab E2E fix (ship-feature run)

Requirement: run the dashboard's Action Center "Verification" tab through a
real E2E and fix any errors, ensuring error handling is properly implemented;
noted only 1 job/test previously exercised that path.

- Traced the flow: dashboard `app/page.tsx`'s Action Center tile for
  `needs_code` sets `statusFilter` and scrolls to `#job-pipeline`, which
  refetches `GET /api/jobs?status=needs_code`. The existing coverage
  (`scripts/test-action-center.mjs`) only exercised `lib/actions.ts`'s
  `getDashboardActions()` data model with one `needs_code` job at
  `match_score = 90` -- never the actual `/api/jobs` route a real click
  reaches, and never a job with `match_score = 0` (reachable in practice:
  `GET /api/autofill/next?jobId=` resumes any job by ID regardless of
  score, per its own comment).
- Reproduced live: started the dev/prod server against a disposable
  `JOB_AUTOPILOT_DATA_DIR`, seeded a `needs_code` job at `match_score = 0`,
  drove a real headless Chromium session (Playwright, explicit
  `executablePath` since only the plain `chromium` build is installed in
  this sandbox, not `chrome-headless-shell`) through the dashboard, and
  clicked the Verification tile. Confirmed the bug: Action Center correctly
  showed the job needing verification, but the Job pipeline list right
  below it said "Job pipeline (0)" / "No jobs yet" -- `GET /api/jobs`
  applied its default `match_score > 0` exclusion even though a specific
  actionable status was explicitly requested.
- Fixed in `app/api/jobs/route.ts`: skip the default score-0 exclusion
  whenever the status filter is one of `ACTIONABLE_STATUSES`
  (`lib/actions.ts`) -- matching `getDashboardActions()`, which never
  hides these by score. Verified the deeper "Resume verification" flow
  itself (`/autofill?jobId=`) already worked correctly with no console or
  API errors; the defect was isolated to the pipeline-list route.
- Added a permanent regression test, `scripts/test-jobs-status-filter-routes.sh`
  (wired as `npm run test:jobs-status-filter-routes`), covering: the fixed
  case (score-0 job now appears under its actionable status), no regression
  to default "new" browsing (score-0 still hidden there), and `showAll=1`
  (unaffected). Along the way, hardened its cleanup to `fuser -k "$PORT/tcp"`
  after discovering `npm run start`'s `$!` is only the npm wrapper -- it
  doesn't forward signals to the real `next-server` grandchild, which
  otherwise leaks as an orphan still bound to the port and serving out of
  an already-deleted disposable data directory (confirmed live via
  `/proc/net/tcp` + `/proc/*/fd` inode lookup, since `lsof -i` did not
  reliably show these sandboxed listeners while `fuser` did). Killed all
  orphaned `next-server`/`next dev` processes left over from this session's
  manual testing before finishing.
- Validation: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and the
  full existing `test:*` suite all passed, except `test:resume-artifacts`,
  which fails in this sandbox for an unrelated, pre-existing reason
  (`chrome-headless-shell` binary not installed here) -- confirmed via
  `git stash` reasoning and direct inspection that this is untouched by
  this change; documented in TODO.md rather than silently ignored.
- Changed files: `app/api/jobs/route.ts`, `package.json` (new test script
  entry), `scripts/test-jobs-status-filter-routes.sh` (new).
- No product decision was ambiguous enough to need user input; this was a
  single-agent, single-branch fix on the standing `feature/claude-autofill`
  branch, so no guarded multi-agent integration was needed for this change
  itself.

## Ship-feature shared integration and Claude availability

On 2026-07-31, the cross-agent `ship-feature` workflow was isolated onto
`feature/shared-ship-feature` with an explicit ownership manifest. The guarded
integrator passed lint, strict TypeScript, and the production build and advanced
`integration/concurrent-work` to `000545c`. The only source-preparation
conflict was in `TODO.md`; it was resolved semantically by preserving the
integration baseline and adding only the ship-feature milestone.

Claude's `feature/claude-autofill` worktree still contains user/agent-owned
uncommitted page changes, so it was deliberately not merged, stashed, or
rewritten. For immediate discovery independent of branch state, the validated
portable skill was also installed at `~/.claude/skills/ship-feature`. Claude
Code 2.1.220 supports that location; an already-open session should run
`/reload-skills`, then invoke `/ship-feature <requirement>` explicitly.

## Latest workflow tooling update

On 2026-07-31, a vendor-neutral feature-delivery workflow was added at
`docs/workflows/ship-feature.md`. `AGENTS.md` recognizes the portable
`SHIP-FEATURE:` trigger, while project adapters expose `/ship-feature` in
Claude Code and Gemini CLI. A matching personal Codex skill was installed at
`~/.codex/skills/ship-feature`; it prefers a repository workflow when present
and otherwise uses its bundled generic reference. The workflow covers agent
feedback, acceptance criteria, design, implementation, risk-based unit,
integration, UI, E2E, and visual checks, ownership-safe concurrent work,
guarded integration, documentation, and evidence-backed handoff.

The installed skill was scaffolded with Codex's `skill-creator`, its YAML and
file structure were validated, and the installed directory was compared
byte-for-byte with the staged build. The official `quick_validate.py` could
not run because both available Python runtimes lack PyYAML; no dependency was
installed solely for validation. Codex discovery was subsequently confirmed by
the skill appearing in the available-skills catalog. Use `/reload-skills` in an
already-open Claude session and `/commands reload` in an already-open Gemini
CLI session.

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

On 2026-07-30, the first truthful resume-tailoring checkpoint was completed on
`feature/codex-work`:

- Added the implementation and validation plan in
  `docs/resume-tailoring-plan.md` and a guarded ownership manifest in
  `config/agent-tasks/resume-tailoring.allow`.
- Added idempotent `resume_evidence` persistence. Extracted evidence retains
  the immutable source text and line references, while a separate normalized
  value can be marked `extracted`, `verified`, or `rejected`.
- Added `GET`, `POST`, and `PATCH /api/resume/evidence` and a Profile review
  surface. Future tailoring is explicitly limited to items the user marks
  verified.
- `npm run test:resume-evidence`, `npm run lint`, `npx tsc --noEmit`,
  `npm run build`, and `git diff --check` passed.
- A production server using a disposable runtime directory accepted a
  synthetic TXT resume, extracted ten evidence items, persisted a summary as
  verified across reload, and emitted no browser console errors. At a 390px
  viewport, the evidence UI had no horizontal overflow. The temporary browser,
  server, and database were removed; live resume data was not read or changed.

The second resume-tailoring checkpoint was then completed:

- Added `job_requirement_analyses` and `job_requirements`. The stored
  description fingerprint causes stale requirements to be replaced whenever
  the posting text changes.
- `lib/jobRequirements.ts` deterministically classifies required, preferred,
  and contextual skills, experience, education, certifications,
  responsibilities, and qualifications.
- Coverage uses only evidence marked verified. Exact known terms and
  conservative text similarity can surface supporting evidence, while
  unevidenced experience duration remains a visible gap rather than being
  inferred from employment dates.
- Added `GET` and `POST /api/jobs/[id]/resume-analysis` and a job-detail
  coverage section. The UI labels evidence, partial matches, gaps, and
  user-review needs separately and explicitly disclaims an employer ATS score
  or guaranteed review.
- `npm run test:resume-requirements`, `npm run test:resume-analysis-routes`,
  `npm run lint`, `npx tsc --noEmit`, `npm run build`, and
  `git diff --check` passed. The route E2E used a temporary production server,
  synthetic resume/job data, and a disposable SQLite database, then removed
  them.

The third resume-tailoring checkpoint was then completed:

- Added `resume_variants` and `resume_variant_items`, including an audit record
  for source evidence, tailored text, rationale, matched terms, ordering, and
  inclusion.
- Variant composition uses only verified evidence. It prioritizes evidence
  supporting required, then preferred, then contextual expectations within
  conventional resume sections. The only automatic text change is whitespace,
  capitalization, and terminal punctuation; it does not create claims.
- The job-detail page presents verified source and tailored text side by side,
  lets the user include/exclude items while the variant is a draft, and
  requires a separate approval action.
- Approval rejects stale master resumes, changed job descriptions, modified or
  unverified evidence, and empty variants. Approved variants are immutable;
  creating a new draft does not silently replace an approved version.
- `npm run test:resume-variants`, lint, strict TypeScript, the production
  build, and the expanded `npm run test:resume-analysis-routes` passed. The
  route E2E verified draft creation, item exclusion, approval, and immutable
  approved state using only temporary synthetic data.

The fourth resume-tailoring checkpoint was then completed:

- Added `resume_variant_artifacts` and approved-only generation/download
  routes. Failed round-trip validation records diagnostics but provides no
  download path.
- DOCX output is a simple single-column Open XML document using Arial, body
  paragraphs, conventional headings, and no tables, graphics, columns,
  headers, or footers. PDF output is a text-based Letter document with the
  same content and no external font/network dependency.
- The untouched contact block is preserved from the master resume header.
  Export refuses a master resume without a recognizable contact detail.
- Skills may be relevance-ordered, but experience, education, projects, and
  other narrative evidence preserve source order so bullets cannot become
  detached from their employer or context.
- Both formats are reparsed using the app's PDF/DOCX extractors. Every header
  and included variant item must survive normalized text comparison before a
  download is exposed.
- `npm run test:resume-artifacts` generated and reparsed both formats using
  synthetic data. The expanded route E2E generated, validated, and downloaded
  both signatures/content types. Visual rendering initially exposed a
  transparent PDF page displayed as black; an explicit white background fixed
  it, and the rerender showed readable typography, margins, section rules, and
  no clipping or overlap. Temporary QA artifacts were deleted.

The fifth and final resume-tailoring checkpoint was then completed:

- Added one saved preferred format per active variant. DOCX is the default;
  the job-detail UI can explicitly select PDF after artifacts exist.
- `selectResumeAttachmentForJob()` is the single selector used by both the
  Auto-fill queue preview and the actual Playwright filler. It requires the
  exact job ID, current posting fingerprint, latest master resume ID, approved
  status, passed artifact validation, unchanged verified evidence, and an
  existing local artifact file.
- The selector tries the preferred artifact, then the other validated format,
  and finally the master resume. A different job, changed posting, newer
  resume, changed/rejected evidence, failed validation, or missing artifact
  always falls back safely.
- The Auto-fill card identifies the exact filename and whether it is approved
  for this job or the master fallback. The filler no longer swallows file
  attachment failures; it returns a manual attachment field.
- Model coverage and the disposable production-route E2E verified DOCX
  default, explicit PDF preference, missing-file format fallback, exact-job
  isolation, and master fallback for a second job. No employer form or live
  application was opened or submitted.

The verified resume-tailoring application baseline is `62fee11`
(`feat: attach exact-job tailored resumes`). Its preceding checkpoints are
`bdb81ac` (validated DOCX/PDF export), `b9bd33e` (reviewable variants),
`ddd3a2e` (job requirement analysis), and `051632b` (verified evidence).

Final validation after the attachment selector refinement:

- `npm run test:resume-evidence` passed.
- `npm run test:resume-requirements` passed.
- `npm run test:resume-variants` passed.
- `npm run test:resume-artifacts` passed with installed headless Chromium.
- `npm run test:resume-analysis-routes` passed against a disposable production
  server and SQLite runtime.
- `npm run lint` passed with no warnings.
- `npx tsc --noEmit` passed.
- `npm run build` passed and registered every resume analysis, variant,
  artifact, download, and existing autofill route.
- `git diff --check` passed.

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

No automated application unit, route-integration, or browser end-to-end tests
exist. Live source synchronization, resume parsing across all supported
formats, and real ATS autofill behavior were not re-run during this
implementation session.

## Current objective

Continue the application-tracking/Gmail-automation line of work, or address
the open items below, per user direction.

## Blockers

- There is no unified `npm test` command, although focused standalone suites
  now cover application tracking, Gmail parsing, resume tailoring, shared
  runtime behavior, queue outcomes, and integration automation.
- A production build can fail in a network-restricted environment because
  `next/font` fetches Google-hosted Geist assets.
- Real ATS forms and external source responses are unstable third-party
  dependencies; current compatibility is limited to the live and synthetic
  evidence recorded below.
- “Applied” and response outcomes remain local tracking data. The app has no
  verified employer receipt or response evidence.
- No fit score or resume-tailoring feature can guarantee ranking, an
  interview, or human review.

## Exact next recommended task

Prioritize one of the remaining independent items: start the scheduled Gmail
runner, extend error handling into API/Playwright internals, clarify the
rate-limited Gmail summary wording, decide the retained watcher file, or tune
the fit-scoring formula.

## 2026-07-30 bulk skill verification checkpoint

- The Profile evidence surface now offers “Verify all skills” whenever pending
  skill records exist. One confirmation verifies those pending skills without
  overwriting rejected skills or changing non-skill evidence.
- `PATCH /api/resume/evidence` supports the narrowly scoped
  `verify_all_skills` action for one validated resume ID and returns the
  refreshed evidence collection.
- The disposable resume-analysis route E2E now proves that pending skills are
  bulk-verified while a deliberately rejected skill remains rejected. The live
  resume and database were not changed during validation.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`
  passed.
- Next action: the user can open `/profile`, click “Verify all skills,” confirm
  once, and refresh any existing job analysis or tailored draft that should
  use the newly verified skills.

## 2026-07-30 full-resume inclusion correction

- Real-data metadata inspection showed why the generated PDF contained only a
  header, summary, skills, and duplicated additional-information content:
  53 non-skill records were still awaiting review, and letter-spaced PDF
  headings had classified the resume body as `other`. The master resume itself
  remained intact.
- Evidence extraction now recognizes compact/letter-spaced forms of Summary,
  Selected Impact, Core Skills, Professional Experience, Education, and
  Certifications. Existing evidence is reclassified in place without changing
  text or verification decisions.
- The Profile page now offers “Verify all resume content” with an explicit
  confirmation. It verifies only pending records and preserves rejected items.
- Existing approved variants and artifacts are immutable snapshots. After
  verifying the remaining content, the user must create, approve, and generate
  a new tailored variant to receive the complete resume body.
- Focused extraction/persistence tests, lint, strict TypeScript, production
  build, and the disposable resume analysis/variant/artifact route E2E passed.
  The E2E proved the full-content bulk boundary while preserving a rejected
  skill; it did not access or change live resume content.
- Next action: reload `/profile`, confirm “Verify all resume content,” then
  create and approve a new tailored draft for the job and generate fresh files.

## 2026-07-31 coordinate-aware PDF reconstruction

- A real generated variant exposed a second PDF-specific issue: visual line
  wraps had become separate evidence rows, while three side-by-side impact
  metrics on one baseline had been combined. The exporter was accurately
  reproducing already-broken evidence.
- PDF resume extraction now uses PDF.js text coordinates. It groups baselines,
  joins wrapped summary and experience lines, keeps line-break hyphenation,
  separates metric columns using their numeric anchors, keeps role/date
  headers intact, and assigns simultaneous education/certification columns to
  their correct sections.
- `POST /api/resume/reprocess` and the Profile “Repair PDF line breaks” action
  create a new resume revision from the unchanged stored master PDF. Previous
  evidence and variants remain immutable history. All-verified evidence state
  can carry forward; mixed verification requires review again.
- A synthetic coordinate-layout test covers summaries, three impact columns,
  wrapped experience bullets, role/date lines, and parallel final sections.
  Read-only structural validation against the stored PDF confirmed that the
  user-reported high-scale example is rejoined, the 40% and 60% metrics are
  separated, no experience row ends in a dangling hyphen, and experience
  fragments decrease from 33 to 24 without printing resume text.
- `npm run test:resume-layout`, `npm run test:resume-evidence`, lint, strict
  TypeScript, `git diff --check`, and the production build passed.
- After a recoverable SQLite backup, the live master PDF was reprocessed into
  a new local resume revision at the user's request. The prior resume,
  evidence, approved variants, and files remain unchanged. Because every prior
  evidence row was verified, verification carried forward to the reconstructed
  evidence. A fresh job-specific draft was created but deliberately left
  unapproved; the user must review and approve it before file generation.
- Next action: reload the job page, review the current draft, approve it, and
  generate new DOCX/PDF files. Do not reuse variant 6 or earlier artifacts.

Follow-up validation found two distinct states in the user's next variant:

- Variant 6 still referenced the pre-repair resume revision and therefore
  retained the original fragmented evidence. No repaired resume revision had
  been created yet.
- Its generated PDF contained the expected content, but round-trip validation
  incorrectly passed that single-column artifact through the new source-PDF
  layout reconstructor, producing 17 false missing-item results. Generated
  artifact validation now uses plain text extraction, while uploaded source
  PDFs alone use coordinate-aware reconstruction.
- The disposable artifact suite passed for both DOCX and PDF after the
  separation. Lint and strict TypeScript also passed.

On 2026-07-31, job-detail testing exposed one remaining generated-PDF
round-trip edge case:

- The current approved variant contained all expected content in DOCX. PDF
  extraction differed only in one long experience paragraph due to punctuation
  glyph normalization, reporting one false missing item.
- Validation now retains exact normalized matching first, then permits
  punctuation-insensitive matching only for narrative lines with at least
  three words. Compact values such as `C` and `C++` remain distinct.
- Focused assertions cover both the allowed long-line normalization and the
  strict short-token boundary. The full disposable DOCX/PDF artifact suite,
  lint, strict TypeScript, and `git diff --check` passed.

The next real job-detail review exposed a client-state issue rather than an
artifact-generation failure:

- Job 15442's approved variant and both validated artifacts existed, and a
  fresh page rendered both download links, while an already-open/restored tab
  could retain an older empty artifact state.
- Artifact GET responses now use `Cache-Control: no-store`; client artifact and
  variant reads bypass caches; restored or newly visible job tabs refresh the
  current files; and download links open separately so the job page remains
  available.
- Live browser verification on the local shared server confirmed visible DOCX
  and PDF links for variant 10, both targeting a separate tab. Lint, strict
  TypeScript, production build, and `git diff --check` passed.

The same variant review then identified insufficient visual hierarchy inside
Experience:

- DOCX and PDF now classify deterministic employment date-range rows as
  employer/date/location headers and render them bold. A short verified row
  immediately after a header renders as the bold italic role title;
  accomplishment rows stay normal.
- The classifier changes presentation only and preserves every evidence-backed
  line. A synthetic fixture verifies employer, role, and detail classification
  plus DOCX run formatting.
- Synthetic DOCX and PDF page images were visually inspected and showed the
  intended hierarchy without overlap or clipping. The focused artifact suite,
  lint, strict TypeScript, production build, and `git diff --check` passed.
- Variant 10 was regenerated on the local shared server. Both formats passed
  round-trip validation with 87 expected items and zero missing.

Follow-up review found that the first hierarchy rule recognized Oracle's
`year - Present` range but not prior roles ending in `Month year`.

- Employment-header recognition now accepts both endings. The regression
  fixture covers one current and two prior employers, their role titles, and
  an accomplishment row.
- A read-only check of the live variant classified three employer rows, three
  role rows, and eighteen detail rows. Variant 10 was regenerated again; DOCX
  and PDF both passed with 87 expected items and zero missing.
- The focused artifact suite, lint, strict TypeScript, production build, and
  `git diff --check` passed.

## 2026-07-31 concurrent feature reconciliation

- Claude's Gmail-alert import, application tracking, response/follow-up UI,
  top-fit application suggestions, and request-error handling were first
  integrated through the guarded workflow into `integration/concurrent-work`.
- That validated baseline was merged into `feature/codex-work`. Five textual
  conflicts were resolved additively: both handoff histories, resume and
  application job-detail state, upload evidence refresh plus network error
  handling, both SQLite schema/type families, and every focused test command.
- The shared autofill page merged textually; semantic review confirmed that
  application-source/error handling wraps rather than weakens the existing
  exact-resume selection and guarded submission behavior.
- `npm run test:applications`, `test:gmail-leads`, `test:action-center`, all
  five resume model/artifact suites, the disposable resume route E2E,
  two-instance shared-runtime route E2E, queue-runner checks, and the five-case
  integration automation suite passed. `npm run validate` then passed lint,
  strict TypeScript, and a production build registering all 27 merged routes.
- No live Gmail mailbox operation or real ATS submission was performed.
