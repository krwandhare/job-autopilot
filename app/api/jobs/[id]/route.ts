import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type DraftRow, type FilterRow, type ResumeRow } from "@/lib/db";
import { maxPossibleScore, type FilterRules } from "@/lib/matching";
import {
  ACTIONABLE_STATUSES,
  recordJobAction,
  resolveJobActions,
  type JobActionInput,
} from "@/lib/actions";
import { createApplication, type ApplicationSource } from "@/lib/applications";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";

const APPLICATION_SOURCES: ApplicationSource[] = [
  "manual",
  "autofill_review",
  "autofill_submit",
  "external_lead",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = positiveInteger(id);
  if (!jobId) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const db = getDb();
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;

  if (!row) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const draft = db
    .prepare("SELECT * FROM drafts WHERE job_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(jobId) as DraftRow | undefined;

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
  const jobId = positiveInteger(id);
  if (!jobId) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const body = await readJsonObject(req);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (Object.keys(body).some((key) => !["status", "action", "applicationSource"].includes(key))) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { status, action, applicationSource } = body as {
    status?: unknown;
    action?: unknown;
    applicationSource?: unknown;
  };

  if (
    applicationSource !== undefined &&
    !APPLICATION_SOURCES.includes(applicationSource as ApplicationSource)
  ) {
    return NextResponse.json({ error: "Invalid applicationSource" }, { status: 400 });
  }

  const validStatuses = [
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
  if (typeof status !== "string" || !validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const db = getDb();
  const job = db
    .prepare("SELECT id, status, company FROM jobs WHERE id = ?")
    .get(jobId) as { id: number; status: string; company: string } | undefined;
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  let actionInput: JobActionInput | null = null;
  if (action !== undefined) {
    if (!action || typeof action !== "object") {
      return NextResponse.json({ error: "Invalid action context" }, { status: 400 });
    }
    const candidate = action as Record<string, unknown>;
    if (
      Object.keys(candidate).some(
        (key) => !["actionType", "reasonCode", "reasonText", "details", "source"].includes(key)
      ) ||
      typeof candidate.actionType !== "string" ||
      typeof candidate.reasonCode !== "string" ||
      typeof candidate.reasonText !== "string" ||
      !candidate.actionType.trim() ||
      !candidate.reasonCode.trim() ||
      !candidate.reasonText.trim() ||
      candidate.actionType.length > 100 ||
      candidate.reasonCode.length > 100 ||
      candidate.reasonText.length > 1000 ||
      (candidate.details !== undefined &&
        (!Array.isArray(candidate.details) ||
          candidate.details.length > 10 ||
          candidate.details.some(
            (detail) => typeof detail !== "string" || detail.length > 500
          ))) ||
      (candidate.source !== undefined &&
        (typeof candidate.source !== "string" || candidate.source.length > 100))
    ) {
      return NextResponse.json({ error: "Invalid action context" }, { status: 400 });
    }
    actionInput = {
      actionType: candidate.actionType,
      reasonCode: candidate.reasonCode,
      reasonText: candidate.reasonText,
      details: candidate.details as string[] | undefined,
      source: candidate.source as string | undefined,
    };
  }

  // A newly-latest resume's filename, if any -- recorded on the application
  // as the "resume_version" used, best-effort (uploads aren't job-specific).
  const latestResume = db
    .prepare("SELECT filename FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get() as { filename: string } | undefined;

  const update = db.transaction(() => {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, jobId);
    if (ACTIONABLE_STATUSES.includes(status as (typeof ACTIONABLE_STATUSES)[number])) {
      if (actionInput) {
        recordJobAction(db, jobId, actionInput);
      } else if (job.status !== status) {
        resolveJobActions(db, jobId);
      }
    } else {
      resolveJobActions(db, jobId);
    }

    if (status === "applied" && job.status !== "applied") {
      createApplication(db, {
        jobId,
        companyName: job.company,
        resumeVersion: latestResume?.filename ?? null,
        source:
          (applicationSource as ApplicationSource | undefined) ??
          (job.status === "external_lead" ? "external_lead" : "manual"),
      });
    }
  });
  update();

  return NextResponse.json({ ok: true });
}
