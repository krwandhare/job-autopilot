import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");

declare global {
  var __db: Database.Database | undefined;
}

function init(db: Database.Database) {
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
}

export function getDb(): Database.Database {
  if (!global.__db) {
    const db = new Database(dbPath);
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
