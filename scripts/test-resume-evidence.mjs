import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ensureResumeEvidence,
  extractResumeEvidence,
} from "../lib/resumeEvidence.ts";

const sample = `Candidate Name
candidate@example.test

PROFESSIONAL SUMMARY
Platform engineer focused on reliable distributed systems.

EXPERIENCE
Example Systems | Senior Engineer | 2022 - Present
• Reduced deployment time by 40% using GitHub Actions and Terraform.
• Led migration of services to Kubernetes.

TECHNICAL SKILLS
TypeScript, Kubernetes, Terraform, PostgreSQL

EDUCATION
Example University, Bachelor of Science in Computer Science`;

const extracted = extractResumeEvidence(sample, [
  "TypeScript",
  "Kubernetes",
  "Terraform",
  "PostgreSQL",
]);

assert.equal(
  extracted.some((item) => item.normalizedText.includes("candidate@example.test")),
  false,
  "contact information must not become tailoring evidence"
);
assert.equal(
  extracted.some(
    (item) =>
      item.kind === "experience" &&
      item.normalizedText ===
        "Reduced deployment time by 40% using GitHub Actions and Terraform."
  ),
  true
);
assert.equal(
  extracted.find((item) => item.normalizedText.startsWith("Reduced deployment"))?.metadata
    .isBullet,
  true
);
assert.equal(
  extracted.filter(
    (item) => item.kind === "skill" && item.normalizedText === "Kubernetes"
  ).length,
  1,
  "skill evidence should be deterministically deduplicated"
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-resume-evidence-"));
const db = new Database(path.join(tempDir, "evidence.db"));

try {
  db.exec(`
    CREATE TABLE resumes (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      skills_json TEXT NOT NULL
    );
    CREATE TABLE resume_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id INTEGER NOT NULL,
      evidence_kind TEXT NOT NULL,
      section TEXT NOT NULL,
      source_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      source_start_line INTEGER,
      source_end_line INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      verification_status TEXT NOT NULL DEFAULT 'extracted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO resumes (id, text, skills_json) VALUES (1, ?, ?)").run(
    sample,
    JSON.stringify(["TypeScript", "Kubernetes", "Terraform", "PostgreSQL"])
  );
  const resume = db.prepare("SELECT * FROM resumes WHERE id = 1").get();
  const first = ensureResumeEvidence(db, resume);
  const second = ensureResumeEvidence(db, resume);
  assert.ok(first.length > 0);
  assert.equal(second.length, first.length, "evidence creation must be idempotent");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM resume_evidence").get().count,
    first.length
  );
  assert.equal(first.every((item) => item.verification_status === "extracted"), true);
  console.log("Resume evidence extraction and isolated persistence checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
