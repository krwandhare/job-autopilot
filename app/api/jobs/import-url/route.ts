import { NextRequest, NextResponse } from "next/server";
import { getDb, type FilterRow, type ResumeRow } from "@/lib/db";
import { importLinkedInJobUrl } from "@/lib/sources/linkedinUrl";
import { scoreJob, type FilterRules } from "@/lib/matching";

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let job;
  try {
    job = await importLinkedInJobUrl(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import job" },
      { status: 400 }
    );
  }

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

  return NextResponse.json({ job, match });
}
