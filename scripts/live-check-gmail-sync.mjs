#!/usr/bin/env node
// Manual, occasional live check for POST /api/jobs/sync-gmail -- the
// dashboard's "Sync Gmail leads" button. explorer-agent's classifier flags
// this as a real state-mutating, external-side-effect action (it reads the
// user's actual Gmail inbox and writes real job rows into the local
// database), so unlike scripts/test-*.mjs this is deliberately NOT wired to
// an `npm run test:*` alias or any repeatable/CI suite. AGENTS.md's rule
// against automating real external side effects applies here: this script
// exists so a human can run it deliberately, once, and read the result --
// not so it can be re-run unattended.
//
// Usage:
//   node scripts/live-check-gmail-sync.mjs --confirm [--base-url http://localhost:3000] [--rate-limit 5]
//
// Requires the target server to already have GMAIL_CLIENT_ID/
// GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN configured in its own .env.local
// (see scripts/gmail-oauth-setup.mjs) -- this script never reads or prints
// those values itself, it only calls the already-running app's own route.

function parseArgs(argv) {
  const args = { baseUrl: "http://localhost:3000", confirm: false, rateLimit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") args.confirm = true;
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--rate-limit") args.rateLimit = Number(argv[++i]);
    else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.confirm) {
  console.error(`
This performs a REAL Gmail sync against whatever account is configured on
the target server (${args.baseUrl}) -- it reads real inbox threads and
writes real job rows into that server's real local database. It is not a
mock and not reversible by re-running it.

Re-run with --confirm once you're ready to do that for real:
  node scripts/live-check-gmail-sync.mjs --confirm [--base-url ${args.baseUrl}] [--rate-limit 5]
`);
  process.exit(1);
}

const body = {};
if (args.rateLimit !== undefined) {
  if (!Number.isFinite(args.rateLimit) || args.rateLimit <= 0) {
    console.error(`--rate-limit must be a positive number, got: ${args.rateLimit}`);
    process.exit(1);
  }
  body.rateLimit = args.rateLimit;
}

console.log(`Calling POST ${args.baseUrl}/api/jobs/sync-gmail ...`);

const res = await fetch(new URL("/api/jobs/sync-gmail", args.baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const data = await res.json();

if (!res.ok) {
  console.error(`Request failed (${res.status}): ${data.error ?? "unknown error"}`);
  process.exit(1);
}

// Only the route's already-privacy-bounded summary fields (title/company/
// url/tagged counts) are printed here -- never raw thread bodies.
console.log(JSON.stringify(
  {
    threadsChecked: data.threadsChecked,
    threadsProcessed: data.threadsProcessed,
    imported: data.imported,
    skipped: data.skipped,
    rateLimited: data.rateLimited,
    results: data.results,
    errors: data.errors,
  },
  null,
  2
));

if (data.errors?.length) {
  console.error(`Completed with ${data.errors.length} error(s) -- see above.`);
  process.exit(1);
}

console.log("Live Gmail sync check completed.");
