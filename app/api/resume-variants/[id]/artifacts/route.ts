import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import {
  generateResumeArtifacts,
  getResumeArtifactSummaries,
} from "@/lib/resumeArtifacts";
import type { ResumeVariantRow } from "@/lib/resumeVariants";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantId = parseId(id);
  if (variantId === null) {
    return NextResponse.json({ error: "Invalid variant id" }, { status: 400 });
  }
  const db = getDb();
  const variant = db.prepare("SELECT id FROM resume_variants WHERE id = ?").get(variantId);
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  return NextResponse.json({
    artifacts: getResumeArtifactSummaries(db, variantId),
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantId = parseId(id);
  if (variantId === null) {
    return NextResponse.json({ error: "Invalid variant id" }, { status: 400 });
  }
  const db = getDb();
  const variant = db.prepare("SELECT * FROM resume_variants WHERE id = ?").get(variantId) as
    | ResumeVariantRow
    | undefined;
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  if (variant.status !== "approved") {
    return NextResponse.json(
      { error: "Approve the resume variant before exporting it" },
      { status: 409 }
    );
  }
  const resume = db.prepare("SELECT * FROM resumes WHERE id = ?").get(variant.resume_id) as
    | ResumeRow
    | undefined;
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(variant.job_id) as
    | JobRow
    | undefined;
  if (!resume || !job) {
    return NextResponse.json(
      { error: "The source resume or job no longer exists" },
      { status: 409 }
    );
  }

  try {
    const artifacts = await generateResumeArtifacts(db, variantId, {
      resumeText: resume.text,
      resumeFilename: resume.filename,
      company: job.company,
      jobTitle: job.title,
    });
    const failed = artifacts.some((artifact) => artifact.validationStatus !== "passed");
    return NextResponse.json(
      { artifacts },
      { status: failed ? 422 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not generate resume artifacts",
      },
      { status: 409 }
    );
  }
}
