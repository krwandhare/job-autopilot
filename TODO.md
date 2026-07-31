# Project TODO

## In Progress

- Live-run and verify Claude's Gmail-alert LinkedIn lead importer through the
  shared runtime, using its existing rate limit and `external_lead` boundary.
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
