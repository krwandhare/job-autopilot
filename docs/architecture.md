# Architecture

## System shape

Job Autopilot is a local-first Next.js App Router application. Client components call same-origin route handlers; route handlers use local filesystem/SQLite services and, for selected operations, external job APIs or Playwright. An optional local shell queue runner calls those same routes; there is no separate backend service, hosted queue, authentication layer, or hosted database.

```text
Browser UI
  -> Next.js route handlers
     -> SQLite (`data/app.db`) and local resume files
     -> Greenhouse / Lever / Adzuna / one LinkedIn page
     -> visible Playwright Chromium -> employer or ATS application page
```

## Frontend routes

| Route | File | Responsibility |
| --- | --- | --- |
| `/` | `app/page.tsx` | Action Center for manual application steps and decisions, followed by source management, LinkedIn import, and the filterable job pipeline. |
| `/profile` | `app/profile/page.tsx` | Upload the latest resume, review/edit detected skills, and save matching filters. |
| `/jobs/[id]` | `app/jobs/[id]/page.tsx` | Display normalized job data, local status, score/reasons, matched/missing skills, and the latest generated draft. |
| `/autofill` | `app/autofill/page.tsx` | Work through the highest-ranked `new` job, launch filling, collect missing answers/files, show manual fields, and close/skip sessions. |

`app/layout.tsx` provides metadata, Google-hosted Geist fonts through `next/font`, and navigation. All four pages are client components except the root layout.

## API routes

| Method and route | Responsibility |
| --- | --- |
| `GET /api/resume` | Return the latest resume row. |
| `POST /api/resume` | Parse and store a PDF/DOCX/TXT resume, detect skills, save the original bytes, and record `file_path`. |
| `PATCH /api/resume` | Replace the detected/editable skills JSON for a resume ID. |
| `GET /api/resume/evidence` | Return extracted evidence for a selected or latest resume without mutating it. |
| `POST /api/resume/evidence` | Idempotently derive line-addressable evidence from one stored resume. |
| `PATCH /api/resume/evidence` | Edit the normalized representation and mark one evidence item extracted, verified, or rejected. |
| `GET /api/filters` | Return the latest filter row in UI-shaped JSON. |
| `PUT /api/filters` | Update the current filter row or insert one if absent. |
| `GET /api/sources` | List source configurations with parsed JSON. |
| `POST /api/sources` | Add a `greenhouse`, `lever`, or `adzuna` configuration. |
| `DELETE /api/sources` | Delete a source configuration by ID. |
| `POST /api/sources/seed` | Insert curated Greenhouse/Lever configurations that are not already present. |
| `GET /api/jobs` | Query jobs by optional status and zero-score visibility, sorted by score/fetch time, with 50-row pagination. |
| `GET /api/jobs/[id]` | Return one job, its latest draft, match details, and the current maximum possible score. |
| `PATCH /api/jobs/[id]` | Set a validated local status: `new`, `drafted`, `applied`, `rejected`, `skipped`, `watchlist`, `needs_code`, `needs_review`, or `external_lead`. |
| `POST /api/jobs/sync` | Fetch every configured source, score results, and upsert jobs. |
| `POST /api/jobs/import-url` | Import, score, and upsert exactly one user-supplied LinkedIn URL. |
| `POST /api/draft/[id]` | Generate and persist a deterministic draft from the latest resume and stored match result. |
| `GET /api/autofill/next` | Return the highest-score, newest-fetched `new` job, or a specifically requested job for resumption, with match and extracted posting details. |
| `POST /api/autofill/start` | Create/reuse a visible browser session and run the form scanner/filler. |
| `POST /api/autofill/answer` | Upsert a remembered answer by semantic key and attempt to fill the corresponding live field. |
| `POST /api/autofill/upload-file` | Store an ad hoc file and attach it to the live field; a resume-classified file also becomes the latest resume's canonical path. |
| `POST /api/autofill/finish` | Close and remove the in-memory browser session for a job. It does not update job status or verify submission. |
| `POST /api/autofill/submit` | In explicitly selected submit mode, conservatively locate and click the submit control and require a confirmation signal; otherwise return an unconfirmed/manual result. |
| `GET /api/autofill/inspect` | Return diagnostic metadata for a field in an open local browser session. |
| `GET /api/autofill/snapshot` | Return a diagnostic snapshot of an open local browser session. |
| `GET /api/actions` | Return prioritized unresolved manual actions and per-status counts for the dashboard Action Center, with safe status-derived fallback reasons. |

