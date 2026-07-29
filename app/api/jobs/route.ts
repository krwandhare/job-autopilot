import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type FilterRow, type ResumeRow } from "@/lib/db";
import { maxPossibleScore, type FilterRules } from "@/lib/matching";

const VALID_STATUSES = ["new", "drafted", "applied", "rejected", "skipped"];
const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const db = getDb();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const showAll = searchParams.get("showAll") === "1";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const statusFilter = status && VALID_STATUSES.includes(status) ? status : null;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (statusFilter) {
    conditions.push("status = ?");
    params.push(statusFilter);
  }
  if (!showAll) {
    // Score-0 jobs are hard scoring failures (e.g. title or location didn't
    // match at all) -- still stored so nothing's lost if filters loosen
    // later, but not worth showing by default among thousands of synced jobs.
    conditions.push("match_score > 0");
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM jobs ${whereClause}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT * FROM jobs ${whereClause} ORDER BY match_score DESC, fetched_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, offset) as JobRow[];

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
    maxScore: maxPossibleScore(filters, resumeSkills),
    total,
    page,
    pageSize: PAGE_SIZE,
    jobs: rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      company: r.company,
      location: r.location,
      remote: !!r.remote,
      salaryText: r.salary_text,
      url: r.url,
      postedAt: r.posted_at,
      matchScore: r.match_score,
      status: r.status,
    })),
  });
}
