import { NextResponse } from "next/server";
import { getDb, type SourceConfigRow, type FilterRow, type ResumeRow } from "@/lib/db";
import { fetchGreenhouseJobs } from "@/lib/sources/greenhouse";
import { fetchLeverJobs } from "@/lib/sources/lever";
import { fetchAdzunaJobs } from "@/lib/sources/adzuna";
import { scoreJob, type FilterRules } from "@/lib/matching";
import type { NormalizedJob } from "@/lib/sources/types";
import { sourceSyncFailure } from "@/lib/sourceSync";
import { validateSourceConfig } from "@/lib/apiValidation";

export async function POST() {
  const db = getDb();

  const sourceRows = db.prepare("SELECT * FROM source_configs").all() as SourceConfigRow[];
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

  const allJobs: NormalizedJob[] = [];
  const errors: string[] = [];

  for (const src of sourceRows) {
    try {
      const storedConfig: unknown = JSON.parse(src.config_json);
      const validated = validateSourceConfig(src.type, storedConfig);
      if (!validated) {
        throw new Error("Invalid stored source configuration");
      }
      if (validated.type === "greenhouse") {
        allJobs.push(...(await fetchGreenhouseJobs(validated.config.companySlug)));
      } else if (validated.type === "lever") {
        allJobs.push(...(await fetchLeverJobs(validated.config.companySlug)));
      } else if (validated.type === "adzuna") {
        allJobs.push(...(await fetchAdzunaJobs(validated.config)));
      }
    } catch {
      errors.push(sourceSyncFailure(src.type));
    }
  }

  const upsert = db.prepare(`
    INSERT INTO jobs (
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
      fetched_at = datetime('now')
  `);

  const insertMany = db.transaction((jobs: NormalizedJob[]) => {
    let count = 0;
    for (const job of jobs) {
      const match = scoreJob(job, filters, resumeSkills);
      upsert.run({
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
      count++;
    }
    return count;
  });

  const count = insertMany(allJobs);

  return NextResponse.json({ synced: count, sourcesConfigured: sourceRows.length, errors });
}
