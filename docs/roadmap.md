# Roadmap

The roadmap is constrained to capabilities and gaps visible in the repository. Priority ordering is a recommendation, not a committed delivery schedule.

## Implemented capabilities

- Local Next.js dashboard, profile, job detail, auto-fill, and application
  tracking pages.
- SQLite persistence for resumes, filters, normalized jobs, drafts, source configurations, remembered profile answers, match metadata, and local statuses.
- PDF, DOCX, and TXT resume extraction with editable curated skill detection.
- Immutable master-resume evidence extraction with explicit user
  verify/reject/edit controls for future truthful tailoring.
- Deterministic per-job requirement extraction and verified-evidence coverage,
  including required/preferred separation and transparent unevidenced gaps.
- Auditable, evidence-constrained per-job resume drafts with side-by-side
  source review, include/exclude controls, stale-input rejection, and explicit
  approval.
- Approved-only ATS-safe DOCX/PDF artifacts with preserved contact header,
  simple formatting, full round-trip text validation, visual PDF QA, and
  validated-only downloads.
- Exact-job autofill attachment selection with visible filename/source,
  user-selectable DOCX/PDF preference, current-evidence/posting checks, and
  safe master-resume fallback.
- Greenhouse and Lever public-board synchronization.
- Optional Adzuna keyword/location search with local environment credentials.
- Static curated Greenhouse/Lever source seeding.
- One-off public LinkedIn URL import without login or bulk crawling.
- Optional rate-limited Gmail LinkedIn-alert intake using explicitly
  configured local OAuth credentials and the `external_lead` review boundary.
- Local application, response, follow-up, response-rate, weekly-volume, and
  top-unsubmitted-fit tracking without claiming employer verification.
- Deterministic filters, hard exclusions, skill-overlap scoring, match explanations, ranking, status filtering, zero-score visibility, and pagination.
- Remote-only matching also enforces configured preferred locations, preventing geographically restricted remote roles from qualifying solely because they contain “remote.”
- Deterministic cover-letter and screening-answer generation.
- Visible Playwright browser sessions that scan and fill supported native and React-style controls.
- Stored resume attachment, ad hoc file attachment, and remembered semantic answers.
- Manual boundaries for sensitive/ambiguous controls and CAPTCHA/bot-block detection.
- Review-only autofill by default, plus explicit guarded auto-submit with conservative fallback and manual local status tracking.
- Explicit user-confirmed autofill completion: mark locally `applied` and advance only after the user says they submitted; allow closing without changing `new`.
- Auto-fill queue cards show stored matched and missing skills before the user starts filling.
- Dashboard Action Center prioritizes manual application work with readable
  reasons, exact persisted details when available, and status-specific actions.
- Concurrent worktrees can share one explicit runtime directory; expiring
  SQLite leases atomically keep separate local servers from opening the same
  autofill job.
- Autofill and queue-runner stop conditions feed structured, privacy-bounded
  reasons and field labels into the dashboard Action Center.
- Skill comparison uses conservative canonical aliases and labels results as mentioned/not mentioned in the posting; draft generation does not claim the user lacks an unmentioned target skill.
- A headless single-project Playwright integration script exercises the
  tailored-resume workflow against disposable runtime data: invalid and valid
  uploads, evidence verification, evidence-constrained tailoring, approval,
  validated artifact generation, and DOCX/PDF downloads.

## Stabilization work

- Add an automated test framework and `npm test` script. Start with pure modules: matching, skill extraction, TXT parsing, drafts, HTML cleanup, and source normalization.
- Add isolated SQLite/route integration tests that never touch the user's `data/app.db`.
- Expand controlled Playwright coverage beyond the tailored-resume generator
  to field matching, native selects, React-style comboboxes, embedded forms,
  browser closure, CAPTCHA boundaries, and confirmation that submit controls
  are ignored.
- Remove the production build's dependency on fetching Google Fonts at build time or otherwise provide a reproducible network-enabled build path.
- Add file-size, supported-content/MIME, and error handling limits to both upload endpoints.
- Add remote-fetch timeouts and response-size bounds, especially for the user-supplied LinkedIn page.
- Add retention/deletion behavior for old resumes, upload directories, drafts, and profile answers.
- Add source-configuration validation and deduplication.

## Near-term improvements

- Recompute stored job scores when profile filters or resume skills change, or clearly prompt the user to resync.
- Add draft editing and persistence before copy/use.
- Improve user-visible failure handling for profile, source, status, and file requests that currently assume successful JSON responses.
- Optionally add local completion notes or timestamps without implying employer verification.
- Add safe structured diagnostics for source and autofill failures while excluding personal data, page contents, cookies, answers, and credentials.
- Add a controlled way to choose among stored resumes rather than implicitly using only the latest.
- Clarify and test stale-job handling when a posting disappears from a configured source.

## Later enhancements

- Add authentication, authorization, and per-user data isolation before any hosted or multi-user deployment.
- Add encrypted-at-rest or OS-protected storage options for resumes and profile answers.
- Add scheduled synchronization only after rate limits, source terms, error isolation, and privacy behavior are defined.
- Expand source adapters only for APIs and user-authorized import mechanisms compatible with provider terms.
- Add richer matching only if explanations remain inspectable and users can distinguish heuristic suggestions from verified qualifications.
- Add multi-page application assistance while retaining visible operation, manual sensitive fields, CAPTCHA boundaries, and human-controlled submission.
- Add optional evidence capture for a user-confirmed submission outcome. This must not infer success from a closed window or a local `applied` label.

## Explicit uncertainty

- The repository contains comments describing live behavior observed on some Greenhouse, Lever, and embedded forms, but there is no automated test evidence or fixture set for those observations.
- Current compatibility with any particular ATS posting is uncertain because external markup and anti-bot behavior can change independently.
- LinkedIn public-page parsing may fail when markup, access policy, or blocking behavior changes.
- The accuracy of salary, location, remote, company, sponsorship, and job-status data is not independently verified.
- A network-restricted `npm run build` currently fails while fetching Google-hosted Geist fonts; a complete production build remains unverified in this environment.
- No timeline, deployment target, multi-user requirement, or external submission integration is specified in the repository.
