# Verified Workflows

This document describes behavior present in the repository. “Implemented” means there is a code path; it does not mean every external service or ATS variant has been tested in this documentation session. Incomplete and proposed behavior is labeled explicitly.

## Profile and resume setup

### Implemented

1. Open `/profile`.
2. The page loads the latest resume and current filter row.
3. Upload one PDF, DOCX, or TXT file.
4. `POST /api/resume` reads it into memory, extracts text, detects curated
   skills, inserts a resume row, stores the original bytes under a per-resume
   local directory, and records that path. PDF extraction uses text
   coordinates to reconstruct wrapped lines and separate side-by-side content
   rather than trusting the PDF object's internal source order.
5. Review the detected skills. Adding/removing a skill calls `PATCH /api/resume`.
6. In Verified career evidence, “Verify all skills” marks every skill still
   awaiting review as verified in one confirmed action. It preserves rejected
   skills and does not bulk-approve experience, achievements, or other claims.
7. If the user has already reviewed the entire uploaded master resume,
   “Verify all resume content” can verify every remaining extracted item with
   one explicit confirmation. Rejected items remain rejected. Letter-spaced
   PDF headings are normalized so summary, skills, experience, education, and
   certification content retain their resume section types.
8. Configure title include/exclude terms, preferred locations, remote-only, minimum salary, required skills, and excluded companies.
9. Save filters through `PUT /api/filters`.

For a PDF uploaded before coordinate-aware extraction existed, “Repair PDF
line breaks” calls `POST /api/resume/reprocess`. It creates a new local resume
revision that shares the unchanged original file, preserving the older resume,
evidence, and variants for audit. When every old evidence row was verified,
verification carries forward because the repair only reconstructs the same
source text; otherwise the reconstructed evidence remains pending. A new
tailored draft is always required after repair.

Generated-artifact validation deliberately uses plain text extraction rather
than source-resume layout reconstruction. The latter joins and reorganizes
positioned source fragments; applying it to Job Autopilot's already
single-column PDF would create false missing-item failures even when the
generated file contains every expected line.

Round-trip validation first requires exact normalized text. For narrative
lines of at least three words, it also permits a punctuation-insensitive match
because PDF text extraction can normalize hyphens, dashes, or similar glyphs.
Short skills and values remain strict so `C`, `C++`, and other compact tokens
cannot be treated as interchangeable.

### Incomplete or unverified

- Upload size, MIME, malware, retention, deletion, and cleanup controls are not implemented.
- The latest uploaded resume remains the master. An approved, validated
  job-specific variant can override it only for that exact job in autofill.
- Saving a resume or filters does not rescore existing jobs immediately. Run synchronization or re-import a URL to compute new scores.
- PDF/DOCX/TXT parsing was not exercised during this documentation session.

## Job discovery and synchronization

### Implemented

1. On `/`, add a Greenhouse company slug, Lever company slug, or Adzuna keyword/location query.
2. Optionally click “Add all known companies” to insert missing configurations from the static curated seed list.
3. Click “Sync jobs.”
4. `POST /api/jobs/sync` loads every source configuration, current filters, and latest resume skills.
5. Each adapter fetches and normalizes its jobs. A failure is collected per source while other sources continue.
6. Each normalized job is scored and upserted by `(source, source_job_id)`.
7. The dashboard reloads jobs sorted by score descending and fetch time descending.

The dashboard shows 50 jobs per page, hides score-zero jobs by default, supports local status filtering, and can show non-matches.

Before the job pipeline, the dashboard Action Center groups work that requires
the user: verification codes, manual application review, external leads,
drafts, and watchlist decisions. Each item states why the user is needed,
shows up to three exact persisted details when available, and exposes one
status-specific primary action plus job details. Summary cards show counts and
filter the pipeline to the selected status.

Action reasons are persisted separately from local job status. If older code
sets only an actionable status, the dashboard uses a conservative fallback
reason rather than inventing an exact blocker. A caller can include structured
action context in `PATCH /api/jobs/[id]`; route validation bounds reason and
detail sizes. Moving to a non-actionable status resolves open action records.

