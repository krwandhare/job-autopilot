import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createApplication,
  getApplicationStats,
  getOrCreateCompany,
  getTopJobsByFit,
  listApplications,
  updateApplication,
} from "../lib/applications.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-applications-"));
const db = new Database(path.join(tempDir, "applications.db"));

try {
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      match_score REAL,
      fetched_at TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE resumes (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      website TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE applications (
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
    CREATE UNIQUE INDEX idx_applications_job_id ON applications(job_id);
  `);

  const insertJob = db.prepare(
    `INSERT INTO jobs (id, status, title, company, match_score, fetched_at, url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertJob.run(1, "new", "Platform Engineer", "Acme Corp", 80, "2026-07-30 10:00:00", "https://example.com/1");
  insertJob.run(2, "new", "Backend Engineer", "Widgets Inc", 60, "2026-07-30 11:00:00", "https://example.com/2");
  insertJob.run(3, "applied", "Staff Engineer", "Acme Corp", 90, "2026-07-30 12:00:00", "https://example.com/3");
  insertJob.run(4, "external_lead", "Principal Engineer", "Beta LLC", 70, "2026-07-30 13:00:00", "https://example.com/4");
  // A hard-excluded match (title/location disallow -> forced to 0 by
  // lib/matching.ts) must never surface as a "top fit" recommendation.
  insertJob.run(5, "new", "Unrelated Role", "Gamma Inc", 0, "2026-07-30 14:00:00", "https://example.com/5");

  db.prepare("INSERT INTO resumes (id, filename, uploaded_at) VALUES (1, 'resume_v2.pdf', '2026-07-30 09:00:00')").run();

  // getOrCreateCompany dedups by exact name.
  const acmeId1 = getOrCreateCompany(db, "Acme Corp");
  const acmeId2 = getOrCreateCompany(db, "Acme Corp");
  assert.equal(acmeId1, acmeId2);
  const companyCount = db.prepare("SELECT COUNT(*) AS c FROM companies").get();
  assert.equal(companyCount.c, 1);

  // createApplication is idempotent per job.
  const app1 = createApplication(db, {
    jobId: 3,
    companyName: "Acme Corp",
    resumeVersion: "resume_v2.pdf",
    source: "autofill_submit",
  });
  const app1Again = createApplication(db, {
    jobId: 3,
    companyName: "Acme Corp",
    source: "manual",
  });
  assert.equal(app1.id, app1Again.id);
  assert.equal(app1Again.source, "autofill_submit"); // first write wins, not overwritten
  const appCount = db.prepare("SELECT COUNT(*) AS c FROM applications").get();
  assert.equal(appCount.c, 1);

  createApplication(db, { jobId: 4, companyName: "Beta LLC", source: "external_lead" });

  // updateApplication for follow-up + response tracking.
  const updated = updateApplication(db, 3, {
    followUpAt: "2026-08-10",
    responseReceivedAt: "2026-08-05",
    responseType: "interview",
  });
  assert.equal(updated.follow_up_at, "2026-08-10");
  assert.equal(updated.response_type, "interview");
  assert.equal(updateApplication(db, 999, { notes: "x" }), null);

  // listApplications: no-response filter excludes the one with a response.
  const noResponse = listApplications(db, { noResponseDays: 0 });
  assert.deepEqual(
    noResponse.map((a) => a.job_id),
    [4]
  );

  const all = listApplications(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].jobTitle, "Principal Engineer"); // most recently applied first

  // getApplicationStats.
  const stats = getApplicationStats(db);
  assert.equal(stats.total, 2);
  assert.equal(stats.withResponse, 1);
  assert.equal(stats.responseRate, 0.5);

  // getTopJobsByFit: only status='new' jobs with no application yet and a
  // real (nonzero) score, best match first. Job 5 (score 0, a hard
  // exclusion) must be excluded even though it's otherwise eligible.
  const topFit = getTopJobsByFit(db, 10);
  assert.deepEqual(
    topFit.map((j) => j.id),
    [1, 2]
  );
  assert.equal(topFit[0].matchScore, 80);
  assert.ok(!topFit.some((j) => j.id === 5));

  console.log("Applications data-model checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
