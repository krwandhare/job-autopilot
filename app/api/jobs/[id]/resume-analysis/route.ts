import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import {
  analyzeRequirementCoverage,
  ensureJobRequirements,
  rowToRequirement,
  type JobRequirementRow,
} from "@/lib/jobRequirements";
import type { ResumeEvidenceRow } from "@/lib/resumeEvidence";

function parseJobId(value: string): number | null {
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
  if (evidence.length === 0) {
    return {
      error: "Verify at least one career-evidence item on the Profile page first" as const,
      status: 409 as const,
    };
  }
  return { db, job, resume, evidence };
}

function responseFor(
  rows: JobRequirementRow[],
  evidence: ResumeEvidenceRow[],
  analyzedAt: string | null
) {
  const requirements = rows.map(rowToRequirement);
  const coverage = analyzeRequirementCoverage(requirements, evidence);
  const counts = {
    required: coverage.filter((item) => item.requirement.priority === "required").length,
    preferred: coverage.filter((item) => item.requirement.priority === "preferred").length,
    context: coverage.filter((item) => item.requirement.priority === "context").length,
    supported: coverage.filter((item) => item.status === "supported").length,
    partial: coverage.filter((item) => item.status === "partial").length,
    notEvidenced: coverage.filter((item) => item.status === "not_evidenced").length,
    needsReview: coverage.filter((item) => item.status === "needs_review").length,
  };
  return { analysis: { analyzedAt, counts, coverage } };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parseJobId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const inputs = loadInputs(jobId);
  if ("error" in inputs) {
    return NextResponse.json({ error: inputs.error }, { status: inputs.status });
  }
  const analysis = inputs.db
    .prepare("SELECT analyzed_at FROM job_requirement_analyses WHERE job_id = ?")
    .get(jobId) as { analyzed_at: string } | undefined;
  if (!analysis) return NextResponse.json({ analysis: null });
  const rows = inputs.db
    .prepare("SELECT * FROM job_requirements WHERE job_id = ? ORDER BY source_order, id")
    .all(jobId) as JobRequirementRow[];
  return NextResponse.json(responseFor(rows, inputs.evidence, analysis.analyzed_at));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parseJobId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const inputs = loadInputs(jobId);
  if ("error" in inputs) {
    return NextResponse.json({ error: inputs.error }, { status: inputs.status });
  }
  if (!inputs.job.description?.trim()) {
    return NextResponse.json(
      { error: "This job has no description to analyze" },
      { status: 409 }
    );
  }
  const rows = ensureJobRequirements(inputs.db, inputs.job);
  const analysis = inputs.db
    .prepare("SELECT analyzed_at FROM job_requirement_analyses WHERE job_id = ?")
    .get(jobId) as { analyzed_at: string };
  return NextResponse.json(responseFor(rows, inputs.evidence, analysis.analyzed_at));
}
