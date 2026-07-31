#!/usr/bin/env node
// Rate-limited import of LinkedIn job-alert leads gathered from Gmail into
// the local job queue. LinkedIn postings are import-only leads per
// AGENTS.md's ToS constraint (no login, no bulk scraping) -- this script
// never scrapes LinkedIn itself, it only calls the existing single-URL
// import endpoint for URLs a human/agent has already pulled out of email.
//
// Usage:
//   node scripts/import-gmail-leads.mjs [options] [url ...]
//
// Options:
//   --base-url <url>   Dev server base URL
//                       (default: $JOB_AUTOPILOT_BASE_URL or http://localhost:3000)
//   --rate-limit <n>   Max URLs imported this run (default: 5)
//   --file <path>      Read additional URLs, one per line, from a file
//
// URLs may also be piped in on stdin (one per line) when no positional URLs
// or --file are given and stdin is not a TTY.
//
// Each URL goes through POST /api/jobs/import-url, which dedups by
// (source, source_job_id) via an upsert -- re-running this script on the
// same alerts never creates duplicate rows. A freshly-created ('new') job
// is then tagged `external_lead` so it never enters the `new` autofill
// queue; a job that already has a further-along status (applied, rejected,
// skipped, watchlist, needs_code, needs_review, external_lead) is left
// untouched rather than regressed.

const DEFAULT_RATE_LIMIT = 5;
const PRESERVE_STATUSES = new Set([
  "applied",
  "rejected",
  "skipped",
  "watchlist",
  "needs_code",
  "needs_review",
  "external_lead",
]);

function parseArgs(argv) {
  const urls = [];
  let baseUrl = process.env.JOB_AUTOPILOT_BASE_URL ?? "http://localhost:3000";
  let rateLimit = DEFAULT_RATE_LIMIT;
  let file = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") {
      baseUrl = argv[++i];
    } else if (arg === "--rate-limit") {
      rateLimit = Number(argv[++i]);
    } else if (arg === "--file") {
      file = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      urls.push(arg);
    }
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), rateLimit, file, urls };
}

async function readStdin() {
  if (process.stdin.isTTY) return [];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").split("\n");
}

async function readFile(path) {
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(path, "utf8");
  return text.split("\n");
}

function normalizeLines(lines) {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}

async function importOne(baseUrl, url) {
  const importRes = await fetch(`${baseUrl}/api/jobs/import-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const importData = await importRes.json();
  if (!importRes.ok) {
    return { url, ok: false, reason: importData.error ?? `HTTP ${importRes.status}` };
  }

  const { id, status, job } = importData;
  if (typeof id !== "number") {
    return { url, ok: false, reason: "import response did not include a job id" };
  }

  if (PRESERVE_STATUSES.has(status)) {
    return { url, ok: true, id, action: `skipped (already ${status})`, title: job?.title };
  }

  const patchRes = await fetch(`${baseUrl}/api/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "external_lead" }),
  });
  if (!patchRes.ok) {
    const patchData = await patchRes.json().catch(() => ({}));
    return {
      url,
      ok: false,
      reason: `imported but status update failed: ${patchData.error ?? patchRes.status}`,
    };
  }

  return { url, ok: true, id, action: "tagged external_lead", title: job?.title };
}

async function main() {
  const { baseUrl, rateLimit, file, urls: argUrls } = parseArgs(process.argv.slice(2));

  let urls = [...argUrls];
  if (file) urls.push(...normalizeLines(await readFile(file)));
  if (urls.length === 0) urls.push(...normalizeLines(await readStdin()));
  urls = [...new Set(normalizeLines(urls))];

  if (!Number.isFinite(rateLimit) || rateLimit <= 0) {
    throw new Error(`Invalid --rate-limit: ${rateLimit}`);
  }

  const capped = urls.slice(0, rateLimit);
  const overflow = urls.length - capped.length;

  if (capped.length === 0) {
    console.log("No URLs to import.");
    return;
  }

  console.log(`Importing ${capped.length} URL(s) (rate limit ${rateLimit}, base ${baseUrl})`);
  for (const url of capped) {
    const result = await importOne(baseUrl, url);
    if (result.ok) {
      const title = result.title ? `: ${result.title}` : "";
      console.log(`OK   ${result.url} -> job ${result.id} (${result.action})${title}`);
    } else {
      console.log(`FAIL ${result.url}: ${result.reason}`);
    }
  }

  if (overflow > 0) {
    console.log(`Rate limit reached; ${overflow} additional URL(s) not imported this run.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
