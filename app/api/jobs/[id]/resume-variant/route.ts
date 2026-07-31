import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import { ensureJobRequirements } from "@/lib/jobRequirements";
import type { ResumeEvidenceRow } from "@/lib/resumeEvidence";
import {
  createResumeVariant,
  getLatestResumeVariant,
  getResumeVariant,
  serializeResumeVariant,
} from "@/lib/resumeVariants";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function loadInputs(jobId: number) {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    | JobRow
    | undefined;
  if (!job) return { error: "Job not found" as const, status: 404 as const };
  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC, id DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  if (!resume) return { error: "Upload a resume first" as const, status: 409 as const };
  const evidence = db
    .prepare(
      `SELECT * FROM resume_evidence
       WHERE resume_id = ? AND verification_status = 'verified'
       ORDER BY source_start_line IS NULL, source_start_line, id`
    )
    .all(resume.id) as ResumeEvidenceRow[];
  return { db, job, resume, evidence };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parseId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const inputs = loadInputs(jobId);
  if ("error" in inputs) {
    return NextResponse.json({ error: inputs.error }, { status: inputs.status });
  }
  return NextResponse.json({
    variant: serializeResumeVariant(getLatestResumeVariant(inputs.db, jobId)),
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parseId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const inputs = loadInputs(jobId);
  if ("error" in inputs) {
    return NextResponse.json({ error: inputs.error }, { status: inputs.status });
  }
  if (!inputs.job.description?.trim()) {
    return NextResponse.json(
      { error: "This job has no description to tailor against" },
      { status: 409 }
    );
  }
  if (inputs.evidence.length === 0) {
    return NextResponse.json(
      { error: "Verify at least one career-evidence item on the Profile page first" },
      { status: 409 }
    );
  }

  const requirements = ensureJobRequirements(inputs.db, inputs.job);
  const created = createResumeVariant(inputs.db, {
    job: inputs.job,
    resume: inputs.resume,
    requirements,
    evidence: inputs.evidence,
  });
  return NextResponse.json({
    variant: serializeResumeVariant(getResumeVariant(inputs.db, created.id)),
  });
}
