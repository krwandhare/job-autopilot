# Project TODO

## In Progress

- Implement the shared-runtime and atomic job-claim foundation before either
  feature branch changes application behavior.
- Live-run and verify `scripts/import-gmail-leads.mjs` against a real server
  once shared-runtime lands (or the user authorizes running against the
  original worktree): confirm dedup, rate limiting, and `external_lead`
  tagging behave as designed with real Gmail-extracted LinkedIn URLs.
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
