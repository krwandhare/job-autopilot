import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb, type ResumeRow } from "@/lib/db";
import { extractResumeText } from "@/lib/resume";
import {
  ensureResumeEvidence,
  serializeResumeEvidence,
  type ResumeEvidenceRow,
} from "@/lib/resumeEvidence";

function parseId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const resumeId = parseId((body as Record<string, unknown>).resumeId);
  if (resumeId === null) {
    return NextResponse.json({ error: "Valid resumeId is required" }, { status: 400 });
  }

  const db = getDb();
  const latest = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC, id DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  if (!latest || latest.id !== resumeId) {
    return NextResponse.json(
      { error: "Only the latest resume can be reprocessed" },
      { status: 409 }
    );
  }
  if (path.extname(latest.filename).toLowerCase() !== ".pdf") {
    return NextResponse.json(
      { error: "Layout-aware reprocessing is available only for PDF resumes" },
      { status: 409 }
    );
  }
  if (!latest.file_path || !fs.existsSync(latest.file_path)) {
    return NextResponse.json(
      { error: "The stored master PDF is unavailable; upload it again" },
      { status: 409 }
    );
  }

  const previousEvidence = db
    .prepare("SELECT * FROM resume_evidence WHERE resume_id = ? ORDER BY id")
    .all(latest.id) as ResumeEvidenceRow[];
  const carryVerification =
    previousEvidence.length > 0 &&
    previousEvidence.every((item) => item.verification_status === "verified");

  let reconstructedText: string;
  try {
    reconstructedText = await extractResumeText(
      fs.readFileSync(latest.file_path),
      latest.filename
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reconstruct the stored PDF layout" },
      { status: 422 }
    );
  }
  if (!reconstructedText.trim()) {
    return NextResponse.json(
      { error: "The stored PDF did not contain extractable text" },
      { status: 422 }
    );
  }

  const result = db
    .prepare(
      `INSERT INTO resumes (filename, text, skills_json, file_path)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      latest.filename,
      reconstructedText,
      latest.skills_json,
      latest.file_path
    );
  const newResumeId = Number(result.lastInsertRowid);
  const newResume = db
    .prepare("SELECT * FROM resumes WHERE id = ?")
    .get(newResumeId) as ResumeRow;
  let evidence = ensureResumeEvidence(db, newResume);
  if (carryVerification) {
    db.prepare(
      `UPDATE resume_evidence
       SET verification_status = 'verified', updated_at = datetime('now')
       WHERE resume_id = ? AND verification_status = 'extracted'`
    ).run(newResumeId);
    evidence = db
      .prepare(
        `SELECT * FROM resume_evidence
         WHERE resume_id = ?
         ORDER BY source_start_line IS NULL, source_start_line, id`
      )
      .all(newResumeId) as ResumeEvidenceRow[];
  }

  return NextResponse.json({
    resume: newResume,
    evidence: evidence.map(serializeResumeEvidence),
    verificationCarriedForward: carryVerification,
  });
}