Autofill and the unattended queue runner populate this context automatically.
They store a safe category and field labels for unanswered questions, manual
fields/agreements, browser challenges, autofill failures, final review,
verification codes, unconfirmed submission, and submission errors. They never
persist field values, cookies, page HTML, credentials, or application payloads.

### Incomplete or unverified

- There is no scheduler/background sync; synchronization is user-triggered.
- Missing postings are not removed when a source no longer returns them.
- Source configurations are not deduplicated by the regular add endpoint.
- Greenhouse/Lever discovery is a curated list plus manual slugs, not global search.
- Adzuna requires local credentials and currently fetches only the first result page.
- External source calls were not run during this documentation session.

## Importing a job by URL

### Implemented

1. Find a public LinkedIn job posting manually.
2. Paste that single URL into the dashboard and click “Import.”
3. `POST /api/jobs/import-url` requires a URL whose parsed hostname ends with `linkedin.com`.
4. The server fetches exactly that page without login.
5. It prefers JobPosting JSON-LD and falls back to Open Graph/title metadata.
6. The normalized job is scored and upserted, then appears in the dashboard subject to the current filters.

### Incomplete or unverified

- There is no LinkedIn search, crawling, bulk import, login, or session reuse.
- LinkedIn can block or change public markup; import success is not guaranteed.
- Fetch timeout and response-size limits are not implemented in application code.
- Parsed company, salary, location, remote status, and description are third-party data and are not independently verified.

## Matching and ranking

### Implemented

Scoring happens during sync/import. Included titles, location/remote, known salary, and skill overlap add points. Excluded titles/companies and failed configured constraints can force zero. Required skills take precedence; otherwise latest resume skills are targets. Skill comparison uses conservative canonical aliases such as NodeJS/Node.js, K8s/Kubernetes, RESTful/REST, and continuous integration/CI/CD. If Remote-only and preferred locations are both set, both constraints must pass; a remotely labeled role in a different configured geography is scored zero.

The dashboard ranks by stored score and the detail page explains stored reasons. The denominator is the maximum possible score for currently configured categories, not always 100.

### Important limitations

- Matching is boundary- and alias-based, deterministic, and intentionally conservative; unlisted synonyms can still be missed.
- “Your skills not mentioned in posting” means the posting text omitted those target skills. It does not mean they are absent from the profile/resume or that the user lacks them.
- Unknown salary is not rejected by a minimum salary filter.
- Remote detection is text heuristic.
- Scores can become stale after filter/resume changes until the job is rescored.
- Existing jobs must be synchronized again after changing location rules or preferences.
- A match score is not evidence of qualification, sponsorship, compensation, or hiring likelihood.

## Job-detail review

### Implemented

1. Open `/jobs/[id]`.
2. Review source data, original-posting link, local tracking status, score reasons, and matched/missing skills.
3. Manually choose `new`, `drafted`, `applied`, `rejected`, or `skipped`.
4. If a draft exists, the latest draft is displayed.

### Important limitation

Statuses are local labels only. Setting `applied` does not submit anything and is not evidence that an employer received an application. Source fields and salary text should be checked against the original posting.

## Draft generation

### Implemented

1. From job detail, click “Generate draft.”
2. The route requires the job and a latest resume.
3. It uses stored match data and deterministic templates to generate a cover letter and screening answers.
4. It inserts a new draft row; the UI displays it and updates the local status to `drafted`.
5. The user reviews and copies the text into an application as appropriate.

### Incomplete or unverified

- Drafts are not AI-generated and do not receive external fact checking.
- The UI does not persist edits to draft text.
- Resume text, job data, and skill heuristics can produce awkward or unsupported wording. Every claim requires human review.

## Autofill session

### Implemented

