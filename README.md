# Job Autopilot

Finds job postings that match your resume/filters, scores them, and drafts a cover letter +
screening-question answers for you to review — you always click submit yourself.

## What it does

- **Resume**: upload a PDF/DOCX/TXT resume; it extracts text and a skills list (editable).
- **Job sources**:
  - Greenhouse and Lever company job boards (public APIs, no key needed) — add a company slug on the dashboard.
  - Adzuna keyword/location search (needs a free API key, see below).
  - LinkedIn: paste a single job posting URL to import just that one listing. No login, no bulk scraping, no auto-apply — that would violate LinkedIn's ToS.
- **Matching**: score each job against filters you set on the Profile page (title include/exclude, location, remote-only, min salary, required skills, excluded companies).
- **Drafts**: generate a tailored cover letter + answers to common screening questions per job, for you to copy into the real application.

Nothing auto-submits anywhere. This app prepares your materials and tracks status (New / Drafted / Applied / Rejected / Skipped); you do the actual applying.

## Setup

```bash
npm install
cp .env.local.example .env.local   # only needed if you want Adzuna
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Go to **Profile & Filters** — upload your resume, review/edit the detected skills, set your filters.
2. Go to **Dashboard** — add a Greenhouse/Lever company slug (e.g. `stripe`, `netflix`) or an Adzuna search, then click **Sync jobs**. Or paste a LinkedIn job URL to import a single listing.
3. Click into a job, check the match breakdown, and click **Generate draft** for a cover letter + answers.

Data is stored locally in `data/app.db` (SQLite) — nothing leaves your machine except the outbound reads to the job-source APIs above.

### Adzuna key

Free at https://developer.adzuna.com/ — put `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` in `.env.local`.

### Finding Greenhouse/Lever slugs

Look at a company's careers page URL — if it redirects to `job-boards.greenhouse.io/<slug>` or `jobs.lever.co/<slug>`, that's the slug to use here.
