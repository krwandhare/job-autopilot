# Architecture

## System shape

Job Autopilot is a local-first Next.js App Router application. Client components call same-origin route handlers; route handlers use local filesystem/SQLite services and, for selected operations, external job APIs or Playwright. There is no separate backend service, worker, queue, authentication layer, or hosted database.

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
| `/` | `app/page.tsx` | Dashboard: configure/delete/seed sources, run synchronization, import one LinkedIn URL, filter and paginate jobs, and open job details. |
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
| `GET /api/filters` | Return the latest filter row in UI-shaped JSON. |
| `PUT /api/filters` | Update the current filter row or insert one if absent. |
| `GET /api/sources` | List source configurations with parsed JSON. |
| `POST /api/sources` | Add a `greenhouse`, `lever`, or `adzuna` configuration. |
| `DELETE /api/sources` | Delete a source configuration by ID. |
| `POST /api/sources/seed` | Insert curated Greenhouse/Lever configurations that are not already present. |
| `GET /api/jobs` | Query jobs by optional status and zero-score visibility, sorted by score/fetch time, with 50-row pagination. |
| `GET /api/jobs/[id]` | Return one job, its latest draft, match details, and the current maximum possible score. |
| `PATCH /api/jobs/[id]` | Set a validated local status: `new`, `drafted`, `applied`, `rejected`, or `skipped`. |
| `POST /api/jobs/sync` | Fetch every configured source, score results, and upsert jobs. |
| `POST /api/jobs/import-url` | Import, score, and upsert exactly one user-supplied LinkedIn URL. |
| `POST /api/draft/[id]` | Generate and persist a deterministic draft from the latest resume and stored match result. |
| `GET /api/autofill/next` | Return the highest-score, newest-fetched job whose local status is `new`. |
| `POST /api/autofill/start` | Create/reuse a visible browser session and run the form scanner/filler. |
| `POST /api/autofill/answer` | Upsert a remembered answer by semantic key and attempt to fill the corresponding live field. |
| `POST /api/autofill/upload-file` | Store an ad hoc file and attach it to the live field; a resume-classified file also becomes the latest resume's canonical path. |
| `POST /api/autofill/finish` | Close and remove the in-memory browser session for a job. It does not update job status or verify submission. |

## SQLite persistence

`lib/db.ts` opens `data/app.db` through `better-sqlite3`, sets WAL mode, caches the connection on `global.__db`, and initializes:

- `resumes`: original filename, extracted text, detected/editable skills JSON, upload time, and migrated `file_path`.
- `filters`: a single currently used row containing title/location/remote/salary/skill/company rules.
- `jobs`: normalized source data, match score/reasons, local status, and a unique `(source, source_job_id)` key.
- `drafts`: immutable generated cover letters and JSON screening answers associated with a job.
- `source_configs`: source type and JSON configuration.
- `profile_answers`: one remembered answer per semantic field key.

Initialization inserts a default filter row if none exists and adds `resumes.file_path` to older databases if necessary. There is no general migration framework. Foreign-key intent is expressed for drafts, but the code does not explicitly enable SQLite's `foreign_keys` pragma.

Synchronization and URL import use upserts. They update normalized fields and scores without deleting stale jobs or overwriting the job's local status.

## Resume processing

`app/api/resume/route.ts` reads the complete upload into memory. `lib/resume.ts` uses:

- `pdf-parse` for PDF text,
- `mammoth.extractRawText` for DOCX,
- UTF-8 decoding for TXT.

`lib/skills.ts` performs case-insensitive boundary matching against a curated vocabulary. Users can edit the detected list in `/profile`. Extracted text and skills are stored in SQLite; original bytes are written to `data/resumes/<resume-id>/<sanitized-original-name>`. The route does not currently enforce file-size, MIME, retention, or cleanup limits.

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

Title include/exclude phrases match when every word appears somewhere in the title. Missing an included title, matching an excluded title/company, failing remote-only/location, or having a known salary below minimum forces the score to zero. Unknown salary does not hard-fail the job.

Target skills are `requiredSkills` when configured, otherwise the latest resume's skills. The stored result includes score, matched/missing skills, and reasons. The UI displays scores relative to a configuration-dependent `maxPossibleScore`; scores are not an absolute confidence percentage.

Scores are computed on source synchronization or LinkedIn import. Saving new filters or resume skills does not itself rescore existing rows; another sync/import is required.

## Draft generation

`lib/draft.ts` is deterministic. It takes the first two sentence-like segments of the resume, incorporates up to six matched skills, and produces:

- a template cover letter,
- an interest answer,
- a relevant-experience answer,
- optionally, an answer about up to three missing skills.

`POST /api/draft/[id]` stores each generation as a new draft and the detail route returns only the latest. The UI then changes the local job status to `drafted`. There is no LLM, external generation service, fact verification, or persisted draft editing.

## Autofill pipeline

`lib/autofill/session.ts` keeps visible Playwright Chromium sessions in a process-global map keyed by job ID. Sessions are ephemeral and unsuitable for serverless/multi-process deployment.

`lib/autofill/filler.ts`:

1. loads the job and opens its URL;
2. converts direct Lever listing URLs to `/apply`;
3. checks common load failures and CAPTCHA/bot-block signals;
4. resolves the page or a lazily loaded Greenhouse/Lever iframe;
5. asks `fieldMatcher.ts` to scan and tag controls with temporary `data-autofill-id` attributes;
6. fills the stored resume, latest draft or generated cover letter, and remembered profile answers;
7. returns missing fields and manual-only fields to the UI.

`fieldMatcher.ts` classifies semantic fields, native inputs/selects, React-style comboboxes, search-as-you-type controls, custom questions, sensitive exclusions, and grouped radio/checkbox controls. Stored select answers are checked against the live options and are re-surfaced when they no longer apply.

The filler does not locate or click submit buttons. `finish` only closes the browser. It does not prove or record an employer submission.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `lib/db.ts` | Connection, schema, compatibility alteration, and database row types. |
| `lib/resume.ts` | File-format-specific text extraction. |
| `lib/skills.ts` | Curated vocabulary and deterministic skill detection. |
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
- Sensitive identifiers/password-like fields and grouped choices are manual-only.
- Local status values, salary strings, sponsorship answers, and “ready for review” are not evidence of employer facts or successful submission.
