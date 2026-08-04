# Explorer-agent

A read-only reconnaissance crawler for Job Autopilot's own UI. It maps every
reachable page route, catalogs the actionable DOM elements on each one
(buttons, inputs, forms), and flags anything that requires sensitive input or
triggers a state-mutating transition -- so a human can decide how to test it
safely before any E2E automation is written.

It is a planning tool, not a test runner: it never clicks, types into, or
submits anything, and it produces no assertions of its own.

## Why it's read-only

Several controls in this app are real, state-mutating actions that AGENTS.md
reserves for explicit, user-authorized use -- most notably "Start Auto-fill",
which opens a live Playwright session against a real employer ATS, and
"Auto-fill & submit", which can click a real submit control. Others (Delete,
Sync, Approve, Regenerate) mutate the local database. An autonomous crawler
must not invoke any of these as a side effect of "exploring" the app, so
explorer-agent only ever:

- navigates with `page.goto` (a GET), and
- reads the DOM with `page.evaluate` (no synthetic events dispatched).

It catalogs every button, form, and input it finds -- including the
state-mutating ones -- but only ever *flags* them in its output for a human
to review, never invokes them.

## Why it never captures dynamic content

The app renders real personal data on nearly every page: job titles and
companies, resume-derived skills, application history. AGENTS.md prohibits
putting resume content, job data, or database rows into logs or docs, and
this tool's output (`site-map.json`, `e2e-test-plan.md`) is meant to be
committed. So the DOM extraction step never records:

- `<a>` link text (job/application list rows use the job title as link text)
- input `value`s
- `<select>`/`<option>` contents (source lists, status pickers)

It only records element type/attributes and `<button>`/`<label>` text, which
in this codebase are static JSX copy defined once per page, not data pulled
from SQLite. Dynamic route segments (`/jobs/17`) are normalized to this app's
actual pattern (`/jobs/[id]`, discovered from the `app/` folder structure)
before being recorded, so no concrete ID ever reaches the output either.

## Running it

Requires a dev server already running -- this script never starts or installs
one itself. Prefer a disposable instance with synthetic fixture data over
pointing it at a server serving your real job search data, since a crawl
still reflects whatever is actually rendered (read-only, but not blind to
real content that leaks through non-whitelisted attributes you might add
later).

```bash
npm run dev   # or a disposable instance on another port
npm run explorer-agent -- --base-url http://localhost:3000
```

Options (all optional):

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base-url` | `http://localhost:3000` | Origin to crawl |
| `--max-pages` | `40` | Cap on distinct route *patterns* visited (not raw pages -- e.g. all `/jobs/17`, `/jobs/42`, ... share one pattern and only the first is visited) |
| `--out-dir` | `docs/explorer-agent` | Where to write `site-map.json` and `e2e-test-plan.md` |
| `--headed` | off | Run with a visible browser window instead of headless |

## Output

- **`site-map.json`** -- the state-machine map: one node per route pattern
  (its classified elements, flags, and any `/api/*` resource actions it
  links to), a deduped edge list of link-based navigation actually observed
  during the crawl, a list of known page routes that were never reached
  (a coverage gap, since link-following can miss unlinked pages), and a
  flat `manualReviewQueue` of every flagged element across the whole app.
- **`e2e-test-plan.md`** -- the same data rendered as a per-route Markdown
  plan: safe-to-automate read-only checks first, then a "Manual review
  required" section per route for anything state-mutating or sensitive,
  plus the flat queue at the end.

## Known limitations

- Classification is a static, label/attribute-based heuristic (the same
  style as `lib/autofill/fieldMatcher.ts` uses for third-party ATS forms) --
  it cannot see what a button's `onClick` handler actually does, only judge
  its visible label. A button labeled with an unrecognized verb could be
  mutating state without being flagged; conversely a purely local UI toggle
  that happens to use a matched verb could be flagged unnecessarily. Treat
  the manual-review queue as a strong starting point, not a guarantee.
- Only same-origin `<a href>` links are followed for route discovery. A page
  reachable only via a client-side `router.push()` with no rendered `<a>`
  tag, or only via a specific data state this run's fixture didn't produce,
  will show up in `unreachedRoutes` instead of being crawled.
- `/api/*` route handlers are recorded only as normalized resource-action
  hrefs referenced from a page (e.g. a download link) -- the crawler never
  calls them directly, and it does not enumerate API routes with no UI
  entry point.