1. Open `/autofill`.
2. `GET /api/autofill/next` atomically reserves the highest-score,
   newest-fetched unclaimed job with local status `new` for the current runtime
   instance. A `jobId` query parameter can reserve and resume a parked job
   directly. A job leased by another local runtime returns a conflict instead
   of opening twice. The Auto-fill card displays salary, extracted
   responsibilities/qualifications, skills mentioned in the posting, and known
   posting skills absent from the resume, plus the exact resume filename and
   whether it is an approved job-specific artifact or the master fallback.
3. Click “Start filling.”
4. The server verifies or acquires the current runtime's claim, extends it from
   a five-minute queue reservation to a two-hour browser-session lease, then
   launches a non-headless Chromium window and opens the stored job URL.
5. Direct Lever listing URLs are changed to `/apply`.
6. The filler checks page failures and visible CAPTCHA/bot-block signals.
7. It resolves the page itself or a lazy Greenhouse/Lever iframe, scans fields, and tags them with ephemeral IDs.
8. It attaches the exact job's current approved and round-trip-validated
   tailored artifact when one exists. DOCX is the default unless PDF was
   explicitly selected. A different job, changed posting/resume/evidence,
   missing file, or absent approval falls back to the master resume. A failed
   attachment is surfaced for manual handling rather than silently ignored.
9. The UI asks for remaining values; saved answers are reused by semantic key on later jobs. A grouped radio/checkbox question is presented once with its real options instead of once per option.
   Search-as-you-type location controls are cleared before retries, wait for their live suggestion list, and may retry a shorter city query; success still requires clicking a real suggestion.
10. Policy acknowledgements, certifications, and other agreement checkboxes retain their full parent question and remain manual-only by default. In explicitly selected submit mode, the two narrowly allowlisted Twilio Applicant Privacy Policy and Candidate AI Responsible Use Policy acknowledgements are checked automatically after the confirmation dialog names that behavior; all other agreements remain manual.
11. When filling is complete, review mode leaves the employer window open. Opt-in submit mode proceeds only when no manual-only fields remain; otherwise the UI lists the exact blocking questions and states that refusal happened before any submit click.

### Incomplete or unverified

- Browser sessions live only in one server process and disappear on restart.
- Real forms vary continuously; “ready for review” means no currently detected fillable values are missing, not that the form is valid or complete.
- No end-to-end ATS form was exercised in this documentation session.
- Authentication, multi-page applications, unexpected navigation, and every custom widget are not guaranteed.

## File upload during autofill

### Implemented

- A missing file field can be answered from the Auto-fill UI.
- The queue and actual filler share one exact-job resume selector, so the file
  previewed to the user is the one the filler attempts to attach.
- The file is written under a unique local subdirectory while preserving a sanitized clean basename.
- Playwright attaches that path to the live input.
- If the semantic field key is `resume`, the latest resume row's canonical `file_path` is updated for future jobs.
- Users can choose “Prefer not to answer,” which stores a skip sentinel for that semantic key.

### Incomplete

- Ad hoc uploads have no automatic cleanup, size/MIME validation, or user-visible file manager.
- The upload endpoint can report success even though lower-level filling catches some browser failures; the open employer window must be checked.

## CAPTCHA and manual intervention

### Implemented

- Visible CAPTCHA frames and common bot-block page phrases return a blocked state.
- Invisible/background CAPTCHA frames are not automatically treated as a human challenge.
- Government-ID/SSN/password-like fields are excluded from automatic filling.
- Grouped radio/checkbox questions are presented once with their actual options. Policy acknowledgements, certifications, sensitive controls, and otherwise ambiguous fields remain manual.
- Load failures and disconnected/closed browser sessions are converted to user-facing errors.
- Email/SMS verification-code challenges are never filled automatically. A blocked submit can move the job to `needs_code` for later resumption.
- When autofill stops for a human decision, the job is parked with a structured
  Action Center reason and safe blocker labels. A later applied/skipped/rejected
  transition resolves that open action.
- Playwright actions for one job are serialized, and opening a new session closes any other tracked browser session.
- Concurrent local servers coordinate through expiring SQLite job claims.
  Finishing a session releases only its owning runtime's claim; a crashed
  process leaves a lease that becomes reclaimable after expiry.

