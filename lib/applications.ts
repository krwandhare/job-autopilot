import type Database from "better-sqlite3";
import type { ApplicationRow } from "@/lib/db";

export type ApplicationSource =
  | "manual"
  | "autofill_review"
  | "autofill_submit"
  | "external_lead";

export type CreateApplicationInput = {
  jobId: number;
  companyName: string;
  resumeVersion?: string | null;
  coverLetterUsed?: boolean;
  source: ApplicationSource;
  notes?: string | null;
};

export type ApplicationWithJob = ApplicationRow & {
  jobTitle: string;
  jobCompany: string;
  jobUrl: string;
  jobStatus: string;
  matchScore: number | null;
};

// Companies are looked up by exact name. jobs.company is free-text (not a
// foreign key), so this just deduplicates by that same string -- it's a
// convenience lookup table, not a strict identity system.
export function getOrCreateCompany(db: Database.Database, name: string): number {
  const trimmed = name.trim();
  const existing = db.prepare("SELECT id FROM companies WHERE name = ?").get(trimmed) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const result = db.prepare("INSERT INTO companies (name) VALUES (?)").run(trimmed);
  return Number(result.lastInsertRowid);
}

// Idempotent: a job can have at most one application row (see
// idx_applications_job_id). Calling this again for the same job returns the
// existing row instead of erroring or creating a duplicate.
export function createApplication(
  db: Database.Database,
  input: CreateApplicationInput
): ApplicationRow {
  const existing = db
    .prepare("SELECT * FROM applications WHERE job_id = ?")
    .get(input.jobId) as ApplicationRow | undefined;
  if (existing) return existing;

  const companyId = getOrCreateCompany(db, input.companyName);
  const result = db
    .prepare(
      `INSERT INTO applications (job_id, company_id, resume_version, cover_letter_used, source, notes)
       VALUES (@jobId, @companyId, @resumeVersion, @coverLetterUsed, @source, @notes)`
    )
    .run({
      jobId: input.jobId,
      companyId,
      resumeVersion: input.resumeVersion ?? null,
      coverLetterUsed: input.coverLetterUsed ? 1 : 0,
      source: input.source,
      notes: input.notes ?? null,
    });

  return db
    .prepare("SELECT * FROM applications WHERE id = ?")
    .get(result.lastInsertRowid) as ApplicationRow;
}

export type UpdateApplicationInput = {
  notes?: string | null;
  followUpAt?: string | null;
  responseReceivedAt?: string | null;
  responseType?: string | null;
};

export function updateApplication(
  db: Database.Database,
  jobId: number,
  patch: UpdateApplicationInput
): ApplicationRow | null {
  const existing = db.prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId) as
    | ApplicationRow
    | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const params: Record<string, unknown> = { jobId };
  if (patch.notes !== undefined) {
    fields.push("notes = @notes");
    params.notes = patch.notes;
  }
  if (patch.followUpAt !== undefined) {
    fields.push("follow_up_at = @followUpAt");
    params.followUpAt = patch.followUpAt;
  }
  if (patch.responseReceivedAt !== undefined) {
    fields.push("response_received_at = @responseReceivedAt");
    params.responseReceivedAt = patch.responseReceivedAt;
  }
  if (patch.responseType !== undefined) {
    fields.push("response_type = @responseType");
    params.responseType = patch.responseType;
  }
  if (fields.length === 0) return existing;

  db.prepare(
    `UPDATE applications SET ${fields.join(", ")}, updated_at = datetime('now') WHERE job_id = @jobId`
  ).run(params);

  return db.prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId) as ApplicationRow;
}

const APPLICATION_WITH_JOB_SELECT = `
  SELECT
    a.*,
    j.title AS job_title,
    j.company AS job_company,
    j.url AS job_url,
    j.status AS job_status,
    j.match_score AS match_score
  FROM applications a
  JOIN jobs j ON j.id = a.job_id
`;

function toApplicationWithJob(row: Record<string, unknown>): ApplicationWithJob {
  return {
    id: Number(row.id),
    job_id: Number(row.job_id),
    company_id: row.company_id == null ? null : Number(row.company_id),
    applied_at: String(row.applied_at),
    resume_version: row.resume_version == null ? null : String(row.resume_version),
    cover_letter_used: Number(row.cover_letter_used),
    source: String(row.source),
    notes: row.notes == null ? null : String(row.notes),
    follow_up_at: row.follow_up_at == null ? null : String(row.follow_up_at),
    response_received_at:
      row.response_received_at == null ? null : String(row.response_received_at),
    response_type: row.response_type == null ? null : String(row.response_type),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    jobTitle: String(row.job_title),
    jobCompany: String(row.job_company),
    jobUrl: String(row.job_url),
    jobStatus: String(row.job_status),
    matchScore: row.match_score == null ? null : Number(row.match_score),
  };
}

