// Parses LinkedIn job-alert digest emails (both single-job and multi-job
// "N new jobs match your preferences" formats) into individual job leads.
// LinkedIn alert emails list each match as a title/company/location block
// followed by a "View job: <url>" line, with blocks separated by a line of
// dashes. The very first block is preceded by an unseparated alert-header
// line ("Your job alert for X ... Manage your job alerts: <url>") which
// must be stripped so it isn't mistaken for a job title.

const BLOCK_SEPARATOR = "---------------------------------------------------------";
const VIEW_JOB_PATTERN = /View job:\s*(https:\/\/www\.linkedin\.com\/comm\/jobs\/view\/(\d+))[^\s]*/;

export type ParsedLead = {
  jobId: string;
  url: string;
  title: string;
  company: string;
};

function normalizeUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}/`;
}

export function extractLeadsFromDigest(plaintextBody: string): ParsedLead[] {
  const leads: ParsedLead[] = [];
  const blocks = plaintextBody.split(BLOCK_SEPARATOR);

  for (const block of blocks) {
    const match = block.match(VIEW_JOB_PATTERN);
    if (!match) continue;
    const [, , jobId] = match;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("View job"))
      .filter((line) => !line.includes("trackingId"))
      .filter((line) => !line.includes("Manage your job alerts"));

    const title = lines[0] ?? "";
    const company = lines[1] ?? "";

    // The alert-summary header ("Your job alert for X ... N new jobs match
    // your preferences") isn't a real job posting; its "company" line is a
    // generic count string, not an employer name. Skip it.
    if (title.startsWith("Your job alert for") || /\d+\+? new jobs match/i.test(company)) {
      continue;
    }
    if (!title || !company) continue;

    leads.push({ jobId, url: normalizeUrl(jobId), title, company });
  }

  // De-dup within a single email (the same job can appear more than once).
  const seen = new Set<string>();
  return leads.filter((lead) => {
    if (seen.has(lead.jobId)) return false;
    seen.add(lead.jobId);
    return true;
  });
}
