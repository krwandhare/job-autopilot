import { NextRequest, NextResponse } from "next/server";
import { getDb, type ResumeRow } from "@/lib/db";
import {
  EVIDENCE_STATUSES,
  ensureResumeEvidence,
  serializeResumeEvidence,
  type EvidenceStatus,
  type ResumeEvidenceRow,
} from "@/lib/resumeEvidence";

function parseResumeId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest) {
  const requestedId = req.nextUrl.searchParams.get("resumeId");
  const resumeId = requestedId === null ? null : parseResumeId(requestedId);
  if (requestedId !== null && resumeId === null) {
    return NextResponse.json({ error: "Invalid resumeId" }, { status: 400 });
  }

  const db = getDb();
  const resume = (resumeId
    ? db.prepare("SELECT * FROM resumes WHERE id = ?").get(resumeId)
    : db.prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC, id DESC LIMIT 1").get()) as
    | ResumeRow
    | undefined;
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const rows = db
    .prepare(
      `SELECT * FROM resume_evidence
       WHERE resume_id = ?
       ORDER BY source_start_line IS NULL, source_start_line, id`
    )
    .all(resume.id) as ResumeEvidenceRow[];
  return NextResponse.json({
    resumeId: resume.id,
    evidence: rows.map(serializeResumeEvidence),
    needsExtraction: rows.length === 0,
  });
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const resumeId = parseResumeId((body as Record<string, unknown>).resumeId);
  if (resumeId === null) {
    return NextResponse.json({ error: "Valid resumeId is required" }, { status: 400 });
  }

  const db = getDb();
  const resume = db.prepare("SELECT * FROM resumes WHERE id = ?").get(resumeId) as
    | ResumeRow
    | undefined;
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const evidence = ensureResumeEvidence(db, resume);
  return NextResponse.json({
    resumeId: resume.id,
    evidence: evidence.map(serializeResumeEvidence),
  });
}

export async function PATCH(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const candidate = body as Record<string, unknown>;

  if (candidate.action === "verify_all_skills") {
    const resumeId = parseResumeId(candidate.resumeId);
    if (resumeId === null) {
      return NextResponse.json({ error: "Valid resumeId is required" }, { status: 400 });
    }

    const db = getDb();
    const resume = db.prepare("SELECT id FROM resumes WHERE id = ?").get(resumeId);
    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const result = db
      .prepare(
        `UPDATE resume_evidence
         SET verification_status = 'verified', updated_at = datetime('now')
         WHERE resume_id = ?
           AND evidence_kind = 'skill'
           AND verification_status = 'extracted'`
      )
      .run(resumeId);
    const rows = db
      .prepare(
        `SELECT * FROM resume_evidence
         WHERE resume_id = ?
         ORDER BY source_start_line IS NULL, source_start_line, id`
      )
      .all(resumeId) as ResumeEvidenceRow[];

    return NextResponse.json({
      updatedCount: result.changes,
      evidence: rows.map(serializeResumeEvidence),
    });
  }

  const id = parseResumeId(candidate.id);
  const verificationStatus = candidate.verificationStatus;
  const normalizedText =
    typeof candidate.normalizedText === "string" ? candidate.normalizedText.trim() : "";
  if (
    id === null ||
    typeof verificationStatus !== "string" ||
    !EVIDENCE_STATUSES.includes(verificationStatus as EvidenceStatus) ||
    !normalizedText ||
    normalizedText.length > 2000
  ) {
    return NextResponse.json(
      { error: "id, valid verificationStatus, and normalizedText are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const result = db
    .prepare(
      `UPDATE resume_evidence
       SET normalized_text = ?, verification_status = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(normalizedText, verificationStatus, id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }
  const row = db.prepare("SELECT * FROM resume_evidence WHERE id = ?").get(id) as
    | ResumeEvidenceRow
    | undefined;
  return NextResponse.json({ evidence: row ? serializeResumeEvidence(row) : null });
}