export type ListApplicationsFilters = {
  noResponseDays?: number;
  limit?: number;
};

export function listApplications(
  db: Database.Database,
  filters: ListApplicationsFilters = {}
): ApplicationWithJob[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.noResponseDays !== undefined) {
    conditions.push("a.response_received_at IS NULL");
    conditions.push("a.applied_at <= datetime('now', ?)");
    params.push(`-${filters.noResponseDays} days`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  const rows = db
    .prepare(`${APPLICATION_WITH_JOB_SELECT} ${where} ORDER BY a.applied_at DESC, a.id DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(toApplicationWithJob);
}

// One calendar-week bucket (Sunday-start, matching the SQL below) of raw
// counts. Kept as unprocessed counts, not pre-computed percentages/deltas --
// that derivation is presentational and belongs in the UI layer, not here.
export type FunnelWeek = {
  weekStart: string;
  total: number;
  withResponse: number;
  interview: number;
  offer: number;
  rejected: number;
};

export type ApplicationStats = {
  total: number;
  withResponse: number;
  responseRate: number;
  // All-time counts by current response_type, for the primary funnel bars.
  // `response_type` is a single current value per application (set/cleared
  // via toggle), not a historical log of every stage reached -- so an
  // application now marked "offer" after an earlier interview no longer
  // counts toward "interview" here. This is a snapshot of current outcome
  // distribution, not a true multi-stage historical pipeline; accurate
  // given the schema, not a bug.
  interview: number;
  offer: number;
  rejected: number;
  // Last 12 calendar weeks, most recent first -- same bucketing as the
  // previous `perWeek` field it replaces (superset: also carries the
  // response/funnel breakdown needed for trend indicators and sparklines).
  funnelWeekly: FunnelWeek[];
};

export function getApplicationStats(db: Database.Database): ApplicationStats {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN response_received_at IS NOT NULL THEN 1 ELSE 0 END) AS with_response,
         SUM(CASE WHEN response_type = 'interview' THEN 1 ELSE 0 END) AS interview,
         SUM(CASE WHEN response_type = 'offer' THEN 1 ELSE 0 END) AS offer,
         SUM(CASE WHEN response_type = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM applications`
    )
    .get() as {
    total: number;
    with_response: number | null;
    interview: number | null;
    offer: number | null;
    rejected: number | null;
  };

  const funnelWeeklyRows = db
    .prepare(
      `SELECT
         date(applied_at, 'weekday 0', '-6 days') AS week_start,
         COUNT(*) AS total,
         SUM(CASE WHEN response_received_at IS NOT NULL THEN 1 ELSE 0 END) AS with_response,
         SUM(CASE WHEN response_type = 'interview' THEN 1 ELSE 0 END) AS interview,
         SUM(CASE WHEN response_type = 'offer' THEN 1 ELSE 0 END) AS offer,
         SUM(CASE WHEN response_type = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM applications
       GROUP BY week_start
       ORDER BY week_start DESC
       LIMIT 12`
    )
    .all() as Array<{
    week_start: string;
    total: number;
    with_response: number | null;
    interview: number | null;
    offer: number | null;
    rejected: number | null;
  }>;

  const total = totals.total;
  const withResponse = totals.with_response ?? 0;

  return {
    total,
    withResponse,
    responseRate: total > 0 ? withResponse / total : 0,
    interview: totals.interview ?? 0,
    offer: totals.offer ?? 0,
    rejected: totals.rejected ?? 0,
    funnelWeekly: funnelWeeklyRows.map((r) => ({
      weekStart: r.week_start,
      total: r.total,
      withResponse: r.with_response ?? 0,
      interview: r.interview ?? 0,
      offer: r.offer ?? 0,
      rejected: r.rejected ?? 0,
    })),
  };
}

// Fit-scoring already lives on jobs.match_score (lib/matching.ts); this is a
// thin, application-tracking-flavored view over it -- new/undecided jobs
// with no application yet, best match first.
export function getTopJobsByFit(
  db: Database.Database,
  limit = 20
): Array<{ id: number; title: string; company: string; matchScore: number | null; url: string }> {
  const rows = db
    .prepare(
      `SELECT j.id, j.title, j.company, j.match_score, j.url
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.status = 'new' AND a.id IS NULL AND j.match_score > 0
       ORDER BY j.match_score DESC, j.fetched_at DESC
       LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 200)) as Array<{
    id: number;
    title: string;
    company: string;
    match_score: number | null;
    url: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    matchScore: r.match_score,
    url: r.url,
  }));
}