## SQLite persistence

`lib/runtimePaths.ts` resolves the runtime directory. It defaults to the
current worktree's `data/`, while `JOB_AUTOPILOT_DATA_DIR` points concurrent
worktrees at one shared directory. `lib/db.ts` opens `app.db` there through
`better-sqlite3`, sets WAL mode and a five-second busy timeout, caches the
connection on `global.__db`, and initializes:

- `resumes`: original filename, extracted text, detected/editable skills JSON, upload time, and migrated `file_path`.
- `filters`: a single currently used row containing title/location/remote/salary/skill/company rules.
- `jobs`: normalized source data, match score/reasons, local status, and a unique `(source, source_job_id)` key.
- `drafts`: immutable generated cover letters and JSON screening answers associated with a job.
- `source_configs`: source type and JSON configuration.
- `profile_answers`: one remembered answer per semantic field key.
- `job_actions`: structured unresolved/resolved manual-action reasons, details,
  source, and timestamps associated with jobs.
- `job_claims`: one expiring autofill lease per job and per runtime owner,
  including an unguessable token, heartbeat, and expiry timestamps.
- `resume_evidence`: line-addressable facts derived from one immutable master
  resume, retaining source text separately from the editable normalized value
  and an explicit extracted/verified/rejected status.

Initialization inserts a default filter row if none exists and adds `resumes.file_path` to older databases if necessary. There is no general migration framework. Foreign-key intent is expressed for drafts, but the code does not explicitly enable SQLite's `foreign_keys` pragma.

`job_actions` is created idempotently. The dashboard reads the latest unresolved
record for each actionable job. Existing jobs without a record remain useful:
their local status produces a conservative fallback explanation. Changing a
job to a non-actionable status resolves its open action records; callers may
attach validated structured action context when patching an actionable status.

Autofill start outcomes persist only safe local metadata: blocker category,
generic explanation, and up to ten field labels. Missing answers, manual
agreements, browser challenges, load/session failures, and review-ready forms
are parked as `needs_review`. A submit-time verification-code challenge is
parked as `needs_code`. The unattended queue runner can replace that context
with a more specific queue outcome such as unconfirmed submission. Answer
values, page HTML, cookies, credentials, and form payloads are never stored in
`job_actions`. Confirmed local completion resolves open actions.

Synchronization and URL import use upserts. They update normalized fields and scores without deleting stale jobs or overwriting the job's local status.

`lib/jobClaims.ts` acquires leases inside SQLite `BEGIN IMMEDIATE`
transactions. Queue selection excludes active leases, so two database
connections cannot select the same job. Queue display uses a five-minute
reservation; starting autofill renews it to two hours. Finishing deletes only
the current runtime owner's lease. Expired leases can be reclaimed after a
server crash. `JOB_AUTOPILOT_INSTANCE_ID` should be stable and unique for each
simultaneous server; otherwise a hostname/process-ID fallback is used.

## Resume processing

`app/api/resume/route.ts` reads the complete upload into memory. `lib/resume.ts` uses:

- `pdf-parse` for PDF text,
- `mammoth.extractRawText` for DOCX,
- UTF-8 decoding for TXT.

