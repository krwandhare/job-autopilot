import Database from "better-sqlite3";
import { getDatabasePath } from "@/lib/runtimePaths";

declare global {
  var __db: Database.Database | undefined;
}

function init(db: Database.Database) {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      text TEXT NOT NULL,
      skills_json TEXT NOT NULL DEFAULT '[]',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_include TEXT NOT NULL DEFAULT '',
      title_exclude TEXT NOT NULL DEFAULT '',
      locations_json TEXT NOT NULL DEFAULT '[]',
      remote_only INTEGER NOT NULL DEFAULT 0,
      min_salary INTEGER,
      required_skills_json TEXT NOT NULL DEFAULT '[]',
      excluded_companies_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_job_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      remote INTEGER NOT NULL DEFAULT 0,
      salary_text TEXT,
      description TEXT,
      url TEXT NOT NULL,
      posted_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      match_score REAL,
      match_reasons_json TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      UNIQUE(source, source_job_id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      cover_letter TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'greenhouse' | 'lever' | 'adzuna'
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      answer TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      reason_text TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'status',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_job_actions_open_job
      ON job_actions(job_id, resolved_at, updated_at DESC);

    CREATE TABLE IF NOT EXISTS job_claims (
      job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      lease_expires_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_claims_owner
      ON job_claims(owner_id);

    CREATE INDEX IF NOT EXISTS idx_job_claims_expiry
      ON job_claims(lease_expires_at);

    CREATE TABLE IF NOT EXISTS resume_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      evidence_kind TEXT NOT NULL,
      section TEXT NOT NULL,
      source_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      source_start_line INTEGER,
      source_end_line INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      verification_status TEXT NOT NULL DEFAULT 'extracted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (verification_status IN ('extracted', 'verified', 'rejected'))
    );

    CREATE INDEX IF NOT EXISTS idx_resume_evidence_resume
      ON resume_evidence(resume_id, source_start_line, id);

    CREATE TABLE IF NOT EXISTS job_requirement_analyses (
      job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      description_fingerprint TEXT NOT NULL,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      requirement_kind TEXT NOT NULL,
      priority TEXT NOT NULL,
      requirement_text TEXT NOT NULL,
      terms_json TEXT NOT NULL DEFAULT '[]',
      source_text TEXT NOT NULL,
      source_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (priority IN ('required', 'preferred', 'context'))
    );

    CREATE INDEX IF NOT EXISTS idx_job_requirements_job
      ON job_requirements(job_id, source_order, id);

    CREATE TABLE IF NOT EXISTS resume_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      job_fingerprint TEXT NOT NULL,
      preferred_format TEXT NOT NULL DEFAULT 'docx',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      CHECK (status IN ('draft', 'approved', 'superseded', 'rejected')),
      CHECK (preferred_format IN ('docx', 'pdf'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_variants_approved_job
      ON resume_variants(job_id) WHERE status = 'approved';

    CREATE INDEX IF NOT EXISTS idx_resume_variants_job
      ON resume_variants(job_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS resume_variant_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL REFERENCES resume_variants(id) ON DELETE CASCADE,
      evidence_id INTEGER NOT NULL REFERENCES resume_evidence(id),
      evidence_kind TEXT NOT NULL,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      tailored_text TEXT NOT NULL,
      rationale TEXT NOT NULL,
      change_type TEXT NOT NULL,
      matched_terms_json TEXT NOT NULL DEFAULT '[]',
      included INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_resume_variant_items_variant
      ON resume_variant_items(variant_id, position, id);

    CREATE TABLE IF NOT EXISTS resume_variant_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL REFERENCES resume_variants(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(variant_id, format),
      CHECK (format IN ('docx', 'pdf')),
      CHECK (validation_status IN ('passed', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_resume_variant_artifacts_variant
      ON resume_variant_artifacts(variant_id, format);

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      website TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      company_id INTEGER REFERENCES companies(id),
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      resume_version TEXT,
      cover_letter_used INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      follow_up_at TEXT,
      response_received_at TEXT,
      response_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_job_id
      ON applications(job_id);

    CREATE INDEX IF NOT EXISTS idx_applications_follow_up
      ON applications(follow_up_at);

    CREATE INDEX IF NOT EXISTS idx_applications_no_response
      ON applications(response_received_at, applied_at);
  `);

  const filterCount = db.prepare("SELECT COUNT(*) as c FROM filters").get() as { c: number };
  if (filterCount.c === 0) {
    db.prepare(
      `INSERT INTO filters (title_include, title_exclude, locations_json, remote_only, min_salary, required_skills_json, excluded_companies_json)
       VALUES ('', '', '[]', 0, NULL, '[]', '[]')`
    ).run();
  }

  const resumeCols = db.prepare("PRAGMA table_info(resumes)").all() as { name: string }[];
  if (!resumeCols.some((c) => c.name === "file_path")) {
    db.exec("ALTER TABLE resumes ADD COLUMN file_path TEXT");
  }

  const variantItemCols = db.prepare("PRAGMA table_info(resume_variant_items)").all() as {
    name: string;
  }[];
  if (!variantItemCols.some((column) => column.name === "evidence_kind")) {
    db.exec(
      "ALTER TABLE resume_variant_items ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'other'"
    );
  }

  const variantCols = db.prepare("PRAGMA table_info(resume_variants)").all() as {
    name: string;
  }[];
  if (!variantCols.some((column) => column.name === "preferred_format")) {
    db.exec(
      "ALTER TABLE resume_variants ADD COLUMN preferred_format TEXT NOT NULL DEFAULT 'docx'"
    );
  }
}

export function getDb(): Database.Database {
  if (!global.__db) {
    const db = new Database(getDatabasePath());
    init(db);
    global.__db = db;
  }
  return global.__db;
}

export type ResumeRow = {
  id: number;
  filename: string;
  text: string;
  skills_json: string;
  uploaded_at: string;
  file_path: string | null;
};

export type FilterRow = {
  id: number;
  title_include: string;
  title_exclude: string;
  locations_json: string;
  remote_only: number;
  min_salary: number | null;
  required_skills_json: string;
  excluded_companies_json: string;
  updated_at: string;
};

export type JobRow = {
  id: number;
  source: string;
  source_job_id: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  salary_text: string | null;
  description: string | null;
  url: string;
  posted_at: string | null;
  fetched_at: string;
  match_score: number | null;
  match_reasons_json: string | null;
  status: string;
};

export type DraftRow = {
  id: number;
  job_id: number;
  cover_letter: string;
  answers_json: string;
  generated_at: string;
};

export type SourceConfigRow = {
  id: number;
  type: string;
  config_json: string;
  created_at: string;
};

export type ProfileAnswerRow = {
  id: number;
  key: string;
  label: string;
  answer: string;
  updated_at: string;
};

export type JobActionRow = {
  id: number;
  job_id: number;
  action_type: string;
  reason_code: string;
  reason_text: string;
  details_json: string;
  source: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type JobClaimRow = {
  job_id: number;
  owner_id: string;
  lease_token: string;
  claimed_at: number;
  heartbeat_at: number;
  lease_expires_at: number;
};

export type ResumeEvidenceRow = {
  id: number;
  resume_id: number;
  evidence_kind: string;
  section: string;
  source_text: string;
  normalized_text: string;
  source_start_line: number | null;
  source_end_line: number | null;
  metadata_json: string;
  verification_status: string;
  created_at: string;
  updated_at: string;
};

export type JobRequirementRow = {
  id: number;
  job_id: number;
  requirement_kind: string;
  priority: string;
  requirement_text: string;
  terms_json: string;
  source_text: string;
  source_order: number;
  created_at: string;
};

export type ResumeVariantRow = {
  id: number;
  job_id: number;
  resume_id: number;
  status: "draft" | "approved" | "superseded" | "rejected";
  job_fingerprint: string;
  preferred_format: "docx" | "pdf";
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

export type ResumeVariantItemRow = {
  id: number;
  variant_id: number;
  evidence_id: number;
  evidence_kind: string;
  section: string;
  position: number;
  original_text: string;
  tailored_text: string;
  rationale: string;
  change_type: string;
  matched_terms_json: string;
  included: number;
  created_at: string;
};

export type ResumeVariantArtifactRow = {
  id: number;
  variant_id: number;
  format: "docx" | "pdf";
  file_path: string;
  filename: string;
  sha256: string;
  validation_status: "passed" | "failed";
  validation_json: string;
  created_at: string;
};

export type CompanyRow = {
  id: number;
  name: string;
  website: string | null;
  notes: string | null;
  created_at: string;
};

export type ApplicationRow = {
  id: number;
  job_id: number;
  company_id: number | null;
  applied_at: string;
  resume_version: string | null;
  cover_letter_used: number;
  source: string;
  notes: string | null;
  follow_up_at: string | null;
  response_received_at: string | null;
  response_type: string | null;
  created_at: string;
  updated_at: string;
};
