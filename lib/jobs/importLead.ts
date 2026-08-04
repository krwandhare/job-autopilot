import { getDb, type FilterRow, type ResumeRow } from "@/lib/db";
import { importLinkedInJobUrl } from "@/lib/sources/linkedinUrl";
import { scoreJob, type FilterRules, type MatchResult } from "@/lib/matching";

export type UpsertedLead = {
  id: number;
  status: string;
  job: Awaited<ReturnType<typeof importLinkedInJobUrl>>;
  match: MatchResult;
};

// Statuses that represent a decision already made about a job. A lead
// import must never regress one of these back toward the top of the queue.
export const PRESERVE_STATUSES = new Set([
  "applied",
  "rejected",
  "skipped",
  "watchlist",
  "needs_code",
  "needs_review",
  "external_lead",
]);

// Fetches and upserts one LinkedIn job URL. Shared by the manual
// "Import LinkedIn URL" dashboard action and the Gmail-alert sync path so
// both go through identical fetch/score/upsert logic.
export async function upsertLinkedInJob(url: string): Promise<UpsertedLead> {
  const job = await importLinkedInJobUrl(url);

  const db = getDb();
  const filterRow = db.prepare("SELECT * FROM filters ORDER BY id DESC LIMIT 1").get() as
    | FilterRow
    | undefined;
  const resumeRow = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get() as ResumeRow | undefined;

  const filters: FilterRules = filterRow
    ? {
        titleInclude: filterRow.title_include,
        titleExclude: filterRow.title_exclude,
        locations: JSON.parse(filterRow.locations_json),
        remoteOnly: !!filterRow.remote_only,
        minSalary: filterRow.min_salary,
        requiredSkills: JSON.parse(filterRow.required_skills_json),
        excludedCompanies: JSON.parse(filterRow.excluded_companies_json),
      }
    : {
        titleInclude: "",
        titleExclude: "",
        locations: [],
        remoteOnly: false,
        minSalary: null,
        requiredSkills: [],
        excludedCompanies: [],
      };
  const resumeSkills: string[] = resumeRow ? JSON.parse(resumeRow.skills_json) : [];

  const match = scoreJob(job, filters, resumeSkills);

  db.prepare(
    `INSERT INTO jobs (
      source, source_job_id, title, company, location, remote, salary_text,
      description, url, posted_at, match_score, match_reasons_json
    ) VALUES (@source, @sourceJobId, @title, @company, @location, @remote, @salaryText,
      @description, @url, @postedAt, @matchScore, @matchReasonsJson)
    ON CONFLICT(source, source_job_id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      remote = excluded.remote,
      salary_text = excluded.salary_text,
      description = excluded.description,
      url = excluded.url,
      posted_at = excluded.posted_at,
      match_score = excluded.match_score,
      match_reasons_json = excluded.match_reasons_json,
      fetched_at = datetime('now')`
  ).run({
    source: job.source,
    sourceJobId: job.sourceJobId,
    title: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote ? 1 : 0,
    salaryText: job.salaryText,
    description: job.description,
    url: job.url,
    postedAt: job.postedAt,
    matchScore: match.score,
    matchReasonsJson: JSON.stringify(match),
  });

  const row = db
    .prepare("SELECT id, status FROM jobs WHERE source = ? AND source_job_id = ?")
    .get(job.source, job.sourceJobId) as { id: number; status: string };

  return { id: row.id, status: row.status, job, match };
}

// Upserts a URL and tags it external_lead unless it already has a
// further-along status, mirroring scripts/import-gmail-leads.mjs's logic
// but as an in-process call for server-side callers (the Gmail sync route).
export async function importAndTagExternalLead(
  url: string
): Promise<{ id: number; status: string; tagged: boolean; title: string; company: string }> {
  const { id, status, job } = await upsertLinkedInJob(url);
  if (PRESERVE_STATUSES.has(status)) {
    return { id, status, tagged: false, title: job.title, company: job.company };
  }
  getDb().prepare("UPDATE jobs SET status = 'external_lead' WHERE id = ?").run(id);
  return { id, status: "external_lead", tagged: true, title: job.title, company: job.company };
}
