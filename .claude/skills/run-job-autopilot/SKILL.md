---
name: run-job-autopilot
description: Build, launch, and drive Job Autopilot (Next.js job-search app) headlessly -- start the dev server, screenshot the dashboard, click through the Action Center/Applications/Auto-fill flows via the bundled Playwright driver. Use for "run the app," "start job-autopilot," "screenshot the dashboard," or "test this UI change."
---

# Running Job Autopilot

Paths below are relative to the repo root (`job-autopilot` / this worktree).

Job Autopilot is a Next.js 16 App Router web app -- SQLite-backed, no
separate backend. It's driven with a headless browser. `chromium-cli`
isn't installed in this environment, so this skill ships an equivalent
minimal Playwright REPL driver at
`.claude/skills/run-job-autopilot/driver.mjs` (same command shape:
`nav` / `wait-for` / `click` / `fill` / `screenshot`, piped via stdin).

## Prerequisites

```bash
npm install
```

Playwright's Chromium must already be available (`npx playwright install chromium` if not -- already present in this environment).

`.env.local` is optional for basic use (Adzuna sync and Gmail auto-sync are both feature-gated on env vars that default to absent/disabled; see `.env.local.example`).

## Build

```bash
npm run build
```

Registers all routes, including the dynamic ones. No separate compile step beyond this.

## Run (agent path)

Start the dev server on an unused port, wait for it to actually serve (poll, don't sleep), then drive it:

```bash
lsof -i :3006 -P 2>/dev/null | grep LISTEN && echo "port in use, pick another"
npm run dev -- -p 3006 &
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3006/ | grep -q 200 && break
  sleep 1
done
```

Stop it the same way every time -- `npm run dev &`'s `$!` is only the npm
wrapper and doesn't forward signals to the actual `next dev` child:

```bash
lsof -i :3006 -P 2>/dev/null | grep LISTEN | awk '{print $2}' | sort -u | xargs -I{} kill -TERM {}
```

Drive it with the bundled REPL driver:

```bash
node .claude/skills/run-job-autopilot/driver.mjs <<'EOF'
nav http://localhost:3006
wait-for text=Dashboard
screenshot /tmp/dashboard.png
click text=Applications
wait-for text=Total applications
screenshot /tmp/applications.png
EOF
```

Screenshots land wherever you tell `screenshot` to put them (default
`/tmp/screenshot-<timestamp>.png` if you omit the path). Full command
list is in `driver.mjs`'s header comment: `nav`, `wait-for`, `click`,
`fill <selector> <text>`, `press <key>`, `screenshot [path]`, `wait
<ms>`, `text` (dumps `body` textContent), `eval <js>`.

A failed step (bad selector, timeout) prints an error and the script
**keeps going** -- it doesn't abort the rest of your script, so a
wrong guess at one selector doesn't cost you the whole run.

Representative flows worth driving, by page:
- Dashboard (`/`): Action Center cards, "Sync jobs"/"Sync Gmail leads" buttons, job list with status filter.
- `/applications`: stats strip, response-type buttons (click to toggle), follow-up date input + Save.
- `/autofill`: the highest-ranked queue job, or `/autofill?jobId=<id>` to resume a specific one.
- `/jobs/[id]`: status dropdown, draft generation.
- `/profile`: resume upload, skills, filters.

## Run (human path)

```bash
npm run dev
```

Opens on `http://localhost:3000` (default port). Useless in a headless container -- no window to see.

## This app has a live-data quirk agents will hit

Beyond this one-off verification: **only one `next dev` process can run
per project *directory*, regardless of port.** If another instance is
already running here (check `lsof -i :PORT` for 3000/3003 before
assuming free), you cannot start a second one from the same directory
concurrently -- stop the existing one first, do your work, then restart
it exactly as it was. This repo's own `AGENTS.md` documents a
multi-worktree pattern (`npm run dev:shared -- <instance> <port>`) for
genuinely running two instances against shared data from *sibling*
worktree directories; that's a project-specific concurrent-agent setup,
not something this skill's plain `npm run dev` path needs.

If `npm run dev` is already running against real user data when you
need to test something destructive (status changes, imports), prefer
picking a fresh, low-stakes row and reverting it afterward over
assuming a blank slate.

## Gotchas

- **`npm run dev -- -p <port>`** (note the `--`) is how you override
  the port through the npm script; `npm run dev -p <port>` (no `--`)
  passes `-p` to npm itself, not to `next dev`, and is silently
  ignored.
- **Schema changes need a server restart.** `lib/db.ts`'s
  `CREATE TABLE IF NOT EXISTS` statements only run once, when the
  process's cached DB connection is first created. If you edit the
  schema while a dev server is already running against that database,
  the new tables won't exist until you restart the process.
- **Playwright's own selector engine already understands
  `text=...` and `:has-text(...)`** the same way chromium-cli's does
  -- the driver passes your selector straight through, no translation
  needed.
- **`wait-for` failing doesn't stop the script** (see above) -- useful,
  but it means a typo'd selector silently continues past the step you
  meant to gate on. Check the driver's stdout for `command failed:`
  lines.

## Troubleshooting

- `EADDRINUSE` on the port you picked -- another process (possibly a
  previous run of this same skill that didn't get cleanly killed) is
  still listening. `lsof -i :<port>` to find and kill it.
- The dev server logs `✓ Ready in ...` and then immediately:
  ```
  ⨯ Another next dev server is already running.
  - Local:        http://localhost:3003
  - PID:          6308
  - Dir:          /path/to/this/repo
  Run kill 6308 to stop it.
  ```
  This is the single-instance-per-directory lock, not a port conflict
  -- it fires even on a port nothing else is using, because the lock
  is keyed on the directory, not the port. Kill the listed PID (that's
  the other instance running from this same directory) before
  retrying, or reuse that existing instance instead of starting a new
  one. Verified live: this exact message/format is what you'll see.
- Driver hangs on `nav` -- the dev server likely isn't actually ready
  yet despite the port being open; Next/Turbopack's first compile can
  take a few seconds after the port starts accepting connections. The
  poll loop above already accounts for this by checking for an actual
  `200`, not just port-open.
