#!/usr/bin/env node
// Manual, occasional live check for POST /api/jobs/import-url -- the
// dashboard's "Import" (LinkedIn URL) action. explorer-agent's classifier
// flags this as a real state-mutating, external-side-effect action (it
// fetches a real, live LinkedIn page and writes a real job row into the
// local database), so unlike scripts/test-*.mjs this is deliberately NOT
// wired to an `npm run test:*` alias or any repeatable/CI suite.
//
// The target URL is never guessed or hardcoded by this script -- you must
// supply a real posting you actually want imported, the same one-off,
// user-supplied-URL model AGENTS.md already requires for this feature (no
// login, no bulk crawling).
//
// Usage:
//   node scripts/live-check-linkedin-import.mjs --confirm \
//     --url "https://www.linkedin.com/jobs/view/<id>/" \
//     [--base-url http://localhost:3000]

function parseArgs(argv) {
  const args = { baseUrl: "http://localhost:3000", confirm: false, url: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") args.confirm = true;
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  console.error(`
--url is required and must be a real LinkedIn job posting URL you actually
want imported. This script never guesses or supplies a default target.

  node scripts/live-check-linkedin-import.mjs --confirm --url "https://www.linkedin.com/jobs/view/<id>/" [--base-url ${args.baseUrl}]
`);
  process.exit(1);
}

if (!args.confirm) {
  console.error(`
This performs a REAL fetch of the LinkedIn posting below and writes a real
job row into the target server's (${args.baseUrl}) real local database --
it is not a mock.

  ${args.url}

Re-run with --confirm once you're ready to do that for real:
  node scripts/live-check-linkedin-import.mjs --confirm --url "${args.url}" [--base-url ${args.baseUrl}]
`);
  process.exit(1);
}

console.log(`Calling POST ${args.baseUrl}/api/jobs/import-url for ${args.url} ...`);

const res = await fetch(new URL("/api/jobs/import-url", args.baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: args.url }),
});

const data = await res.json();

if (!res.ok) {
  console.error(`Request failed (${res.status}): ${data.error ?? "unknown error"}`);
  process.exit(1);
}

console.log(JSON.stringify(
  {
    id: data.id,
    status: data.status,
    job: data.job ? { title: data.job.title, company: data.job.company, url: data.job.url } : null,
    match: data.match ? { score: data.match.score } : null,
  },
  null,
  2
));

console.log("Live LinkedIn import check completed.");