### Required human behavior

Complete CAPTCHA or sensitive/ambiguous questions manually in the visible browser. Do not ask an agent to bypass bot controls. Review every automatically filled value, uploaded file, checkbox, dropdown, cover letter, and screening response.

## Application completion

### Implemented boundary

Review mode never clicks an employer submit control. The separately selected opt-in submit mode clicks a conservatively matched submit control only when filling is complete and no manual-only fields remain. A refusal lists the exact blockers; CAPTCHA, an unknown submit control, or an unconfirmed result falls back to the open employer window.

- **“I submitted it — mark Applied & next”** is an explicit user confirmation. It first patches the local job status to `applied`, verifies that update succeeded, then closes the Playwright session and loads the next local `new` job.
- If the status update fails, the UI displays an error, keeps the browser session open, and does not advance.
- **“Close without marking Applied”** closes the Playwright session without changing status. The current job remains `new` and can be started again.
- CAPTCHA, load-error, and generic completion paths can close a session but never set `applied`.
- Skipping explicitly updates status to `skipped`, closes the session, and advances as before.
- “Save for later” moves a job to `watchlist`. The optional local queue runner processes only `new` jobs and parks unresolved work as `needs_review` or `needs_code`.
- Queue parking sends structured action context through the validated job-status
  route. Missing/manual field labels are retained locally, while answer values
  and page contents are excluded.
- After an unconfirmed submit that requires manual completion, a read-only watcher can recognize a later success page, mark the local job `applied`, and close the session. It never types or clicks.

### Not implemented

- employer/ATS receipt verification;
- confirmation-page or confirmation-email capture;
- verified synchronization of applied/rejected status;
- proof of sponsorship or compensation;
- reliable detection that the user submitted before clicking “Done.”

The local `applied` value records only what the user confirmed. It is not proof that the employer received the application. Therefore, never report successful submission or employer-side application status from this app unless separate verified evidence is provided.

## Concurrent-agent integration

Codex and Claude work from separate feature branches and worktrees. Task
allowlists under `config/agent-tasks/` constrain the files each feature is
expected to change. `scripts/integrate-branch.sh` compares the source branch
with the integration target, rejects out-of-scope paths, performs the merge in
a disposable detached worktree, and runs `npm run validate`.

For simultaneous application testing, each worktree starts with a distinct
runtime identity and port:

```bash
npm run dev:shared -- codex 3002
npm run dev:shared -- claude 3003
```

The launcher points both processes at the primary worktree's ignored `data/`
directory. SQLite WAL mode and a busy timeout coordinate ordinary database
access, while `job_claims` prevents both runtimes from reserving or starting
the same autofill job. Resume uploads are also written beneath the shared
runtime directory, keeping stored database paths valid in both worktrees.

`npm run test:shared-runtime-routes` starts two production servers with
different instance IDs against one disposable SQLite directory. Using only
synthetic jobs, it verifies distinct queue claims, HTTP 409 for cross-owner
resumption, owner-safe release/reclaim, structured action persistence through
the real routes, and zero remaining claims after cleanup.

Each agent creates focused checkpoint commits on its own feature branch without
requiring a repeated user instruction: after a coherent validated unit,
normally every 30–90 minutes, and before a task switch or session handoff.
Elapsed time alone never justifies committing broken or incoherent work. The
integrator rejects a checked-out source branch with tracked or untracked
changes, preventing an apparently successful merge that silently omits the
agent's unfinished local diff.

Without `--apply`, the command is a complete dry run. With `--apply`, it
creates the merge commit only after validation and atomically advances
`integration/concurrent-work`. If that branch moved during validation, the
compare-and-swap update fails instead of overwriting the newer work.

The automation intentionally does not resolve conflicts. A conflict or failed
validation leaves both branch refs unchanged. After both feature branches pass
the integration queue, the combined integration branch receives final
shared-database and browser testing before a reviewed merge to `main`.