`lib/skills.ts` performs case-insensitive boundary matching against a curated vocabulary and a conservative canonical alias map (for example, NodeJS → Node.js, K8s → Kubernetes, and continuous integration → CI/CD). Users can edit the detected list in `/profile`. Extracted text and skills are stored in SQLite; original bytes are written to `data/resumes/<resume-id>/<sanitized-original-name>`. The route does not currently enforce file-size, MIME, retention, or cleanup limits.

`lib/resumeEvidence.ts` deterministically converts known resume sections,
lines, bullets, and detected skills into evidence records. Contact-like lines
are excluded. Extraction is idempotent and never rewrites the uploaded file or
stored source text. The Profile UI lets the user clarify and explicitly verify
or reject each item; later tailoring may use only verified evidence.

## Job-source integrations

All adapters return `NormalizedJob` from `lib/sources/types.ts`.

- `greenhouse.ts` calls the public board API with `content=true`; the configured slug is used as the company label.
- `lever.ts` calls the public postings API and uses the hosted listing URL.
- `adzuna.ts` calls the first US search page by default, uses environment credentials, and defaults to 20 results.
- `linkedinUrl.ts` accepts a manually supplied hostname ending in `linkedin.com`, fetches only that page without login, and extracts JobPosting JSON-LD with Open Graph/title fallbacks.
- `html.ts` decodes a limited entity set and strips tags for normalized descriptions.
- `seedCompanies.ts` is a static curated Greenhouse/Lever slug list; it is not a discovery crawler.

Remote detection is heuristic: “remote” in title or location (and LinkedIn employment type). External descriptions and metadata are untrusted and may be missing or inaccurate.

## Matching logic

`lib/matching.ts` assigns transparent points:

- included title term: 25,
- remote-only match: 10, or preferred-location match: 15,
- known salary meeting the minimum: 15,
- proportional target-skill overlap: up to 35.

Title include/exclude phrases match when every word appears somewhere in the title. Missing an included title, matching an excluded title/company, failing remote-only/location, or having a known salary below minimum forces the score to zero. When Remote-only and preferred locations are both configured, a job must be remote and its location text must match a preferred location; a role such as “Remote - India” does not satisfy a US preference. Unknown salary does not hard-fail the job.

Target skills are `requiredSkills` when configured, otherwise the latest resume's skills. Canonical names and conservative aliases are matched against the job title and description with alphanumeric boundaries. The stored `matchedSkills` and `missingSkills` fields mean “target skills mentioned in the posting” and “target skills not mentioned in the posting”; they do not describe skills the user possesses or lacks. The UI uses those clearer labels. Scores are displayed relative to a configuration-dependent `maxPossibleScore`; they are not an absolute confidence percentage.

Scores are computed on source synchronization or LinkedIn import. Saving new filters or resume skills does not itself rescore existing rows; another sync/import is required.

## Draft generation

`lib/draft.ts` is deterministic. It takes the first two sentence-like segments of the resume, incorporates up to six matched skills, and produces:

- a template cover letter,
- an interest answer,
- a relevant-experience answer.

Draft generation never interprets a target skill omitted from the posting as a skill the user lacks. `POST /api/draft/[id]` stores each generation as a new draft and the detail route returns only the latest. The UI then changes the local job status to `drafted`. There is no LLM, external generation service, fact verification, or persisted draft editing.

## Autofill pipeline

`lib/autofill/session.ts` keeps visible Playwright Chromium sessions in a
process-global map keyed by job ID. Sessions remain ephemeral, but SQLite job
claims stop a second local server from starting the same job while the first
lease is active. This is local coordination, not a distributed browser-session
store, and remains unsuitable for serverless deployment.

`lib/autofill/filler.ts`:

1. loads the job and opens its URL;
2. converts direct Lever listing URLs to `/apply`;
3. checks common load failures and CAPTCHA/bot-block signals;
4. resolves the page or a lazily loaded Greenhouse/Lever iframe;
5. asks `fieldMatcher.ts` to scan and tag controls with temporary `data-autofill-id` attributes;
6. fills the stored resume, latest draft or generated cover letter, and remembered profile answers;
7. returns missing fields and manual-only fields to the UI.

