import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  generateResumeArtifacts,
  getResumeArtifactSummaries,
  selectResumeAttachmentForJob,
} from "../lib/resumeArtifacts.ts";
import { extractResumeText } from "../lib/resume.ts";
import { postingFingerprint } from "../lib/jobRequirements.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-artifacts-"));
process.env.JOB_AUTOPILOT_DATA_DIR = tempDir;
const db = new Database(path.join(tempDir, "artifacts.db"));

try {
  db.exec(`
    CREATE TABLE resume_variants (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      resume_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      job_fingerprint TEXT NOT NULL,
      preferred_format TEXT NOT NULL DEFAULT 'docx',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT
    );
    CREATE TABLE resume_variant_items (
      id INTEGER PRIMARY KEY,
      variant_id INTEGER NOT NULL,
      evidence_id INTEGER NOT NULL,
      evidence_kind TEXT NOT NULL,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      tailored_text TEXT NOT NULL,
      rationale TEXT NOT NULL,
      change_type TEXT NOT NULL,
      matched_terms_json TEXT NOT NULL,
      included INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE resume_variant_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(variant_id, format)
    );
    CREATE TABLE resume_evidence (
      id INTEGER PRIMARY KEY,
      normalized_text TEXT NOT NULL,
      verification_status TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO resume_variants
       VALUES (1, 1, 1, 'approved', ?, 'docx', '2026-07-30',
               '2026-07-30', '2026-07-30')`
  ).run(postingFingerprint("Kubernetes is required."));
  const insertItem = db.prepare(
    `INSERT INTO resume_variant_items
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '2026-07-30')`
  );
  insertItem.run(
    1,
    1,
    "summary",
    "Summary",
    0,
    "Platform engineer.",
    "Platform engineer.",
    "Verified summary.",
    "unchanged",
    "[]"
  );
  db.prepare(
    "INSERT INTO resume_evidence VALUES (?, ?, 'verified')"
  ).run(1, "Platform engineer.");
  db.prepare(
    "INSERT INTO resume_evidence VALUES (?, ?, 'verified')"
  ).run(2, "TypeScript");
  db.prepare(
    "INSERT INTO resume_evidence VALUES (?, ?, 'verified')"
  ).run(3, "Built reliable platform services.");
  insertItem.run(
    2,
    2,
    "skill",
    "Skills",
    1,
    "TypeScript",
    "TypeScript",
    "Supports a required expectation.",
    "reordered",
    '["TypeScript"]'
  );
  insertItem.run(
    3,
    3,
    "experience",
    "Experience",
    2,
    "Built reliable platform services.",
    "Built reliable platform services.",
    "Supports a required expectation.",
    "unchanged",
    "[]"
  );

  const sourceResume = `Jordan Example
jordan@example.test | 555-010-1234

PROFESSIONAL SUMMARY
Platform engineer.`;
  const artifacts = await generateResumeArtifacts(db, 1, {
    resumeText: sourceResume,
    resumeFilename: "Jordan Example Resume.txt",
    company: "Synthetic Company",
    jobTitle: "Platform Engineer",
  });
  assert.deepEqual(
    artifacts.map((artifact) => [artifact.format, artifact.validationStatus]),
    [
      ["docx", "passed"],
      ["pdf", "passed"],
    ]
  );
  const rows = db
    .prepare(
      "SELECT format, file_path, validation_status FROM resume_variant_artifacts ORDER BY format"
    )
    .all();
  assert.equal(rows.every((row) => row.validation_status === "passed"), true);
  assert.equal(rows.every((row) => fs.existsSync(row.file_path)), true);
  const qaDir = process.env.JOB_AUTOPILOT_ARTIFACT_QA_DIR;
  if (qaDir) {
    fs.mkdirSync(qaDir, { recursive: true });
    for (const row of rows) {
      fs.copyFileSync(row.file_path, path.join(qaDir, `synthetic-resume.${row.format}`));
    }
  }

  for (const row of rows) {
    const extracted = await extractResumeText(fs.readFileSync(row.file_path), `resume.${row.format}`);
    assert.equal(extracted.includes("Jordan Example"), true);
    assert.equal(extracted.includes("TypeScript"), true);
    assert.equal(extracted.includes("Built reliable platform services."), true);
  }
  const summaries = getResumeArtifactSummaries(db, 1);
  assert.equal(summaries.length, 2);
  assert.equal(summaries.every((artifact) => artifact.downloadUrl), true);

  const masterPath = path.join(tempDir, "master-resume.txt");
  fs.writeFileSync(masterPath, sourceResume);
  const master = {
    id: 1,
    filename: "Jordan Example Resume.txt",
    file_path: masterPath,
  };
  const defaultSelection = selectResumeAttachmentForJob(
    db,
    { id: 1, description: "Kubernetes is required." },
    master
  );
  assert.equal(defaultSelection?.source, "tailored");
  assert.equal(defaultSelection?.format, "docx");

  db.prepare("UPDATE resume_variants SET preferred_format = 'pdf' WHERE id = 1").run();
  const preferredPdf = selectResumeAttachmentForJob(
    db,
    { id: 1, description: "Kubernetes is required." },
    master
  );
  assert.equal(preferredPdf?.format, "pdf");
  fs.unlinkSync(preferredPdf.filePath);
  assert.equal(
    selectResumeAttachmentForJob(
      db,
      { id: 1, description: "Kubernetes is required." },
      master
    )?.format,
    "docx",
    "a missing preferred artifact should fall back to the other validated format"
  );
  assert.equal(
    selectResumeAttachmentForJob(
      db,
      { id: 2, description: "Kubernetes is required." },
      master
    )?.source,
    "master",
    "another job must never receive this job's approved variant"
  );
  assert.equal(
    selectResumeAttachmentForJob(
      db,
      { id: 1, description: "The posting changed." },
      master
    )?.source,
    "master",
    "a changed posting must invalidate the tailored attachment"
  );
  db.prepare(
    "UPDATE resume_evidence SET verification_status = 'rejected' WHERE id = 3"
  ).run();
  assert.equal(
    selectResumeAttachmentForJob(
      db,
      { id: 1, description: "Kubernetes is required." },
      master
    )?.source,
    "master",
    "changed evidence must invalidate the tailored attachment"
  );

  await assert.rejects(
    generateResumeArtifacts(db, 1, {
      resumeText: "Jordan Example\nPROFESSIONAL SUMMARY\nPlatform engineer.",
      resumeFilename: "Resume.txt",
      company: "Synthetic Company",
      jobTitle: "Platform Engineer",
    }),
    /contact detail/
  );

  console.log("ATS-safe DOCX/PDF generation and round-trip checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
