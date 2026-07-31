import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import {
  approveResumeVariant,
  getResumeVariant,
  serializeResumeVariant,
  type ResumeVariantRow,
} from "@/lib/resumeVariants";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(variant.job_id) as
    | JobRow
    | undefined;
  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC, id DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  if (!job || !resume) {
    return NextResponse.json(
      { error: "The job or master resume no longer exists" },
      { status: 409 }
    );
  }
  const result = approveResumeVariant(db, variantId, {
    jobDescription: job.description,
    latestResumeId: resume.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({
    variant: serializeResumeVariant(getResumeVariant(db, variantId)),
  });
}
