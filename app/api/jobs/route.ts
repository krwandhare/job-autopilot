import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type FilterRow, type ResumeRow } from "@/lib/db";
import { maxPossibleScore, type FilterRules } from "@/lib/matching";
import { boundedPositiveInteger } from "@/lib/apiValidation";
import { ACTIONABLE_STATUSES } from "@/lib/actions";

const VALID_STATUSES = [
  "new",
  "drafted",
  "applied",
  "rejected",
  "skipped",
  "watchlist",
  "needs_code",
  "needs_review",
  "external_lead",
];
const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const db = getDb();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  const showAllParam = searchParams.get("showAll");
  if (showAllParam !== null && showAllParam !== "0" && showAllParam !== "1") {
    return NextResponse.json({ error: "showAll must be 0 or 1" }, { status: 400 });
  }
  const showAll = showAllParam === "1";
  const page = boundedPositiveInteger(searchParams.get("page"), 1, 100_000);
  if (page === null) {
    return NextResponse.json({ error: "page must be an integer from 1 to 100000" }, { status: 400 });
  }
  const offset = (page - 1) * PAGE_SIZE;

  const statusFilter = status;
  const isActionableStatusFilter =
    !!statusFilter && (ACTIONABLE_STATUSES as readonly string[]).includes(statusFilter);

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (statusFilter) {
    conditions.push("status = ?");
    params.push(statusFilter);
  }
  if (!showAll && !isActionableStatusFilter) {
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