`fieldMatcher.ts` classifies semantic fields, native inputs/selects, React-style comboboxes, search-as-you-type controls, custom questions, sensitive exclusions, and grouped radio/checkbox controls. It collapses each option group into one answerable question while retaining policy acknowledgements and certifications as manual-only controls with their full parent question. Submit-mode orchestration has a narrow text allowlist for Twilio's Applicant Privacy Policy and Candidate AI Responsible Use Policy acknowledgements; it does not generalize to other agreements. Stored answers are checked against live options and re-surfaced when they no longer apply.

In opt-in submit mode, the filler locates and clicks a narrowly matched submit button only after all fillable questions are resolved and no manual-only controls remain. It requires a navigation or confirmation-text signal; otherwise it leaves the browser open and reports an unconfirmed result. `finish` only closes the browser and never proves employer receipt.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `lib/db.ts` | Connection, schema, compatibility alteration, and database row types. |
| `lib/runtimePaths.ts` | Shared/default data paths and validated runtime identity. |
| `lib/jobClaims.ts` | Atomic claim, renewal, expiry, and owner-safe release primitives. |
| `lib/resume.ts` | File-format-specific text extraction. |
| `lib/resumeEvidence.ts` | Deterministic evidence extraction, idempotent persistence, and API serialization. |
| `lib/skills.ts` | Curated vocabulary, conservative aliases, boundary-aware detection, and posting-match checks. |
| `lib/matching.ts` | Filter types, scoring, hard failures, and score ceiling. |
| `lib/draft.ts` | Template-based cover letters and screening answers. |
| `lib/sources/*` | External fetch/parsing and normalization. |
| `lib/autofill/session.ts` | Playwright browser lifecycle. |
| `lib/autofill/captcha.ts` | Visible CAPTCHA and bot-block heuristics. |
| `lib/autofill/fieldMatcher.ts` | Live form discovery, classification, and select/combobox interaction. |
| `lib/autofill/filler.ts` | Database-to-form orchestration and error recovery. |

## Data flow

```text
Resume upload -> extract text -> detect/edit skills -> SQLite + local file
                              -> evidence extraction -> user verification
Filters ----------------------------------------------------------+
Source config -> external source -> NormalizedJob -> scoreJob -----+-> jobs table
LinkedIn URL -> one public page -> NormalizedJob -> scoreJob ------+

jobs table -> dashboard/detail -> generateDraft -> drafts table
highest-ranked local `new` job + latest resume/draft + profile answers
  -> visible Playwright form
  -> missing answers/files from user
  -> review in employer window
  -> human-controlled submit, outside verified app state
```

## Security boundaries

- The intended trust boundary is one local user. API routes have no authentication, CSRF protection, rate limiting, or multi-user isolation.
- `.env.local`, SQLite files, WAL/SHM files, and `data/resumes/` are Git-ignored and must remain private.
- Server code can read/write local files and launch a browser; client code should never receive credentials or internal paths.
- Resume contents and remembered answers are highly sensitive. Current storage is unencrypted local disk.
- External APIs, LinkedIn HTML, job descriptions, and ATS pages are untrusted inputs.
- The LinkedIn importer restricts the hostname suffix but has no response-size or fetch-time limit in application code.
- Uploads sanitize basenames but currently lack explicit size/MIME/content validation and cleanup.
- CAPTCHA and detected bot-block pages stop automated filling. The system must not bypass them.
- Sensitive identifiers/password-like fields, acknowledgements, certifications, and ambiguous choices are manual-only. Ordinary option groups are answerable but are never guessed.
- Local status values, salary strings, sponsorship answers, and “ready for review” are not evidence of employer facts or successful submission.
