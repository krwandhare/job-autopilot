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
import {
  LLMTailoringError,
  isEvidenceKindTailorable,
  isLLMTailoringConfigured,
  tailorEvidenceText,
} from "@/lib/llmTailoring";

type TailoringMode = "auto" | "llm" | "deterministic";

// Tolerates a body-less POST (the existing UI call site sends none) as
// "use defaults" -- distinct from a non-empty-but-malformed body, which
// still gets a clean 400 instead of an uncaught req.json() SyntaxError.
async function parseModeBody(
  req: NextRequest
): Promise<{ ok: true; mode: TailoringMode } | { ok: false; response: NextResponse }> {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, mode: "auto" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 }),
    };
  }
  const mode = (parsed as { mode?: unknown })?.mode;
  if (mode === undefined) return { ok: true, mode: "auto" };
  if (mode === "auto" || mode === "llm" || mode === "deterministic") {
    return { ok: true, mode };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'mode must be "auto", "llm", or "deterministic"' },
      { status: 400 }
    ),
  };
}

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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parseId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const modeResult = await parseModeBody(req);
  if (!modeResult.ok) return modeResult.response;
  const { mode } = modeResult;

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
  if (mode === "llm" && !isLLMTailoringConfigured()) {
    return NextResponse.json(
      { error: "AI tailoring requires ANTHROPIC_API_KEY to be set in .env.local" },
      { status: 409 }
    );
  }

  // The LLM (when used) only ever supplies wording for these free-text
  // kinds -- see lib/llmTailoring.ts. Everything else, including which
  // evidence qualifies and how it's ordered, stays on the unchanged
  // deterministic path in composeVariantItems().
  const tailorableEvidence = inputs.evidence.filter((row) =>
    isEvidenceKindTailorable(row.evidence_kind)
  );

  let tailoredOverrides: Map<number, string> | undefined;
  let tailoringMode: "llm" | "deterministic" = "deterministic";
  let tailoringError: string | undefined;

  if (mode !== "deterministic" && isLLMTailoringConfigured() && tailorableEvidence.length > 0) {
    try {
      tailoredOverrides = await tailorEvidenceText(
        tailorableEvidence.map((row) => ({
          evidenceId: row.id,
          kind: row.evidence_kind,
          text: row.normalized_text,
        })),
        inputs.job.description
      );
      tailoringMode = "llm";
    } catch (err) {
      const message = err instanceof LLMTailoringError ? err.message : "AI tailoring failed";
      if (mode === "llm") {
        return NextResponse.json({ error: `AI tailoring failed: ${message}` }, { status: 502 });
      }
      // mode "auto": fall back to the deterministic path rather than
      // blocking the pipeline on a transient API/refusal failure, but
      // report exactly what happened -- never silently mislabel it.
      tailoringError = message;
    }
  }

  const requirements = ensureJobRequirements(inputs.db, inputs.job);
  const created = createResumeVariant(inputs.db, {
    job: inputs.job,
    resume: inputs.resume,
    requirements,
    evidence: inputs.evidence,
    tailoredOverrides,
  });
  return NextResponse.json({
    variant: serializeResumeVariant(getResumeVariant(inputs.db, created.id)),
    tailoringMode,
    ...(tailoringError ? { tailoringError } : {}),
  });
}
