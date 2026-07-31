import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  analyzeRequirementCoverage,
  ensureJobRequirements,
  extractJobRequirements,
  rowToRequirement,
} from "../lib/jobRequirements.ts";

const posting = `RESPONSIBILITIES
Build reliable platform services using TypeScript and PostgreSQL.
Collaborate with product and infrastructure teams.

MINIMUM QUALIFICATIONS
At least 5 years of software engineering experience.
Kubernetes experience is required.

PREFERRED QUALIFICATIONS
Terraform experience is preferred.
AWS certification is a plus.`;

const extracted = extractJobRequirements(posting);
assert.equal(extracted.length, 6);
assert.equal(
  extracted.find((item) => item.text.includes("Kubernetes"))?.priority,
  "required"
);
assert.equal(
  extracted.find((item) => item.text.includes("Terraform"))?.priority,
  "preferred"
);
assert.equal(
  extracted.find((item) => item.text.includes("5 years"))?.kind,
  "experience"
);
assert.deepEqual(
  extracted.find((item) => item.text.includes("TypeScript"))?.terms,
  ["TypeScript", "PostgreSQL"]
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-requirements-"));
const db = new Database(path.join(tempDir, "requirements.db"));

try {
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      description TEXT
    );
    CREATE TABLE job_requirement_analyses (
      job_id INTEGER PRIMARY KEY,
      description_fingerprint TEXT NOT NULL,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE job_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      requirement_kind TEXT NOT NULL,
      priority TEXT NOT NULL,
      requirement_text TEXT NOT NULL,
      terms_json TEXT NOT NULL DEFAULT '[]',
      source_text TEXT NOT NULL,
      source_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO jobs (id, description) VALUES (1, ?)").run(posting);
  const job = db.prepare("SELECT * FROM jobs WHERE id = 1").get();
  const first = ensureJobRequirements(db, job);
  const second = ensureJobRequirements(db, job);
  assert.equal(first.length, 6);
  assert.deepEqual(
    second.map((row) => row.id),
    first.map((row) => row.id),
    "unchanged postings must reuse deterministic stored analysis"
  );

  const evidence = [
    {
      id: 1,
      resume_id: 1,
      evidence_kind: "experience",
      section: "Experience",
      source_text: "Built services",
      normalized_text: "Built TypeScript services backed by PostgreSQL.",
      source_start_line: 1,
      source_end_line: 1,
      metadata_json: "{}",
      verification_status: "verified",
      created_at: "",
      updated_at: "",
    },
    {
      id: 2,
      resume_id: 1,
      evidence_kind: "skill",
      section: "Skills",
      source_text: "Kubernetes",
      normalized_text: "Kubernetes",
      source_start_line: 2,
      source_end_line: 2,
      metadata_json: "{}",
      verification_status: "extracted",
      created_at: "",
      updated_at: "",
    },
  ];
  const coverage = analyzeRequirementCoverage(first.map(rowToRequirement), evidence);
  assert.equal(
    coverage.find((item) => item.requirement.text.includes("TypeScript"))?.status,
    "supported"
  );
  assert.equal(
    coverage.find((item) => item.requirement.text.includes("Kubernetes"))?.status,
    "not_evidenced",
    "unverified evidence must never count as support"
  );
  assert.equal(
    coverage.find((item) => item.requirement.text.includes("5 years"))?.status,
    "not_evidenced",
    "years of experience must not be inferred from unrelated resume dates"
  );

  db.prepare("UPDATE jobs SET description = ? WHERE id = 1").run(
    `${posting}\nPython experience is required.`
  );
  const refreshed = ensureJobRequirements(
    db,
    db.prepare("SELECT * FROM jobs WHERE id = 1").get()
  );
  assert.equal(refreshed.some((row) => row.requirement_text.includes("Python")), true);
  assert.notDeepEqual(
    refreshed.map((row) => row.id),
    first.map((row) => row.id),
    "changed posting text must replace stale requirements"
  );
  console.log("Job requirement extraction, coverage, and refresh checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
