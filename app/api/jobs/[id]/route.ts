import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type DraftRow, type FilterRow, type ResumeRow } from "@/lib/db";
import { maxPossibleScore, type FilterRules } from "@/lib/matching";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;

  if (!row) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const draft = db
    .prepare("SELECT * FROM drafts WHERE job_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(id) as DraftRow | undefined;

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

  return NextResponse.json({
    job: {
      id: row.id,
      source: row.source,
      title: row.title,
      company: row.company,
      location: row.location,
      remote: !!row.remote,
      salaryText: row.salary_text,
      description: row.description,
      url: row.url,
      postedAt: row.posted_at,
      matchScore: row.match_score,
      matchReasons: row.match_reasons_json ? JSON.parse(row.match_reasons_json) : null,
      status: row.status,
    },
    maxScore: maxPossibleScore(filters, resumeSkills),
    draft: draft
      ? {
          id: draft.id,
          coverLetter: draft.cover_letter,
          answers: JSON.parse(draft.answers_json),
          generatedAt: draft.generated_at,
        }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await req.json();

  const validStatuses = ["new", "drafted", "applied", "rejected", "skipped"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);

  return NextResponse.json({ ok: true });
}
