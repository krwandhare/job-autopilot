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

## Current objective

Truthful per-job resume tailoring is implemented and validated through local
model, route, artifact, and visual PDF checks. The next product priority is
separate from this completed feature.

## Blockers

- There is no unified test framework or `npm test` command; focused standalone
  test scripts exist for several modules, including resume evidence.
- Real ATS forms and external source responses are unstable third-party dependencies; their current end-to-end behavior is unverified in this session.
- “Applied” remains a user-confirmed local status. The app has no verified employer receipt or submission evidence.
- No ATS or resume-tailoring feature can guarantee ranking, an interview, or
  human review because employer screening rules are undisclosed.

## Exact next recommended task

Perform a user review of the new Profile evidence and job-detail tailoring
workflow with the real local resume, then create one approved variant for a
non-destructive test job and inspect both downloaded formats before relying on
tailored attachments in a real application.

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
