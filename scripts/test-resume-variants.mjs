import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  approveResumeVariant,
  composeVariantItems,
  createResumeVariant,
  getResumeVariant,
  setVariantItemIncluded,
} from "../lib/resumeVariants.ts";

const requirements = [
  {
    id: 1,
    job_id: 1,
    requirement_kind: "skill",
    priority: "required",
    requirement_text: "Kubernetes experience is required",
    terms_json: '["Kubernetes"]',
    source_text: "Kubernetes experience is required",
    source_order: 1,
    created_at: "",
  },
  {
    id: 2,
    job_id: 1,
    requirement_kind: "skill",
    priority: "preferred",
    requirement_text: "Terraform experience is preferred",
    terms_json: '["Terraform"]',
    source_text: "Terraform experience is preferred",
    source_order: 2,
    created_at: "",
  },
];

const evidence = [
  {
    id: 1,
    resume_id: 1,
    evidence_kind: "summary",
    section: "Summary",
    source_text: "Platform engineer",
    normalized_text: "Platform engineer",
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
    evidence_kind: "experience",
    section: "Experience",
    source_text: "Led Kubernetes migration",
    normalized_text: "Led Kubernetes migration",
    source_start_line: 8,
    source_end_line: 8,
    metadata_json: "{}",
    verification_status: "verified",
    created_at: "",
    updated_at: "",
  },
  {
    id: 3,
    resume_id: 1,
    evidence_kind: "skill",
    section: "Skills",
    source_text: "Terraform",
    normalized_text: "Terraform",
    source_start_line: 12,
    source_end_line: 12,
    metadata_json: "{}",
    verification_status: "extracted",
    created_at: "",
    updated_at: "",
  },
];

const composed = composeVariantItems(requirements, evidence);
assert.deepEqual(
  composed.map((item) => item.evidenceId),
  [1, 2],
  "only verified evidence may enter a tailored variant"
);
assert.equal(composed[1].matchedTerms.includes("Kubernetes"), true);
assert.equal(composed[1].rationale.includes("required"), true);
assert.equal(composed[1].tailoredText, "Led Kubernetes migration.");
assert.equal(
  composed.some((item) => item.tailoredText.includes("Terraform")),
  false,
  "unverified preferred terms must not be inserted"
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-variants-"));
const db = new Database(path.join(tempDir, "variants.db"));

try {
  db.exec(`
    CREATE TABLE resume_evidence (
      id INTEGER PRIMARY KEY,
      resume_id INTEGER NOT NULL,
      evidence_kind TEXT NOT NULL,
      section TEXT NOT NULL,
      source_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      source_start_line INTEGER,
      source_end_line INTEGER,
      metadata_json TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE resume_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      resume_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      job_fingerprint TEXT NOT NULL,
      preferred_format TEXT NOT NULL DEFAULT 'docx',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE UNIQUE INDEX idx_approved
      ON resume_variants(job_id) WHERE status = 'approved';
    CREATE TABLE resume_variant_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insertEvidence = db.prepare(
    `INSERT INTO resume_evidence VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of evidence) {
    insertEvidence.run(
      item.id,
      item.resume_id,
      item.evidence_kind,
      item.section,
      item.source_text,
      item.normalized_text,
      item.source_start_line,
      item.source_end_line,
      item.metadata_json,
      item.verification_status,
      "2026-07-30",
      "2026-07-30"
    );
  }

  const first = createResumeVariant(db, {
    job: { id: 1, description: "Kubernetes required. Terraform preferred." },
    resume: { id: 1 },
    requirements,
    evidence,
  });
  const second = createResumeVariant(db, {
    job: { id: 1, description: "Kubernetes required. Terraform preferred." },
    resume: { id: 1 },
    requirements,
    evidence,
  });
  assert.equal(
    db.prepare("SELECT status FROM resume_variants WHERE id = ?").get(first.id).status,
    "superseded"
  );
  const loadedSecond = getResumeVariant(db, second.id);
  assert.ok(loadedSecond);
  assert.equal(
    setVariantItemIncluded(db, second.id, loadedSecond.items[0].id, false),
    true
  );
  assert.equal(
    approveResumeVariant(db, second.id, {
      jobDescription: "Kubernetes required. Terraform preferred.",
      latestResumeId: 1,
    }).ok,
    true
  );
  assert.equal(
    setVariantItemIncluded(db, second.id, loadedSecond.items[0].id, true),
    false,
    "approved variants must be immutable"
  );

  const third = createResumeVariant(db, {
    job: { id: 1, description: "Kubernetes required. Terraform preferred." },
    resume: { id: 1 },
    requirements,
    evidence,
  });
  db.prepare(
    "UPDATE resume_evidence SET normalized_text = 'Changed evidence' WHERE id = 2"
  ).run();
  const staleApproval = approveResumeVariant(db, third.id, {
    jobDescription: "Kubernetes required. Terraform preferred.",
    latestResumeId: 1,
  });
  assert.equal(staleApproval.ok, false);
  assert.equal(staleApproval.reason.includes("evidence changed"), true);

  console.log("Evidence-constrained resume variant and approval checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
