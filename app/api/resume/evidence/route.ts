import { NextRequest, NextResponse } from "next/server";
import { getDb, type ResumeRow } from "@/lib/db";
import {
  ensureResumeEvidence,
  serializeResumeEvidence,
  type ResumeEvidenceRow,
} from "@/lib/resumeEvidence";
import { validateEvidencePatch, validateResumeIdBody } from "@/lib/apiValidation";

function parseResumeId(value: unknown): number | null {
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function getEvidence(req: NextRequest) {
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

async function createEvidence(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const resumeId = validateResumeIdBody(body as Record<string, unknown>);
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

  try {
    const evidence = ensureResumeEvidence(db, resume);
    return NextResponse.json({
      resumeId: resume.id,
      evidence: evidence.map(serializeResumeEvidence),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not prepare resume evidence; please try again" },
      { status: 500 }
    );
  }
}

async function updateEvidence(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const patch = validateEvidencePatch(body as Record<string, unknown>);
  if (!patch) {
    return NextResponse.json({ error: "Invalid evidence update" }, { status: 400 });
  }

  if (patch.kind === "bulk") {
    const { resumeId } = patch;
    const db = getDb();
    const resume = db.prepare("SELECT id FROM resumes WHERE id = ?").get(resumeId);
    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const verifyAllEvidence = patch.action === "verify_all_evidence";
    const result = verifyAllEvidence
      ? db
          .prepare(
            `UPDATE resume_evidence
             SET verification_status = 'verified', updated_at = datetime('now')
             WHERE resume_id = ?
               AND verification_status = 'extracted'`
          )
          .run(resumeId)
      : db
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

  const db = getDb();
  const result = db
    .prepare(
      `UPDATE resume_evidence
       SET normalized_text = ?, verification_status = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(patch.normalizedText, patch.verificationStatus, patch.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }
  const row = db.prepare("SELECT * FROM resume_evidence WHERE id = ?").get(patch.id) as
    | ResumeEvidenceRow
    | undefined;
  return NextResponse.json({ evidence: row ? serializeResumeEvidence(row) : null });
}

function evidenceFailure() {
  return NextResponse.json(
    { error: "Could not access resume evidence; please try again" },
    { status: 500 }
  );
}

export async function GET(req: NextRequest) {
  try {
    return await getEvidence(req);
  } catch {
    return evidenceFailure();
  }
}

export async function POST(req: NextRequest) {
  try {
    return await createEvidence(req);
  } catch {
    return evidenceFailure();
  }
}

export async function PATCH(req: NextRequest) {
  try {
    return await updateEvidence(req);
  } catch {
    return evidenceFailure();
  }
}
