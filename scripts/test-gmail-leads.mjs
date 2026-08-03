import assert from "node:assert/strict";
import { extractLeadsFromDigest } from "../lib/sources/gmailLeads.ts";
import { formatGmailSyncSummary, gmailSyncIssue } from "../lib/gmailSync.ts";

// Synthetic fixture mirroring LinkedIn's real digest-email plaintext
// structure: an unseparated alert-header line followed by job blocks
// separated by a dashed line, each "Title\nCompany\nLocation\nTop
// applicant\nView job: <url>...&trackingId=...".
const digest = [
  "Your job alert for Principal EngineerManage your job alerts: https://www.linkedin.com/comm/jobs/alerts?lipi=abc",
  "",
  "Principal Engineer",
  "Acme Corp",
  "Remote",
  "Top applicant",
  "View job: https://www.linkedin.com/comm/jobs/view/1111111111/?trackingId=abc&refId=def",
  BLOCK_SEP(),
  "Staff Engineer",
  "Widgets Inc",
  "New York, NY",
  "View job: https://www.linkedin.com/comm/jobs/view/2222222222/?trackingId=ghi&refId=jkl",
].join("\n");

function BLOCK_SEP() {
  return "---------------------------------------------------------";
}

const summaryOnlyDigest = [
  "Your job alert for (Senior OR Staff) EngineerManage your job alerts: https://www.linkedin.com/comm/jobs/alerts?lipi=abc",
  "",
  "Your job alert for (Senior OR Staff) Engineer",
  "30+ new jobs match your preferences.",
  "View job: https://www.linkedin.com/comm/jobs/view/3333333333/?trackingId=abc",
].join("\n");

const leads = extractLeadsFromDigest(digest);
assert.equal(leads.length, 2);
assert.deepEqual(leads[0], {
  jobId: "1111111111",
  url: "https://www.linkedin.com/jobs/view/1111111111/",
  title: "Principal Engineer",
  company: "Acme Corp",
});
assert.deepEqual(leads[1], {
  jobId: "2222222222",
  url: "https://www.linkedin.com/jobs/view/2222222222/",
  title: "Staff Engineer",
  company: "Widgets Inc",
});

// The "N new jobs match your preferences" summary link isn't a real
// posting and must be excluded, not misparsed as a job titled "Your job
// alert for ...".
assert.deepEqual(extractLeadsFromDigest(summaryOnlyDigest), []);

// The same job ID repeated within one digest (e.g. shown twice across
// sections) still de-dups to one lead.
const duplicated = `${digest}\n${BLOCK_SEP()}\n${digest}`;
assert.equal(extractLeadsFromDigest(duplicated).length, 2);

const importIssue = gmailSyncIssue("lead_import");
assert.deepEqual(importIssue, {
  code: "lead_import",
  message: "Could not import one job posting.",
});
assert.doesNotMatch(importIssue.message, /thread-secret|linkedin\.com|upstream/i);

assert.equal(
  formatGmailSyncSummary({
    threadsChecked: 1,
    threadsProcessed: 0,
    imported: 5,
    skipped: 1,
    rateLimited: true,
    issues: [importIssue],
  }),
  "Imported 5 lead(s). 0 of 1 alert email fully processed. 1 posting(s) could not be imported. " +
    "The run limit was reached; remaining alerts will stay unread for the next run."
);

assert.match(
  formatGmailSyncSummary({
    threadsChecked: 2,
    threadsProcessed: 1,
    imported: 2,
    skipped: 0,
    rateLimited: false,
    issues: [gmailSyncIssue("thread_read"), gmailSyncIssue("mark_read")],
  }),
  /could not be read.*could not be marked read/
);

console.log("Gmail digest parsing checks passed.");
