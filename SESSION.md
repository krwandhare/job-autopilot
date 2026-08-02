# Session Handoff

## Attached CV history review surface

On 2026-08-02, the job-detail page gained a read-only “Attached CV history”
panel. `GET /api/jobs/[id]/cv-archive` returns newest-first, privacy-bounded
metadata without `file_path`; the nested archive download route verifies the
archive belongs to the requested job, remains under that job's archive
directory, exists, and still matches its recorded SHA-256 before serving it.
The UI covers loading, failure, empty, long-filename, latest, master/tailored,
format, UTC timestamp, fingerprint, and touch-sized download states while
stating that local history is not employer-receipt evidence.

Focused archive checks, scoped ESLint, strict TypeScript, the production
build, `git diff --check`, and the full disposable `npm test` suite passed.
The tailored-resume Playwright suite now has two cases and verifies exact-byte
archive download, cross-job denial, tamper refusal, and empty history without
opening the live database or an employer form. Repository-wide `npm run lint`
is currently blocked only by 28 errors in user-owned, untracked Ruflo files
under `.claude/helpers/`; those files and the existing `.gitignore` change
were deliberately not modified.

The exact next recommended task is the still-pending live, user-authorized ATS
verification that the archived file matches the CV actually attached and that
best-effort archiving never delays or blocks attachment.

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

## Standard deterministic test command

On 2026-07-31, `npm test` was added as the single fail-fast entry point for
all 14 existing deterministic suites. `scripts/test-all.sh` exports a fresh
temporary `JOB_AUTOPILOT_DATA_DIR` before running model, workflow, route,
guarded-integration, shared-runtime, artifact, and headless browser checks in
sequence. Suites that use SQLite continue to create their own isolated files,
and Playwright output now goes under the aggregate temporary root, which is
removed on exit. The command never reads or writes the live `data/app.db`.

Validation passed: `npm test`, `npm run lint`, `npx tsc --noEmit`,
`npm run build`, `bash -n scripts/test-all.sh`, and `git diff --check`. The
first sandboxed aggregate run reached the artifact suite but macOS denied the
installed Chromium process its Mach port; the approved unsandboxed rerun
passed every suite, including the tailored-resume browser flow and disposable
two-server route test. No live database, resume, mailbox, employer page, or
application submission was accessed.

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

On 2026-08-01, per-job CV archiving was added via `SHIP-FEATURE:`. Two
decisions were confirmed with the user first: the archive is keyed directly
to the job ID (rather than, e.g., a separate lookup table) so the
post-submission review loop can find it by job, and archived files live
under the project's own `data/cv-archive/` runtime directory (ignored by
Git, matching `data/resumes/`) rather than an out-of-tree location like
`~/cv-archive`.

`lib/cvArchive.ts`'s `archiveCvForJob()` is called from
`lib/autofill/filler.ts` immediately before a selected resume file is
attached to a live application form (shared by review and submit mode). It
copies the exact bytes into `data/cv-archive/<jobId>/`, sanitizes the stored
filename, and records a new `cv_archive` row (source, original filename,
format, tailored variant ID, and a sha256 content hash) keyed to that job ID.
Archiving is content-addressed and idempotent per job -- re-attaching
identical bytes (e.g. reopening the review screen) reuses the existing row
and file instead of duplicating either -- and a failed archive attempt never
blocks the actual form attachment. `getLatestCvArchiveForJob()` and
`listCvArchiveForJob()` support later lookup; no UI surface consumes them
yet.

`scripts/test-cv-archive.mjs` (`npm run test:cv-archive`, added to
`scripts/test-all.sh`) covers first-archive creation, idempotent
re-attachment, a genuinely changed file creating new history rather than
overwriting it, per-job isolation, and that a path-traversal-style filename
never escapes the job's own archive subdirectory. `npm run lint`,
`npx tsc --noEmit`, `npm run build`, and the existing
`test:submission-guard` suite (to confirm no regression in the modified
resume-attachment call site) all passed. Live ATS verification of the actual
attach-then-archive sequence was not performed this session.

