# Session Handoff

## Current project state

Job Autopilot is an implemented local MVP on the `main` branch. The working application includes profile/resume setup, configurable job-source synchronization, one-off LinkedIn URL import, deterministic matching and ranking, deterministic draft generation, local status tracking, and visible-browser assisted form filling. There is no automated test suite, authentication layer, deployment configuration, or verified submission tracking.

At this documentation baseline, application source is unchanged. The local workspace contains ignored runtime artifacts such as the SQLite database, resume uploads, environment configuration, dependencies, and Next.js build output; they are sensitive or generated and must remain uncommitted.

## Latest completed milestone and Git commit

The latest completed application milestone is **“job search, profile, and autofill foundation”**, committed as:

- `3059f22464e81f9097fcbdfde24ce43c97563072` (`3059f22`)
- Commit date: 2026-07-29
- Subject: `feat: add job search, profile, and autofill foundation`

The only earlier commit is `70dc5b1`, the initial Create Next App scaffold.

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
- Preserve the core safety boundary: the app does not click submit.

## Important architecture decisions

- The app is local-first and single-user; it has no authentication.
- SQLite at `data/app.db` is the system of record for app state. WAL mode is enabled and schema setup is lazy/idempotent.
- Resume files remain on local disk under `data/resumes/`; extracted text and skills are stored in SQLite.
- All job sources normalize to a shared `NormalizedJob` structure before scoring and persistence.
- Matching is transparent and deterministic, not ML/LLM-based. Configured hard exclusions force score zero.
- Draft generation is a deterministic template, not an external AI call.
- Source synchronization rescans current source results but does not delete postings absent from a later fetch.
- Job statuses are local user-entered workflow labels and are not synchronized with employer systems.
- Autofill uses a visible, in-memory Playwright session keyed by job ID. It fills for review, never submits, and cannot prove application completion.
- Sensitive or ambiguous fields and CAPTCHA challenges are manual boundaries.

## Validation already performed

On 2026-07-29:

- `npm run lint` passed with no reported errors.
- `npm run build` reached the optimized production build but failed because the restricted environment could not fetch Geist and Geist Mono from Google Fonts through `next/font`. No source compilation error was reported before that external-resource failure.
- Repository scope was checked with `git status`; no application source changes were made by this documentation task.

No automated unit, integration, or end-to-end tests exist. Live source synchronization, resume parsing across all supported formats, and real ATS autofill behavior were not re-run during this documentation session.

## Current objective

Stabilize the foundation before expanding automation: add repeatable automated coverage for deterministic core behavior and route-level persistence while preserving the no-submit safety boundary.

## Blockers

- There is no test framework, fixtures, or `npm test` command.
- A production build cannot be fully validated in the current network-restricted environment because `next/font` fetches Google-hosted Geist assets.
- Real ATS forms and external source responses are unstable third-party dependencies; their current end-to-end behavior is unverified in this session.
- “Applied” is only a manual local status. The app has no verified employer receipt or submission evidence.

## Exact next recommended task

Add a minimal automated test setup and repository-local fixtures for `lib/matching.ts`, `lib/skills.ts`, `lib/resume.ts` TXT handling, `lib/draft.ts`, and source normalization/HTML parsing; add an `npm test` script, run it with lint, and document the results without changing submission behavior.
