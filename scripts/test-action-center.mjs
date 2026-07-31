import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getDashboardActions,
  parkJobWithAction,
  recordJobAction,
  resolveJobActions,
} from "../lib/actions.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-actions-"));
const db = new Database(path.join(tempDir, "actions.db"));

try {
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      remote INTEGER NOT NULL DEFAULT 0,
      match_score REAL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE job_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      reason_text TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'status',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  const insertJob = db.prepare(
    `INSERT INTO jobs
       (id, status, title, company, location, remote, match_score, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertJob.run(1, "watchlist", "Platform Engineer", "Example One", "Remote", 1, 75, "2026-07-30 10:00:00");
  insertJob.run(2, "needs_code", "Backend Engineer", "Example Two", "New York", 0, 90, "2026-07-30 11:00:00");
  insertJob.run(3, "new", "Frontend Engineer", "Example Three", "Boston", 0, 80, "2026-07-30 12:00:00");

  let actions = getDashboardActions(db);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((action) => action.jobId), [2, 1]);
  assert.equal(actions[0].reasonCode, "verification_code_required");
  assert.equal(actions[0].primaryHref, "/autofill?jobId=2");

  recordJobAction(db, 2, {
    actionType: "verification",
    reasonCode: "email_code_required",
    reasonText: "Enter the code sent to your email.",
    details: ["Check the inbox used for this application."],
    source: "autofill",
  });
  actions = getDashboardActions(db);
  assert.equal(actions[0].reasonText, "Enter the code sent to your email.");
  assert.deepEqual(actions[0].details, ["Check the inbox used for this application."]);
  assert.equal(actions[0].source, "autofill");

  assert.equal(
    parkJobWithAction(db, 3, "needs_review", {
      actionType: "application_review",
      reasonCode: "unanswered_questions",
      reasonText: "The application has questions that need your answer.",
      details: ["Expected salary"],
      source: "queue_runner",
    }),
    true
  );
  actions = getDashboardActions(db);
  assert.equal(actions[1].jobId, 3);
  assert.equal(actions[1].reasonCode, "unanswered_questions");
  assert.deepEqual(actions[1].details, ["Expected salary"]);

  resolveJobActions(db, 2);
  db.prepare("UPDATE jobs SET status = 'applied' WHERE id = 2").run();
  actions = getDashboardActions(db);
  assert.deepEqual(actions.map((action) => action.jobId), [3, 1]);
  assert.equal(actions.some((action) => action.jobId === 2), false);

  console.log("Action Center data-model checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