On 2026-08-01, the uncommitted autofill work gained a submission guard.
`lib/autofill/session.ts` audits visible enabled native/ARIA-required and
`aria-invalid` controls immediately before submit, including required consent
checkboxes/radio groups. Invalid forms return bounded labels plus exact
ATS-rendered/native errors without returning values/HTML and without clicking
Submit. The Auto-fill client renders an accessible `UI-validation-error`
toast. Three disposable Playwright cases cover required text/consent failures,
valid pass-through, and custom `aria-invalid` errors. `npm test`, lint, strict
TypeScript, production build, and diff checks passed. No live database,
employer form, or submission was used.

Job Autopilot is an implemented local MVP on `feature/codex-work`, currently
34 commits ahead of its remote tracking branch. The working application
includes profile/resume setup, configurable job-source synchronization,
one-off LinkedIn and Gmail lead intake, deterministic matching and ranking,
truthful job-specific resume tailoring, application tracking, guarded
visible-browser assisted form filling, and a shared-runtime concurrent-agent
workflow. There is no authentication layer, deployment configuration, or
employer-verified submission tracking.

The latest checkpoint adds an isolated, headless Playwright integration for
the complete tailored-resume generator workflow. It uses disposable runtime
data and covers upload rejection and acceptance, evidence verification,
truthful tailoring, approval, validated artifact generation, and DOCX/PDF
download actions. Existing APIs, SQLite records, status transitions, and
autofill safeguards are unchanged. Ignored local runtime artifacts remain
sensitive/generated and stayed uncommitted.

## Latest completed milestone and Git commit

The latest completed repository milestone is tailored-resume browser integration:

- `fe19aef` (`test: cover tailored resume generator flow`)

The preceding checkpoint is `da5a9a5` (`feat(ui): add expert error handling to
.cursorrules`), preceded by `4c6d5a8` (`feat(ui): add expert error handling to
app/profile/page.tsx`).

## Latest validation

On 2026-07-31, after the tailored-resume browser integration:

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed and generated all expected application and API routes.
- `npm run test:tailored-resume-generator` passed against disposable runtime
  data and verified both generated downloads. No live database, resume,
  employer page, or application submission was accessed.

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

## 2026-07-31 tailored-resume browser integration

- Added `tests/tailored-resume-generator.spec.ts`, a headless single-project
  Playwright integration script that starts the production app with a
  disposable runtime directory and SQLite database.
- The browser flow rejects an unsupported upload, uploads the synthetic TXT
  resume fixture, verifies extracted evidence, analyzes a synthetic posting,
  and confirms an unevidenced Python requirement is excluded while verified
  Kubernetes evidence remains in the tailored draft.
- The flow approves the job-specific variant, generates round-trip-validated
  DOCX and PDF artifacts, triggers both download links, and verifies that both
  downloaded files contain data. It does not inspect live application data,
  open an employer page, or submit anything.
- `npm run test:tailored-resume-generator`, `npm run lint`,
  `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The first
  sandboxed browser run could not bind its local test port; the approved local
  rerun passed.

Follow-up runner compatibility fix:

- Declared the package as ESM with `"type": "module"` so Node and external
  TypeScript runners consistently parse the test's imports and
  `import.meta.dirname` instead of treating the file as CommonJS.
- The repository contains no CommonJS `.js` modules; existing executable test
  helpers already use `.mjs`, so the package declaration matches the current
  source and script conventions.
- The retest also replaced the fixed default port with a per-process port and
  waits for the child server to exit before deleting its runtime directory,
  preventing stale-server readiness from racing a new disposable database.

Playwright test-runner discovery fix:

- Converted the self-executing script to the installed `playwright/test`
  runner API. All assertions now execute within the named
  `test("uploads, tailors, validates, and downloads a job-specific resume",
  async ({ page }) => { ... })` flow, with server lifecycle handled by
  `beforeAll`/`afterAll` hooks.
- The npm command now invokes `playwright test` with one worker and the line
  reporter, so the runner discovers, reports, and owns the headless Chromium
  page fixture instead of the file launching Chromium itself.
- `npx playwright test tests/tailored-resume-generator.spec.ts --list` found
  one named test. That test passed headlessly, and `npm run lint`,
  `npx tsc --noEmit`, `npm run build`, and `git diff --check` also passed.
