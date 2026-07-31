import type Database from "better-sqlite3";

export const ACTIONABLE_STATUSES = [
  "needs_code",
  "needs_review",
  "external_lead",
  "drafted",
  "watchlist",
] as const;

export type ActionableStatus = (typeof ACTIONABLE_STATUSES)[number];

export type JobActionInput = {
  actionType: string;
  reasonCode: string;
  reasonText: string;
  details?: string[];
  source?: string;
};

export type DashboardAction = {
  id: number | null;
  jobId: number;
  status: ActionableStatus;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  matchScore: number | null;
  actionType: string;
  reasonCode: string;
  reasonText: string;
  details: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  primaryLabel: string;
  primaryHref: string;
  priority: number;
};

type ActionConfig = {
  actionType: string;
  reasonCode: string;
  reasonText: string;
  primaryLabel: string;
  priority: number;
};

const ACTION_CONFIG: Record<ActionableStatus, ActionConfig> = {
  needs_code: {
    actionType: "verification",
    reasonCode: "verification_code_required",
    reasonText:
      "The employer requires a verification code sent to you. This step must be completed manually.",
    primaryLabel: "Resume verification",
    priority: 10,
  },
  needs_review: {
    actionType: "application_review",
    reasonCode: "manual_review_required",
    reasonText:
      "The application contains a question or confirmation that requires your judgment.",
    primaryLabel: "Continue application",
    priority: 20,
  },
  external_lead: {
    actionType: "external_application",
    reasonCode: "external_application_required",
    reasonText:
      "This opportunity was captured as an external lead and needs to be reviewed on its original site.",
    primaryLabel: "Review external lead",
    priority: 30,
  },
  drafted: {
    actionType: "draft_review",
    reasonCode: "draft_ready",
    reasonText:
      "A local application draft is ready. Review every claim before using it.",
    primaryLabel: "Review draft",
    priority: 40,
  },
  watchlist: {
    actionType: "decision",
    reasonCode: "watchlist_decision",
    reasonText:
      "You saved this job for later. Decide whether to apply, return it to New, or skip it.",
    primaryLabel: "Make a decision",
    priority: 50,
  },
};

function isActionableStatus(status: string): status is ActionableStatus {
  return ACTIONABLE_STATUSES.includes(status as ActionableStatus);
}

function parseDetails(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function recordJobAction(
  db: Database.Database,
  jobId: number,
  input: JobActionInput
): void {
  const details = (input.details ?? [])
    .map((detail) => detail.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 10);
  const actionType = input.actionType.trim().slice(0, 100);
  const reasonCode = input.reasonCode.trim().slice(0, 100);
  const reasonText = input.reasonText.trim().slice(0, 1000);
  const source = (input.source?.trim() || "status").slice(0, 100);

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE job_actions
       SET resolved_at = datetime('now'), updated_at = datetime('now')
       WHERE job_id = ? AND resolved_at IS NULL`
    ).run(jobId);
    db.prepare(
      `INSERT INTO job_actions
         (job_id, action_type, reason_code, reason_text, details_json, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      jobId,
      actionType,
      reasonCode,
      reasonText,
      JSON.stringify(details),
      source
    );
  });
  write();
}

export function parkJobWithAction(
  db: Database.Database,
  jobId: number,
  status: Extract<ActionableStatus, "needs_code" | "needs_review">,
  input: JobActionInput,
  allowedCurrentStatuses: readonly string[] = ["new", "needs_review"]
): boolean {
  const park = db.transaction(() => {
    const current = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as
      | { status: string }
      | undefined;
    if (!current || !allowedCurrentStatuses.includes(current.status)) return false;

    if (current.status !== status) {
      db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, jobId);
    }
    recordJobAction(db, jobId, input);
    return true;
  });
  return park();
}

export function resolveJobActions(db: Database.Database, jobId: number): void {
  db.prepare(
    `UPDATE job_actions
     SET resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE job_id = ? AND resolved_at IS NULL`
  ).run(jobId);
}

export function getDashboardActions(db: Database.Database): DashboardAction[] {
  const placeholders = ACTIONABLE_STATUSES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         j.id AS job_id,
         j.status,
         j.title,
         j.company,
         j.location,
         j.remote,
         j.match_score,
         j.fetched_at,
         a.id AS action_id,
         a.action_type,
         a.reason_code,
         a.reason_text,
         a.details_json,
         a.source AS action_source,
         a.created_at AS action_created_at,
         a.updated_at AS action_updated_at
       FROM jobs j
       LEFT JOIN job_actions a ON a.id = (
         SELECT ja.id
         FROM job_actions ja
         WHERE ja.job_id = j.id AND ja.resolved_at IS NULL
         ORDER BY ja.updated_at DESC, ja.id DESC
         LIMIT 1
       )
       WHERE j.status IN (${placeholders})`
    )
    .all(...ACTIONABLE_STATUSES) as Array<Record<string, unknown>>;

  return rows
    .filter((row) => isActionableStatus(String(row.status)))
    .map((row) => {
      const status = String(row.status) as ActionableStatus;
      const config = ACTION_CONFIG[status];
      const jobId = Number(row.job_id);
      const actionCreatedAt = row.action_created_at
        ? String(row.action_created_at)
        : String(row.fetched_at);
      const actionUpdatedAt = row.action_updated_at
        ? String(row.action_updated_at)
        : actionCreatedAt;

      return {
        id: row.action_id == null ? null : Number(row.action_id),
        jobId,
        status,
        title: String(row.title),
        company: String(row.company),
        location: row.location == null ? null : String(row.location),
        remote: !!row.remote,
        matchScore: row.match_score == null ? null : Number(row.match_score),
        actionType: row.action_type ? String(row.action_type) : config.actionType,
        reasonCode: row.reason_code ? String(row.reason_code) : config.reasonCode,
        reasonText: row.reason_text ? String(row.reason_text) : config.reasonText,
        details: parseDetails(row.details_json == null ? null : String(row.details_json)),
        source: row.action_source ? String(row.action_source) : "status",
        createdAt: actionCreatedAt,
        updatedAt: actionUpdatedAt,
        primaryLabel: config.primaryLabel,
        primaryHref:
          status === "needs_code" || status === "needs_review"
            ? `/autofill?jobId=${jobId}`
            : `/jobs/${jobId}`,
        priority: config.priority,
      };
    })
    .sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
}
