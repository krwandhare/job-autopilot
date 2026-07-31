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

const letterSpacedSample = `Candidate Name
candidate@example.test

S U M M A R Y
Platform engineer focused on reliable distributed systems.

P R O F E S S I O N A L  E X P E R I E N C E
Example Systems | Senior Engineer | 2022 - Present
• Led migration of services to Kubernetes.

CO R E S K I L LS
TypeScript, Kubernetes

E D U C AT I O N
Example University

C E RT I F I C AT I O N S
Cloud Certification`;
const letterSpacedEvidence = extractResumeEvidence(letterSpacedSample);
assert.equal(
  letterSpacedEvidence.some(
    (item) =>
      item.kind === "experience" &&
      item.section === "Professional Experience" &&
      item.normalizedText.includes("Example Systems")
  ),
  true,
  "letter-spaced PDF headings must retain experience structure"
);
assert.equal(
  letterSpacedEvidence.some(
    (item) =>
      item.kind === "skill" &&
      item.section === "Core Skills" &&
      item.normalizedText === "Kubernetes"
  ),
  true
);
assert.equal(
  letterSpacedEvidence.some(
    (item) => item.kind === "education" && item.section === "Education"
  ),
  true
);
assert.equal(
  letterSpacedEvidence.some(
    (item) => item.kind === "certification" && item.section === "Certifications"
  ),
  true
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

  db.prepare(
    `UPDATE resume_evidence
     SET evidence_kind = 'other', section = 'P R O F E S S I O N A L  E X P E R I E N C E'
     WHERE id = ?`
  ).run(first[0].id);
  const normalizedExisting = ensureResumeEvidence(db, resume);
  assert.equal(
    normalizedExisting.find((item) => item.id === first[0].id)?.evidence_kind,
    "experience",
    "existing letter-spaced sections must be reclassified without rebuilding evidence"
  );
  console.log("Resume evidence extraction and isolated persistence checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
