# Project TODO

## In Progress

- Start `scripts/gmail-sync-runner.sh` for scheduled Gmail sync -- the user
  asked for both on-demand (done, live) and scheduled; only the on-demand
  button has actually been run so far.
- Continue the API error-handling audit across remaining non-Auto-fill routes;
  all Auto-fill routes and Playwright fallback messages now have bounded,
  privacy-safe handling.
- Decide on the Gmail-sync summary message wording when a digest email's
  leads exceed the rate limit mid-thread (currently reads "Imported 5
  lead(s) from 0 alert email(s)", accurate but confusing).
- Decide whether to delete the untracked `data/watch-and-integrate.sh`
  scratch file (abandoned background-merge-watcher, never used).
- Tune the fit-scoring formula in `lib/matching.ts` per user judgment on
  what should weigh more (skills vs. salary vs. location, etc) -- explicitly
  deferred, not started.
- Review and validate the uncommitted workflow improvements: canonical skill aliases and mentioned/not-mentioned wording, removal of inaccurate draft skill-gap claims, Remote-only preferred-location enforcement, Auto-fill skill visibility, user-confirmed `applied`, close-without-marking, failure handling, and unchanged skip behavior.
- Manually verify the new opt-in "Auto-fill & submit" mode against a real, user-authorized test application before relying on it for real submissions -- static checks and a production build passed, but no live ATS run has confirmed the submit-control detection or confirmation logic yet.
- Retest Twilio's location autocomplete, grouped referral-source question, the narrowly allowlisted submit-mode policy acknowledgements, and exact manual-blocker messaging in a visible browser; static checks pass, but the live form has not been rerun after the latest fixes.
- Live-retest the pre-submit audit against a user-authorized ATS form and confirm the `UI-validation-error` toast matches the employer-rendered error without activating Submit.
- Live-test the unattended queue runner and verification-code recovery against user-authorized forms; confirm uncertain jobs are parked as `needs_review` or `needs_code` and no manual blocker is bypassed.

## Next

- Add deterministic fixtures for matching, skill extraction, TXT resume
  parsing, draft generation, HTML cleanup, and source normalization to the
  standard `npm test` suite.
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

- Hardened Auto-fill Inspect, Snapshot, and Next: bounded identifiers and
  errors, redacted state-bearing HTML attributes and URL secrets, preserved
  explicitly local screenshot review, and automatic claim release when queue
  response preparation fails. Invalid-GET route checks are in `npm test`.

- Hardened the first Auto-fill error-boundary tranche: malformed JSON and
  invalid job IDs receive bounded 400 responses, answer inputs are bounded,
  raw Playwright/path/URL failures are converted to actionable safe messages,
  and file-attachment failures now propagate so staged bytes are cleaned up.
  Focused and two-server route tests are part of `npm test`.

- Hardened ad hoc Auto-fill uploads with the same 10 MiB PDF/DOCX/TXT
  validation boundary as master resumes, bounded request metadata,
  collision-resistant staging, cleanup after stage/attachment failure, and a
  master pointer update only after successful live attachment. Disposable
  tests verify staging/cleanup and rejection before disk persistence.

- Added a 10 MiB ceiling plus extension, MIME, and real-content validation for
  master PDF/DOCX/TXT uploads. Rejected files are never inserted or stored;
  persistence is transactional and cleans up its new directory on failure.
  Focused validation and disposable route E2E cover malformed and disguised
  inputs without touching the live database.

- Fixed PDF resume uploads in the Next.js development server by keeping the
  directly imported `pdfjs-dist` package external, with a focused configuration
  regression in `npm test`. The user-authorized master PDF was re-uploaded
  through the normal route; stored bytes match the source, extracted text
  matches the prior master revision, and Auto-fill selected the durable master
  PDF for a job without a tailored variant. No employer form was opened or
  submitted.

- Live-verified per-job CV archiving against a real, user-authorized Greenhouse
  form in Auto-fill (review) mode. The form reached review with the resume
  field filled and only manual policy acknowledgements remaining; no submit
  control was activated and the browser was closed without marking Applied.
  The resulting archive stayed under the exact job directory, its recorded
  SHA-256 matched the archived bytes, and those bytes exactly matched the file
  selected for attachment. The job-detail history UI displayed the live row.

- Added an “Attached CV history” panel to each job-detail page with newest,
  master/tailored source, format, timestamp, short fingerprint, empty/error/
  loading states, and an exact-job download action. The metadata API never
  exposes local paths; downloads revalidate archive containment and SHA-256
  and reject cross-job, missing, or changed files. Disposable browser coverage
  verifies the populated and empty UI plus exact-byte download and refusal
  cases.

- Added per-job CV archiving: `lib/cvArchive.ts` snapshots the exact resume
  file about to be attached to an application form, content-addressed and
  linked directly to the job ID under `data/cv-archive/`, with a new
  `cv_archive` SQLite table, a call site in `lib/autofill/filler.ts` before
  attachment, and `npm run test:cv-archive` covering creation, idempotent
  re-attachment, history-on-change, isolation, and path-traversal safety.
  Lint, strict TypeScript, production build, and the existing
  `test:submission-guard` suite passed; live ATS verification is pending
  (see In Progress).

- Added a standard `npm test` command that runs all 14 existing deterministic
  suites sequentially with a disposable default runtime directory, isolated
  SQLite data, and temporary Playwright output. The complete suite, lint,
  strict TypeScript, and production build passed without accessing live data.

- Added the vendor-neutral `ship-feature` requirement-to-handoff workflow,
  project adapters for Claude Code and Gemini CLI, the universal
  `SHIP-FEATURE:` trigger, and a personal Codex `$ship-feature` skill with a
  bundled fallback for repositories that do not define their own workflow.
  The ownership-scoped workflow passed guarded integration into
  `integration/concurrent-work`, and the portable skill is also installed in
  the personal Claude skills directory for branch-independent discovery.

- Added a headless, isolated Playwright integration script for the complete
  tailored-resume generator workflow. It covers rejected and accepted upload
  inputs, bulk evidence verification, supported versus unevidenced tailoring,
  approval, round-trip artifact validation, and real DOCX/PDF download actions
  without reading or changing the user's runtime database.
- Redesigned the dashboard around manual work: explicit action reasons and
  urgency, one primary next step, five category counters, eight expanded
  highest-priority items, a clearer job pipeline, and expandable secondary
  source/import controls. Verified on the shared real-data server at desktop
  and 390×844 mobile widths with no overflow or browser-console errors
  (`bdb1b72`).

- Added one shared set of Figma design-system and implementation rules for
  Codex and Claude through `AGENTS.md` (which `CLAUDE.md` imports). The rules
  cover required Figma context/screenshots, component placement, Tailwind 4
  tokens, mobile-first responsive behavior, accessibility, architecture and
  privacy boundaries, asset handling, and visual/browser validation.
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
- Added a session-level submission guard for required/invalid fields (including consent controls), exact bounded error toasts, and deterministic Playwright coverage (uncommitted, awaiting live ATS retest).
- Added watchlist, verification-code, review, and external-lead workflow statuses; resumable jobs; serialized Playwright actions; guarded success watching; diagnostic inspect/snapshot routes; and an unattended queue runner that parks uncertain jobs (uncommitted, static validation passed).
- Established shared agent, session, workflow, architecture, and roadmap documentation.
- Added GitHub Actions quality checks (`933c4bc`), following the shared-context documentation commit (`d314240`).
- Verified `npm run lint` on 2026-07-29; documented the network-bound Google Fonts build failure.
